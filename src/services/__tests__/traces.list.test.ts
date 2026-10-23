import { of, lastValueFrom, throwError } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { getTracesService } from '../traces';

jest.mock('@grafana/runtime', () => ({ getBackendSrv: jest.fn(() => ({ fetch })), logError: jest.fn() }));
jest.mock('components/with-error-handler/withErrorHandler', () => ({ withErrorHandler: (response: any) => response }));
const fetch = jest.fn();
const payload = {
    selectdbDS: { uid: 'doris', type: 'velodb-doris-datasource' },
    database: 'otel',
    table: 'traces',
    timeField: 'timestamp',
    startDate: '2026-03-18 23:00:00',
    endDate: '2026-03-19 01:00:00',
};

function frame(rows: Array<Record<string, any>>) {
    const names = Object.keys(rows[0] || {});
    return { frames: [{ schema: { fields: names.map(name => ({ name, type: 'string' })) }, data: { values: names.map(name => rows.map(row => row[name])) } }] };
}
function response(results: Record<string, any>) {
    return of({ ok: true, data: { results } });
}
const legacy = { capability: { hasSummary: false, rewrites: {} } };

beforeEach(() => {
    fetch.mockReset();
});

describe('normalized Trace list', () => {
    it('returns an independent total for an empty page', async () => {
        fetch.mockReturnValue(response({ getTraces: frame([]), getTraceCount: frame([{ total: 101 }]) }));
        expect(await lastValueFrom(getTracesService({ ...payload, page: 9 }, legacy))).toEqual({ rows: [], total: 101 });
        expect(fetch.mock.calls[0][0].data.queries.map((query: any) => query.refId)).toEqual(['getTraces', 'getTraceCount']);
    });

    it('merges summary and per-page details and retains precision', async () => {
        fetch.mockImplementation(({ data }) => {
            if (data.queries[0].refId === 'explainTraceList') {
                return response({
                    explainTraceList: frame([{ plan: 'TABLE: traces(traces_summary)' }]),
                    explainTraceCount: frame([{ plan: 'TABLE: traces(traces_summary)' }]),
                });
            }
            if (data.queries[0].refId === 'traceSupplement') {
                return response({
                    traceSupplement: frame([{ trace_id: 'abc', services: '["gateway","checkout"]', root_service: 'gateway', operation: 'GET /a|b', root_span_duration_ms: 0.5 }]),
                });
            }
            return response({
                getTraces: frame([
                    {
                        trace_id: 'abc',
                        start_time: '2026-03-18 23:59:59.500',
                        end_time: '2026-03-19 00:00:00.125',
                        span_count: 4,
                        error_count: 1,
                        first_root: '20260318235959500000|gateway|GET /a|b',
                        max_span_duration: 1234,
                    },
                ]),
                getTraceCount: frame([{ total: 1 }]),
            });
        });
        const onCapability = jest.fn();
        const result = await lastValueFrom(getTracesService(payload, { capability: { hasSummary: true, rewrites: {} }, onCapability }));
        expect(result.total).toBe(1);
        expect(result.rows[0]).toMatchObject({
            trace_id: 'abc',
            spans: 4,
            trace_duration_ms: 625,
            max_span_duration_ms: 1.234,
            root_service: 'gateway',
            operation: 'GET /a|b',
            services: '["gateway","checkout"]',
        });
        expect(onCapability).toHaveBeenCalled();
        // A subsequent page with this capability does not repeat EXPLAIN.
        const capability = onCapability.mock.calls[0][0];
        fetch.mockClear();
        await lastValueFrom(getTracesService({ ...payload, page: 2 }, { capability }));
        expect(fetch.mock.calls.some(([request]) => request.data.queries[0].refId.startsWith('explain'))).toBe(false);
    });

    it('falls back unless BOTH list and count plans use the summary', async () => {
        fetch.mockImplementation(({ data }) =>
            data.queries[0].refId === 'explainTraceList'
                ? response({ explainTraceList: frame([{ plan: 'TABLE: traces(traces_summary)' }]), explainTraceCount: frame([{ plan: 'TABLE: traces(traces)' }]) })
                : response({ getTraces: frame([{ trace_id: 'old', time: 1 }]), getTraceCount: frame([{ total: 1 }]) }),
        );
        const result = await lastValueFrom(getTracesService(payload, { capability: { hasSummary: true, rewrites: {} } }));
        expect(result.rows[0].trace_id).toBe('old');
        expect(fetch.mock.calls[1][0].data.queries[0].rawSql).toContain('matching_trace_ids');
    });

    it('uses legacy SQL when metadata detection fails or a custom time field is selected', async () => {
        fetch.mockImplementation(({ data }) =>
            data.queries[0].refId === 'traceFields' ? throwError(() => new Error('permission denied')) : response({ getTraces: frame([]), getTraceCount: frame([{ total: 0 }]) }),
        );
        await expect(lastValueFrom(getTracesService(payload))).resolves.toEqual({ rows: [], total: 0 });
        fetch.mockClear();
        await lastValueFrom(getTracesService({ ...payload, timeField: 'created_at' }));
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(getBackendSrv().fetch).toBe(fetch);
    });

    it('exposes backend per-query errors', async () => {
        fetch.mockReturnValue(response({ getTraces: { error: 'Unknown column trace_id', status: 400 } }));
        await expect(lastValueFrom(getTracesService(payload, legacy))).rejects.toThrow('Unknown column trace_id');
    });
});
