import { buildTraceAggSQLFromParams } from 'services/traces.sql';

describe('buildTraceAggSQLFromParams', () => {
    const baseParams = {
        database: 'otel',
        table: 'traces',
        timeField: 'timestamp',
        startDate: '2026-03-18 00:00:00',
        endDate: '2026-03-19 00:00:00',
        page: 1,
        page_size: 20,
        sortBy: 'most-recent',
    };

    it('filters min duration with the same millisecond trace duration expression used by the list', () => {
        const sql = buildTraceAggSQLFromParams({
            ...baseParams,
            minDuration: '100ms',
        });

        expect(sql).toContain('MAX(UNIX_TIMESTAMP(timestamp) * 1000 + duration / 1000) - MIN(UNIX_TIMESTAMP(timestamp) * 1000) AS trace_duration_ms');
        expect(sql).toContain('AND trace_duration_ms >= 100');
    });

    it('treats bare numeric duration input as milliseconds', () => {
        const sql = buildTraceAggSQLFromParams({
            ...baseParams,
            minDuration: '250',
        });

        expect(sql).toContain('AND trace_duration_ms >= 250');
    });
});
