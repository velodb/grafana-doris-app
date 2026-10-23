import { normalizeColumnType } from 'utils/query-parser/column-types';
import { toDataFrame } from '@grafana/data';
import { getBackendSrv, logError } from '@grafana/runtime';
import { lastValueFrom, Observable, finalize, shareReplay } from 'rxjs';
import { withErrorHandler } from 'components/with-error-handler/withErrorHandler';
import { toError } from 'utils/errors';
import { escapeSqlIdentifier, quoteSqlLiteral } from 'utils/sql-filter';
import { DORIS_DATASOURCE_TYPE } from './grafana-permissions';

type GetColumnParams = {
    connectionId: string;
    database: string;
    table: string;
    column: string;
    datasourceType?: string;
};

type ColumnMetadata = {
    name: string;
    dataType?: string;
    columnType?: string;
};

type GetIndexesParams = {
    connectionId: string;
    database: string;
    table: string;
    datasourceType?: string;
};

type TryCastCapabilityParams = {
    connectionId: string;
    datasourceType?: string;
};

export type GetApplicationValuesParams = {
    selectdbDS: any;
    database: string;
    table: string;
    timeField: string;
    startDate: string;
    endDate: string;
    attributeKey: string;
};

const escapeSqlLiteral = (value: string) => value.replace(/'/g, "''");

// Cache capability probes during a Grafana session. SEARCH results are scoped
// to the table and expression because its referenced fields need indexes.
const tryCastSupportCache = new Map<string, Promise<boolean>>();
const jsonSearchSupportCache = new Map<string, Promise<boolean>>();
const searchSupportCache = new Map<string, Promise<boolean>>();

function querySucceeded(data: unknown, refId: string): boolean {
    const result = (data as { results?: Record<string, { error?: unknown; frames?: unknown[] }> })?.results?.[refId];
    // Grafana can return an HTTP-success response containing a per-query error.
    // Treat that as an unsupported capability instead of trusting frames alone.
    return Boolean(result && !result.error && result.frames?.length);
}

export async function supportsTryCast({
    connectionId,
    datasourceType = DORIS_DATASOURCE_TYPE,
}: TryCastCapabilityParams): Promise<boolean> {
    if (!connectionId) {
        return false;
    }

    const cacheKey = `${datasourceType}:${connectionId}`;
    const cached = tryCastSupportCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const supportPromise = (async (): Promise<boolean> => {
        const response$ = withErrorHandler(getBackendSrv().fetch({
            url: '/api/ds/query',
            method: 'POST',
            data: {
                queries: [{
                    refId: 'probeTryCast',
                    datasource: { type: datasourceType, uid: connectionId },
                    rawSql: 'SELECT TRY_CAST(1 AS BIGINT) AS try_cast_supported',
                    format: 'table',
                }],
            },
        }));

        try {
            const { data, ok } = await lastValueFrom(response$);
            return Boolean(ok && querySucceeded(data, 'probeTryCast'));
        } catch {
            return false;
        }
    })();

    tryCastSupportCache.set(cacheKey, supportPromise);
    return supportPromise;
}

/** JSON_SEARCH is required to preserve Lucene text semantics for JSON arrays. */
export async function supportsJsonSearch({
    connectionId,
    datasourceType = DORIS_DATASOURCE_TYPE,
}: TryCastCapabilityParams): Promise<boolean> {
    if (!connectionId) {
        return false;
    }

    const cacheKey = `${datasourceType}:${connectionId}`;
    const cached = jsonSearchSupportCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const supportPromise = (async (): Promise<boolean> => {
        const response$ = withErrorHandler(getBackendSrv().fetch({
            url: '/api/ds/query',
            method: 'POST',
            data: {
                queries: [{
                    refId: 'probeJsonSearch',
                    datasource: { type: datasourceType, uid: connectionId },
                    rawSql: "SELECT JSON_SEARCH(CAST('[\"x\"]' AS JSON), 'one', 'x') AS json_search_supported",
                    format: 'table',
                }],
            },
        }));

        try {
            const { data, ok } = await lastValueFrom(response$);
            return Boolean(ok && querySucceeded(data, 'probeJsonSearch'));
        } catch {
            return false;
        }
    })();

    jsonSearchSupportCache.set(cacheKey, supportPromise);
    return supportPromise;
}

/** Probe SEARCH against the current table and query because the function is a
 * WHERE predicate and each referenced field must have an inverted index. */
export async function supportsSearch({
    connectionId,
    datasourceType = DORIS_DATASOURCE_TYPE,
    databaseName,
    tableName,
    query,
}: TryCastCapabilityParams & { databaseName: string; tableName: string; query: string }): Promise<boolean> {
    if (!connectionId || !databaseName || !tableName || !query) {
        return false;
    }

    const cacheKey = JSON.stringify([datasourceType, connectionId, databaseName, tableName, query]);
    const cached = searchSupportCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const supportPromise = (async (): Promise<boolean> => {
        const response$ = withErrorHandler(getBackendSrv().fetch({
            url: '/api/ds/query',
            method: 'POST',
            data: {
                queries: [{
                    refId: 'probeSearch',
                    datasource: { type: datasourceType, uid: connectionId },
                    // SEARCH is a WHERE predicate and requires indexed fields in the scanned table.
                    // EXPLAIN validates the actual query without reading rows.
                    rawSql: `EXPLAIN SELECT 1 FROM ${escapeSqlIdentifier(databaseName)}.${escapeSqlIdentifier(tableName)} WHERE SEARCH(${quoteSqlLiteral(query)}, '{"mode":"lucene"}')`,
                    format: 'table',
                }],
            },
        }), { showBackendError: false });

        try {
            const { data, ok } = await lastValueFrom(response$);
            return Boolean(ok && querySucceeded(data, 'probeSearch'));
        } catch {
            return false;
        }
    })();

    searchSupportCache.set(cacheKey, supportPromise);
    return supportPromise;
}


export async function getColumn({
    connectionId,
    database,
    table,
    column,
    datasourceType = DORIS_DATASOURCE_TYPE,
}: GetColumnParams): Promise<(ColumnMetadata & { normalizedType: string }) | null> {
    if (!connectionId || !database || !table || !column) {
        return null;
    }

    const query = `
SELECT
  COLUMN_NAME AS Field,
  DATA_TYPE AS DataType,
  COLUMN_TYPE AS ColumnType
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '${escapeSqlLiteral(database)}'
  AND TABLE_NAME = '${escapeSqlLiteral(table)}'
  AND COLUMN_NAME = '${escapeSqlLiteral(column)}'
LIMIT 1;
`;

    const response$ = withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getColumn',
                    datasource: { type: datasourceType, uid: connectionId },
                    rawSql: query,
                    format: 'table',
                },
            ],
        },
    }));

    try {
        const { data, ok } = await lastValueFrom(response$);
        if (!ok) {
            return null;
        }

        const resultData = data as { results?: Record<string, any> };
        const frame = resultData?.results?.getColumn?.frames?.[0];
        if (!frame) {
            return null;
        }

        const dataFrame = toDataFrame(frame);
        const nameField = dataFrame.fields.find(field => field.name === 'Field') ?? dataFrame.fields[0];
        const dataTypeField = dataFrame.fields.find(field => field.name === 'DataType');
        const columnTypeField = dataFrame.fields.find(field => field.name === 'ColumnType');

        const name = nameField?.values?.get?.(0);
        if (!name) {
            return null;
        }

        const dataTypeValue = dataTypeField?.values?.get?.(0);
        const columnTypeValue = columnTypeField?.values?.get?.(0);

        const columnInfo: ColumnMetadata = {
            name: String(name),
            dataType: dataTypeValue != null ? String(dataTypeValue) : undefined,
            columnType: columnTypeValue != null ? String(columnTypeValue) : undefined,
        };

        const normalizedType = normalizeColumnType({
            dataType: columnInfo.dataType,
            columnType: columnInfo.columnType,
        });

        return {
            ...columnInfo,
            normalizedType,
        };
    } catch (error) {
        logError(toError(error), { source: 'metaservice', action: 'getColumnInfo' });
        return null;
    }
}

export async function getInvertedIndexColumns({
    connectionId,
    database,
    table,
    datasourceType = DORIS_DATASOURCE_TYPE,
}: GetIndexesParams): Promise<string[]> {
    if (!connectionId || !database || !table) {
        return [];
    }

    const query = `SHOW INDEXES FROM \`${database}\`.\`${table}\``;

    const response$ = withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getInvertedIndexes',
                    datasource: { type: datasourceType, uid: connectionId },
                    rawSql: query,
                    format: 'table',
                },
            ],
        },
    }));

    try {
        const { data, ok } = await lastValueFrom(response$);
        if (!ok) {
            return [];
        }

        const resultData = data as { results?: Record<string, any> };
        const frame =
            resultData?.results?.getInvertedIndexes?.frames?.[0] ??
            resultData?.results?.getIndexes?.frames?.[0];

        if (!frame) {
            return [];
        }

        const dataFrame = toDataFrame(frame);
        const columnNameField =
            dataFrame.fields.find(field => field.name === 'Column_name') ??
            dataFrame.fields.find(field => field.name === 'COLUMN_NAME');
        const indexTypeField =
            dataFrame.fields.find(field => field.name === 'Index_type') ??
            dataFrame.fields.find(field => field.name === 'INDEX_TYPE');

        if (!columnNameField || !indexTypeField) {
            return [];
        }

        const columnNames = Array.from(columnNameField.values ?? []);
        const indexTypes = Array.from(indexTypeField.values ?? []);
        const indexedColumns = new Set<string>();

        for (let i = 0; i < columnNames.length; i += 1) {
            const columnName = columnNames[i];
            const indexType = indexTypes[i];
            if (typeof columnName !== 'string' || columnName.length === 0) {
                continue;
            }
            if (typeof indexType !== 'string') {
                continue;
            }

            if (indexType.toUpperCase().includes('INVERT')) {
                indexedColumns.add(columnName);
            }
        }

        return Array.from(indexedColumns);
    } catch (error) {
        logError(toError(error), { source: 'metaservice', action: 'getInvertedIndexColumns' });
        return [];
    }
}


export function getDatabases(selectdbDS: any) {
    const response$ = getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getDatabases',
                    datasource: {
                        type: selectdbDS.type || DORIS_DATASOURCE_TYPE,
                        uid: selectdbDS.uid,
                    },
                    rawSql: 'SHOW DATABASES',
                    format: 'table',
                },
            ],
        },
    });
    return withErrorHandler(response$);
}

export function getTablesService({ selectdbDS, database }: { selectdbDS: any; database: string }) {
    return withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getTables',
                    datasource: { type: selectdbDS.type || DORIS_DATASOURCE_TYPE, uid: selectdbDS.uid },
                    rawSql: `SHOW TABLES FROM \`${database}\``,
                    format: 'table',
                },
            ],
        },
    }));
}

const tableMetadataRequests = new Map<string, Observable<any>>();

function sharedMetadataRequest(key: string, request: () => Observable<any>): Observable<any> {
    const existing = tableMetadataRequests.get(key);
    if (existing) {
        return existing;
    }
    const response = request().pipe(finalize(() => tableMetadataRequests.delete(key)), shareReplay({ bufferSize: 1, refCount: true }));
    tableMetadataRequests.set(key, response);
    return response;
}

export function getFieldsService({ selectdbDS, database, table }: { selectdbDS: any; database: string; table: string }) {
    return sharedMetadataRequest(JSON.stringify(['fields', selectdbDS.uid, database, table]), () => withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getFields',
                    datasource: { type: selectdbDS.type || DORIS_DATASOURCE_TYPE, uid: selectdbDS.uid },
                    rawSql: `SHOW COLUMNS FROM \`${database}\`.\`${table}\``,
                    format: 'table',
                },
            ],
        },
    })));
}

export function getVariantFieldsService({ selectdbDS, database, table }: { selectdbDS: any; database: string; table: string }) {
    return withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getVariantFields',
                    datasource: { type: selectdbDS.type || DORIS_DATASOURCE_TYPE, uid: selectdbDS.uid },
                    rawSql: `DESC \`${database}\`.\`${table}\``,
                    format: 'table',
                    // The datasource executes this setting and DESC through the
                    // same Doris connection. A standalone SET would be lost,
                    // because normal datasource queries use fresh connections.
                    describeExtendVariantColumn: true,
                },
            ],
        },
    }));
}

export function getVariantPathSampleService(params: {
    selectdbDS: any;
    database: string;
    table: string;
    timeField: string;
    startDate: string;
    endDate: string;
    columns: string[];
}) {
    const { selectdbDS, database, table, timeField, startDate, endDate, columns } = params;
    const projections = columns.map((column, index) =>
        `CAST(${escapeSqlIdentifier(column)} AS STRING) AS c${index + 1}`,
    );
    return withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [{
                refId: 'sampleVariantPaths',
                datasource: { type: selectdbDS.type || DORIS_DATASOURCE_TYPE, uid: selectdbDS.uid },
                rawSql: `SELECT ${projections.join(', ')} FROM ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(table)} WHERE ${escapeSqlIdentifier(timeField)} BETWEEN ${quoteSqlLiteral(startDate)} AND ${quoteSqlLiteral(endDate)} ORDER BY rand() LIMIT 5000`,
                format: 'table',
            }],
        },
    }));
}

export function getApplicationValuesSQL({
    database,
    table,
    timeField,
    startDate,
    endDate,
    attributeKey,
}: Omit<GetApplicationValuesParams, 'selectdbDS'>): string {
    const resourceAttributes = escapeSqlIdentifier('resource_attributes');
    const applicationExpression = `CAST(${resourceAttributes}[${quoteSqlLiteral(attributeKey)}] AS STRING)`;

    return `
SELECT ${applicationExpression} AS application
FROM ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(table)}
WHERE ${escapeSqlIdentifier(timeField)} BETWEEN ${quoteSqlLiteral(startDate)} AND ${quoteSqlLiteral(endDate)}
  AND ${applicationExpression} IS NOT NULL
  AND ${applicationExpression} != ''
GROUP BY application
ORDER BY application
LIMIT 200;
`;
}

export function getApplicationValuesService(params: GetApplicationValuesParams) {
    const { selectdbDS, ...queryParams } = params;

    return withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getApplicationValues',
                    datasource: { type: selectdbDS.type || DORIS_DATASOURCE_TYPE, uid: selectdbDS.uid },
                    rawSql: getApplicationValuesSQL(queryParams),
                    format: 'table',
                },
            ],
        },
    }));
}

export function getColumnFromFieldService({ selectdbDS, database, table }: { selectdbDS: any; database: string; table: string }) {
    // return getBackendSrv().fetch({
    //     url: '/api/ds/query',
    //     method: 'POST',
    //     data: {
    //         queries: [
    //             {
    //                 refId: 'getColumnFromFieldService',
    //                 datasource: { type: 'mysql', uid: selectdbDS.uid },
    //                 rawSql: `SHOW COLUMNS FROM \`${database}\`.\`${table}\``,
    //                 format: 'table',
    //             },
    //         ],
    //     },
    // });
}

export function getIndexesService({ selectdbDS, database, table }: { selectdbDS: any; database: string; table: string }) {
    return sharedMetadataRequest(JSON.stringify(['indexes', selectdbDS.uid, database, table]), () => withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getIndexes',
                    datasource: { type: selectdbDS.type || DORIS_DATASOURCE_TYPE, uid: selectdbDS.uid },
                    rawSql: `SHOW INDEXES FROM \`${database}\`.\`${table}\``,
                    format: 'table',
                },
            ],
        },
    })));
}
