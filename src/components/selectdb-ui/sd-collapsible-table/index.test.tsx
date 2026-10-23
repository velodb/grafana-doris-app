import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ColumnDef, ColumnSizingState, SortingState } from '@tanstack/react-table';
import SDCollapsibleTable from './index';

type RowData = { time: string; message: string };

const columns: Array<ColumnDef<RowData>> = [
    {
        id: '__expand',
        header: '',
        cell: () => null,
        size: 48,
        minSize: 48,
        maxSize: 48,
        enableSorting: false,
        enableResizing: false,
    },
    {
        id: 'time',
        accessorKey: 'time',
        header: 'Time',
        enableSorting: true,
        sortDescFirst: false,
    },
    {
        id: 'message',
        accessorKey: 'message',
        header: 'Message',
        enableSorting: true,
        sortDescFirst: false,
    },
];

function TableHarness({ data = [{ time: '2026-08-03', message: 'hello' }], emptyContent, stickyHeader }: { data?: RowData[]; emptyContent?: React.ReactNode; stickyHeader?: boolean }) {
    const [sorting, setSorting] = React.useState<SortingState>([{ id: 'time', desc: true }]);
    const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({ time: 240, message: 240 });
    return (
        <SDCollapsibleTable
            data={data}
            columns={columns}
            getRowCanExpand={() => false}
            renderSubComponent={() => <div />}
            columnOrder={['__expand', 'time', 'message']}
            onColumnOrderChange={() => {}}
            columnSizing={columnSizing}
            onColumnSizingChange={setColumnSizing}
            sorting={sorting}
            onSortingChange={setSorting}
            enableColumnReordering
            emptyContent={emptyContent}
            stickyHeader={stickyHeader}
        />
    );
}

describe('SDCollapsibleTable column interactions', () => {
    it('exposes sorting state and toggles a sortable header', () => {
        render(<TableHarness />);
        const timeHeader = screen.getByText('Time').closest('th');
        expect(timeHeader).toHaveAttribute('aria-sort', 'descending');

        fireEvent.click(screen.getByText('Time').closest('[role="button"]') as HTMLElement);

        expect(timeHeader).toHaveAttribute('aria-sort', 'ascending');
    });

    it.each([true, false])('resizes columns with stickyHeader=%s without changing sorting', async stickyHeader => {
        render(<TableHarness stickyHeader={stickyHeader} />);
        expect(screen.getByRole('button', { name: 'Move column time' })).toBeInTheDocument();

        const separator = screen.getByRole('separator', { name: 'Resize column time' });
        fireEvent.mouseDown(separator, { clientX: 240 });
        fireEvent.mouseMove(document, { clientX: 340 });
        fireEvent.mouseUp(document);

        await waitFor(() => expect(screen.getByText('Time').closest('th')).toHaveStyle({ width: '340px' }));
        expect(screen.getByText('2026-08-03').closest('td')).toHaveStyle({ width: '340px' });
        expect(screen.getByText('Message').closest('th')).toHaveStyle({ width: '240px' });
        expect(screen.getByText('Time').closest('th')).toHaveAttribute('aria-sort', 'descending');
    });

    it('limits column widths and restores the default width on double-click', () => {
        render(<TableHarness stickyHeader={false} />);
        const separator = screen.getByRole('separator', { name: 'Resize column message' });
        const header = screen.getByText('Message').closest('th');

        fireEvent.mouseDown(separator, { clientX: 240 });
        fireEvent.mouseMove(document, { clientX: 0 });
        fireEvent.mouseUp(document);
        expect(header).toHaveStyle({ width: '80px' });

        fireEvent.mouseDown(separator, { clientX: 80 });
        fireEvent.mouseMove(document, { clientX: 1000 });
        fireEvent.mouseUp(document);
        expect(header).toHaveStyle({ width: '800px' });

        fireEvent.doubleClick(separator);
        expect(header).toHaveStyle({ width: '240px' });
        expect(screen.queryByRole('separator', { name: 'Resize column __expand' })).not.toBeInTheDocument();
    });

    it('renders caller-provided empty-state content', () => {
        render(<TableHarness data={[]} emptyContent={<div>Query succeeded — no results</div>} />);
        expect(screen.getByText('Query succeeded — no results')).toBeInTheDocument();
        expect(screen.queryByText('No Data')).not.toBeInTheDocument();
    });

    it('anchors resize handles to non-sticky headers and keeps the hit area inside the column', () => {
        render(<TableHarness stickyHeader={false} />);
        expect(window.getComputedStyle(screen.getByText('Time').closest('th') as HTMLElement).position).toBe('relative');
        const separatorStyle = window.getComputedStyle(screen.getByRole('separator', { name: 'Resize column time' }));
        expect(separatorStyle.position).toBe('absolute');
        expect(separatorStyle.right).toBe('0px');
    });
});
