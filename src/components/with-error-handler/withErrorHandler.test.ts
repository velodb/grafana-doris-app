import { firstValueFrom, of, throwError } from 'rxjs';
import { withErrorHandler } from './withErrorHandler';
import { createDiscoverQueryError } from 'utils/query-error';

jest.mock('@grafana/runtime', () => ({ logError: jest.fn() }));
jest.mock('antd', () => ({ message: { error: jest.fn() } }));

describe('query error propagation', () => {
    it.each([200, 500])('retains per-query failures and generated SQL for an HTTP %s response', async status => {
        const response = {
            status,
            statusText: status === 200 ? 'OK' : 'Internal Server Error',
            data: {
                results: {
                    A: { status: 500, error: 'OIDC ID token is required; enable Forward OAuth Identity for this datasource' },
                },
            },
        };
        const source = status === 200 ? of(response) : throwError(() => response);
        const error = await firstValueFrom(withErrorHandler(source, {
            showBackendError: false,
            generatedSql: 'SELECT 1',
        })).catch(error => error);
        const parsed = createDiscoverQueryError(error, { source: 'results', searchType: 'SQL' });

        expect(parsed.message).toBe(response.data.results.A.error);
        expect(parsed.generatedSql).toBe('SELECT 1');
        expect(parsed.likelyCause).toContain('Forward OAuth Identity');
    });

    it('retains a generic Grafana plugin failure and explains where to find the missing detail', async () => {
        const error = await firstValueFrom(withErrorHandler(throwError(() => ({
            status: 500,
            statusText: 'Internal Server Error',
            data: { message: 'An error occurred within the plugin', messageId: 'plugin.requestFailureError' },
        })), { showBackendError: false })).catch(error => error);
        const parsed = createDiscoverQueryError(error, { source: 'results', searchType: 'Lucene' });

        expect(parsed.message).toBe('An error occurred within the plugin');
        expect(parsed.likelyCause).toContain('Grafana server/plugin logs');
    });

    it('passes successful empty results through unchanged', async () => {
        const response = { status: 200, data: { results: { A: { frames: [] } } } };

        await expect(firstValueFrom(withErrorHandler(of(response)))).resolves.toBe(response);
    });
});
