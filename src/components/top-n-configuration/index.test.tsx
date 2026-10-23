import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import {
    currentTableAtom,
    discoverCurrentAtom,
    selectedDatasourceAtom,
    tableFieldsAtom,
    topNConfigAtom,
    topNConfigurationFieldAtom,
    topNEnabledAtom,
    topNRunRequestAtom,
} from 'store/discover';
import TopNConfiguration from './index';

jest.mock('./useTopNData', () => ({ useTopNData: () => ({ loading: false, hasRun: false }) }));

// Exercise the form with real Grafana controls; the drawer's overlay requires
// the host's React runtime, which differs from the standalone Jest runtime.
jest.mock('@grafana/ui', () => ({
    ...jest.requireActual('@grafana/ui'),
    Drawer: ({ title, children }: any) => (
        <section role="dialog" aria-label={title}>
            {children}
        </section>
    ),
}));

function setup() {
    const store = createStore();
    store.set(selectedDatasourceAtom, { uid: 'ds', type: 'doris' } as any);
    store.set(discoverCurrentAtom, { catalog: 'internal', database: 'otel', table: 'logs', timeField: 'timestamp', date: [], cluster: '' });
    store.set(currentTableAtom, 'logs');
    store.set(tableFieldsAtom, [
        { Field: 'service_name', Type: 'VARCHAR' },
        { Field: 'duration_ms', Type: 'DOUBLE' },
    ]);
    store.set(topNConfigurationFieldAtom, { Field: 'service_name', Type: 'VARCHAR' });
    render(
        <Provider store={store}>
            <TopNConfiguration />
        </Provider>,
    );
    return store;
}

beforeEach(() => localStorage.clear());

it('configures a common N without running until the user submits', () => {
    const store = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Top 20' }));
    expect(store.get(topNConfigAtom).limit).toBe(5);
    expect(store.get(topNRunRequestAtom)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Run aggregation' }));
    expect(store.get(topNConfigAtom)).toEqual({ groupField: 'service_name', metric: 'COUNT', metricField: '', direction: 'DESC', limit: 20 });
    expect(store.get(topNEnabledAtom)).toBe(true);
    expect(store.get(topNRunRequestAtom)).toBe(1);
    expect(store.get(topNConfigurationFieldAtom)).toEqual({ Field: 'service_name', Type: 'VARCHAR' });
});

it.each(['0', '1.5', '10001', ''])('rejects invalid custom N %s', value => {
    const store = setup();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of groups (N)' }), { target: { value: '20' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of groups (N)' }), { target: { value } });
    expect(screen.getByRole('button', { name: 'Run aggregation' })).toBeDisabled();
    expect(store.get(topNRunRequestAtom)).toBe(0);
    const saved = Object.values(JSON.parse(localStorage.getItem('discover-top-n-preferences-v1')!)) as Array<{ limit: number }>;
    expect(saved[0].limit).toBe(20);
});

it('runs a custom N with a numeric metric and Bottom ordering', () => {
    const store = setup();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of groups (N)' }), { target: { value: '37' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Aggregation' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByText('Average (AVG)', { exact: true }));
    expect(screen.getByRole('combobox', { name: 'Metric field' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Sort direction' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByText('Lowest to highest (Bottom)', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Run aggregation' }));
    expect(store.get(topNConfigAtom)).toEqual({ groupField: 'service_name', metric: 'AVG', metricField: 'duration_ms', direction: 'ASC', limit: 37 });
    expect(store.get(topNRunRequestAtom)).toBe(1);
});

it('closes without enabling or running aggregation', () => {
    const store = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Top 100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(store.get(topNConfigAtom).limit).toBe(5);
    expect(store.get(topNRunRequestAtom)).toBe(0);
    expect(store.get(topNEnabledAtom)).toBe(false);
    expect(store.get(topNConfigurationFieldAtom)).toBeUndefined();
});
