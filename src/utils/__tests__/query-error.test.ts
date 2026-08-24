import { createDiscoverQueryError, getQueryErrorMessage } from 'utils/query-error';

describe('Discover query error parsing', () => {
    it('extracts Grafana result errors and maps generated SQL columns to the SQL input', () => {
        const searchValue = "status = 'ok' AND";
        const generatedSql = `SELECT * FROM logs WHERE timestamp > 0 AND ${searchValue} ORDER BY timestamp DESC`;
        const inputStart = generatedSql.indexOf(searchValue);
        const error = {
            backendError: `Syntax error at line 1, column ${inputStart + 15} near 'AND'`,
            generatedSql,
        };

        const parsed = createDiscoverQueryError(error, { source: 'results', searchType: 'SQL', searchValue });

        expect(parsed.summary).toBe('Query failed');
        expect(parsed.location).toMatchObject({ line: 1, inputLine: 1, inputPosition: 15 });
        expect(parsed.location?.near).toBe('AND');
        expect(parsed.generatedSql).toBe(generatedSql);
        expect(parsed.likelyCause).toContain('keywords');
    });

    it('uses the Lucene parser native input location', () => {
        const error = Object.assign(new Error('Expected a term but found end of input'), {
            location: { start: { line: 2, column: 7 } },
        });
        const parsed = createDiscoverQueryError(error, { source: 'lucene', searchType: 'Lucene', searchValue: 'foo:\nbar:' });

        expect(parsed.location).toMatchObject({ line: 2, column: 7, inputLine: 2, inputColumn: 7 });
    });

    it('extracts the caret position from Doris multiline syntax errors', () => {
        const error = new Error('errCode = 2, detailMessage = Syntax error in line 1:\nSELECT * FORM logs\n         ^\nEncountered: IDENTIFIER');
        const parsed = createDiscoverQueryError(error, { source: 'results', searchType: 'SQL' });

        expect(parsed.location).toMatchObject({ line: 1, column: 10 });
    });

    it('classifies common field and connectivity failures', () => {
        const fieldError = createDiscoverQueryError(new Error('Unknown column service'), {
            source: 'results',
            searchType: 'SQL',
        });
        const networkError = createDiscoverQueryError(new Error('Failed to fetch: connection unavailable'), {
            source: 'histogram',
            searchType: 'SQL',
        });

        expect(fieldError.likelyCause).toContain('field may not exist');
        expect(networkError.likelyCause).toContain('could not be reached');
        expect(fieldError.location).toBeUndefined();
    });

    it('reads errors embedded in Grafana response results', () => {
        const error = {
            data: {
                results: {
                    getTableData: { status: 500, error: 'permission denied' },
                },
            },
        };

        expect(getQueryErrorMessage(error)).toBe('permission denied');
    });
});
