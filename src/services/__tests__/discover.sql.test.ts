import { getQueryOrderBySQL, getQueryTableResultSQL, resolveQuerySortField } from 'services/sql';
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
