import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { getWhereSQLViaLucene } from 'services/lucene';
import { getColumn, getInvertedIndexColumns } from 'services/metaservice';

jest.mock('services/metaservice', () => ({
    getColumn: jest.fn(),
    getInvertedIndexColumns: jest.fn(),
}));

const mockedGetColumn = getColumn as jest.MockedFunction<typeof getColumn>;
const mockedGetInvertedIndexColumns = getInvertedIndexColumns as jest.MockedFunction<typeof getInvertedIndexColumns>;

type ColumnFixture = {
    name: string;
    normalizedType: string;
    dataType?: string;
    columnType?: string;
};

type LuceneCase = {
    name: string;
    lucene: string;
    expectedWhere?: string;
    expectedSql?: string;
    databaseName: string;
    tableName: string;
    connectionId?: string;
    datasourceType?: string;
    implicitColumnExpression?: string;
    tableReference?: string;
    columns?: Record<string, ColumnFixture>;
    invertedIndexColumns?: string[];
};

function loadCaseFixtures(): Array<LuceneCase & { fileName: string }> {
    const casesDir = path.resolve(__dirname, 'cases');
    let files: string[] = [];
    try {
        files = readdirSync(casesDir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    return files
        .filter(fileName => fileName.endsWith('.json'))
        .map(fileName => {
            const raw = readFileSync(path.join(casesDir, fileName), 'utf8');
            const parsed = JSON.parse(raw) as LuceneCase;
            return {
                ...parsed,
                fileName,
            };
        });
}

const luceneCases = loadCaseFixtures();

describe('Lucene case fixtures', () => {
    if (luceneCases.length === 0) {
        it('has at least one lucene case fixture defined', () => {
            throw new Error('No lucene case fixtures found under src/services/__tests__/cases');
        });
        return;
    }

    afterEach(() => {
        mockedGetColumn.mockReset();
        mockedGetInvertedIndexColumns.mockReset();
    });

    it.each(luceneCases.map(testCase => [testCase.name ?? testCase.fileName, testCase]))(
        '%s',
        async (_name, testCase) => {
            const {
                lucene,
                expectedWhere,
                expectedSql,
                databaseName,
                tableName,
                connectionId = 'test-connection',
                datasourceType,
                implicitColumnExpression,
                tableReference,
                columns = {},
                invertedIndexColumns = [],
            } = testCase;

            const metadataLookup = Object.entries(columns).reduce<Record<string, ColumnFixture>>((acc, [key, value]) => {
                acc[key] = value;
                acc[key.toLowerCase()] = value;
                return acc;
            }, {});

            mockedGetColumn.mockImplementation(async ({ column }) => {
                const lookupKey = column in metadataLookup ? column : column.toLowerCase();
                return metadataLookup[lookupKey] ?? null;
            });

            mockedGetInvertedIndexColumns.mockImplementation(async () => invertedIndexColumns);

            const whereSQL = await getWhereSQLViaLucene({
                query: lucene,
                databaseName,
                tableName,
                connectionId,
                implicitColumnExpression,
                datasourceType,
            });

            if (!expectedWhere && !expectedSql) {
                throw new Error(`Fixture "${testCase.fileName}" must specify expectedWhere or expectedSql`);
            }

            if (expectedWhere) {
                expect(whereSQL).toBe(expectedWhere);
            }

            if (expectedSql) {
                const resolvedTableReference =
                    tableReference ?? `\`${databaseName}\`.\`${tableName}\``;
                const actualSql = `SELECT * FROM ${resolvedTableReference} WHERE ${whereSQL}`;
                expect(actualSql).toBe(expectedSql);
            }
        },
    );
});
