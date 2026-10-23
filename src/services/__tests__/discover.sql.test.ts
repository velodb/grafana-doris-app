import { getFieldStatisticsSummarySQL, getFieldStatisticsTopValuesSQL, getQueryOrderBySQL, getQueryTableResultSQL, getTopNQuerySQL, resolveQuerySortField } from 'services/sql';
import { QueryTableDataParams } from 'types/type';

const baseParams: QueryTableDataParams = {
    catalog: 'internal',
    database: 'observability',
    table: 'logs',
    cluster: '',
    startDate: '2026-08-03 00:00:00',
    endDate: '2026-08-03 01:00:00',
    sort: 'DESC',
    timeField: 'timestamp',
    data_filters: [],
    search_type: 'SQL',
    search_value: '',
    page: '1',
    page_size: 50,
};

describe('Discover result sorting SQL', () => {
    it('defaults to descending time sorting', () => {
        expect(getQueryOrderBySQL(baseParams)).toBe('`timestamp` DESC');
        expect(getQueryTableResultSQL(baseParams)).toContain('ORDER BY `timestamp` DESC LIMIT 50 OFFSET 0');
    });

    it('adds the time field as a deterministic secondary order', () => {
        expect(getQueryOrderBySQL({ ...baseParams, sort: 'ASC', sortField: 'service_name' }))
            .toBe('`service_name` ASC, `timestamp` DESC');
    });

    it('supports nested Doris field paths and escapes identifiers', () => {
        expect(getQueryOrderBySQL({ ...baseParams, sortField: 'attributes.http.method' }))
            .toBe("`attributes`['http']['method'] DESC, `timestamp` DESC");
        expect(getQueryOrderBySQL({ ...baseParams, sortField: 'bad`field' }))
            .toContain('`bad``field` DESC');
        expect(getQueryOrderBySQL({
            ...baseParams,
            sortField: 'resource_attributes.k8s.namespace.name',
            sortFieldPath: ['resource_attributes', 'k8s.namespace.name'],
        })).toBe("CAST(`resource_attributes`['k8s.namespace.name'] AS STRING) DESC, `timestamp` DESC");
        expect(getQueryOrderBySQL({
            ...baseParams,
            sortField: 'log_attributes.duration_ms',
            sortFieldPath: ['log_attributes', 'duration_ms'],
            sortFieldType: 'DOUBLE',
        })).toBe("CAST(`log_attributes`['duration_ms'] AS DOUBLE) DESC, `timestamp` DESC");
    });

    it('falls back to the time field when the requested field is not in table metadata', () => {
        expect(resolveQuerySortField('injected_field', 'timestamp', ['timestamp', 'service_name']))
            .toBe('timestamp');
    });
});

describe('Discover Top N SQL', () => {
    const fields = [{ Field: 'service_name', Type: 'VARCHAR' }, { Field: 'duration_ms', Type: 'DOUBLE' }];
    const topNParams = {
        catalog: 'internal', database: 'observability', table: 'logs', timeField: 'timestamp',
        startDate: baseParams.startDate, endDate: baseParams.endDate, data_filters: [],
        search_type: 'SQL', search_value: '', groupField: 'service_name', metric: 'COUNT' as const,
        direction: 'DESC' as const, limit: 5,
    };

    it('groups by the selected field, ranks by count, and applies the requested limit', () => {
        expect(getTopNQuerySQL(topNParams, fields)).toContain(
            "SELECT `service_name` AS `service_name`, COUNT(*) AS `__top_n_value` FROM `observability`.`logs` WHERE (`timestamp` BETWEEN '2026-08-03 00:00:00' AND '2026-08-03 01:00:00') GROUP BY `service_name` ORDER BY `__top_n_value` DESC, `service_name` ASC LIMIT 5",
        );
    });

    it('supports numeric aggregation, bottom order, and SQL filters', () => {
        const sql = getTopNQuerySQL({ ...topNParams, metric: 'AVG', metricField: 'duration_ms', direction: 'ASC', search_value: 'status_code >= 500' }, fields);
        expect(sql).toContain('AVG(`duration_ms`) AS `__top_n_value`');
        expect(sql).toContain('AND status_code >= 500 GROUP BY');
        expect(sql).toContain('ORDER BY `__top_n_value` ASC');
    });

    it('reuses structured filters, Search indexes, and Lucene predicates', () => {
        const filter = { fieldName: 'service_name', operator: '=' as const, value: ['api'], id: 'service' };
        const searchSql = getTopNQuerySQL({ ...topNParams, search_type: 'Search', indexes_statement: "`message` MATCH_PHRASE 'timeout'", data_filters: [filter] }, fields);
        expect(searchSql).toContain("(`message` MATCH_PHRASE 'timeout') AND (`timestamp` BETWEEN");
        expect(searchSql).toContain("AND (`service_name` = 'api')");

        const luceneSql = getTopNQuerySQL({ ...topNParams, search_type: 'Lucene', lucene_where: "`message` LIKE '%timeout%'" }, fields);
        expect(luceneSql).toContain("AND (`message` LIKE '%timeout%') GROUP BY");
    });

    it('rejects invalid limits, unavailable group fields, and non-numeric metric fields', () => {
        expect(() => getTopNQuerySQL({ ...topNParams, limit: 0 }, fields)).toThrow('Top N limit');
        expect(() => getTopNQuerySQL({ ...topNParams, groupField: 'missing' }, fields)).toThrow('group field');
        expect(() => getTopNQuerySQL({ ...topNParams, metric: 'SUM', metricField: 'service_name' }, fields)).toThrow('numeric field');
    });
});

describe('Discover field statistics SQL', () => {
    const params = {
        catalog: 'internal', database: 'observability', table: 'logs', timeField: 'timestamp',
        startDate: baseParams.startDate, endDate: baseParams.endDate, data_filters: [],
        search_type: 'SQL', search_value: 'status_code >= 500', field: { Field: 'duration_ms', Type: 'DOUBLE' },
    };

    it('returns summary values and a bounded histogram for a continuous field', () => {
        const sql = getFieldStatisticsSummarySQL(params);
        expect(sql).toContain('COUNT(`duration_ms`) AS `__field_stats_non_null`');
        expect(sql).toContain('APPROX_COUNT_DISTINCT(`duration_ms`)');
        expect(sql).toContain('HISTOGRAM(`duration_ms`, 20)');
        expect(sql).toContain('AND status_code >= 500');
    });

    it('excludes nulls and ranks top values deterministically', () => {
        const sql = getFieldStatisticsTopValuesSQL({ ...params, field: { Field: 'service_name', Type: 'VARCHAR' } });
        expect(sql).toContain('AND `service_name` IS NOT NULL GROUP BY `service_name`');
        expect(sql).toContain('ORDER BY `__field_stats_count` DESC, `service_name` ASC LIMIT 5');
    });

    it('uses the existing JSON extraction expression for a JSON leaf', () => {
        const sql = getFieldStatisticsSummarySQL({ ...params, field: { Field: 'attributes.http.method', Type: 'VARCHAR', variantPath: ['attributes', 'http.method'], variantRootType: 'JSON' } });
        expect(sql).toContain("CAST(JSON_EXTRACT(`attributes`, '$.\"http.method\"') AS STRING)");
        expect(sql).not.toContain('HISTOGRAM');
    });
});
