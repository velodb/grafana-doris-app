import {
    DISCOVER_SHARE_STATE_VERSION,
    DiscoverShareState,
    decodeDiscoverShareState,
    encodeDiscoverShareState,
} from '../discover-share-state';

describe('Discover share state', () => {
    const state: DiscoverShareState = {
        version: DISCOVER_SHARE_STATE_VERSION,
        datasource: 'doris-logs',
        database: 'observability',
        table: 'logs',
        timeField: 'timestamp',
        timeZone: 'browser',
        timeRawFrom: 'now-24h',
        timeRawTo: 'now',
        mode: 'Lucene' as const,
        query: 'service:api',
        filters: [{ id: 'level-error', fieldName: 'level', operator: '=', value: ['ERROR'] }],
        selectedFields: [{ Field: 'timestamp', Type: 'DATETIME' }, { Field: 'service', Type: 'STRING' }, { Field: 'message', Type: 'STRING' }],
        columnOrder: ['__expand', '__time', 'field:timestamp', 'field:service', 'field:message'],
        sort: { field: 'timestamp', direction: 'DESC' as const },
    };

    it('round-trips a relative-time filter and selected columns', () => {
        expect(decodeDiscoverShareState(encodeDiscoverShareState(state))).toEqual(state);
    });

    it('returns undefined for malformed or unsupported states', () => {
        expect(decodeDiscoverShareState('%7Bbad')).toBeUndefined();
        expect(decodeDiscoverShareState(encodeURIComponent(JSON.stringify({ ...state, version: 2 })))).toBeUndefined();
    });

    it('normalizes an invalid sorting direction safely', () => {
        const encoded = encodeURIComponent(JSON.stringify({ ...state, sort: { field: 'message', direction: 'SIDEWAYS' } }));
        expect(decodeDiscoverShareState(encoded)?.sort).toEqual({ field: 'message', direction: 'DESC', variantPath: undefined, variantType: undefined });
    });
});
