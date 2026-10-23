import { of, throwError } from 'rxjs';

jest.mock('@grafana/runtime', () => {
    const backendSrv = { fetch: jest.fn() };
    return { getBackendSrv: jest.fn(() => backendSrv), logError: jest.fn() };
});

jest.mock('components/with-error-handler/withErrorHandler', () => ({
    withErrorHandler: jest.fn(response => response),
}));

import { getBackendSrv } from '@grafana/runtime';
import { supportsJsonSearch, supportsSearch, supportsTryCast } from '../metaservice';

describe('supportsTryCast', () => {
    const fetch = getBackendSrv().fetch as jest.Mock;

    beforeEach(() => {
        fetch.mockReset();
    });

    it('detects TRY_CAST support once per datasource and caches the result', async () => {
        fetch.mockReturnValue(of({
            ok: true,
            data: { results: { probeTryCast: { frames: [{}] } } },
        }));

        await expect(supportsTryCast({ connectionId: 'doris-4', datasourceType: 'velodb-doris-datasource' })).resolves.toBe(true);
        await expect(supportsTryCast({ connectionId: 'doris-4', datasourceType: 'velodb-doris-datasource' })).resolves.toBe(true);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                queries: [expect.objectContaining({
                    refId: 'probeTryCast',
                    rawSql: 'SELECT TRY_CAST(1 AS BIGINT) AS try_cast_supported',
                })],
            }),
        }));
    });

    it('falls back to CAST when the probe query fails', async () => {
        fetch.mockReturnValue(throwError(() => new Error('TRY_CAST is not supported')));

        await expect(supportsTryCast({ connectionId: 'doris-3', datasourceType: 'velodb-doris-datasource' })).resolves.toBe(false);
    });

    it('detects JSON_SEARCH support once per datasource', async () => {
        fetch.mockReturnValue(of({
            ok: true,
            data: { results: { probeJsonSearch: { frames: [{}] } } },
        }));

        await expect(supportsJsonSearch({ connectionId: 'doris-json', datasourceType: 'velodb-doris-datasource' })).resolves.toBe(true);
        await expect(supportsJsonSearch({ connectionId: 'doris-json', datasourceType: 'velodb-doris-datasource' })).resolves.toBe(true);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                queries: [expect.objectContaining({ refId: 'probeJsonSearch', rawSql: expect.stringContaining('JSON_SEARCH') })],
            }),
        }));
    });

    it('detects SEARCH support once per datasource', async () => {
        fetch.mockReturnValue(of({
            ok: true,
            data: { results: { probeSearch: { frames: [{}] } } },
        }));

        const params = { connectionId: 'doris-search-4', datasourceType: 'velodb-doris-datasource', databaseName: 'otel', tableName: 'logs', query: 'service_name:checkout' };
        await expect(supportsSearch(params)).resolves.toBe(true);
        await expect(supportsSearch(params)).resolves.toBe(true);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                queries: [expect.objectContaining({ refId: 'probeSearch', rawSql: 'EXPLAIN SELECT 1 FROM `otel`.`logs` WHERE SEARCH(\'service_name:checkout\', \'{"mode":"lucene"}\')' })],
            }),
        }));
    });

    it('falls back when SEARCH is unavailable', async () => {
        fetch.mockReturnValue(throwError(() => new Error('SEARCH is not supported')));

        await expect(supportsSearch({ connectionId: 'doris-search-3', datasourceType: 'velodb-doris-datasource', databaseName: 'otel', tableName: 'logs', query: 'service_name:checkout' })).resolves.toBe(false);
    });
});
