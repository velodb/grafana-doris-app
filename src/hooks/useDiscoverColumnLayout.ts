import { useCallback, useMemo } from 'react';
import { useAtom } from 'jotai';
import { ColumnOrderState, ColumnSizingState, OnChangeFn } from '@tanstack/react-table';
import { discoverColumnLayoutsAtom, discoverSharedColumnOrderAtom } from 'store/discover';
import { reconcileColumnOrder, reconcileColumnSizing } from 'utils/column-layout';

export function useDiscoverColumnLayout(layoutKey: string, availableColumnIds: string[], defaultColumnSizing: ColumnSizingState) {
    const [columnLayouts, setColumnLayouts] = useAtom(discoverColumnLayoutsAtom);
    const [sharedColumnOrder, setSharedColumnOrder] = useAtom(discoverSharedColumnOrderAtom);
    const savedLayout = layoutKey ? columnLayouts[layoutKey] : undefined;
    const columnOrder = useMemo(
        () => reconcileColumnOrder(availableColumnIds, sharedColumnOrder.length ? sharedColumnOrder : savedLayout?.columnOrder),
        [availableColumnIds, savedLayout?.columnOrder, sharedColumnOrder],
    );
    const columnSizing = useMemo(
        () => ({ ...defaultColumnSizing, ...reconcileColumnSizing(availableColumnIds, savedLayout?.columnSizing) }),
        [availableColumnIds, defaultColumnSizing, savedLayout?.columnSizing],
    );

    // Persist only user changes. Restoring a link or changing tables must never
    // write the previous table's layout over the newly selected table's settings.
    const onColumnSizingChange = useCallback<OnChangeFn<ColumnSizingState>>(updater => {
        if (!layoutKey) {
            return;
        }
        setColumnLayouts(previous => {
            const current = previous[layoutKey];
            const currentSizing = { ...defaultColumnSizing, ...reconcileColumnSizing(availableColumnIds, current?.columnSizing) };
            const nextSizing = typeof updater === 'function' ? updater(currentSizing) : updater;
            // Keep hidden fields' widths, but let resetSize remove a visible field's override.
            const inactiveSizing = Object.fromEntries(Object.entries(current?.columnSizing || {}).filter(([id]) => !availableColumnIds.includes(id)));
            return {
                ...previous,
                [layoutKey]: {
                    columnOrder: current?.columnOrder || columnOrder,
                    columnSizing: { ...inactiveSizing, ...nextSizing },
                },
            };
        });
    }, [availableColumnIds, columnOrder, defaultColumnSizing, layoutKey, setColumnLayouts]);

    const onColumnOrderChange = useCallback<OnChangeFn<ColumnOrderState>>(updater => {
        const nextOrder = typeof updater === 'function' ? updater(columnOrder) : updater;
        setSharedColumnOrder(nextOrder);
        if (layoutKey) {
            setColumnLayouts(previous => ({
                ...previous,
                [layoutKey]: {
                    columnOrder: [...nextOrder, ...(previous[layoutKey]?.columnOrder || []).filter(id => !nextOrder.includes(id))],
                    columnSizing: previous[layoutKey]?.columnSizing || {},
                },
            }));
        }
    }, [columnOrder, layoutKey, setColumnLayouts, setSharedColumnOrder]);

    const resetColumnLayout = useCallback(() => {
        setSharedColumnOrder([]);
        if (layoutKey) {
            setColumnLayouts(previous => {
                const { [layoutKey]: _removed, ...remaining } = previous;
                return remaining;
            });
        }
    }, [layoutKey, setColumnLayouts, setSharedColumnOrder]);

    return { columnOrder, columnSizing, onColumnOrderChange, onColumnSizingChange, resetColumnLayout };
}
