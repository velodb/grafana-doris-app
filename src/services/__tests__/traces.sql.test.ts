import { buildTraceAggSQLFromParams, getQueryTableTraceSQL } from 'services/traces.sql';

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

        expect(sql).toContain('MAX(UNIX_TIMESTAMP(t.timestamp) * 1000 + t.duration / 1000)');
        expect(sql).toContain('- MIN(UNIX_TIMESTAMP(t.timestamp) * 1000) AS trace_duration_ms');
        expect(sql).toContain('AND d.trace_duration_ms >= 100');
    });

    it('treats bare numeric duration input as milliseconds', () => {
        const sql = buildTraceAggSQLFromParams({
            ...baseParams,
            minDuration: '250',
        });

        expect(sql).toContain('AND d.trace_duration_ms >= 250');
    });

    it('pages deterministic root spans before aggregating the selected traces', () => {
        const sql = buildTraceAggSQLFromParams({
            ...baseParams,
            page: 2,
        });

        expect(sql).toContain('ROW_NUMBER() OVER (\n        PARTITION BY trace_id\n        ORDER BY timestamp ASC, span_id ASC');
        expect(sql).toContain('SELECT r.*, COUNT(*) OVER() AS total_count\n    FROM eligible_roots r');
        expect(sql).toContain('ORDER BY root_time DESC, trace_id DESC\n    LIMIT 20 OFFSET 20');
        expect(sql).toContain('JOIN page_root_spans p ON t.trace_id = p.trace_id');
        expect(sql).toContain("t.timestamp >= '2026-03-18 00:00:00' - INTERVAL 2 DAY");
        expect(sql).toContain("t.timestamp < '2026-03-19 00:00:00' + INTERVAL 2 DAY");
        expect(sql).toContain('UNIX_TIMESTAMP(p.root_time) AS time');
        expect(sql).toContain('p.root_duration / 1000 AS root_span_duration_ms');
        expect(sql).toContain("SUM(IF(t.status_code IN ('STATUS_CODE_ERROR', 'ERROR'), 1, 0)) AS error_spans");
        expect(sql).toContain('ORDER BY p.root_time DESC, t.trace_id DESC');

        expect(sql.indexOf('COUNT(*) OVER() AS total_count')).toBeLessThan(sql.indexOf('LIMIT 20 OFFSET 20'));
        expect(sql.indexOf('LIMIT 20 OFFSET 20')).toBeLessThan(sql.indexOf('JOIN page_root_spans p ON t.trace_id = p.trace_id'));
    });

    it('applies root and span filters before counting and paging', () => {
        const sql = buildTraceAggSQLFromParams({
            ...baseParams,
            service_name: 'frontend',
            operation: 'GET /orders',
            statusCode: 'STATUS_CODE_ERROR',
            tags: 'http.method=GET',
            minDuration: '100ms',
            maxDuration: '2s',
        });

        expect(sql).toContain("root_service = 'frontend'");
        expect(sql).toContain("operation = 'GET /orders'");
        expect(sql).toContain('status_trace_ids AS (');
        expect(sql).toContain("t.status_code = 'STATUS_CODE_ERROR'");
        expect(sql).toContain('tag_trace_ids AS (');
        expect(sql).toContain("t.span_attributes['http.method'] = 'GET'");
        expect(sql).toContain('JOIN status_trace_ids s ON r.trace_id = s.trace_id');
        expect(sql).toContain('JOIN tag_trace_ids g ON r.trace_id = g.trace_id');
        expect(sql).toContain('JOIN trace_durations d ON r.trace_id = d.trace_id');
        expect(sql).toContain('d.trace_duration_ms BETWEEN 100 AND 2000');
    });

    it.each([
        ['longest-duration', 'trace_duration_ms DESC'],
        ['shortest-duration', 'trace_duration_ms ASC'],
        ['most-spans', 'spans DESC'],
        ['least-spans', 'spans ASC'],
    ])('keeps full-window aggregation for %s sorting', (sortBy, orderBy) => {
        const sql = buildTraceAggSQLFromParams({
            ...baseParams,
            sortBy,
        });

        expect(sql).toContain('all_trace_ids AS (');
        expect(sql).toContain('aggregated AS (');
        expect(sql).toContain(`ROW_NUMBER() OVER(ORDER BY ${orderBy}) AS rn`);
        expect(sql).not.toContain('page_root_spans AS (');
    });
});

describe('getQueryTableTraceSQL', () => {
    it('selects Doris span events as Grafana trace logs', () => {
        const sql = getQueryTableTraceSQL({
            database: 'otel',
            table: 'traces',
            trace_id: 'abc123',
        });

        expect(sql).toContain('CAST(ARRAY_MAP(e -> NAMED_STRUCT(');
        expect(sql).toContain("'timestamp', CAST(UNIX_TIMESTAMP(STRUCT_ELEMENT(e, 'timestamp')) * 1000 AS BIGINT)");
        expect(sql).toContain("'name', STRUCT_ELEMENT(e, 'name')");
        expect(sql).toContain("'attributes', STRUCT_ELEMENT(e, 'attributes')");
        expect(sql).toContain('), events) AS JSON) AS logs');
        expect(sql).toContain('AS logs');
    });
});
