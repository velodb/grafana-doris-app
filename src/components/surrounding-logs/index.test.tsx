import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { of } from 'rxjs';
import { dataFilterAtom, selectedRowAtom } from 'store/discover';
import { getSurroundingDataWithWindow } from 'services/discover';
import SurroundingLogs from './index';
import { DataFilterType } from 'types/type';

jest.mock('@grafana/ui', () => ({
    createLogger: () => ({ warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    attachDebugger: () => undefined,
    useTheme2: () => ({ isDark: false }),
    Checkbox: ({ label, checked, onChange }: any) => (
        <label><input type="checkbox" checked={checked} onChange={onChange} />{label}</label>
    ),
    Badge: ({ text }: any) => <span>{text}</span>,
    LoadingBar: () => null,
}));
jest.mock('@grafana/runtime', () => ({ logError: jest.fn() }));
jest.mock('services/discover', () => ({ getSurroundingDataWithWindow: jest.fn() }));
jest.mock('components/selectdb-ui/sd-collapsible-table', () => () => null);
jest.mock('components/discover-content/variant-value-viewer', () => ({ VariantValueViewer: () => null }));
jest.mock('components/long-text-cell', () => ({ LongTextCell: () => null }));
jest.mock('./column-action', () => ({ SurroundingColumnAction: () => null }));
jest.mock('./logs-actions', () => ({
    SurroundingLogsActions: ({ getSurroundingData, time, type }: any) => (
        <button onClick={() => getSurroundingData({ time })}>{type}</button>
    ),
}));
jest.mock('utils/data', () => ({
    ...jest.requireActual('utils/data'),
    convertColumnToRowViaFieldsType: () => [],
}));
jest.mock('utils/utils', () => ({ generateTableDataUID: async (data: any[]) => data }));

it('opts into Discover filters for initial and additional surrounding queries and resets on reopen', async () => {
    const query = getSurroundingDataWithWindow as jest.Mock;
    query.mockImplementation(() => of({
        ok: true,
        data: { results: { getSurroundingData: { frames: [{}] } } },
    }));
    const store = createStore();
    const filters: DataFilterType[] = [{ id: 'level-error', fieldName: 'level', operator: '=', value: ['ERROR'] }];
    store.set(dataFilterAtom, filters);
    store.set(selectedRowAtom, {
        _uid: 'anchor', time: '2026-10-23 10:00:00', _original: {},
    });
    const view = () => <Provider store={store}><SurroundingLogs /></Provider>;
    let unmount = () => {};
    await act(async () => {
        ({ unmount } = render(view()));
    });
    const checkbox = screen.getByRole('checkbox', { name: 'Filter' });
    expect(checkbox).not.toBeChecked();
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls.every(([params]) => params.data_filters.length === 0)).toBe(true);

    query.mockClear();
    await act(async () => { fireEvent.click(checkbox); });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(checkbox).toBeChecked();
    expect(query.mock.calls.every(([params]) => params.data_filters === filters)).toBe(true);

    query.mockClear();
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'before' }));
        fireEvent.click(screen.getByRole('button', { name: 'after' }));
    });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls.every(([params]) => params.data_filters === filters)).toBe(true);

    query.mockClear();
    await act(async () => { fireEvent.click(checkbox); });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls.every(([params]) => params.data_filters.length === 0)).toBe(true);

    await act(async () => { fireEvent.click(checkbox); });
    await waitFor(() => expect(checkbox).toBeChecked());
    unmount();
    query.mockClear();
    await act(async () => { render(view()); });
    expect(screen.getByRole('checkbox', { name: 'Filter' })).not.toBeChecked();
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls.every(([params]) => params.data_filters.length === 0)).toBe(true);
});
