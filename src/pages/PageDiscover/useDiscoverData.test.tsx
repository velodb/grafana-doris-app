import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import dayjs from 'dayjs';
import { of } from 'rxjs';
import { useDiscoverData } from './useDiscoverData';
import { getTableDataChartsService, getTableDataCountService, getTableDataService, getTopDataService } from 'services/discover';
import {
    currentDateAtom,
    currentTableAtom,
    discoverCurrentAtom,
    searchValueAtom,
    searchTypeAtom,
    selectedDatasourceAtom,
    tableFieldsAtom,
    discoverShareReadyAtom,
    discoverQueryStateAtom,
} from 'store/discover';

const buildClause = jest.fn();
jest.mock('./useLuceneWhereClause', () => ({ useLuceneWhereClause: () => buildClause, rememberVariantSamples: jest.fn() }));
jest.mock('services/discover', () => ({
    getTableDataChartsService: jest.fn(),
    getTableDataCountService: jest.fn(),
    getTableDataService: jest.fn(),
    getTopDataService: jest.fn(),
    getTopNDataService: jest.fn(),
}));
jest.mock('services/traces', () => ({ getTableDataTraceService: jest.fn() }));
jest.mock('utils/utils', () => ({ generateTableDataUID: async (rows: any[]) => rows }));

function setup() {
    const store = createStore();
    store.set(discoverCurrentAtom, { catalog: 'internal', database: 'otel', table: 'logs', timeField: 'timestamp', date: [], cluster: '' });
    store.set(currentTableAtom, 'logs');
    store.set(currentDateAtom, [dayjs('2026-10-16T01:00:00Z'), dayjs('2026-10-16T02:00:00Z')]);
    store.set(selectedDatasourceAtom, { uid: 'ds', type: 'doris' } as any);
    store.set(searchTypeAtom, 'Lucene');
    store.set(searchValueAtom, 'GET');
    store.set(tableFieldsAtom, [{ Field: 'timestamp', Type: 'DATETIMEV2' }]);
    store.set(discoverShareReadyAtom, false);
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    return { store, ...renderHook(() => useDiscoverData(), { wrapper }) };
}
const services = [getTableDataChartsService, getTableDataCountService, getTableDataService, getTopDataService];
beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    buildClause.mockResolvedValue("`attrs`['http']['method'] = 'GET'");
    Object.defineProperty(performance, 'measure', { configurable: true, value: jest.fn() });
    services.forEach(service => (service as jest.Mock).mockReturnValue(of({ ok: true, data: { results: {} } })));
});

it('builds one WHERE and supplies the same clause to all four search requests', async () => {
    const { result } = setup();
    act(() => result.current.onQuerying());
    await waitFor(() => expect(getTableDataService).toHaveBeenCalledTimes(1));
    expect(buildClause).toHaveBeenCalledTimes(1);
    for (const service of services) {
        expect(service).toHaveBeenCalledTimes(1);
        expect(service).toHaveBeenCalledWith(expect.objectContaining({ lucene_where: "`attrs`['http']['method'] = 'GET'", startDate: '2026-10-16 01:00:00' }), expect.anything());
    }
});
it('does not issue data requests after a WHERE build error', async () => {
    buildClause.mockRejectedValueOnce(new Error('invalid Lucene'));
    const { result, store } = setup();
    act(() => result.current.onQuerying());
    await waitFor(() => expect(store.get(discoverQueryStateAtom).status).toBe('error'));
    services.forEach(service => expect(service).not.toHaveBeenCalled());
});
it('distinguishes explicit metadata refresh from ordinary searches', async () => {
    const { result } = setup();
    await act(async () => result.current.onRefresh());
    await waitFor(() => expect(getTableDataService).toHaveBeenCalledTimes(1));
    expect(buildClause).toHaveBeenCalledWith({ refreshMetadata: true, refreshPaths: true });
});
it('drops a prepared clause if the selected table changed while waiting', async () => {
    let resolve: (value: string) => void = () => {};
    buildClause.mockImplementationOnce(
        () =>
            new Promise<string>(done => {
                resolve = done;
            }),
    );
    const { result, store } = setup();
    act(() => result.current.onQuerying());
    act(() => store.set(currentTableAtom, 'other'));
    await act(async () => resolve('old clause'));
    services.forEach(service => expect(service).not.toHaveBeenCalled());
});
