jest.mock('@grafana/runtime', () => {
    const backendSrv = { fetch: jest.fn() };
    return { getBackendSrv: jest.fn(() => backendSrv), logError: jest.fn() };
});

jest.mock('components/with-error-handler/withErrorHandler', () => ({
    withErrorHandler: jest.fn(response => response),
}));

import { getBackendSrv } from '@grafana/runtime';
import { getVariantFieldsService } from '../metaservice';

describe('extended VARIANT DESC request', () => {
    it('requests an extended description for the selected table', () => {
        const fetch = getBackendSrv().fetch as jest.Mock;
        fetch.mockReturnValue('response-stream');

        getVariantFieldsService({
            selectdbDS: { type: 'velodb-doris-datasource', uid: 'doris-main' },
            database: 'otel',
            table: 'otel_logs',
        });

        expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
            url: '/api/ds/query',
            method: 'POST',
            data: expect.objectContaining({
                queries: [
                    expect.objectContaining({
                        refId: 'getVariantFields',
                        rawSql: 'DESC `otel`.`otel_logs`',
                        describeExtendVariantColumn: true,
                    }),
                ],
            }),
        }));
    });
});
