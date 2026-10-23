import { t } from 'i18n';
import SqlString from 'sqlstring';
import dayjs from 'dayjs';
import { parseDorisTime, histogramOrigin, formatSqlTime } from 'utils/time';
import { FieldStatisticsParams, QueryTableDataParams, SurroundingParams, TopNQueryParams } from 'types/type';
import { addSqlFilter, getFilterFieldReference, transformFieldPath } from 'utils/sql-filter';

export { addSqlFilter, getFilterSQL, transformFieldPath } from 'utils/sql-filter';

function getVariantSortExpression(fieldPath: string, variantPath: string[], type?: string) {
    const expression = transformFieldPath(fieldPath, variantPath);
    const normalizedType = type?.toUpperCase();
    const castType = normalizedType?.includes('BOOLEAN') ? 'BOOLEAN' : normalizedType?.includes('DOUBLE') || normalizedType?.includes('FLOAT') || normalizedType?.includes('DECIMAL') || normalizedType?.includes('INT') ? 'DOUBLE' : 'STRING';
    return `CAST(${expression} AS ${castType})`;
}

export function getQueryOrderBySQL(params: Pick<QueryTableDataParams, 'sort' | 'sortField' | 'timeField'> & { sortFieldPath?: string[]; sortFieldType?: string }) {
    const sortField = params.sortField?.trim() || params.timeField;
    const direction = params.sort === 'ASC' ? 'ASC' : 'DESC';
    const primaryExpression = params.sortFieldPath?.length
        ? getVariantSortExpression(sortField, params.sortFieldPath, params.sortFieldType)
        : transformFieldPath(sortField);
    const primaryOrder = `${primaryExpression} ${direction}`;

    if (sortField === params.timeField) {
        return primaryOrder;
    }

    return `${primaryOrder}, ${transformFieldPath(params.timeField)} DESC`;
}

export function resolveQuerySortField(requestedField: string | undefined, timeField: string, availableFields: string[]) {
    return requestedField && new Set(availableFields).has(requestedField) ? requestedField : timeField;
}

export function getQueryTableResultSQL(params: QueryTableDataParams) {
    const indexesStatement = params.indexes_statement;
    let statement = `SELECT * FROM \`${params.database}\`.\`${params.table}\` WHERE`;

    if (indexesStatement && params.search_type === 'Search') {
        statement += ` (${indexesStatement}) AND`;
    }

    // timeField 加上反引号
    statement += ` (\`${params.timeField}\` BETWEEN '${params.startDate}' AND '${params.endDate}') `;

    statement = params.data_filters.reduce((prev, curr) => {
        return addSqlFilter(prev, curr);
    }, statement);

    if (params.search_type === 'SQL' && params.search_value) {
        statement = statement + ` AND ${params.search_value}`;
    }

    if (params.search_type === 'Lucene' && params.lucene_where) {
        statement = statement + ` AND (${params.lucene_where})`;
    }

    // ORDER BY 的 timeField 也加反引号
    statement = statement + ` ORDER BY ${getQueryOrderBySQL(params)} LIMIT ${+params.page_size} OFFSET ${(+params?.page - 1) * params.page_size} `;

    return statement;
}

const NUMERIC_DORIS_TYPE = /(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|LARGEINT|FLOAT|DOUBLE|DECIMAL)/i;

export function getTopNQuerySQL(params: TopNQueryParams, availableFields: Array<{ Field: string; Type?: string }>) {
    const limit = Number(params.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
        throw new Error(t('Top N limit must be an integer between 1 and 10000'));
    }
    const group = availableFields.find(field => field.Field === params.groupField);
    if (!group) {
        throw new Error(t('Top N group field is unavailable'));
    }
    const metric = params.metric || 'COUNT';
    if (!['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(metric)) {
        throw new Error(t('Top N aggregation is unsupported'));
    }
    const metricField = metric === 'COUNT' ? undefined : availableFields.find(field => field.Field === params.metricField);
    if (metric !== 'COUNT' && (!metricField || !NUMERIC_DORIS_TYPE.test(metricField.Type || ''))) {
        throw new Error(t('Top N metric requires an available numeric field'));
    }
    const groupExpression = transformFieldPath(group.Field);
    const metricExpression = metric === 'COUNT' ? 'COUNT(*)' : `${metric}(${transformFieldPath(metricField!.Field)})`;
    const metricAlias = '__top_n_value';
    let statement = `SELECT ${groupExpression} AS ${transformFieldPath(params.groupField)}, ${metricExpression} AS ${transformFieldPath(metricAlias)} FROM \`${params.database}\`.\`${params.table}\` WHERE`;
    if (params.indexes_statement && params.search_type === 'Search') {
        statement += ` (${params.indexes_statement}) AND`;
    }
    statement += ` (${transformFieldPath(params.timeField)} BETWEEN '${params.startDate}' AND '${params.endDate}')`;
    statement = (params.data_filters || []).reduce((sql, filter) => addSqlFilter(sql, filter), statement);
    if (params.search_type === 'SQL' && params.search_value) {
        statement += ` AND ${params.search_value}`;
    }
    if (params.search_type === 'Lucene' && params.lucene_where) {
        statement += ` AND (${params.lucene_where})`;
    }
    statement += ` GROUP BY ${groupExpression} ORDER BY ${transformFieldPath(metricAlias)} ${params.direction === 'ASC' ? 'ASC' : 'DESC'}, ${groupExpression} ASC LIMIT ${limit}`;
    return statement;
}

function getFieldStatisticsWhere(params: FieldStatisticsParams) {
    let statement = `FROM \`${params.database}\`.\`${params.table}\` WHERE`;
    if (params.indexes_statement && params.search_type === 'Search') {
        statement += ` (${params.indexes_statement}) AND`;
    }
    statement += ` (${transformFieldPath(params.timeField)} BETWEEN '${params.startDate}' AND '${params.endDate}')`;
    statement = (params.data_filters || []).reduce((sql, filter) => addSqlFilter(sql, filter), statement);
    if (params.search_type === 'SQL' && params.search_value) {
        statement += ` AND ${params.search_value}`;
    }
    if (params.search_type === 'Lucene' && params.lucene_where) {
        statement += ` AND (${params.lucene_where})`;
    }
    return statement;
}

function getFieldStatisticsExpression(params: FieldStatisticsParams) {
    return getFilterFieldReference({
        fieldName: params.field.Field,
        variantPath: params.field.variantPath,
        variantRootType: params.field.variantRootType,
        fieldType: params.field.Type,
        operator: 'is not null',
        value: [],
        id: 'field-statistics',
    });
}

function supportsFieldStatisticsHistogram(type?: string) {
    return /(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|LARGEINT|FLOAT|DOUBLE|DECIMAL|DATE|TIME|TIMESTAMP)/i.test(type || '');
}

export function getFieldStatisticsSummarySQL(params: FieldStatisticsParams) {
    const expression = getFieldStatisticsExpression(params);
    const histogram = supportsFieldStatisticsHistogram(params.field.Type) ? `, HISTOGRAM(${expression}, 20) AS \`__field_stats_histogram\`` : '';
    return `SELECT COUNT(*) AS \`__field_stats_total\`, COUNT(${expression}) AS \`__field_stats_non_null\`, APPROX_COUNT_DISTINCT(${expression}) AS \`__field_stats_distinct\`, MIN(${expression}) AS \`__field_stats_min\`, MAX(${expression}) AS \`__field_stats_max\`${histogram} ${getFieldStatisticsWhere(params)}`;
}

export function getFieldStatisticsTopValuesSQL(params: FieldStatisticsParams) {
    const expression = getFieldStatisticsExpression(params);
    return `SELECT ${expression} AS \`__field_stats_value\`, COUNT(*) AS \`__field_stats_count\` ${getFieldStatisticsWhere(params)} AND ${expression} IS NOT NULL GROUP BY ${expression} ORDER BY \`__field_stats_count\` DESC, ${expression} ASC LIMIT 5`;
}

export function getQueryTableChartsSQL(params: QueryTableDataParams) {
    const indexes = params.indexes;
    const unit = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'].includes(params.interval || '') ? params.interval! : 'hour';
    const period = Math.max(1, Math.floor(params.interval_value || 1));
    const zone = params.timeZone === 'browser' ? Intl.DateTimeFormat().resolvedOptions().timeZone : params.timeZone || 'UTC';
    const origin = histogramOrigin(parseDorisTime(params.startDate), { interval_unit: unit as dayjs.ManipulateType, interval_value: period }, zone);
    const field = SqlString.escapeId(params.timeField);
    // Fixed units stay on the absolute timeline so repeated DST hours remain distinct.
    const fixedUnit = ['second', 'minute', 'hour'].includes(unit);
    const bucket = fixedUnit
        ? `${unit}_FLOOR(${field}, ${period}, ${SqlString.escape(formatSqlTime(origin))})`
        : `CONVERT_TZ(${unit}_FLOOR(CONVERT_TZ(${field}, 'UTC', ${SqlString.escape(zone)}), ${period}, ${SqlString.escape(origin.format('YYYY-MM-DD HH:mm:ss'))}), ${SqlString.escape(zone)}, 'UTC')`;
    let statement = `SELECT ${bucket} AS TT, COUNT(*) AS \`sum(cnt)\` FROM \`${params.database}\`.\`${params.table}\` WHERE`;
    if (indexes && params.search_type === 'Search') {
        statement += ` (${indexes}) AND`;
    }
    statement += ` (\`${params.timeField}\` between '${params.startDate}' AND '${params.endDate}') `;
    if (params.data_filters.length > 0) {
        statement = params.data_filters.reduce((prev, curr) => {
            return addSqlFilter(prev, curr);
        }, statement);
    }
    if (params.search_type === 'SQL' && params.search_value) {
        statement = statement + ` ` + `AND ${params.search_value}`;
    }

    if (params.search_type === 'Lucene' && params.lucene_where) {
        statement = statement + ` AND (${params.lucene_where})`;
    }
    statement = statement + ` ` + `GROUP BY TT ORDER BY TT`;

    return statement;
}

export function getQueryTableResultCountSQL(params: QueryTableDataParams) {
    const indexes = params.indexes;
    let statement = `SELECT SUM(table_per_time.cnt) AS total_count
        FROM (
          SELECT ${params.interval}_FLOOR(${params.timeField}) as T, COUNT(*) as cnt
          FROM \`${params.database}\`.\`${params.table}\`
          WHERE`;
    if (indexes && params.search_type === 'Search') {
        statement += ` (${indexes}) AND`;
    }
    statement += ` (\`${params.timeField}\` between '${params.startDate}' AND '${params.endDate}')`;

    if (params.data_filters.length > 0) {
        statement = params.data_filters.reduce((prev, curr) => {
            return addSqlFilter(prev, curr);
        }, statement);
    }
    if (params.search_type === 'SQL' && params.search_value) {
        statement = statement + ` ` + `AND ${params.search_value}`;
    }

    if (params.search_type === 'Lucene' && params.lucene_where) {
        statement = statement + ` AND (${params.lucene_where})`;
    }
    statement = statement + ` ` + `GROUP BY T) AS table_per_time;`;
    return statement;
}

export function getSurroundingSQL(params: SurroundingParams) {
    const anchor = parseDorisTime(params.time);
    if (!anchor.isValid()) {
        throw new Error(t('Invalid surrounding log anchor'));
    }
    const hours = [1, 6, 24].includes(params.windowHours || 1) ? params.windowHours || 1 : 1;
    const anchorLiteral = SqlString.escape(anchor.format('YYYY-MM-DD HH:mm:ss.SSS'));
    const field = SqlString.escapeId(params.timeField);
    const lower = params.operator === '<' ? `${anchorLiteral} - INTERVAL ${hours} HOUR` : anchorLiteral;
    const upper = params.operator === '>' ? `${anchorLiteral} + INTERVAL ${hours} HOUR` : anchorLiteral;
    let statement = `SELECT * FROM ${SqlString.escapeId(params.database)}.${SqlString.escapeId(params.table)} WHERE (${field} BETWEEN ${lower} AND ${upper}) AND (${field} ${params.operator === '<' ? '<' : '>'} ${anchorLiteral})`;
    statement = (params.data_filters || []).reduce((sql: string, filter: any) => addSqlFilter(sql, filter), statement);
    return `${statement} ORDER BY ${field} ${params.operator === '<' ? 'DESC' : 'ASC'} LIMIT ${Math.max(1, Math.floor(+params.pageSize))}`;
}
