import { snapshotKey, validateSavedQueryState } from '../saved-query-state';
import { DiscoverShareState } from '../discover-share-state';

const state: DiscoverShareState = {
    version: 1,
    datasource: 'ds',
    database: 'otel',
    table: 'logs',
    timeField: 'ts',
    timeZone: 'UTC',
    mode: 'Lucene',
    timeRawFrom: 'now-1h',
    timeRawTo: 'now',
    filters: [],
    selectedFields: [],
    columnOrder: [],
    sort: { field: 'ts', direction: 'DESC' },
};
it('does not silently discard corrupt filters or paths', () => {
    expect(() => validateSavedQueryState({ ...state, filters: [null] })).toThrow('Invalid saved filters');
    expect(() => validateSavedQueryState({ ...state, filters: [{ id: 'x', fieldName: 'attrs.x', operator: '=', value: ['x'], variantPath: [null] }] })).toThrow(
        'Invalid saved filters',
    );
    expect(() => validateSavedQueryState({ ...state, version: 2 })).toThrow('Unsupported');
});
it('accepts fixed time and preserves sparse explicit paths', () => {
    const snapshot = { ...state, timeRawFrom: undefined, timeRawTo: undefined, startTime: '2026-10-20 00:00:00', endTime: '2026-10-21 00:00:00' };
    expect(validateSavedQueryState(snapshot)).toBe(snapshot);
});
it('compares states independent of property order and omitted optional fields', () => {
    const { version, ...rest } = state;
    expect(snapshotKey(state)).toBe(snapshotKey({ ...rest, query: undefined, version }));
    expect(snapshotKey({ ...state, query: 'error' })).not.toBe(snapshotKey(state));
});

it('does not mark default sort initialization as an unsaved change', () => {
    expect(snapshotKey({ ...state, sort: { field: '', direction: 'DESC' } })).toBe(snapshotKey(state));
});
