import dayjs from 'dayjs';
import { formatSqlTime, formatShareTime, formatDorisTime, parseTimeInZone, histogramOrigin } from '../time';
import { getChartsData, getDateRange } from '../data';
import { getQueryTableChartsSQL } from 'services/sql';

it('generates UTC SQL and absolute links independently of display timezone', () => {
    const time = dayjs('2026-10-16T10:00:00+08:00');
    expect(formatSqlTime(time)).toBe('2026-10-16 02:00:00');
    expect(formatShareTime(time)).toBe('2026-10-16T02:00:00.000Z');
    expect(formatDorisTime('2026-10-16 02:00:00', 'Asia/Shanghai')).toBe('2026-10-16 10:00:00.000');
    expect(formatDorisTime('2026-10-16 02:00:00', 'utc')).toBe('2026-10-16 02:00:00.000');
    expect(formatDorisTime('2026-10-16 02:00:00', 'browser')).toBe('2026-10-16 02:00:00.000');
});
it('reads new absolute and old wall-clock share parameters as the same instant', () => {
    expect(parseTimeInZone('2026-10-16T02:00:00.000Z', 'Asia/Shanghai')?.valueOf()).toBe(parseTimeInZone('2026-10-16 10:00:00', 'Asia/Shanghai')?.valueOf());
});
it('keeps repeated fall-back hours distinct even when their clock labels match', () => {
    const dates: [dayjs.Dayjs, dayjs.Dayjs] = [dayjs('2026-11-01T04:00:00Z'), dayjs('2026-11-01T08:00:00Z')];
    const buckets = getChartsData(
        [
            { TT: '2026-11-01 05:00:00', 'sum(cnt)': 7 },
            { TT: '2026-11-01 06:00:00', 'sum(cnt)': 9 },
        ],
        dates,
        'America/New_York',
        { interval_unit: 'hour', interval_value: 1 },
    );
    expect(buckets.map(row => row.TT)).toHaveLength(4);
    expect(buckets[1].label).toContain('01:00:00 -04:00');
    expect(buckets[2].label).toContain('01:00:00 -05:00');
    expect(buckets[1]['sum(cnt)']).toBe(7);
    expect(buckets[2]['sum(cnt)']).toBe(9);
});
it('advances calendar days through a 23-hour spring transition', () => {
    const buckets = getDateRange(dayjs('2026-03-08T05:00:00Z'), dayjs('2026-03-10T04:00:00Z'), { interval_unit: 'day', interval_value: 1 }, 'America/New_York');
    expect(buckets[1] - buckets[0]).toBe(23 * 3600000);
});
it('aligns half-hour-zone buckets and SQL origins on the same instant', () => {
    const interval = { interval_unit: 'hour' as const, interval_value: 1 };
    const origin = histogramOrigin(dayjs('2026-10-16T02:05:00Z'), interval, 'Asia/Kolkata');
    expect(formatSqlTime(origin)).toBe('2026-10-16 01:30:00');
    const sql = getQueryTableChartsSQL({
        database: 'otel',
        table: 'logs',
        timeField: 'timestamp',
        startDate: '2026-10-16 02:05:00',
        endDate: '2026-10-16 03:05:00',
        timeZone: 'Asia/Kolkata',
        interval: 'hour',
        interval_value: 1,
        data_filters: [],
    } as any);
    expect(sql).toContain("hour_FLOOR(`timestamp`, 1, '2026-10-16 01:30:00')");
});
