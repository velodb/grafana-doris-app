import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import dayjs from 'dayjs';
import { Subject } from 'rxjs';
import { getTopNDataService } from 'services/discover';
import {
    currentDateAtom,
    currentTableAtom,
    discoverCurrentAtom,
    discoverQueryStateAtom,
    searchTypeAtom,
    searchValueAtom,
    selectedDatasourceAtom,
    tableDataAtom,
    tableFieldsAtom,
    topDataAtom,
    topNConfigAtom,
    topNEnabledAtom,
    topNRowsAtom,
    topNRunRequestAtom,
} from 'store/discover';
import { useTopNData } from './useTopNData';

const buildClause = jest.fn();
jest.mock('pages/PageDiscover/useLuceneWhereClause', () => ({ useLuceneWhereClause: () => buildClause }));
jest.mock('services/discover', () => ({ getTopNDataService: jest.fn() }));

function response(value: string, count: number) {
    return {
        data: {
            results: {
                getTopNData: {
                    frames: [
                        {
                            schema: {
                                fields: [
                                    { name: 'service_name', type: 'string' },
                                    { name: '__top_n_value', type: 'number' },
                                ],
                            },
                            data: { values: [[value], [count]] },
                        },
                    ],
                },
            },
        },
    };
}

function setup() {
    const store = createStore();
    store.set(discoverCurrentAtom, { catalog: 'internal', database: 'otel', table: 'logs', timeField: 'timestamp', date: [], cluster: '' });
    store.set(currentTableAtom, 'logs');
    store.set(currentDateAtom, [dayjs('2026-10-16T01:00:00Z'), dayjs('2026-10-16T02:00:00Z')]);
    store.set(selectedDatasourceAtom, { uid: 'ds', type: 'doris' } as any);
    store.set(tableFieldsAtom, [
        { Field: 'service_name', Type: 'VARCHAR' },
        { Field: 'timestamp', Type: 'DATETIMEV2' },
    ]);
    store.set(searchTypeAtom, 'Lucene');
    store.set(searchValueAtom, 'GET');
    store.set(tableDataAtom, [{ _uid: 'record', _original: { service_name: 'api' } }]);
    store.set(topDataAtom, [{ service_name: 'api' }]);
    store.set(discoverQueryStateAtom, { status: 'success', rowCount: 1, auxiliaryErrors: [] });
    const table = store.get(tableDataAtom);
    const query = store.get(discoverQueryStateAtom);
    const sample = store.get(topDataAtom);
    const hook = renderHook(() => useTopNData('service_name'), { wrapper: ({ children }) => <Provider store={store}>{children}</Provider> });
    const run = (limit: number) =>
        act(() => {
            store.set(topNConfigAtom, { groupField: 'service_name', metric: 'COUNT', metricField: '', direction: 'DESC', limit });
            store.set(topNEnabledAtom, true);
            store.set(topNRunRequestAtom, value => value + 1);
        });
    return { ...hook, store, run, table, query, sample };
}

beforeEach(() => {
    jest.clearAllMocks();
    buildClause.mockResolvedValue("`message` LIKE '%GET%'");
});

it('runs only the sidebar aggregation and preserves the main records, sample and query status', async () => {
    const subject = new Subject<any>();
    (getTopNDataService as jest.Mock).mockReturnValue(subject);
    const hook = setup();
    expect(getTopNDataService).not.toHaveBeenCalled();
    hook.run(10);
    await waitFor(() => expect(getTopNDataService).toHaveBeenCalledTimes(1));
    expect(getTopNDataService).toHaveBeenCalledWith(
        expect.objectContaining({
            groupField: 'service_name',
            limit: 10,
            lucene_where: "`message` LIKE '%GET%'",
            startDate: '2026-10-16 01:00:00',
            endDate: '2026-10-16 02:00:00',
        }),
        expect.anything(),
        expect.anything(),
    );
    act(() => subject.next(response('api', 12)));
    expect(hook.store.get(topNRowsAtom)).toEqual([{ service_name: 'api', __top_n_value: 12 }]);
    expect(hook.store.get(tableDataAtom)).toBe(hook.table);
    expect(hook.store.get(topDataAtom)).toBe(hook.sample);
    expect(hook.store.get(discoverQueryStateAtom)).toBe(hook.query);
});

it('keeps aggregation failures local to the sidebar', async () => {
    const subject = new Subject<any>();
    (getTopNDataService as jest.Mock).mockReturnValue(subject);
    const hook = setup();
    hook.run(5);
    await waitFor(() => expect(getTopNDataService).toHaveBeenCalledTimes(1));
    act(() => subject.error(new Error('aggregation failed')));
    expect(hook.result.current.error?.message).toBe('aggregation failed');
    expect(hook.store.get(tableDataAtom)).toBe(hook.table);
    expect(hook.store.get(discoverQueryStateAtom)).toBe(hook.query);
});

it('ignores superseded results and stops updates when the sidebar closes', async () => {
    const older = new Subject<any>();
    const newer = new Subject<any>();
    (getTopNDataService as jest.Mock).mockReturnValueOnce(older).mockReturnValueOnce(newer);
    const hook = setup();
    hook.run(5);
    await waitFor(() => expect(getTopNDataService).toHaveBeenCalledTimes(1));
    hook.run(20);
    await waitFor(() => expect(getTopNDataService).toHaveBeenCalledTimes(2));
    act(() => {
        newer.next(response('new', 20));
        older.next(response('old', 5));
    });
    expect(hook.store.get(topNRowsAtom)).toEqual([{ service_name: 'new', __top_n_value: 20 }]);
    hook.unmount();
    act(() => newer.next(response('closed', 99)));
    expect(hook.store.get(topNRowsAtom)).toEqual([{ service_name: 'new', __top_n_value: 20 }]);
});
