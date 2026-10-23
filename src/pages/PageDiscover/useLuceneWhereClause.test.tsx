import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { of } from 'rxjs';
import dayjs from 'dayjs';
import { getFieldsService, getIndexesService, getVariantPathSampleService } from 'services/metaservice';
import { getWhereSQLViaLucene } from 'services/lucene';
import { useLuceneWhereClause, rememberVariantSamples } from './useLuceneWhereClause';
import {
    currentDateAtom,
    currentTableAtom,
    discoverCurrentAtom,
    searchValueAtom,
    searchTypeAtom,
    selectedDatasourceAtom,
    tableMetadataAtom,
    variantImplicitPathsAtom,
    variantSamplingWarningAtom,
} from 'store/discover';

jest.mock('services/metaservice', () => ({ getFieldsService: jest.fn(), getIndexesService: jest.fn(), getVariantPathSampleService: jest.fn() }));
jest.mock('services/lucene', () => ({ getWhereSQLViaLucene: jest.fn(async () => 'WHERE CLAUSE') }));
const fields = [
    { Field: 'message', Type: 'VARCHAR(255)' },
    { Field: 'attrs', Type: 'VARIANT' },
    { Field: 'timestamp', Type: 'DATETIMEV2(6)' },
    { Field: 'duration', Type: 'BIGINT' },
    { Field: 'unknown' },
];
const key = JSON.stringify(['ds', 'otel', 'logs']);
function sampleResponse(method = 'GET') {
    return of({
        ok: true,
        data: {
            results: {
                sampleVariantPaths: { frames: [{ schema: { fields: [{ name: 'c1', type: 'string' }] }, data: { values: [[JSON.stringify({ http: { method }, numeric: 1 })]] } }] },
            },
        },
    });
}
function setup() {
    const store = createStore();
    store.set(discoverCurrentAtom, { catalog: 'internal', database: 'otel', table: 'logs', timeField: 'timestamp', date: [], cluster: '' });
    store.set(currentTableAtom, 'logs');
    store.set(currentDateAtom, [dayjs('2026-10-16T01:00:00Z'), dayjs('2026-10-16T02:00:00Z')]);
    store.set(selectedDatasourceAtom, { uid: 'ds', type: 'doris' } as any);
    store.set(searchValueAtom, 'GET');
    store.set(searchTypeAtom, 'Lucene');
    store.set(tableMetadataAtom, { [key]: { fields, indexes: [{ type: 'INVERTED', columnName: 'message' }] } });
    store.set(variantImplicitPathsAtom, {});
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    return { store, ...renderHook(() => useLuceneWhereClause(), { wrapper }) };
}
beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    (getVariantPathSampleService as jest.Mock).mockReturnValue(sampleResponse());
});

it('awaits sampling and feeds paths into the FIRST search without metadata queries', async () => {
    const { result } = setup();
    await act(async () => {
        expect(await result.current()).toBe('WHERE CLAUSE');
    });
    expect(getFieldsService).not.toHaveBeenCalled();
    expect(getIndexesService).not.toHaveBeenCalled();
    expect(getWhereSQLViaLucene).toHaveBeenCalledWith(
        expect.objectContaining({
            implicitColumnExpression: "coalesce(`message`, '')",
            variantImplicitPaths: { attrs: [['http', 'method']] },
        }),
    );
    expect(getVariantPathSampleService).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-10-16 01:00:00', endDate: '2026-10-16 02:00:00' }));
    await act(async () => {
        await result.current();
    });
    expect(getVariantPathSampleService).toHaveBeenCalledTimes(1);
});

it('resamples explicitly, preserving and extending cached paths by frequency', async () => {
    const { result, store } = setup();
    await act(async () => {
        await result.current();
    });
    (getVariantPathSampleService as jest.Mock).mockReturnValue(
        of({
            ok: true,
            data: { results: { sampleVariantPaths: { frames: [{ schema: { fields: [{ name: 'c1', type: 'string' }] }, data: { values: [['{"new":"value"}']] } }] } } },
        }),
    );
    await act(async () => {
        await result.current({ refreshPaths: true });
    });
    expect(getVariantPathSampleService).toHaveBeenCalledTimes(2);
    expect(store.get(variantImplicitPathsAtom)[key].attrs).toEqual(expect.arrayContaining([['new'], ['http', 'method']]));
});

it('keeps cached coverage and exposes a warning if sampling fails', async () => {
    const { result, store } = setup();
    store.set(variantImplicitPathsAtom, { [key]: { attrs: [['cached']] } });
    (getVariantPathSampleService as jest.Mock).mockReturnValue(of({ ok: false }));
    await act(async () => {
        await result.current();
    });
    expect(getWhereSQLViaLucene).toHaveBeenCalledWith(expect.objectContaining({ variantImplicitPaths: { attrs: [['cached']] } }));
    expect(store.get(variantSamplingWarningAtom)[key]).toContain('may miss');
});

it('does not serialize a stale table after asynchronous sampling', async () => {
    const { result, store } = setup();
    let deliver: (value: any) => void = () => {};
    const { Observable } = jest.requireActual('rxjs');
    (getVariantPathSampleService as jest.Mock).mockReturnValue(
        new Observable((subscriber: any) => {
            deliver = value => {
                subscriber.next(value);
                subscriber.complete();
            };
        }),
    );
    let pending: Promise<string>;
    await act(async () => {
        pending = result.current();
        store.set(currentTableAtom, 'other');
        deliver({ ok: true, data: { results: { sampleVariantPaths: { frames: [] } } } });
        await expect(pending).rejects.toThrow('Search table changed');
    });
    expect(getWhereSQLViaLucene).not.toHaveBeenCalled();
    expect(store.get(currentTableAtom)).toBe('other');
});

it('merges sidebar samples into the correct table and caps by frequency', () => {
    const { store } = setup();
    const values = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`key${i}`, 'value']));
    rememberVariantSamples(store, key, ['attrs'], [{ attrs: values }, ...Array.from({ length: 5 }, () => ({ attrs: { popular: 'GET' } }))]);
    const paths = store.get(variantImplicitPathsAtom)[key].attrs;
    expect(paths).toHaveLength(200);
    expect(paths[0]).toEqual(['popular']);
});
