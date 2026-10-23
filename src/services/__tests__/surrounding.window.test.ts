import { of, lastValueFrom } from 'rxjs';
import { getSurroundingDataWithWindow } from '../discover';
import { getSurroundingSQL } from '../sql';

jest.mock('@grafana/runtime', () => ({ getBackendSrv: () => ({ fetch }), logError: jest.fn() }));
jest.mock('components/with-error-handler/withErrorHandler', () => ({ withErrorHandler: (response: any) => response }));
const fetch = jest.fn();
const params = {
    selectdbDS: { type: 'doris', uid: 'test' },
    catalog: 'internal',
    database: 'otel',
    table: 'logs',
    cluster: '',
    timeField: 'timestamp',
    time: '2026-09-20 10:00:00',
    data_filters: [],
    pageSize: '5',
    operator: '>' as const,
    theme: 'light',
};
function result(size: number) {
    return of({ ok: true, data: { results: { getSurroundingData: { frames: [{ data: { values: [Array.from({ length: size }, (_, i) => i)] } }] } } } });
}
beforeEach(() => fetch.mockReset());

it('widens to 6 hours and returns the wider result without appending duplicates', async () => {
    fetch.mockReturnValueOnce(result(2)).mockReturnValueOnce(result(5));
    const response = await lastValueFrom(getSurroundingDataWithWindow(params));
    expect(response.data.results.getSurroundingData.frames[0].data.values[0]).toHaveLength(5);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0].data.queries[0].rawSql).toContain('INTERVAL 6 HOUR');
});
it('stops at one day on empty results without reading a nonexistent cursor', async () => {
    fetch.mockReturnValue(result(0));
    await lastValueFrom(getSurroundingDataWithWindow(params));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0].data.queries[0].rawSql).toContain('INTERVAL 24 HOUR');
});
it('uses a lower partition boundary and a strict upper cursor for preceding logs', () => {
    const sql = getSurroundingSQL({ ...params, operator: '<', windowHours: 6 });
    expect(sql).toContain("BETWEEN '2026-09-20 10:00:00.000' - INTERVAL 6 HOUR AND '2026-09-20 10:00:00.000'");
    expect(sql).toContain("(`timestamp` < '2026-09-20 10:00:00.000')");
    expect(sql).toContain('ORDER BY `timestamp` DESC');
});
