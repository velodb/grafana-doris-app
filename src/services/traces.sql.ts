import SqlString from 'sqlstring';
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

      milliseconds_diff(timestamp, '1970-01-01 00:00:00') AS startTime,
      duration / 1000 AS duration,

      CAST(span_attributes AS TEXT) AS tags,
      CAST(ARRAY_MAP(e -> NAMED_STRUCT(
        'timestamp', CAST(milliseconds_diff(STRUCT_ELEMENT(e, 'timestamp'), '1970-01-01 00:00:00') AS BIGINT),
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
    FROM ${SqlString.escapeId(database)}.${SqlString.escapeId(table)}
    WHERE trace_id = ${SqlString.escape(trace_id)};
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
    const conditions: string[] = [];
    const regex = /([\w.]+)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(tags || '')) !== null) {
        const root = tableAlias ? `${tableAlias}.span_attributes` : 'span_attributes';
        const path = match[1]
            .split('.')
            .map(key => `[${SqlString.escape(key)}]`)
            .join('');
        conditions.push(`${root}${path} = ${SqlString.escape(match[2] || match[3] || match[4])}`);
    }
    return conditions.length ? conditions.join(' AND ') : '1=1';
}

function tableName(params: Pick<QueryTracesParams, 'database' | 'table'>): string {
    return `${SqlString.escapeId(params.database)}.${SqlString.escapeId(params.table)}`;
}

function spanFilter(params: QueryTracesParams): string {
    return [
        params.service_name && params.service_name !== 'all' ? `service_name = ${SqlString.escape(params.service_name)}` : '',
        params.operation && params.operation !== 'all' ? `span_name = ${SqlString.escape(params.operation)}` : '',
        params.statusCode && params.statusCode !== 'all' ? `status_code = ${SqlString.escape(params.statusCode)}` : '',
        params.tags ? tagsToDorisSQLConditions(params.tags) : '',
    ]
        .filter(Boolean)
        .join(' AND ');
}

function durationFilter(params: QueryTracesParams, expression = 'trace_duration_ms'): string {
    const min = parseDuration(params.minDuration);
    const max = parseDuration(params.maxDuration);
    return [min > 0 ? `${expression} >= ${min}` : '', max > 0 ? `${expression} <= ${max}` : ''].filter(Boolean).join(' AND ');
}

function orderBy(params: QueryTracesParams, summary = false): string {
    const columns: Record<string, string> = {
        'most-recent': summary ? 'start_time DESC' : 'time DESC',
        'longest-duration': 'trace_duration_ms DESC',
        'shortest-duration': 'trace_duration_ms ASC',
        'most-spans': summary ? 'span_count DESC' : 'spans DESC',
        'least-spans': summary ? 'span_count ASC' : 'spans ASC',
    };
    return `${columns[params.sortBy || 'most-recent'] || columns['most-recent']}, trace_id DESC`;
}

function pagination(params: QueryTracesParams): string {
    const limit = Math.max(1, Math.floor(params.page_size || 50));
    const offset = Math.max(0, (Math.floor(params.page || 1) - 1) * limit);
    return `LIMIT ${limit} OFFSET ${offset}`;
}

function legacyTraceCTEs(params: QueryTracesParams): string {
    const table = tableName(params);
    const time = SqlString.escapeId(params.timeField);
    const start = SqlString.escape(params.startDate);
    const end = SqlString.escape(params.endDate);
    const filters = spanFilter(params);
    return `WITH
  matching_trace_ids AS (
    SELECT DISTINCT trace_id FROM ${table}
    WHERE ${time} >= ${start} AND ${time} < ${end}${filters ? ` AND ${filters}` : ''}
  ),
  root_candidates AS (
    SELECT trace_id, ${time} AS root_time, span_name AS operation, service_name AS root_service,
      duration AS root_duration,
      ROW_NUMBER() OVER (PARTITION BY trace_id ORDER BY ${time} ASC, span_id ASC) AS root_rank
    FROM ${table}
    WHERE (parent_span_id IS NULL OR parent_span_id = '')
      AND ${time} >= ${start} AND ${time} < ${end}
      AND trace_id IN (SELECT trace_id FROM matching_trace_ids)
  ),
  selected_roots AS (
    SELECT * FROM root_candidates WHERE root_rank = 1
  ),
  trace_metrics AS (
    SELECT t.trace_id, milliseconds_diff(r.root_time, '1970-01-01 00:00:00') / 1000 AS time, r.operation, r.root_service,
      COLLECT_SET(t.service_name) AS services, COUNT(*) AS spans,
      SUM(IF(t.status_code IN ('STATUS_CODE_ERROR', 'ERROR'), 1, 0)) AS error_spans,
      MAX(t.duration) / 1000 AS max_span_duration_ms,
      MAX(milliseconds_diff(t.${time}, '1970-01-01 00:00:00') + t.duration / 1000)
        - MIN(milliseconds_diff(t.${time}, '1970-01-01 00:00:00')) AS trace_duration_ms,
      r.root_duration / 1000 AS root_span_duration_ms
    FROM ${table} t JOIN selected_roots r ON t.trace_id = r.trace_id
    WHERE t.${time} >= ${start} - INTERVAL 2 DAY AND t.${time} < ${end} + INTERVAL 2 DAY
    GROUP BY t.trace_id, r.root_time, r.operation, r.root_service, r.root_duration
  ),
  eligible_traces AS (
    SELECT * FROM trace_metrics${durationFilter(params) ? ` WHERE ${durationFilter(params)}` : ''}
  )`;
}

export function buildTraceAggSQLFromParams(params: QueryTracesParams): string {
    return `${legacyTraceCTEs(params)}
SELECT * FROM eligible_traces ORDER BY ${orderBy(params)} ${pagination(params)};`;
}

export function buildTraceCountSQLFromParams(params: QueryTracesParams): string {
    return `${legacyTraceCTEs(params)} SELECT COUNT(*) AS total FROM ${durationFilter(params) ? 'eligible_traces' : 'selected_roots'};`;
}

/** Keep the inner grouping/aggregates identical to the synchronous exporter MV.
 * Roll up BEFORE HAVING, ordering or pagination so midnight cannot split a trace.
 * Probe this exact shape with EXPLAIN; unsupported rewrites use the legacy path.
 */
function traceSummarySQL(params: QueryTracesParams): string {
    const table = tableName(params);
    const start = SqlString.escape(params.startDate);
    const end = SqlString.escape(params.endDate);
    const filters = spanFilter(params);
    const duration = durationFilter(params, 'milliseconds_diff(MAX(end_time), MIN(start_time))');
    return `SELECT trace_id, MIN(start_time) AS start_time, MAX(end_time) AS end_time,
    SUM(span_count) AS span_count, SUM(error_count) AS error_count,
    MIN(first_root) AS first_root, MAX(max_span_duration) AS max_span_duration,
    milliseconds_diff(MAX(end_time), MIN(start_time)) AS trace_duration_ms
FROM (
  SELECT trace_id, MIN(\`timestamp\`) AS start_time, MAX(end_time) AS end_time,
    COUNT(*) AS span_count,
    SUM(CASE WHEN status_code = 'STATUS_CODE_ERROR' THEN 1 ELSE 0 END) AS error_count,
    MIN(CASE WHEN is_root = 1 THEN CONCAT(DATE_FORMAT(\`timestamp\`, '%Y%m%d%H%i%s%f'), '|', service_name, '|', span_name) END) AS first_root,
    MAX(duration) AS max_span_duration
  FROM ${table}
  WHERE date_trunc(\`timestamp\`, 'day') >= date_trunc(${start}, 'day') - INTERVAL 2 DAY
    AND date_trunc(\`timestamp\`, 'day') <= date_trunc(${end}, 'day') + INTERVAL 2 DAY
    ${filters ? `AND trace_id IN (SELECT trace_id FROM ${table} WHERE \`timestamp\` >= ${start} AND \`timestamp\` < ${end} AND ${filters})` : ''}
  GROUP BY trace_id, date_trunc(\`timestamp\`, 'day')
) daily
GROUP BY trace_id
HAVING MIN(start_time) >= ${start} AND MIN(start_time) < ${end}
  AND MIN(first_root) IS NOT NULL${duration ? ` AND ${duration}` : ''}`;
}

export function buildTraceSummaryListSQL(params: QueryTracesParams): string {
    return `${traceSummarySQL(params)} ORDER BY ${orderBy(params, true)} ${pagination(params)};`;
}

export function buildTraceSummaryCountSQL(params: QueryTracesParams): string {
    return `SELECT COUNT(*) AS total, SUM(span_count) AS total_spans FROM (${traceSummarySQL(params)}) traces;`;
}

export function buildTraceSupplementSQL(params: QueryTracesParams, traceIds: string[]): string {
    // Fetch only this page. Earliest root uses span_id for deterministic ties,
    // which cannot be recovered from the MV's first_root string alone.
    return `WITH spans AS (
    SELECT * FROM ${tableName(params)}
    WHERE \`${params.timeField.replace(/`/g, '``')}\` >= ${SqlString.escape(params.startDate)} - INTERVAL 2 DAY
      AND \`${params.timeField.replace(/`/g, '``')}\` < ${SqlString.escape(params.endDate)} + INTERVAL 2 DAY
      AND trace_id IN (${traceIds.map(id => SqlString.escape(id)).join(', ') || 'NULL'})
  ), roots AS (
    SELECT trace_id, service_name, span_name, duration,
      ROW_NUMBER() OVER (PARTITION BY trace_id ORDER BY \`timestamp\` ASC, span_id ASC) AS root_rank
    FROM spans WHERE is_root = 1
  )
  SELECT s.trace_id, COLLECT_SET(s.service_name) AS services,
    r.service_name AS root_service, r.span_name AS operation, r.duration / 1000 AS root_span_duration_ms
  FROM spans s LEFT JOIN roots r ON s.trace_id = r.trace_id AND r.root_rank = 1
  GROUP BY s.trace_id, r.service_name, r.span_name, r.duration;`;
}

export function getServiceListSQL(params: TracesServicesParams): string {
    return `SELECT DISTINCT service_name FROM ${params.database ? SqlString.escapeId(params.database) + '.' : ''}${SqlString.escapeId(params.table)}
    WHERE ${SqlString.escapeId(params.timeField)} >= ${SqlString.escape(params.startDate)}
      AND ${SqlString.escapeId(params.timeField)} < ${SqlString.escape(params.endDate)} ORDER BY service_name ASC`;
}

export function getOperationListSQL(params: TracesOperationsParams): string {
    return `SELECT DISTINCT span_name FROM ${params.database ? SqlString.escapeId(params.database) + '.' : ''}${SqlString.escapeId(params.table)}
    WHERE ${SqlString.escapeId(params.timeField)} >= ${SqlString.escape(params.startDate)}
      AND ${SqlString.escapeId(params.timeField)} < ${SqlString.escape(params.endDate)}
      AND service_name = ${SqlString.escape(params.service_name)} ORDER BY span_name ASC`;
}
