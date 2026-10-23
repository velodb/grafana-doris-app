import {
    buildTraceAggSQLFromParams,
    buildTraceCountSQLFromParams,
    buildTraceSummaryListSQL,
    buildTraceSummaryCountSQL,
    buildTraceSupplementSQL,
    getQueryTableTraceSQL,
} from '../traces.sql';

const params = { database: 'otel', table: 'traces', timeField: 'timestamp', startDate: '2026-03-18 23:00:00', endDate: '2026-03-19 01:00:00', page: 2, page_size: 20 };

describe('Trace SQL semantics', () => {
    it.each([
        ['most-recent', 'time DESC'],
        ['longest-duration', 'trace_duration_ms DESC'],
        ['shortest-duration', 'trace_duration_ms ASC'],
        ['most-spans', 'spans DESC'],
        ['least-spans', 'spans ASC'],
    ])('selects matching spans before roots, counting and paging for %s', (sortBy, order) => {
        const sql = buildTraceAggSQLFromParams({ ...params, sortBy, service_name: 'checkout', operation: 'POST /checkout', tags: 'http.method=GET' });
        const candidates = sql.slice(0, sql.indexOf('root_candidates AS'));
        const roots = sql.slice(sql.indexOf('root_candidates AS'), sql.indexOf('trace_metrics AS'));
        expect(candidates).toContain("service_name = 'checkout' AND span_name = 'POST /checkout'");
        expect(candidates).toContain("span_attributes['http']['method'] = 'GET'");
        expect(roots).not.toContain("service_name = 'checkout'");
        expect(roots).toContain('PARTITION BY trace_id ORDER BY `timestamp` ASC, span_id ASC');
        expect(roots).toContain('WHERE root_rank = 1');
        expect(sql).toContain(`ORDER BY ${order}, trace_id DESC LIMIT 20 OFFSET 20`);
        expect(sql).not.toContain('COUNT(*) OVER()');
    });

    it('uses aggregate millisecond duration for filtering and keeps cross-day spans', () => {
        const sql = buildTraceAggSQLFromParams({ ...params, minDuration: '250', maxDuration: '2s' });
        expect(sql).toContain("MAX(milliseconds_diff(t.`timestamp`, '1970-01-01 00:00:00') + t.duration / 1000)");
        expect(sql).toContain('WHERE trace_duration_ms >= 250 AND trace_duration_ms <= 2000');
        expect(sql).toContain('- INTERVAL 2 DAY');
        expect(sql).toContain('+ INTERVAL 2 DAY');
        expect(sql).toContain('r.root_duration / 1000 AS root_span_duration_ms');
    });

    it('counts the complete eligible set independently of page rows', () => {
        const sql = buildTraceCountSQLFromParams({ ...params, minDuration: '100ms' });
        expect(sql).toContain('SELECT COUNT(*) AS total FROM eligible_traces');
        expect(sql).not.toContain('LIMIT 20');
    });

    it('quotes service, operation, identifiers and detail trace IDs', () => {
        const sql = buildTraceAggSQLFromParams({ ...params, service_name: "O'Reilly" });
        expect(sql).toContain("service_name = 'O\\'Reilly'");
        expect(getQueryTableTraceSQL({ database: 'otel', table: 'traces', trace_id: "a'b" })).toContain("WHERE trace_id = 'a\\'b'");
    });
});

describe('Summary MV SQL', () => {
    it('preserves MV aggregates then merges daily rows before filtering and pagination', () => {
        const sql = buildTraceSummaryListSQL({ ...params, service_name: 'frontend', minDuration: '1ms' });
        expect(sql).toContain("GROUP BY trace_id, date_trunc(`timestamp`, 'day')");
        expect(sql).toContain("SUM(CASE WHEN status_code = 'STATUS_CODE_ERROR' THEN 1 ELSE 0 END)");
        expect(sql).toContain('SUM(span_count) AS span_count');
        expect(sql).toContain('MIN(first_root) AS first_root');
        expect(sql).toContain('GROUP BY trace_id\nHAVING MIN(start_time)');
        expect(sql).toContain('milliseconds_diff(MAX(end_time), MIN(start_time)) >= 1');
        expect(sql.indexOf('GROUP BY trace_id\nHAVING')).toBeLessThan(sql.indexOf('ORDER BY'));
        expect(sql).not.toContain('COUNT(*) OVER()');
        expect(sql).not.toContain('FROM `otel`.`traces_summary`');
    });

    it('keeps an aggregate alongside COUNT and omits list ordering/pagination', () => {
        const sql = buildTraceSummaryCountSQL(params);
        expect(sql).toContain('COUNT(*) AS total, SUM(span_count)');
        expect(sql).not.toContain('ORDER BY');
        expect(sql).not.toContain('LIMIT');
    });

    it('supplements only the page and selects a deterministic root', () => {
        const sql = buildTraceSupplementSQL(params, ['trace1', "trace'2"]);
        expect(sql).toContain("trace_id IN ('trace1', 'trace\\'2')");
        expect(sql).toContain('PARTITION BY trace_id ORDER BY `timestamp` ASC, span_id ASC');
        expect(sql).toContain('r.root_rank = 1');
    });
});

describe('Trace detail', () => {
    it('returns plain attribute JSON and preserves event support', () => {
        const sql = getQueryTableTraceSQL({ database: 'otel', table: 'traces', trace_id: 'abc123' });
        expect(sql).toContain('CAST(resource_attributes AS TEXT) AS serviceTags');
        expect(sql).toContain('CAST(span_attributes AS TEXT) AS tags');
        expect(sql).not.toContain('MAP<STRING');
        expect(sql).toContain('CAST(ARRAY_MAP(e -> NAMED_STRUCT(');
        expect(sql).toContain('), events) AS JSON) AS logs');
    });
});
