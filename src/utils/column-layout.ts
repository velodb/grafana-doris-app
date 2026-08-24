import { ColumnSizingState } from '@tanstack/react-table';

const EXPAND_COLUMN_ID = '__expand';

export function reconcileColumnOrder(availableColumnIds: string[], persistedColumnOrder: string[] = []) {
    const available = new Set(availableColumnIds);
    const reconciled = persistedColumnOrder.filter(id => available.has(id) && id !== EXPAND_COLUMN_ID);
    for (const id of availableColumnIds) {
        if (id !== EXPAND_COLUMN_ID && !reconciled.includes(id)) {
            reconciled.push(id);
        }
    }
    return available.has(EXPAND_COLUMN_ID) ? [EXPAND_COLUMN_ID, ...reconciled] : reconciled;
}

export function reconcileColumnSizing(availableColumnIds: string[], persistedColumnSizing: ColumnSizingState = {}) {
    const available = new Set(availableColumnIds);
    return Object.fromEntries(
        Object.entries(persistedColumnSizing)
            .filter(([id]) => available.has(id) && id !== EXPAND_COLUMN_ID)
            .map(([id, size]) => [id, Math.min(800, Math.max(80, size))]),
    );
}
