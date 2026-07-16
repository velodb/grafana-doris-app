import { QueryTracesParams, TracesOperationsParams, TracesServicesParams } from 'types/type';

interface QueryTraceDetailParams {
  database: string;
  table: string;
  trace_id: string;
}

export function getQueryTableTraceSQL(params: QueryTraceDetailParams): string {
    const { table, trace_id, database } = params;

    const sql = `
      SELECT
      trace_id AS traceID,
      span_id AS spanID,
      parent_span_id AS parentSpanID,
      span_name AS operationName,
      service_name AS serviceName,

      CAST(resource_attributes AS TEXT) AS serviceTags,

      UNIX_TIMESTAMP(timestamp) * 1000 AS startTime,
      duration / 1000 AS duration,

      CAST(span_attributes AS TEXT) AS tags,
      CAST(ARRAY_MAP(e -> NAMED_STRUCT(
        'timestamp', CAST(UNIX_TIMESTAMP(STRUCT_ELEMENT(e, 'timestamp')) * 1000 AS BIGINT),
        'name', STRUCT_ELEMENT(e, 'name'),
        'attributes', STRUCT_ELEMENT(e, 'attributes')
      ), events) AS JSON) AS logs,

      span_kind AS kind,
      CASE
        WHEN status_code IN ('STATUS_CODE_ERROR', 'ERROR') THEN 2
        WHEN status_code IN ('STATUS_CODE_OK', 'OK') THEN 1
        ELSE 0
      END AS statusCode,
      status_message AS statusMessage,
      scope_name AS instrumentationLibraryName,
      scope_version AS instrumentationLibraryVersion,
      trace_state AS traceState
    FROM ${database}.\`${table}\`
    WHERE trace_id = '${trace_id}';
    `;

    return sql;
}
function parseDuration(input?: string): number {
  if (!input) {
    return 0;
  }

  const normalizedInput = input.trim().toLowerCase();

  if (!normalizedInput) {
    return 0;
  }

  if (normalizedInput.endsWith('ms')) {
    return parseFloat(normalizedInput.replace('ms', ''));
  } else if (normalizedInput.endsWith('us')) {
    return parseFloat(normalizedInput.replace('us', '')) / 1000;
  } else if (normalizedInput.endsWith('s')) {
    return parseFloat(normalizedInput.replace('s', '')) * 1000;
  }

  // Treat bare numeric input as milliseconds for simpler filtering.
  const numericDuration = parseFloat(normalizedInput);
  return Number.isFinite(numericDuration) ? numericDuration : 0;
}

function tagsToDorisSQLConditions(tags?: string, tableAlias?: string): string {
  if (!tags) {
    return '1=1';
  }
  const conditions: string[] = [];

    const regex = /([\w.]+)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(tags)) !== null) {
        const key = match[1];
        const val = match[2] || match[3] || match[4];
        const spanAttributes = tableAlias ? `${tableAlias}.span_attributes` : 'span_attributes';
        conditions.push(`${spanAttributes}['${key}'] = '${val}'`);
    }

  return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
}

function buildMostRecentTraceAggSQL(
  params: QueryTracesParams,
  limit: number,
  offset: number,
  durationFilter: string,
): string {
  const rootFilters = ['root_rank = 1'];
  if (params.service_name && params.service_name !== 'all') {
    rootFilters.push(`root_service = '${params.service_name}'`);
  }
  if (params.operation && params.operation !== 'all') {
    rootFilters.push(`operation = '${params.operation}'`);
  }

  const extendedTimeFilter = (alias: string) =>
    `${alias}.${params.timeField} >= '${params.startDate}' - INTERVAL 2 DAY
      AND ${alias}.${params.timeField} < '${params.endDate}' + INTERVAL 2 DAY`;

  const optionalCtes: string[] = [];
  const eligibilityJoins: string[] = [];
  const eligibilityFilters: string[] = ['1=1'];

  if (params.statusCode && params.statusCode !== 'all') {
    optionalCtes.push(`status_trace_ids AS (
    SELECT DISTINCT t.trace_id
    FROM ${params.table} t
    JOIN selected_roots r ON t.trace_id = r.trace_id
    WHERE ${extendedTimeFilter('t')}
      AND t.status_code = '${params.statusCode}'
  )`);
    eligibilityJoins.push('JOIN status_trace_ids s ON r.trace_id = s.trace_id');
  }

  if (params.tags) {
    optionalCtes.push(`tag_trace_ids AS (
    SELECT DISTINCT t.trace_id
    FROM ${params.table} t
    JOIN selected_roots r ON t.trace_id = r.trace_id
    WHERE ${extendedTimeFilter('t')}
      AND ${tagsToDorisSQLConditions(params.tags, 't')}
  )`);
    eligibilityJoins.push('JOIN tag_trace_ids g ON r.trace_id = g.trace_id');
  }

  if (durationFilter !== '1=1') {
    optionalCtes.push(`trace_durations AS (
    SELECT
      t.trace_id,
      MAX(UNIX_TIMESTAMP(t.${params.timeField}) * 1000 + t.duration / 1000)
        - MIN(UNIX_TIMESTAMP(t.${params.timeField}) * 1000) AS trace_duration_ms
    FROM ${params.table} t
    JOIN selected_roots r ON t.trace_id = r.trace_id
    WHERE ${extendedTimeFilter('t')}
    GROUP BY t.trace_id
  )`);
    eligibilityJoins.push('JOIN trace_durations d ON r.trace_id = d.trace_id');
    eligibilityFilters.push(durationFilter.replace(/trace_duration_ms/g, 'd.trace_duration_ms'));
  }

  const ctes = [
    `root_span_candidates AS (
    SELECT
      trace_id,
      ${params.timeField} AS root_time,
      span_name AS operation,
      service_name AS root_service,
      duration AS root_duration,
      ROW_NUMBER() OVER (
        PARTITION BY trace_id
        ORDER BY ${params.timeField} ASC, span_id ASC
      ) AS root_rank
    FROM ${params.table}
    WHERE ${params.timeField} >= '${params.startDate}'
      AND ${params.timeField} < '${params.endDate}'
      AND (parent_span_id IS NULL OR parent_span_id = '')
  )`,
    `selected_roots AS (
    SELECT trace_id, root_time, operation, root_service, root_duration
    FROM root_span_candidates
    WHERE ${rootFilters.join('\n      AND ')}
  )`,
    ...optionalCtes,
    `eligible_roots AS (
    SELECT r.*
    FROM selected_roots r
    ${eligibilityJoins.join('\n    ')}
    WHERE ${eligibilityFilters.join('\n      AND ')}
  )`,
    `counted_roots AS (
    SELECT r.*, COUNT(*) OVER() AS total_count
    FROM eligible_roots r
  )`,
    `page_root_spans AS (
    SELECT *
    FROM counted_roots
    ORDER BY root_time DESC, trace_id DESC
    LIMIT ${limit} OFFSET ${offset}
  )`,
  ];

  return `
USE ${params.database};

WITH
  ${ctes.join(',\n  ')}

SELECT
  UNIX_TIMESTAMP(p.root_time) AS time,
  t.trace_id,
  p.operation,
  p.root_service,
  COLLECT_SET(t.service_name) AS services,
  COUNT(*) AS spans,
  SUM(IF(t.status_code IN ('STATUS_CODE_ERROR', 'ERROR'), 1, 0)) AS error_spans,
  MAX(t.duration) / 1000 AS max_span_duration_ms,
  MAX(UNIX_TIMESTAMP(t.${params.timeField}) * 1000 + t.duration / 1000)
    - MIN(UNIX_TIMESTAMP(t.${params.timeField}) * 1000) AS trace_duration_ms,
  p.root_duration / 1000 AS root_span_duration_ms,
  p.total_count,
  p.total_count AS total
FROM ${params.table} t
JOIN page_root_spans p ON t.trace_id = p.trace_id
WHERE ${extendedTimeFilter('t')}
GROUP BY
  p.root_time,
  t.trace_id,
  p.operation,
  p.root_service,
  p.root_duration,
  p.total_count
ORDER BY p.root_time DESC, t.trace_id DESC;
`;
}

export function buildTraceAggSQLFromParams(params: QueryTracesParams): string {
  const timeFilter = `${params.timeField} >= '${params.startDate}' AND ${params.timeField} < '${params.endDate}'`;

  const serviceFilter = params.service_name && params.service_name !== 'all' ? `service_name = '${params.service_name}'` : '1=1';

  const operationFilter = params.operation && params.operation !== 'all' ? `span_name = '${params.operation}'` : '1=1';

  const statusFilter = params.statusCode && params.statusCode !== 'all' ? `status_code = '${params.statusCode}'` : '1=1';

  const minDuration = parseDuration(params.minDuration);
  const maxDuration = parseDuration(params.maxDuration);

  let durationFilter = '1=1';
  if (minDuration > 0 && maxDuration > 0) {
    durationFilter = `trace_duration_ms BETWEEN ${minDuration} AND ${maxDuration}`;
  } else if (minDuration > 0) {
    durationFilter = `trace_duration_ms >= ${minDuration}`;
  } else if (maxDuration > 0) {
    durationFilter = `trace_duration_ms <= ${maxDuration}`;
  }

  const tagsFilter = tagsToDorisSQLConditions(params.tags);

  let rootSpansFilter = '1=1';
  if (params.service_name && params.service_name !== 'all') {
    rootSpansFilter = `service_name = '${params.service_name}'`;
  }
  if (params.operation && params.operation !== 'all') {
    rootSpansFilter += ` AND span_name = '${params.operation}'`;
  }

  const limit = params.page_size ?? 1000;
  const offset = Math.max(((params.page ?? 1) - 1) * limit, 0);

  if (!params.sortBy || params.sortBy === 'most-recent') {
    return buildMostRecentTraceAggSQL(params, limit, offset, durationFilter);
  }

  let rowNumberOrderBy = 'time DESC';
  switch (params.sortBy) {
    case 'longest-duration':
      rowNumberOrderBy = 'trace_duration_ms DESC';
      break;
    case 'shortest-duration':
      rowNumberOrderBy = 'trace_duration_ms ASC';
      break;
    case 'most-spans':
      rowNumberOrderBy = 'spans DESC';
      break;
    case 'least-spans':
      rowNumberOrderBy = 'spans ASC';
      break;
    case 'most-recent':
      rowNumberOrderBy = 'time DESC';
      break;
  }

  const query = `
USE ${params.database};

WITH
  trace_durations AS (
    SELECT
      trace_id,
      MAX(UNIX_TIMESTAMP(timestamp) * 1000 + duration / 1000) - MIN(UNIX_TIMESTAMP(timestamp) * 1000) AS trace_duration_ms
    FROM ${params.table}
    WHERE ${timeFilter}
    GROUP BY trace_id
  ),
  all_trace_ids AS (
    SELECT
      t.trace_id,
      MIN(t.${params.timeField}) AS time,
      d.trace_duration_ms
    FROM ${params.table} t
    JOIN trace_durations d ON t.trace_id = d.trace_id
    WHERE
      ${timeFilter}
      AND ${serviceFilter}
      AND ${operationFilter}
      AND ${statusFilter}
      AND ${tagsFilter}
      AND 1=1
      AND ${durationFilter}
    GROUP BY t.trace_id, d.trace_duration_ms
  ),
  root_spans AS (
    SELECT trace_id, span_name AS operation, service_name AS root_service
    FROM ${params.table}
    WHERE (parent_span_id IS NULL
    OR parent_span_id = '')
    AND ${timeFilter}
    AND ${rootSpansFilter}
    group by trace_id,operation,root_service
  ),
  aggregated AS (
    SELECT
      UNIX_TIMESTAMP(MIN(t.${params.timeField})) AS time,
      t.trace_id,
      r.operation,
      r.root_service,
      COLLECT_SET(t.service_name) AS services,
      COUNT(*) AS spans,
      SUM(IF(status_code = 'STATUS_CODE_ERROR', 1, 0)) AS error_spans,
      MAX(duration) / 1000 AS max_span_duration_ms,
      MAX(UNIX_TIMESTAMP(t.timestamp) * 1000 + duration / 1000) - MIN(UNIX_TIMESTAMP(t.timestamp) * 1000) AS trace_duration_ms,
      MAX(IF(t.parent_span_id IS NULL OR t.parent_span_id = '', duration, 0)) / 1000 AS root_span_duration_ms
    FROM ${params.table} t
    JOIN all_trace_ids a ON t.trace_id = a.trace_id
    JOIN root_spans r ON t.trace_id = r.trace_id
    GROUP BY t.trace_id, r.operation, r.root_service
  ),
  numbered AS (
    SELECT
      a.*,
      COUNT(*) OVER() AS total_count,
      ROW_NUMBER() OVER(ORDER BY ${rowNumberOrderBy}) AS rn
    FROM aggregated a
  )

SELECT
  *,
  total_count AS total
FROM numbered
WHERE rn > ${offset} AND rn <= ${offset + limit}
ORDER BY ${rowNumberOrderBy};
`;

  return query;
}

export function getServiceListSQL(params: TracesServicesParams): string {
  return `
    SELECT DISTINCT service_name 
    FROM ${params.table} 
    WHERE ${params.timeField} BETWEEN '${params.startDate}' AND '${params.endDate}' 
    ORDER BY service_name ASC
  `;
}

export function getOperationListSQL(params: TracesOperationsParams): string {
  return `
    SELECT DISTINCT span_name 
    FROM ${params.table} 
    WHERE ${params.timeField} BETWEEN '${params.startDate}' AND '${params.endDate}' 
    AND service_name = '${params.service_name}'
    ORDER BY span_name ASC
  `;
}
