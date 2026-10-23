import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { selectedFieldsAtom, tableFieldsAtom } from 'store/discover';
import { SurroundingColumnAction } from './column-action';

jest.mock('@grafana/ui', () => ({
    createLogger: () => ({ warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    attachDebugger: () => undefined,
    IconButton: ({ tooltip, onClick }: { tooltip: string; onClick: React.MouseEventHandler<HTMLButtonElement> }) => (
        <button onClick={onClick}>{tooltip}</button>
    ),
}));

describe('SurroundingColumnAction', () => {
    const field = { Field: 'service', Type: 'VARCHAR' };

    it('adds an available field to the shared main-table selection', () => {
        const store = createStore();
        store.set(tableFieldsAtom, [field]);
        store.set(selectedFieldsAtom, []);

        render(<Provider store={store}><SurroundingColumnAction fieldName="service" /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Add To Table' }));

        expect(store.get(selectedFieldsAtom)).toEqual([field]);
    });

    it('removes a selected field from the shared main-table selection', () => {
        const store = createStore();
        store.set(tableFieldsAtom, [field]);
        store.set(selectedFieldsAtom, [field]);

        render(<Provider store={store}><SurroundingColumnAction fieldName="service" /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Remove From Table' }));

        expect(store.get(selectedFieldsAtom)).toEqual([]);
    });
});
