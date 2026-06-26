import { getWhereSQLViaLucene } from 'services/lucene';
import { getColumn, getInvertedIndexColumns } from 'services/metaservice';

jest.mock('services/metaservice', () => ({
    getColumn: jest.fn(),
    getInvertedIndexColumns: jest.fn(),
}));

const mockedGetColumn = getColumn as jest.MockedFunction<typeof getColumn>;
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
        mockedGetInvertedIndexColumns.mockReset();
    });

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

        expect(result).toBe("(lower(toString(`attrs`['message'])) LIKE lower('%error%'))");
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

        expect(result).toBe("(lower(toString(`attrs`['message'])) LIKE lower('%hello world%'))");
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
        expect(equalityResult).toContain("dynamicType(`attrs`['status']) in");
        expect(equalityResult).toContain("CAST(toString(`attrs`['status']) AS DOUBLE) = CAST('500' AS DOUBLE)");

        const result = await getWhereSQLViaLucene({
            ...baseParams,
            query: 'attrs.status:>500',
        });

        expect(result).toContain("dynamicType(`attrs`['status']) in");
        expect(result).toContain("CAST(toString(`attrs`['status']) AS DOUBLE) > CAST('500' AS DOUBLE)");
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

        expect(result).toContain("CAST(toString(`attrs`['status']) AS DOUBLE) >= CAST('100' AS DOUBLE)");
        expect(result).toContain("CAST(toString(`attrs`['status']) AS DOUBLE) <= CAST('500' AS DOUBLE)");
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

        expect(result).toBe("(NOT (lower(toString(`attrs`['ok'])) = 'true'))");
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

        expect(result).toBe("notEmpty(toString(`attrs`['user']['name'])) = 1");
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

        expect(result).toBe("(lower(toString(`attrs`)) LIKE lower('%error%'))");
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

    it('uses variant root fallback for implicit bare text searches', async () => {
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

        expect(result).toBe("(lower(toString(`attrs`)) LIKE lower('%error%'))");
    });
});
