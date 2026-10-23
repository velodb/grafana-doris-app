import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { FieldType } from '@grafana/data';
import { of, Subject } from 'rxjs';
import { useDiscoverRestore } from './useDiscoverRestore';
import * as atoms from 'store/discover';
import { discoverRestoreEpochAtom, discoverRestoreErrorAtom, discoverRestoreWarningAtom } from 'store/discover-snapshot';
import { DiscoverShareState } from 'utils/discover-share-state';
import { getDatabases, getTablesService, getFieldsService, getIndexesService, getVariantFieldsService } from 'services/metaservice';
import { useDiscoverData } from 'pages/PageDiscover/useDiscoverData';
import { getTableDataChartsService, getTableDataCountService, getTableDataService, getTopDataService } from 'services/discover';

jest.mock('services/metaservice', () => ({
    getDatabases: jest.fn(),
    getTablesService: jest.fn(),
    getFieldsService: jest.fn(),
    getIndexesService: jest.fn(),
    getVariantFieldsService: jest.fn(),
}));
jest.mock('services/discover', () => ({
    getTableDataChartsService: jest.fn(),
    getTableDataCountService: jest.fn(),
    getTableDataService: jest.fn(),
    getTopDataService: jest.fn(),
    getTopNDataService: jest.fn(),
}));
jest.mock('services/traces', () => ({ getTableDataTraceService: jest.fn() }));
jest.mock('pages/PageDiscover/useLuceneWhereClause', () => ({ useLuceneWhereClause: () => async () => '', rememberVariantSamples: jest.fn() }));
jest.mock('utils/utils', () => ({ generateTableDataUID: async (rows: any[]) => rows }));
const sources = [{ uid: 'ds', type: 'doris', name: 'Doris' }] as any;
const invalidate = jest.fn();
const state: DiscoverShareState = {
    version: 1,
    datasource: 'ds',
    database: 'otel',
    table: 'logs',
    timeField: 'timestamp',
    timeZone: 'UTC',
    mode: 'Lucene',
    query: 'level:ERROR',
    timeRawFrom: 'now-1h',
    timeRawTo: 'now',
    filters: [{ id: 'f', fieldName: 'level', operator: '=', value: ['ERROR'] }],
    selectedFields: [{ Field: 'level' }],
    columnOrder: ['field:level'],
    sort: { field: 'timestamp', direction: 'ASC' },
};
function response(ref: string, columns: any[][]) {
    return { ok: true, data: { results: { [ref]: { frames: [{ fields: columns.map((values, i) => ({ name: `c${i}`, type: FieldType.string, values })) }] } } } };
}
function setup() {
    const store = createStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    return { store, ...renderHook(() => useDiscoverRestore(sources, invalidate), { wrapper }) };
}
beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    (getDatabases as jest.Mock).mockReturnValue(of(response('getDatabases', [['otel']])));
    (getTablesService as jest.Mock).mockReturnValue(of(response('getTables', [['logs']])));
    (getFieldsService as jest.Mock).mockReturnValue(
        of(
            response('getFields', [
                ['timestamp', 'level', 'attrs'],
                ['DATETIMEV2', 'VARCHAR', 'VARIANT'],
            ]),
        ),
    );
    (getIndexesService as jest.Mock).mockReturnValue(of(response('getIndexes', [])));
    (getVariantFieldsService as jest.Mock).mockReturnValue(of(response('getVariantFields', [])));
    Object.defineProperty(performance, 'measure', { configurable: true, value: jest.fn() });
    [getTableDataChartsService, getTableDataCountService, getTableDataService, getTopDataService].forEach(service =>
        (service as jest.Mock).mockReturnValue(of({ ok: true, data: { results: {} } })),
    );
});

it.each(['SQL', 'Search', 'Lucene'] as const)('restores %s with filters, order, sort, zone and relative time', async mode => {
    const { store, result } = setup();
    await act(async () => {
        expect(await result.current({ ...state, mode })).toBe(true);
    });
    expect(store.get(atoms.discoverShareReadyAtom)).toBe(true);
    expect(store.get(atoms.searchTypeAtom)).toBe(mode);
    expect(store.get(atoms.searchValueAtom)).toBe(state.query);
    expect(store.get(atoms.dataFilterAtom)).toEqual(state.filters);
    expect(store.get(atoms.discoverSharedColumnOrderAtom)).toEqual(state.columnOrder);
    expect(store.get(atoms.discoverSortAtom)).toEqual(state.sort);
    expect(store.get(atoms.timeRangeAtom).raw).toEqual({ from: 'now-1h', to: 'now' });
    expect(store.get(atoms.timeZoneAtom)).toBe('UTC');
    expect(store.get(atoms.pageAtom)).toBe(1);
});

it('waits for delayed VARIANT metadata before becoming query-ready', async () => {
    const subject = new Subject<any>();
    (getVariantFieldsService as jest.Mock).mockReturnValue(subject);
    const { store, result } = setup();
    let pending: Promise<boolean>;
    act(() => {
        pending = result.current({
            ...state,
            selectedFields: [{ Field: 'attrs.http.route', variantPath: ['attrs', 'http.route'], Type: 'VARCHAR' }],
            filters: [{ id: 'v', fieldName: 'attrs.http.route', variantPath: ['attrs', 'http.route'], operator: '=', value: ['/checkout'] }],
        });
    });
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
    expect(store.get(atoms.discoverShareReadyAtom)).toBe(false);
    await act(async () => {
        subject.next(response('getVariantFields', [["attrs['http.route']"], ['VARCHAR']]));
        subject.complete();
        expect(await pending).toBe(true);
    });
    expect(store.get(atoms.selectedFieldsAtom)[0].variantPath).toEqual(['attrs', 'http.route']);
    expect(store.get(atoms.dataFilterAtom)).toHaveLength(1);
});

it.each([
    { datasource: 'denied' },
    { database: 'gone' },
    { table: 'gone' },
    { timeField: 'gone' },
    { filters: [{ id: 'bad', fieldName: 'gone', operator: '=' as const, value: ['ERROR'] }] },
    { sort: { field: 'gone', direction: 'ASC' as const } },
    { version: 2 },
])('does not fall back or enable queries for invalid state %j', async change => {
    const { store, result } = setup();
    await act(async () => {
        expect(await result.current({ ...state, ...change })).toBe(false);
    });
    expect(store.get(atoms.discoverShareReadyAtom)).toBe(false);
    expect(store.get(discoverRestoreErrorAtom)).not.toBe('');
});

it('skips only missing display columns and preserves fixed time bounds', async () => {
    const { store, result } = setup();
    await act(async () => {
        expect(
            await result.current({
                ...state,
                timeRawFrom: undefined,
                timeRawTo: undefined,
                startTime: '2026-10-20 00:00:00',
                endTime: '2026-10-21 00:00:00',
                selectedFields: [{ Field: 'gone' }],
            }),
        ).toBe(true);
    });
    expect(store.get(atoms.currentDateAtom)[0].toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(store.get(atoms.selectedFieldsAtom)).toEqual([]);
    expect(store.get(discoverRestoreWarningAtom)).toContain('gone');
});

it('ignores an earlier restore, including when the table is unchanged', async () => {
    const first = new Subject<any>();
    (getDatabases as jest.Mock).mockReturnValueOnce(first);
    const { store, result } = setup();
    let pending: Promise<boolean>;
    act(() => {
        pending = result.current({ ...state, query: 'old' });
    });
    await act(async () => {
        expect(await result.current({ ...state, query: 'new' })).toBe(true);
    });
    await act(async () => {
        first.next(response('getDatabases', [['otel']]));
        first.complete();
        expect(await pending).toBe(false);
    });
    expect(store.get(atoms.searchValueAtom)).toBe('new');
    expect(store.get(atoms.discoverShareReadyAtom)).toBe(true);
    expect(store.get(discoverRestoreEpochAtom)).toBe(2);
});

it('executes one complete query per restore, resets pagination, and still allows the next page', async () => {
    const store = createStore();
    store.set(atoms.pageAtom, 3);
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => ({ data: useDiscoverData(), restore: useDiscoverRestore(sources, invalidate) }), { wrapper });
    await act(async () => {
        expect(await result.current.restore(state)).toBe(true);
    });
    await waitFor(() => expect(getTableDataService).toHaveBeenCalledTimes(1));
    expect(getTableDataService).toHaveBeenLastCalledWith(expect.objectContaining({ table: 'logs', data_filters: state.filters }), expect.anything());
    expect(getTableDataChartsService).toHaveBeenCalledTimes(1);
    expect(store.get(atoms.pageAtom)).toBe(1);
    act(() => store.set(atoms.pageAtom, 2));
    await waitFor(() => expect(getTableDataService).toHaveBeenCalledTimes(2));
    await act(async () => {
        expect(await result.current.restore({ ...state, query: 'level:WARN' })).toBe(true);
    });
    await waitFor(() => expect(getTableDataService).toHaveBeenCalledTimes(3));
    expect(getTableDataChartsService).toHaveBeenCalledTimes(2);
    expect(store.get(atoms.searchValueAtom)).toBe('level:WARN');
});
