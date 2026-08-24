import React, { Fragment, useEffect, useMemo, useState } from 'react';
import {
    ColumnDef,
    ColumnOrderState,
    ColumnSizingState,
    ExpandedState,
    OnChangeFn,
    Row,
    SortingState,
    Table,
    flexRender,
    getCoreRowModel,
    getExpandedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { EmptySearchResult, Icon, IconButton, useTheme2 } from '@grafana/ui';
import { css, cx } from '@emotion/css';
import {
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SDCollapsibleTableProps<TData> {
    data: TData[];
    columns: Array<ColumnDef<TData>>;
    renderSubComponent: (props: { row: Row<TData> }) => React.ReactElement;
    getRowCanExpand: (row: Row<TData>) => boolean;
    className?: string;
    showExpandAllToggle?: boolean;
    allRowsExpanded?: boolean;
    onAllRowsExpandedChange?: (expanded: boolean) => void;
    columnOrder?: ColumnOrderState;
    onColumnOrderChange?: OnChangeFn<ColumnOrderState>;
    columnSizing?: ColumnSizingState;
    onColumnSizingChange?: OnChangeFn<ColumnSizingState>;
    sorting?: SortingState;
    onSortingChange?: OnChangeFn<SortingState>;
    enableColumnReordering?: boolean;
    emptyContent?: React.ReactNode;
}

type SortableHeaderProps<TData> = {
    header: ReturnType<Table<TData>['getFlatHeaders']>[number];
    canReorder: boolean;
    renderExpandAllToggle: boolean;
    isAllRowsExpanded: boolean;
    onToggleAll: () => void;
};

function SortableHeader<TData>({
    header,
    canReorder,
    renderExpandAllToggle,
    isAllRowsExpanded,
    onToggleAll,
}: SortableHeaderProps<TData>) {
    const theme = useTheme2();
    const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
        id: header.column.id,
        disabled: !canReorder,
    });
    const sorted = header.column.getIsSorted();
    const canSort = header.column.getCanSort();
    const ariaSort = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';

    return (
        <th
            ref={setNodeRef}
            key={header.id}
            colSpan={header.colSpan}
            aria-sort={canSort ? ariaSort : undefined}
            style={{
                width: header.getSize(),
                transform: CSS.Translate.toString(transform),
                transition,
                opacity: isDragging ? 0.7 : 1,
            }}
            className={css`
                position: sticky;
                top: 0;
                z-index: ${isDragging ? 4 : 2};
                height: 48px;
                white-space: nowrap;
                background-color: ${theme.isLight ? 'hsl(var(--table-header-background))' : 'hsl(var(--table-header-background-dark))'};
                padding: 0 16px;
                text-align: left;
                vertical-align: middle;
                font-size: 14px;
                font-weight: 500;
                color: hsl(var(--n2));

                &:has([role='checkbox']) {
                    padding-right: 0;
                }
            `}
        >
            <div
                className={css`
                    display: flex;
                    align-items: center;
                    min-width: 0;
                    height: 100%;
                    gap: 4px;
                `}
            >
                {renderExpandAllToggle ? (
                    <IconButton
                        name={isAllRowsExpanded ? 'arrow-down' : 'arrow-right'}
                        tooltip={isAllRowsExpanded ? 'Collapse all' : 'Expand all'}
                        onClick={onToggleAll}
                    />
                ) : null}
                {canReorder ? (
                    <button
                        type="button"
                        aria-label={`Move column ${header.column.id}`}
                        title="Drag to reorder column"
                        {...attributes}
                        {...listeners}
                        className={css`
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            flex: 0 0 20px;
                            width: 20px;
                            height: 28px;
                            padding: 0;
                            border: 0;
                            border-radius: 4px;
                            background: transparent;
                            color: ${theme.colors.text.secondary};
                            cursor: grab;

                            &:hover,
                            &:focus-visible {
                                color: ${theme.colors.text.primary};
                                background: ${theme.colors.action.hover};
                            }

                            &:active {
                                cursor: grabbing;
                            }
                        `}
                    >
                        <Icon name="draggabledots" size="sm" />
                    </button>
                ) : null}
                <div
                    role={canSort ? 'button' : undefined}
                    tabIndex={canSort ? 0 : undefined}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    onKeyDown={canSort ? event => {
                        if (event.target !== event.currentTarget) {
                            return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            header.column.toggleSorting();
                        }
                    } : undefined}
                    className={css`
                        display: inline-flex;
                        align-items: center;
                        min-width: 0;
                        gap: 6px;
                        padding: 0;
                        border: 0;
                        background: transparent;
                        color: inherit;
                        font: inherit;
                        cursor: ${canSort ? 'pointer' : 'default'};
                    `}
                >
                    <span
                        className={css`
                            min-width: 0;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        `}
                    >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                    {canSort && sorted ? <Icon name={sorted === 'asc' ? 'angle-up' : 'angle-down'} size="sm" /> : null}
                </div>
                {header.column.getCanResize() ? (
                    <div
                        role="separator"
                        aria-label={`Resize column ${header.column.id}`}
                        aria-orientation="vertical"
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cx(
                            css`
                                position: absolute;
                                top: 0;
                                right: -4px;
                                z-index: 5;
                                width: 8px;
                                height: 100%;
                                cursor: col-resize;
                                touch-action: none;

                                &::after {
                                    content: '';
                                    position: absolute;
                                    top: 25%;
                                    left: 3px;
                                    width: 2px;
                                    height: 50%;
                                    border-radius: 1px;
                                    background: ${theme.colors.border.medium};
                                }

                                &:hover::after {
                                    background: ${theme.colors.primary.main};
                                }
                            `,
                            header.column.getIsResizing()
                                ? css`
                                      &::after {
                                          background: ${theme.colors.primary.main};
                                      }
                                  `
                                : undefined,
                        )}
                    />
                ) : null}
            </div>
        </th>
    );
}

export default function SDCollapsibleTable<T>(props: SDCollapsibleTableProps<T>) {
    const {
        data,
        columns,
        renderSubComponent,
        getRowCanExpand,
        className,
        showExpandAllToggle,
        allRowsExpanded,
        onAllRowsExpandedChange,
        columnOrder,
        onColumnOrderChange,
        columnSizing,
        onColumnSizingChange,
        sorting,
        onSortingChange,
        enableColumnReordering = false,
        emptyContent,
    } = props;
    const theme = useTheme2();
    const [expanded, setExpanded] = useState<ExpandedState>(allRowsExpanded ? true : {});
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    useEffect(() => {
        if (typeof allRowsExpanded === 'boolean') {
            setExpanded(allRowsExpanded ? true : {});
        }
    }, [allRowsExpanded]);

    const table = useReactTable<any>({
        data,
        columns,
        state: {
            expanded,
            ...(columnOrder ? { columnOrder } : {}),
            ...(columnSizing ? { columnSizing } : {}),
            ...(sorting ? { sorting } : {}),
        },
        onExpandedChange: setExpanded,
        onColumnOrderChange,
        onColumnSizingChange,
        onSortingChange,
        getRowCanExpand,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        defaultColumn: {
            size: 240,
            minSize: 80,
            maxSize: 800,
        },
        columnResizeMode: 'onChange',
        manualSorting: true,
        enableMultiSort: false,
        enableSortingRemoval: false,
    });

    const reorderableColumnIds = useMemo(
        () => table.getAllLeafColumns().filter(column => column.id !== '__expand').map(column => column.id),
        // The table instance is stable; columns is the source that changes available IDs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [columns],
    );

    const handleDragEnd = (event: DragEndEvent) => {
        if (!onColumnOrderChange || !event.over || event.active.id === event.over.id) {
            return;
        }
        const currentOrder = columnOrder?.length ? columnOrder : table.getAllLeafColumns().map(column => column.id);
        const oldIndex = currentOrder.indexOf(String(event.active.id));
        const newIndex = currentOrder.indexOf(String(event.over.id));
        if (oldIndex < 0 || newIndex < 0) {
            return;
        }
        const nextOrder = arrayMove(currentOrder, oldIndex, newIndex);
        const pinnedOrder = ['__expand', ...nextOrder.filter(id => id !== '__expand')];
        onColumnOrderChange(pinnedOrder);
    };

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <table
                className={className}
                style={{ width: table.getTotalSize(), minWidth: '100%', tableLayout: 'fixed' }}
            >
                <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <SortableContext key={headerGroup.id} items={reorderableColumnIds} strategy={horizontalListSortingStrategy}>
                            <tr
                                className={css`
                                    ${theme.isDark ? 'border-bottom: 1px solid hsl(var(--border-dark));' : 'border-bottom: 1px solid hsl(var(--border));'}
                                `}
                            >
                                {headerGroup.headers.map((header, index) => {
                                    const renderExpandAllToggle = Boolean(showExpandAllToggle && index === 0);
                                    const isAllRowsExpanded = typeof allRowsExpanded === 'boolean' ? allRowsExpanded : table.getIsAllRowsExpanded();
                                    return (
                                        <SortableHeader
                                            key={header.id}
                                            header={header}
                                            canReorder={enableColumnReordering && header.column.id !== '__expand'}
                                            renderExpandAllToggle={renderExpandAllToggle}
                                            isAllRowsExpanded={isAllRowsExpanded}
                                            onToggleAll={() => {
                                                const nextExpanded = !isAllRowsExpanded;
                                                table.toggleAllRowsExpanded(nextExpanded);
                                                onAllRowsExpandedChange?.(nextExpanded);
                                            }}
                                        />
                                    );
                                })}
                            </tr>
                        </SortableContext>
                    ))}
                </thead>
                <tbody
                    className={css`
                        #selected {
                            background-color: #3f3f46cc;
                        }
                    `}
                >
                    {table.getRowModel().rows.length > 0 ? (
                        table.getRowModel().rows.map(row => (
                            <Fragment key={row.id}>
                                <tr
                                    id={row.original.selected ? 'selected' : ''}
                                    className={css`
                                        ${row.getIsExpanded() ? 'border: none;' : theme.isDark ? 'border-bottom: 1px solid hsl(var(--border-dark));' : 'border-bottom: 1px solid hsl(var(--border));'}
                                        ${theme.isLight
                                            ? `background-color: ${row.original.selected ? 'hsl(var(--b1) / 0.6)' : 'hsl(val(--n8))'}; &:hover { background-color: hsl(var(--b1) / 0.8); }`
                                            : `background-color: ${row.original.selected ? 'hsl(var(--n7))' : 'hsl(val(--n8))'}; &:hover { background-color: hsl(var(--n7) / 0.8); }`}
                                    `}
                                >
                                    {row.getVisibleCells().map(cell => (
                                        <td
                                            key={cell.id}
                                            style={{ width: cell.column.getSize() }}
                                            className={css`
                                                height: 48px;
                                                padding: 0 16px;
                                                overflow: hidden;
                                                font-size: 14px;
                                            `}
                                        >
                                            {cell.getContext().getValue() !== null ? flexRender(cell.column.columnDef.cell, cell.getContext()) : '-'}
                                        </td>
                                    ))}
                                </tr>
                                {row.getIsExpanded() ? (
                                    <tr
                                        className={css`
                                            border-bottom: 1px solid rgb(63, 63, 70);
                                            transition: background-color 150ms ease-in-out;

                                            &:hover {
                                                background-color: hsl(var(--muted) / 0.5);
                                            }
                                        `}
                                    >
                                        <td
                                            colSpan={row.getVisibleCells().length}
                                            className={css`
                                                height: 32px;
                                                padding: 0;
                                            `}
                                        >
                                            {renderSubComponent({ row })}
                                        </td>
                                    </tr>
                                ) : null}
                            </Fragment>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={Math.max(table.getVisibleLeafColumns().length, 1)}>
                                {emptyContent || <EmptySearchResult>No Data</EmptySearchResult>}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </DndContext>
    );
}
