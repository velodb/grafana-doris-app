import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { currentTableAtom, discoverCurrentAtom, selectedDatasourceAtom, topNConfigAtom, topNRunRequestAtom } from 'store/discover';
import { useTopNPreferences } from './useTopNPreferences';

const storageKey = 'discover-top-n-preferences-v1';

function setup(field = 'service_name') {
    const store = createStore();
    store.set(selectedDatasourceAtom, { uid: 'ds', type: 'doris' } as any);
    store.set(discoverCurrentAtom, { catalog: 'internal', database: 'otel', table: 'logs', timeField: 'timestamp', date: [], cluster: '' });
    store.set(currentTableAtom, 'logs');
    return {
        store,
        ...renderHook(({ name }) => useTopNPreferences(name), {
            initialProps: { name: field },
            wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
        }),
    };
}

beforeEach(() => localStorage.clear());

it('automatically saves every preference and restores it in a fresh store without running a query', () => {
    const first = setup();
    act(() => first.result.current.update({ limit: 37, metric: 'AVG', metricField: 'duration_ms', direction: 'ASC' }));
    const expected = { groupField: 'service_name', limit: 37, metric: 'AVG', metricField: 'duration_ms', direction: 'ASC' };
    expect(JSON.parse(localStorage.getItem(storageKey)!)[first.result.current.key]).toEqual(expected);
    first.unmount();

    const refreshed = setup();
    expect(refreshed.result.current.config).toEqual(expected);
    expect(refreshed.store.get(topNRunRequestAtom)).toBe(0);
    expect(refreshed.store.get(topNConfigAtom).limit).toBe(5);
});

it('keeps configurations independent for fields, tables and datasources', () => {
    const hook = setup();
    act(() => hook.result.current.update({ limit: 20 }));
    hook.rerender({ name: 'severity_text' });
    expect(hook.result.current.config.limit).toBe(5);
    act(() => hook.result.current.update({ limit: 50 }));
    hook.rerender({ name: 'service_name' });
    expect(hook.result.current.config.limit).toBe(20);
    act(() => hook.store.set(currentTableAtom, 'other_logs'));
    expect(hook.result.current.config.limit).toBe(5);
    act(() => hook.store.set(currentTableAtom, 'logs'));
    expect(hook.result.current.config.limit).toBe(20);
    act(() => hook.store.set(selectedDatasourceAtom, { uid: 'other', type: 'doris' } as any));
    expect(hook.result.current.config.limit).toBe(5);
    expect(Object.keys(JSON.parse(localStorage.getItem(storageKey)!))).toHaveLength(2);
});

it('restores settings without writing defaults over another context', () => {
    const first = setup();
    act(() => first.result.current.update({ limit: 100, direction: 'ASC' }));
    const saved = localStorage.getItem(storageKey);
    first.unmount();
    const refreshed = setup('new_field');
    expect(refreshed.result.current.config.limit).toBe(5);
    expect(localStorage.getItem(storageKey)).toBe(saved);
});

it('uses valid defaults when stored values are invalid', () => {
    localStorage.setItem(
        storageKey,
        JSON.stringify({
            [JSON.stringify(['ds', 'internal', 'otel', 'logs', 'service_name'])]: { limit: -2, metric: 'INVALID', direction: 'unknown', metricField: null },
        }),
    );
    const hook = setup();
    expect(hook.result.current.config).toEqual({ groupField: 'service_name', limit: 5, metric: 'COUNT', metricField: '', direction: 'DESC' });
});
