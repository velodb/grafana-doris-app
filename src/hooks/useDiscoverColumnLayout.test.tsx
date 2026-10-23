import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { discoverSharedColumnOrderAtom } from 'store/discover';
import { useDiscoverColumnLayout } from './useDiscoverColumnLayout';

const storageKey = 'discover-column-layouts';
const firstTable = JSON.stringify(['ds', 'internal', 'logs', 'first']);
const secondTable = JSON.stringify(['ds', 'internal', 'logs', 'second']);
const columns = ['__expand', '__time', '__source'];
const defaults = { __time: 240, __source: 640 };

function setup(layoutKey = firstTable, sharedOrder: string[] = []) {
    const store = createStore();
    store.set(discoverSharedColumnOrderAtom, sharedOrder);
    return renderHook(({ key, ids }) => useDiscoverColumnLayout(key, ids, defaults), {
        initialProps: { key: layoutKey, ids: columns },
        wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
}

beforeEach(() => localStorage.clear());

it('saves resizing immediately even with a shared order, and restores it in a fresh store', () => {
    const sharedOrder = ['__expand', '__source', '__time'];
    const first = setup(firstTable, sharedOrder);
    act(() => first.result.current.onColumnSizingChange(current => ({ ...current, __time: 360, __source: 720 })));
    expect(JSON.parse(localStorage.getItem(storageKey)!)[firstTable].columnSizing).toEqual({ __time: 360, __source: 720 });
    first.unmount();

    const refreshed = setup(firstTable, sharedOrder);
    expect(refreshed.result.current.columnSizing).toEqual({ __time: 360, __source: 720 });
    expect(refreshed.result.current.columnOrder).toEqual(sharedOrder);
});

it('keeps saving widths after columns have been reordered', () => {
    const first = setup();
    act(() => first.result.current.onColumnOrderChange(['__expand', '__source', '__time']));
    act(() => first.result.current.onColumnSizingChange(current => ({ ...current, __time: 420 })));
    first.unmount();

    const refreshed = setup();
    expect(refreshed.result.current.columnOrder).toEqual(['__expand', '__source', '__time']);
    expect(refreshed.result.current.columnSizing.__time).toBe(420);
});

it('restores each table independently without writing defaults or another table’s widths', () => {
    const layouts = {
        [firstTable]: { columnOrder: columns, columnSizing: { __time: 360 } },
        [secondTable]: { columnOrder: columns, columnSizing: { __time: 480 } },
    };
    localStorage.setItem(storageKey, JSON.stringify(layouts));
    const hook = setup();
    expect(hook.result.current.columnSizing.__time).toBe(360);
    hook.rerender({ key: secondTable, ids: columns });
    expect(hook.result.current.columnSizing.__time).toBe(480);
    hook.rerender({ key: '', ids: columns });
    expect(hook.result.current.columnSizing).toEqual(defaults);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(layouts);
});

it('retains hidden field widths when resizing another column and supports resetting one width', () => {
    localStorage.setItem(storageKey, JSON.stringify({
        [firstTable]: { columnOrder: columns, columnSizing: { __time: 360, 'field:body': 500 } },
    }));
    const hook = setup();
    act(() => hook.result.current.onColumnSizingChange(current => ({ ...current, __source: 700 })));
    hook.rerender({ key: firstTable, ids: [...columns, 'field:body'] });
    expect(hook.result.current.columnSizing['field:body']).toBe(500);

    act(() => hook.result.current.onColumnSizingChange(({ __time: _removed, ...remaining }) => remaining));
    expect(hook.result.current.columnSizing.__time).toBe(240);
    hook.unmount();
    expect(setup().result.current.columnSizing.__time).toBe(240);
});

it('persists a layout reset without clearing other tables', () => {
    const otherLayout = { columnOrder: columns, columnSizing: { __time: 480 } };
    localStorage.setItem(storageKey, JSON.stringify({
        [firstTable]: { columnOrder: columns, columnSizing: { __time: 360 } },
        [secondTable]: otherLayout,
    }));
    const hook = setup(firstTable, ['__expand', '__source', '__time']);
    act(() => hook.result.current.resetColumnLayout());
    expect(hook.result.current.columnSizing).toEqual(defaults);
    expect(hook.result.current.columnOrder).toEqual(columns);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ [secondTable]: otherLayout });
    hook.unmount();
    expect(setup().result.current.columnSizing).toEqual(defaults);
});
