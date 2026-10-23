import { getWhereSQLViaLucene } from 'services/lucene';
import { getColumn, getInvertedIndexColumns, supportsJsonSearch, supportsSearch, supportsTryCast } from 'services/metaservice';

jest.mock('services/metaservice', () => ({
    getColumn: jest.fn(),
    supportsJsonSearch: jest.fn(),
    supportsSearch: jest.fn(),
    supportsTryCast: jest.fn(),
    getInvertedIndexColumns: jest.fn(),
}));

const mockedGetColumn = getColumn as jest.MockedFunction<typeof getColumn>;
const mockedSupportsTryCast = supportsTryCast as jest.MockedFunction<typeof supportsTryCast>;
const mockedSupportsJsonSearch = supportsJsonSearch as jest.MockedFunction<typeof supportsJsonSearch>;
const mockedSupportsSearch = supportsSearch as jest.MockedFunction<typeof supportsSearch>;
const mockedGetInvertedIndexColumns = getInvertedIndexColumns as jest.MockedFunction<typeof getInvertedIndexColumns>;

describe('getWhereSQLViaLucene', () => {
    const baseParams = {
        databaseName: 'logs',
        tableName: 'events',
        connectionId: 'conn-1',
        datasourceType: 'mysql',
    };

    beforeEach(() => {
        mockedGetColumn.mockReset();
        mockedSupportsTryCast.mockReset();
        mockedSupportsJsonSearch.mockReset();
        mockedSupportsSearch.mockReset();
        mockedGetInvertedIndexColumns.mockReset();
        mockedSupportsTryCast.mockResolvedValue(true);
        mockedSupportsJsonSearch.mockResolvedValue(true);
        mockedSupportsSearch.mockResolvedValue(false);
    });

    it('uses the SQL serializer for explicit text queries while Doris SEARCH is disabled', async () => {
        mockedSupportsSearch.mockResolvedValue(true);

        const result = await getWhereSQLViaLucene({ ...baseParams, query: 'message:"hello world"' });

        expect(result).toBe("(message = 'hello world')");
        expect(mockedSupportsSearch).not.toHaveBeenCalled();
    });

    it('uses the SQL serializer for explicit text boolean combinations while Doris SEARCH is disabled', async () => {
        mockedSupportsSearch.mockResolvedValue(true);

        const result = await getWhereSQLViaLucene({ ...baseParams, query: 'message:error AND service:api' });

        expect(result).toBe("(message MATCH_ANY 'error') AND (service MATCH_ANY 'api')");
        expect(mockedSupportsSearch).not.toHaveBeenCalled();
    });

    it.each(['status:>=200', 'message:*', 'timestamp:[1 TO 2]', 'attrs["http.status"]:200'])(
        'keeps unsupported SEARCH query shapes on the SQL serializer: %s',
        async (query) => {
            mockedSupportsSearch.mockResolvedValue(true);
            mockedGetColumn.mockImplementation(async ({ column }) => column === 'attrs'
                ? { name: 'attrs', normalizedType: 'Variant', dataType: 'variant', columnType: 'variant' }
                : null);
            mockedGetInvertedIndexColumns.mockResolvedValue([]);

            await getWhereSQLViaLucene({ ...baseParams, query });

            expect(mockedSupportsSearch).not.toHaveBeenCalled();
        },
    );

    it('returns empty SQL for blank queries', async () => {
        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: '   ',
        });

        expect(result).toBe('');
        expect(mockedGetColumn).not.toHaveBeenCalled();
        expect(mockedGetInvertedIndexColumns).not.toHaveBeenCalled();
    });

    it('builds numeric equality clauses', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'status') {
                return {
                    name: 'status',
                    normalizedType: 'Int32',
                    dataType: 'int',
                    columnType: 'int(11)',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'status:200',
        });

        expect(result).toBe("(`status` = CAST('200' AS DOUBLE))");
        expect(mockedGetColumn).toHaveBeenCalledWith({
            column: 'status',
            connectionId: 'conn-1',
            database: 'logs',
            datasourceType: 'mysql',
            table: 'events',
        });
    });

    it('uses inverted indexes for string phrase searches', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'message') {
                return {
                    name: 'message',
                    normalizedType: 'String',
                    dataType: 'varchar',
                    columnType: 'varchar(255)',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue(['message']);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'message:"hello world"',
        });

        expect(result).toBe("(message MATCH_PHRASE 'hello world')");
        expect(mockedGetInvertedIndexColumns).toHaveBeenCalledWith({
            connectionId: 'conn-1',
            database: 'logs',
            datasourceType: 'mysql',
            table: 'events',
        });
    });

    it('falls back to LIKE for variant nested text searches without inverted indexes', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.message:error',
        });

        expect(result).toBe("(`attrs`['message'] = 'error')");
    });

    it('expands a bracketed dotted VARIANT path into nested accessors', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'resource_attributes') {
                return { name: 'resource_attributes', normalizedType: 'Variant', dataType: 'variant', columnType: 'variant' };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'resource_attributes["k8s.pod.name"]:\'catalog-1\'',
        });

        expect(result).toBe("(`resource_attributes`['k8s']['pod']['name'] = 'catalog-1')");
    });

    it('expands bracketed dotted paths for numeric and boolean VARIANT comparisons', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return { name: 'attrs', normalizedType: 'Variant', dataType: 'variant', columnType: 'variant' };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        await expect(getWhereSQLViaLucene({ ...baseParams, query: 'attrs["duration.ms"]:>500' }))
            .resolves.toBe("(TRY_CAST(`attrs`['duration']['ms'] AS BIGINT) > CAST('500' AS BIGINT))");
        await expect(getWhereSQLViaLucene({ ...baseParams, query: 'attrs["is.ready"]:true' }))
            .resolves.toBe("(TRY_CAST(`attrs`['is']['ready'] AS BOOLEAN) = CAST('true' AS BOOLEAN))");
    });

    it('reports a misspelled root column in a bracketed Lucene path', async () => {
        mockedGetColumn.mockResolvedValue(null);

        await expect(getWhereSQLViaLucene({ ...baseParams, query: 'logs_attributes["latency_ms"]:>250' }))
            .rejects.toThrow('Unknown column "logs_attributes" in Lucene field "logs_attributes.latency_ms"');
    });

    it('uses JSON_EXTRACT for Lucene queries on JSON child paths', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'log_attributes') {
                return { name: 'log_attributes', normalizedType: 'JSON', dataType: 'json', columnType: 'json' };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const number = await getWhereSQLViaLucene({ ...baseParams, query: 'log_attributes["http.status"]:200' });
        expect(number).toContain("JSON_TYPE(`log_attributes`, '$.\"http.status\"') IN ('int', 'bigint', 'largeint', 'double')");
        expect(number).toContain("JSON_CONTAINS(JSON_EXTRACT(`log_attributes`, '$.\"http.status\"'), CAST('200' AS JSON))");
        const bool = await getWhereSQLViaLucene({ ...baseParams, query: 'log_attributes["is.ready"]:true' });
        expect(bool).toContain("JSON_TYPE(`log_attributes`, '$.\"is.ready\"') = 'bool'");
        const text = await getWhereSQLViaLucene({ ...baseParams, query: 'log_attributes["http.route"]:"/checkout"' });
        expect(text).toContain("JSON_UNQUOTE(JSON_EXTRACT(`log_attributes`, '$.\"http.route\"'))");
        expect(text).toContain('JSON_SEARCH(JSON_EXTRACT');
        const escapedText = await getWhereSQLViaLucene({ ...baseParams, query: 'log_attributes["http.route"]:"50%_done"' });
        expect(escapedText).toContain("'%50\\\\%\\\\_done%'");
        const escapedKey = await getWhereSQLViaLucene({ ...baseParams, query: 'log_attributes["a\\\"b"]:ok' });
        expect(escapedKey).toContain("'$.\"a\\\\\"b\"'");
        const range = await getWhereSQLViaLucene({ ...baseParams, query: 'log_attributes.duration:[100 TO 500]' });
        expect(range).toContain("CAST(JSON_EXTRACT(`log_attributes`, '$.\"duration\"') AS DOUBLE) >= CAST('100' AS DOUBLE)");
        expect(range).toContain("CAST(JSON_EXTRACT(`log_attributes`, '$.\"duration\"') AS DOUBLE) <= CAST('500' AS DOUBLE)");
    });

    it('distinguishes JSON existence, null, and missing paths', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => column === 'attrs'
            ? { name: 'attrs', normalizedType: 'JSON', dataType: 'json', columnType: 'json' }
            : null);
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        await expect(getWhereSQLViaLucene({ ...baseParams, query: 'attrs.value:*' }))
            .resolves.toBe("(JSON_EXISTS_PATH(`attrs`, '$.\"value\"') AND JSON_TYPE(`attrs`, '$.\"value\"') != 'null')");
        await expect(getWhereSQLViaLucene({ ...baseParams, query: 'attrs.value:null' }))
            .resolves.toContain("JSON_TYPE(`attrs`, '$.\"value\"') = 'null'");
        await expect(getWhereSQLViaLucene({ ...baseParams, query: '-attrs.value:*' }))
            .resolves.toBe("(NOT (JSON_EXISTS_PATH(`attrs`, '$.\"value\"') AND JSON_TYPE(`attrs`, '$.\"value\"') != 'null'))");
    });

    it('reports when JSON array text search is unavailable', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => column === 'attrs'
            ? { name: 'attrs', normalizedType: 'JSON', dataType: 'json', columnType: 'json' }
            : null);
        mockedGetInvertedIndexColumns.mockResolvedValue([]);
        mockedSupportsJsonSearch.mockResolvedValue(false);

        await expect(getWhereSQLViaLucene({ ...baseParams, query: 'attrs.tags:prod' }))
            .rejects.toThrow('JSON array text search requires Doris JSON_SEARCH support.');
    });

    it.each(['attrs.message:/error/', 'attrs.message:err?r', 'attrs.message:error~0.8', 'attrs.message:"error log"~3', 'attrs.message:error^2'])(
        'rejects unsupported advanced Lucene syntax: %s',
        async query => {
            mockedGetColumn.mockImplementation(async ({ column }) => column === 'attrs'
                ? { name: 'attrs', normalizedType: 'JSON', dataType: 'json', columnType: 'json' }
                : null);
            mockedGetInvertedIndexColumns.mockResolvedValue([]);
            await expect(getWhereSQLViaLucene({ ...baseParams, query })).rejects.toThrow(/not supported/);
        },
    );

    it('uses CAST for VARIANT comparisons on Doris versions before 4.0', async () => {
        mockedSupportsTryCast.mockResolvedValue(false);
        mockedGetColumn.mockImplementation(async ({ column }) => column === 'attrs'
            ? { name: 'attrs', normalizedType: 'Variant', dataType: 'variant', columnType: 'variant' }
            : null);
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        await expect(getWhereSQLViaLucene({ ...baseParams, query: 'attrs.duration:>500' }))
            .resolves.toBe("(CAST(`attrs`['duration'] AS BIGINT) > CAST('500' AS BIGINT))");
        expect(mockedSupportsTryCast).toHaveBeenCalledWith({ connectionId: 'conn-1', datasourceType: 'mysql' });
    });

    it('uses phrase LIKE fallback for variant nested phrase searches', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.message:"hello world"',
        });

        expect(result).toBe("(`attrs`['message'] = 'hello world')");
    });

    it('builds numeric comparisons for variant nested paths', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const equalityResult = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.status:500',
        });
        expect(equalityResult).toBe("(TRY_CAST(`attrs`['status'] AS BIGINT) = CAST('500' AS BIGINT))");

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.status:>500',
        });

        expect(result).toBe("(TRY_CAST(`attrs`['status'] AS BIGINT) > CAST('500' AS BIGINT))");
    });

    it('builds numeric ranges for variant nested paths', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.status:[100 TO 500]',
        });

        expect(result).toContain("TRY_CAST(`attrs`['status'] AS BIGINT) >= CAST('100' AS BIGINT)");
        expect(result).toContain("TRY_CAST(`attrs`['status'] AS BIGINT) <= CAST('500' AS BIGINT)");
    });

    it('builds boolean comparisons for variant nested paths', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: '-attrs.ok:true',
        });

        expect(result).toBe("(NOT (TRY_CAST(`attrs`['ok'] AS BOOLEAN) = CAST('true' AS BOOLEAN)))");
    });

    it('builds existence checks for variant nested paths', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.user.name:*',
        });

        expect(result).toBe("`attrs`['user']['name'] IS NOT NULL");
    });

    it('uses inverted indexes for variant root text searches', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue(['attrs']);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs:error',
        });

        expect(result).toBe("(attrs MATCH_ANY 'error')");
    });

    it('uses a VARIANT root inverted index for nested text searches', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue(['attrs']);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.message:error',
        });

        expect(result).toBe("(`attrs`['message'] = 'error')");
    });

    it('falls back to LIKE for variant root text searches without inverted indexes', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs:error',
        });

        expect(result).toBe("(lower(CAST(`attrs` AS STRING)) LIKE lower('%error%'))");
    });

    it('does not build numeric comparisons for variant root fields', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs:>500',
        });

        expect(result).toBe('(1 = 0)');
    });

    it('never stringifies an entire VARIANT root for implicit bare text searches', async () => {
        mockedGetColumn.mockImplementation(async ({ column }) => {
            if (column === 'attrs') {
                return {
                    name: 'attrs',
                    normalizedType: 'Variant',
                    dataType: 'variant',
                    columnType: 'variant',
                };
            }
            return null;
        });
        mockedGetInvertedIndexColumns.mockResolvedValue([]);

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            implicitColumnExpression: "coalesce(`attrs`, '')",
            query: 'error',
        });

        expect(result).toBe('(1 = 0)');
    });
});

it('normalizes physical Doris metadata without fetching columns or indexes', async () => {
    mockedSupportsTryCast.mockResolvedValue(true);
    mockedSupportsJsonSearch.mockResolvedValue(true);
    mockedGetColumn.mockClear();
    mockedGetInvertedIndexColumns.mockClear();
    const where = await getWhereSQLViaLucene({ query: 'message:error', databaseName: 'otel', tableName: 'logs', connectionId: 'ds', columnMeta: { columns: [{ name: 'message', type: 'VARCHAR(255)' }], invertedIndexColumns: ['message'] } });
    expect(where).toContain("MATCH_ANY 'error'");
    expect(mockedGetColumn).not.toHaveBeenCalled();
    expect(mockedGetInvertedIndexColumns).not.toHaveBeenCalled();
});
