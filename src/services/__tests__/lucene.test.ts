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

        expect(result).toBe("(`status` = CAST('200', 'Float64'))");
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
});
