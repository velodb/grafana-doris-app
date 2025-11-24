import React, { Fragment } from 'react';
import { ColumnDef, Row, flexRender, getCoreRowModel, getExpandedRowModel, useReactTable } from '@tanstack/react-table';
import { EmptySearchResult, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';

interface SDCollapsibleTableProps<TData> {
    data: TData[];
    columns: Array<ColumnDef<TData>>;
    renderSubComponent: (props: { row: Row<TData> }) => React.ReactElement;
    getRowCanExpand: (row: Row<TData>) => boolean;
    className?: string;
}

export default function SDCollapsibleTable<T>(props: SDCollapsibleTableProps<T>) {
    const { data, columns, renderSubComponent, getRowCanExpand, className } = props;
    const theme = useTheme2();
    const table = useReactTable<any>({
        data,
        columns,
        getRowCanExpand,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
    });

    return (
        <table className={className}>
            <thead>
                {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id} className={css`${theme.isDark ? 'border-bottom: 1px solid hsl(var(--border-dark));' : 'border-bottom: 1px solid hsl(var(--border));'} `}>
                        {headerGroup.headers.map(header => {
                            return (
                                <th
                                    key={header.id}
                                    colSpan={header.colSpan}
                                    className={css`
                                            position: sticky;
                                            top: 0;
                                            z-index: 2;
                                            height: 48px; 
                                            white-space: nowrap;
                                            background-color: ${theme.isLight ? 'hsl(var(--table-header-background)' : 'hsl(var(--table-header-background-dark)'} ); 
                                            padding-left: 16px; 
                                            padding-right: 16px;
                                            text-align: left;
                                            vertical-align: middle;
                                            font-size: 14px;
                                            font-weight: 500;    
                                            color: hsl(var(--n2)}  

                                            &:has([role="checkbox"]) {
                                                padding-right: 0;
                                            }
                                        `}
                                >
                                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                </th>
                            );
                        })}
                    </tr>
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
                    table.getRowModel().rows.map(row => {
                        return (
                            <Fragment key={row.id}>
                                <tr
                                    id={row.original.selected ? 'selected' : ''}
                                    // className={classNames(
                                    //     'transition-colors dark:hover:bg-n7/80 hover:bg-b1/80 data-[state=selected]:bg-muted',
                                    //     row.getIsExpanded() ? 'border-none' : 'border-b',
                                    //     row.original.selected ? 'dark:bg-n7 bg-b1/60' : 'hsl(val(--n8))',
                                    // )}
                                    className={css`
                                        ${row.getIsExpanded() ? `border:none;` : `${theme.isDark ? 'border-bottom: 1px solid hsl(var(--border-dark));' : 'border-bottom: 1px solid hsl(var(--border));'} `}

                                        ${theme.isLight ? `
                                             background-color: ${row.original.selected ? 'hsl(var(--b1) / 0.6)' : 'hsl(val(--n8))'}; 
                                        &:hover {
                                            background-color: hsl(var(--b1) / 0.8);
                                        }
                                            `
                                            :
                                            `
                                            background-color: ${row.original.selected ? 'hsl(var(--n7))' : 'hsl(val(--n8))'}; 
                                            &:hover {
                                                    background-color: hsl(var(--n7) / 0.8);
                                                }
                                            }
                                            `
                                        }
                                    `}
                                >
                                    {row.getVisibleCells().map(cell => {
                                        return (
                                            <td key={cell.id} className={css`
                                                height: 48px;
                                                padding: 0 16px;
                                                font-size: 14px;
                                            `} >
                                                {cell.getContext().getValue() !== null ? flexRender(cell.column.columnDef.cell, cell.getContext()) : '-'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                {row.getIsExpanded() && (
                                    <tr
                                        //  className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                                        className={css`
                                        border-bottom: 1px solid rgb(63,63,70);
                                        transition-property: background-color, border-color, color, fill, stroke;
                                        transition-duration: 150ms;
                                        transition-timing-function: ease-in-out;
                                        
                                        &:hover {
                                            background-color: hsl(var(--muted) / 0.5);
                                        }
                                        
                                        [data-state="selected"] {
                                            background-color: hsl(var(--muted))
                                        }
                                    `}
                                    >
                                        <td colSpan={row.getVisibleCells().length} className={css`
                                                height: 32px;
                                                padding: 0;
                                            `}>
                                            {renderSubComponent({ row })}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })
                ) : (
                    <tr >
                        <td colSpan={columns.length}>
                            <EmptySearchResult>{`No Data`}</EmptySearchResult>
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}
