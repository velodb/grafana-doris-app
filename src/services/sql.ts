import { QueryTableDataParams, SurroundingParams } from 'types/type';
import { addSqlFilter, transformFieldPath } from 'utils/sql-filter';

export { addSqlFilter, getFilterSQL, transformFieldPath } from 'utils/sql-filter';

export function getQueryOrderBySQL(params: Pick<QueryTableDataParams, 'sort' | 'sortField' | 'timeField'>) {
    const sortField = params.sortField?.trim() || params.timeField;
    const direction = params.sort === 'ASC' ? 'ASC' : 'DESC';
    const primaryOrder = `${transformFieldPath(sortField)} ${direction}`;

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

export function getQueryTableChartsSQL(params: QueryTableDataParams) {
    const indexes = params.indexes;
    let statement = `SELECT ${params.interval}_FLOOR(table_per_time.T,${params.interval_value}) as TT,sum(table_per_time.cnt) FROM (SELECT ${params.interval}_FLOOR(${params.timeField}) as T,count(*) as cnt FROM \`${params.database}\`.\`${params.table}\` WHERE`;
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
    statement = statement + ` ` + `GROUP BY T ORDER BY T) as table_per_time GROUP BY TT ORDER BY TT`;

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
    let statement = `SELECT * FROM \`${params.database}\`.\`${params.table}\` WHERE`;
    statement += ` (\`${params.timeField}\` ${params.operator} '${params.time}')`;
    statement = params.data_filters.reduce((prev: any, curr: any) => {
        return addSqlFilter(prev, curr);
    }, statement);
    const orderSymbol = params.operator === '<' ? 'DESC' : 'ASC';
    statement = statement + ` ` + `ORDER BY \`${params.timeField}\` ${orderSymbol} LIMIT ${+params.pageSize}`;
    return statement;
}
