'use client';
import { ColumnDef, ColumnOrderState, ColumnSizingState, OnChangeFn, Row, SortingState } from '@tanstack/react-table';
import React, { useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Drawer, IconButton, Pagination, Tab, TabContent, TabsBar, useTheme2 } from '@grafana/ui';
import {
    tableTotalCountAtom,
    tableDataAtom,
    selectedFieldsAtom,
    selectedRowAtom,
    surroundingTableDataAtom,
    pageSizeAtom,
    pageAtom,
    afterCountAtom,
    beforeCountAtom,
    surroundingDataFilterAtom,
    currentTimeFieldAtom,
    discoverCurrentAtom,
    selectedDatasourceAtom,
    tableFieldsAtom,
    discoverRowsExpandedAtom,
    discoverColumnLayoutsAtom,
} from 'store/discover';
import { Button as AntButton, Tooltip } from 'antd';
import SDCollapsibleTable from 'components/selectdb-ui/sd-collapsible-table';
import { ColumnStyleWrapper, HoverStyle } from './discover-content.style';
import { css } from '@emotion/css';
import { ContentTableActions } from './content-table-actions';
import { ContentItem } from './content-item';
import SurroundingLogs from 'components/surrounding-logs';
import TraceDetail from 'components/trace-detail';
import { usePluginContext } from '@grafana/data';
import { mergeLogsConfig, type AppPluginSettings } from 'types/plugin-settings';
import { formatFieldDisplayValue, formatTimestampToDateTime, isComplexType, isValidTimeFieldType, isVariantType, parseJsonLikeValue } from 'utils/data';
import { DiscoverQueryState, DiscoverSort } from 'types/discover';
import { reconcileColumnOrder, reconcileColumnSizing } from 'utils/column-layout';
import { VariantValueViewer } from './variant-value-viewer';
import { getVariantFieldValue } from 'utils/variant-fields';

const EXPAND_COLUMN_ID = '__expand';
const TIME_COLUMN_ID = '__time';
const SOURCE_COLUMN_ID = '__source';
const FIELD_COLUMN_PREFIX = 'field:';

const getFieldColumnId = (fieldName: string) => `${FIELD_COLUMN_PREFIX}${fieldName}`;

type DiscoverContentProps = {
    fetchNextPage: (page: number) => void;
    getTraceData: (traceId: string, table?: string, callback?: Function) => any;
    queryState: DiscoverQueryState;
    sort: DiscoverSort;
    onSortChange: (sort: DiscoverSort) => void;
};


export default function DiscoverContent({ fetchNextPage, getTraceData, queryState, sort, onSortChange }: DiscoverContentProps) {
    const theme = useTheme2();
    const [fields, setFields] = useState<any[]>([]);
    const tableTotalCount = useAtomValue(tableTotalCountAtom);
    const [tableData, _setTableData] = useAtom(tableDataAtom);
    const [selectedFields, setSelectedFields] = useAtom(selectedFieldsAtom);
    const hasSelectedFields = selectedFields.length > 0;
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    // const [surroundingOpen, setSurroundingOpen] = useState(false);
    const [selectedRow, setSelectedRow] = useAtom(selectedRowAtom);
    const setSurroundingTableData = useSetAtom(surroundingTableDataAtom);
    const setSurroundingDataFilter = useSetAtom(surroundingDataFilterAtom);
    const setBeforeCount = useSetAtom(beforeCountAtom);
    const setAfterCount = useSetAtom(afterCountAtom);
    const [pageSize, _setPageSize] = useAtom(pageSizeAtom);
    const [page, setPage] = useAtom(pageAtom);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [surroundingLogsOpen, setSurroundingLogsOpen] = useState(false);
    const [_fieldKeyBg, setFieldKeyBg] = useState<string>('#3f3f4f');
    const discoverCurrent = useAtomValue(discoverCurrentAtom);
    const currentDatasource = useAtomValue(selectedDatasourceAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const [discoverRowsExpanded, setDiscoverRowsExpanded] = useAtom(discoverRowsExpandedAtom);
    const [columnLayouts, setColumnLayouts] = useAtom(discoverColumnLayoutsAtom);
    const availableColumnIds = useMemo(
        () => [
            EXPAND_COLUMN_ID,
            TIME_COLUMN_ID,
            ...(hasSelectedFields ? selectedFields.map((field: any) => getFieldColumnId(field.Field)) : [SOURCE_COLUMN_ID]),
        ],
        [hasSelectedFields, selectedFields],
    );
    const availableColumnIdsKey = availableColumnIds.join('\u0000');
    const validPersistentColumnIds = useMemo(
        () => [
            EXPAND_COLUMN_ID,
            TIME_COLUMN_ID,
            SOURCE_COLUMN_ID,
            ...tableFields.map((field: any) => getFieldColumnId(String(field?.Field || field?.value || ''))),
        ],
        [tableFields],
    );
    const defaultColumnSizing = useMemo<ColumnSizingState>(() => ({
        [TIME_COLUMN_ID]: 240,
        [SOURCE_COLUMN_ID]: 640,
        ...Object.fromEntries(selectedFields.map((field: any) => [getFieldColumnId(field.Field), 240])),
    }), [selectedFields]);
    const layoutKey = useMemo(() => {
        const datasourceId = currentDatasource?.uid || currentDatasource?.id || currentDatasource?.name;
        if (!datasourceId || !discoverCurrent.database || !discoverCurrent.table) {
            return '';
        }
        return JSON.stringify([
            datasourceId,
            discoverCurrent.catalog || 'internal',
            discoverCurrent.database,
            discoverCurrent.table,
        ]);
    }, [currentDatasource?.id, currentDatasource?.name, currentDatasource?.uid, discoverCurrent.catalog, discoverCurrent.database, discoverCurrent.table]);
    const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => availableColumnIds);
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => defaultColumnSizing);
    const context = usePluginContext();
    // user settings
    const jsonData = context.meta.jsonData || {};
    const logsConfig = mergeLogsConfig((jsonData as AppPluginSettings).logsConfig);
    const { database = '', datasource, logsTable = '', targetTraceTable = '' } = logsConfig;
    // local input state for page-jump control
    const [jumpPage, setJumpPage] = useState<string>(String(page));

    useEffect(() => {
        const persistedLayout = layoutKey ? columnLayouts[layoutKey] : undefined;
        setColumnOrder(reconcileColumnOrder(availableColumnIds, persistedLayout?.columnOrder));
        setColumnSizing({
            ...defaultColumnSizing,
            ...reconcileColumnSizing(availableColumnIds, persistedLayout?.columnSizing),
        });
        // availableColumnIdsKey intentionally represents the primitive column identity list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [availableColumnIdsKey, columnLayouts, defaultColumnSizing, layoutKey]);

    useEffect(() => {
        if (!layoutKey || columnOrder.length === 0) {
            return;
        }
        const timeout = window.setTimeout(() => {
            setColumnLayouts(previous => {
                const currentLayout = previous[layoutKey];
                const validIds = new Set(validPersistentColumnIds);
                const inactiveColumnOrder = (currentLayout?.columnOrder || []).filter(
                    id => validIds.has(id) && !columnOrder.includes(id),
                );
                const retainedSizing = Object.fromEntries(
                    Object.entries(currentLayout?.columnSizing || {}).filter(([id]) => validIds.has(id)),
                );
                const nextLayout = {
                    columnOrder: [...columnOrder, ...inactiveColumnOrder],
                    columnSizing: { ...retainedSizing, ...columnSizing },
                };
                if (JSON.stringify(currentLayout) === JSON.stringify(nextLayout)) {
                    return previous;
                }
                return { ...previous, [layoutKey]: nextLayout };
            });
        }, 250);
        return () => window.clearTimeout(timeout);
    }, [columnOrder, columnSizing, layoutKey, setColumnLayouts, validPersistentColumnIds]);

    const resetColumnLayout = React.useCallback(() => {
        setColumnOrder(availableColumnIds);
        setColumnSizing(defaultColumnSizing);
        if (layoutKey) {
            setColumnLayouts(previous => {
                if (!previous[layoutKey]) {
                    return previous;
                }
                const { [layoutKey]: _removed, ...remaining } = previous;
                return remaining;
            });
        }
    }, [availableColumnIds, defaultColumnSizing, layoutKey, setColumnLayouts]);

    useEffect(() => {
        setJumpPage(String(page));
    }, [page]);

    const configuredDatasourceUid =
        typeof datasource === 'string'
            ? datasource
            : datasource?.uid || datasource?.id;
    const currentDatasourceIdentity = [
        currentDatasource?.uid,
        currentDatasource?.id,
        currentDatasource?.name,
    ].filter(Boolean);
    const isTargetLogTable =
        discoverCurrent.table === logsTable &&
        discoverCurrent.database === database &&
        (!configuredDatasourceUid || currentDatasourceIdentity.includes(configuredDatasourceUid));

    useEffect(() => {
        if (theme.isDark) {
            setFieldKeyBg('#3f3f4f');
        } else {
            setFieldKeyBg('rgb(191, 217, 253)');
        }
    }, [theme.isDark]);

    const [state, updateState] = useState([
        {
            label: 'Table',
            value: 'Table',
            active: true,
        },
        {
            label: 'JSON',
            value: 'JSON',
            active: false,
        },
    ]);

    useEffect(() => {
        const data = tableData.map(item => {
            return {
                _original: item._original,
                time: item._original?.[currentTimeField] || '',
                _source: item._source,
                _uid: item?._uid,
            };
        });
        setFields(data);
    }, [tableData, currentTimeField]);

    const handleRemove = React.useCallback(
        (field: any) => {
            setSelectedFields(current => current.filter((item: any) => item.Field !== field.Field));
        },
        [setSelectedFields],
    );

    const renderSubComponent = ({ row }: { row: Row<any> }) => {
        const processedData = parseJsonLikeValue(row.original._original);

        const subTableData = Object.keys(processedData).map(key => {
            return {
                field: key,
                value: row.original._original[key],
            };
        });
        return (
            <div
                className={css`
                    position: relative;
                `}
            >
                <TabsBar
                    className={css`
                        ${theme.isDark ? 'background-color: hsl(var(--n9) / 0.4);' : 'background-color: hsl(var(--b1) / 0.6);'}
                    `}
                >
                    {state.map((tab, index) => {
                        return (
                            <Tab
                                key={index}
                                label={tab.label}
                                active={tab.active}
                                onChangeTab={() =>
                                    updateState(
                                        state.map((tab, idx) => ({
                                            ...tab,
                                            active: idx === index,
                                        })),
                                    )
                                }
                                counter={subTableData.length}
                            />
                        );
                    })}
                </TabsBar>

                <TabContent>
                    {state[0].active && (
                        <table
                            // className="bg-b1/20 pl-4 backdrop-blur-md dark:bg-n9/60"
                            className={css`
                                padding-left: 16px;
                                backdrop-filter: blur(12px);
                                -webkit-backdrop-filter: blur(12px);
                                width: 100%;
                                ${theme.isDark ? 'background-color: hsl(var(--n9) / 0.6);' : 'background-color: hsl(var(--b1) / 0.2)'}
                            `}
                        >
                            <tbody>
                                {subTableData.map((item: any) => {
                                    const fieldValue = formatFieldDisplayValue(item.value, 'compact');
                                    const fieldName = item.field;
                                    const fieldType = tableFields.find((field: any) => field.Field === fieldName)?.Type;
                                    const tableRowStyle = css`
                                        &:hover {
                                            .filter-table-content {
                                                visibility: visible;
                                            }
                                        }
                                    `;
                                    return (
                                        <tr className={`${tableRowStyle}`} key={fieldName}>
                                            <td
                                                className={css`
                                                    height: 32px;
                                                    width: 70px;
                                                `}
                                            >
                                                <div
                                                    className={`filter-table-content ${css`
                                                        visibility: hidden;
                                                    `}`}
                                                >
                                                    <ContentTableActions fieldName={fieldName} fieldValue={fieldValue} />
                                                </div>
                                            </td>
                                            <td
                                                className={css`
                                                    height: 32px;
                                                    font-size: 12px;
                                                `}
                                            >
                                                {fieldName || '-'}
                                            </td>
                                            <td
                                                className={css`
                                                    height: 32px;
                                                    font-size: 12px;
                                                    white-space: normal;
                                                `}
                                            >
                                                <div
                                                    className={css`
                                                        width: 100%;
                                                        word-break: break-all;
                                                    `}
                                                >
                                                    {isVariantType(fieldType) ? <VariantValueViewer value={item.value} /> : fieldValue}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {state[1].active && (
                        <VariantValueViewer value={processedData} />
                    )}
                </TabContent>
                <Tooltip title="Surrounding Items will ignore the existing interface's filter conditions and view the context through time.">
                    <a
                        onClick={() => {
                            setSurroundingLogsOpen(true);
                            setSelectedRow(row.original);
                        }}
                        className={css`
                        position: absolute;
                        right: 1rem;
                        top: 0;
                        cursor: pointer;
                        padding-top: 0.5rem;
                        &:hover {
                            color: #3D71D9;
                        }
                    `}
                    >
                        Surrounding items
                    </a>
                </Tooltip>
            </div>
        );
    };

    const callback = (status: number) => {
        if (status >= 200 && status <= 299) {
            setDrawerOpen(true)
        }
    }

    const openTraceDrawer = (traceId: string, table?: string) => {
        // request
        getTraceData(traceId, table, callback);
    };

    const columns = useMemo<Array<ColumnDef<any>>>(() => {
        let dynamicColumns: Array<ColumnDef<any>> = [
            {
                id: EXPAND_COLUMN_ID,
                accessorKey: 'collapse',
                header: ``,
                size: 48,
                minSize: 48,
                maxSize: 48,
                enableResizing: false,
                enableSorting: false,
                cell: ({ row, getValue }) => {
                    return (
                        row.getCanExpand() && (
                            <div className="flex items-center">
                                {row.getIsExpanded() ? (
                                    <IconButton onClick={row.getToggleExpandedHandler()} name="arrow-down" tooltip="Collapse" />
                                ) : (
                                    <IconButton onClick={row.getToggleExpandedHandler()} name="arrow-right" tooltip="Expand" />
                                )}
                                <div className="ml-1">{getValue<string>()}</div>
                            </div>
                        )
                    );
                },
            },
            {
                id: TIME_COLUMN_ID,
                header: () => currentTimeField || 'Time',
                accessorKey: 'time',
                size: 240,
                minSize: 80,
                maxSize: 800,
                enableSorting: true,
                sortDescFirst: false,
                cell: ({ row, getValue }) => {
                    const fieldValue = getValue<string>();
                    const fieldName = currentTimeField;
                    // try to find field type from tableFields
                    const fieldInfo = tableFields.find((f: any) => f.value === currentTimeField);
                    const fieldType = fieldInfo?.Type || '';
                    let timeField: any = fieldValue;

                    // If this field is a valid time field type, try to format it
                    try {
                        if (fieldInfo && isValidTimeFieldType(String(fieldInfo.Type).toUpperCase())) {
                            // if numeric timestamp, convert
                            const num = Number(fieldValue);
                            if (!Number.isNaN(num)) {
                                timeField = formatTimestampToDateTime(num);
                            } else {
                                // otherwise keep raw string (or attempt Date parse)
                                timeField = String(fieldValue || '');
                            }
                        }
                    } catch (e) {
                        // fallback to raw
                        timeField = fieldValue;
                    }
                    return (
                        <div
                            className={HoverStyle}
                        >
                            <div
                                className={css`
                                     display: flex;
                                     align-items: center;
                                 `}
                            >
                                {timeField}
                                <div
                                    className={`filter-content ${css`
                                         visibility: hidden;
                                     `}`}
                                >
                                    <ContentItem fieldName={fieldName} fieldValue={fieldValue} fieldType={fieldType} />
                                </div>
                            </div>
                        </div>
                    );
                },
            },
        ];
        if (!hasSelectedFields) {
            dynamicColumns.push({
                id: SOURCE_COLUMN_ID,
                accessorKey: '_source',
                header: '_source',
                size: 640,
                minSize: 80,
                maxSize: 800,
                enableSorting: false,
                cell: ({ row, getValue, ...rest }) => {
                    const html = getValue<string>();
                    const handleClick: React.MouseEventHandler<HTMLDivElement> = e => {
                        const target = e.target as HTMLElement | null;
                        if (!target) {
                            return;
                        }

                        const link = target.closest<HTMLElement>('[data-trace-id]');
                        if (!link) {
                            return;
                        }

                        const traceId = link.getAttribute('data-trace-id');
                        if (!traceId) {
                            return;
                        }

                        e.preventDefault();
                        if (isTargetLogTable && targetTraceTable) {
                            openTraceDrawer(traceId, targetTraceTable);
                        } else {
                            openTraceDrawer(traceId);
                        }
                    };

                    return (
                        <div
                            className={css`
                                padding-top: 0.5rem;
                                padding-bottom: 0.5rem;
                                font-size: 0.875rem;
                                line-height: 1.25rem;
                            `}
                        >
                            <ColumnStyleWrapper
                                className={css`
                                    & .field-key {
                                        background-color: ${theme.isDark ? '#3f3f4f' : 'rgb(191, 217, 253)'};
                                    }
                                    & .trace-link {
                                        cursor: pointer;
                                        text-decoration: underline;
                                        color: #3D71D9;
                                    }
                                `}
                            >
                                <div
                                    onClick={handleClick}
                                    dangerouslySetInnerHTML={{ __html: html }}
                                    className={css`
                                        max-height: 12rem;
                                        overflow: auto;
                                        word-break: break-all;
                                        white-space: pre-wrap;
                                    `}
                                />
                            </ColumnStyleWrapper>
                        </div>
                    );
                },
            });
        } else {
            dynamicColumns = [
                ...dynamicColumns,
                ...selectedFields.map((field: any) => {
                    return {
                        id: getFieldColumnId(field.Field),
                        accessorFn: (row: any) => getVariantFieldValue(row._original, field),
                        size: 240,
                        minSize: 80,
                        maxSize: 800,
                        enableSorting: field.Field !== currentTimeField && !isComplexType(field.Type),
                        sortDescFirst: false,
                        header: () => (
                            <div
                                className={css`
                                    display: flex;
                                    align-items: center;
                                `}
                            >
                                <div>{field.Field}</div>
                                <IconButton
                                    name="times"
                                    tooltip="Remove"
                                    style={{
                                        marginLeft: '8px',
                                        cursor: 'pointer',
                                        marginTop: '2px',
                                    }}
                                    onClick={e => {
                                        handleRemove(field);
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                />
                            </div>
                        ),
                        cell: ({ row }: any) => {
                            const rawFieldValue = getVariantFieldValue(row.original._original, field);
                            const fieldValue = formatFieldDisplayValue(rawFieldValue, 'compact');
                            const fieldName = field.Field;
                            const fieldType = field.Type;
                            return (
                                <div
                                    className={`${HoverStyle} ${css`
                                        display: flex;
                                        align-items: center;
                                        min-height: 48px;
                                    `}`}
                                >
                                    <div
                                        className={css`
                                            max-height: 192px;
                                            overflow: auto;
                                        `}
                                    >
                                        <div
                                            className={css`
                                                display: flex;
                                                align-items: center;
                                                padding: 16px 16px 16px 0;
                                                word-break: break-all;
                                            `}
                                        >
                                            {isVariantType(fieldType) ? <VariantValueViewer value={rawFieldValue} /> : field.value === 'trace_id' ? <AntButton
                                                className={css`padding-left: 0px;`}
                                                onClick={() => {
                                                    if (isTargetLogTable && targetTraceTable) {
                                                        openTraceDrawer(fieldValue, targetTraceTable)
                                                    } else {
                                                        openTraceDrawer(fieldValue);
                                                    }
                                                }}
                                                type="link">
                                                {fieldValue}
                                            </AntButton> : (
                                                <span
                                                    className={css`
                                                        display: block;
                                                        width: 100%;
                                                        font-size: 12px;
                                                        white-space: nowrap;
                                                        text-overflow: ellipsis;
                                                        overflow: hidden;
                                                    `}
                                                >
                                                    {fieldValue}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div
                                        className={`filter-content ${css`
                                            visibility: hidden;
                                        `}`}
                                    >
                                        <ContentItem fieldName={fieldName} fieldValue={fieldValue} fieldType={fieldType} />
                                    </div>
                                </div>
                            );
                        },
                    };
                }),
            ];
        }
        return dynamicColumns;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTimeField, handleRemove, hasSelectedFields, selectedFields, theme.isDark]);

    const tableSorting = useMemo<SortingState>(() => {
        const selectedColumnId = sort.field === currentTimeField || !sort.field
            ? TIME_COLUMN_ID
            : selectedFields.some((field: any) => field.Field === sort.field)
                ? getFieldColumnId(sort.field)
                : TIME_COLUMN_ID;
        return [{ id: selectedColumnId, desc: sort.direction === 'DESC' }];
    }, [currentTimeField, selectedFields, sort.direction, sort.field]);

    useEffect(() => {
        if (
            sort.field &&
            sort.field !== currentTimeField &&
            !selectedFields.some((field: any) => field.Field === sort.field)
        ) {
            onSortChange({ field: currentTimeField, direction: 'DESC' });
        }
    }, [currentTimeField, onSortChange, selectedFields, sort.field]);

    const handleTableSortingChange = React.useCallback<OnChangeFn<SortingState>>((updater) => {
        const nextSorting = typeof updater === 'function' ? updater(tableSorting) : updater;
        const nextColumn = nextSorting[0];
        if (!nextColumn) {
            onSortChange({ field: currentTimeField, direction: 'DESC' });
            return;
        }
        const field = nextColumn.id === TIME_COLUMN_ID
            ? currentTimeField
            : nextColumn.id.startsWith(FIELD_COLUMN_PREFIX)
                ? nextColumn.id.slice(FIELD_COLUMN_PREFIX.length)
                : currentTimeField;
        const selectedField = selectedFields.find((item: any) => item.Field === field);
        onSortChange({
            field,
            direction: nextColumn.desc ? 'DESC' : 'ASC',
            variantPath: selectedField?.variantPath,
            variantType: selectedField?.Type,
        });
    }, [currentTimeField, onSortChange, selectedFields, tableSorting]);

    const emptyContent = queryState.status === 'error' ? (
        <div role="status" className={css`padding: 32px 16px; text-align: center;`}>
            <strong>Query failed</strong>
            <div className={css`margin-top: 4px; color: ${theme.colors.text.secondary};`}>
                Review the query error above, then update the query and try again.
            </div>
        </div>
    ) : queryState.status === 'success' && queryState.rowCount === 0 ? (
        <div role="status" className={css`padding: 32px 16px; text-align: center;`}>
            <strong>Query succeeded — no results</strong>
            <div className={css`margin-top: 4px; color: ${theme.colors.text.secondary};`}>
                Try expanding the time range or adjusting the filters.
            </div>
        </div>
    ) : queryState.status === 'loading' ? (
        <div role="status" className={css`padding: 32px 16px; text-align: center;`}>Querying…</div>
    ) : undefined;

    const isLayoutModified = JSON.stringify(columnOrder) !== JSON.stringify(availableColumnIds) ||
        JSON.stringify(columnSizing) !== JSON.stringify(defaultColumnSizing);

    return (
        <div
            className={css`
                overflow-x: scroll;
            `}
        >
            <div
                className={css`
                    display: flex;
                    justify-content: flex-end;
                    min-height: 28px;
                    padding: 0 8px 4px;
                `}
            >
                <IconButton
                    name="history"
                    tooltip="Reset column layout"
                    aria-label="Reset column layout"
                    disabled={!isLayoutModified}
                    onClick={resetColumnLayout}
                />
            </div>
            <SDCollapsibleTable
                className={css`
                    width: 100%;
                `}
                data={fields}
                columns={columns}
                getRowCanExpand={() => true}
                renderSubComponent={renderSubComponent}
                showExpandAllToggle
                allRowsExpanded={discoverRowsExpanded}
                onAllRowsExpandedChange={setDiscoverRowsExpanded}
                columnOrder={columnOrder}
                onColumnOrderChange={setColumnOrder}
                columnSizing={columnSizing}
                onColumnSizingChange={setColumnSizing}
                sorting={tableSorting}
                onSortingChange={handleTableSortingChange}
                enableColumnReordering
                emptyContent={emptyContent}
            />
            {queryState.status !== 'error' ? <div
                className={css`
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.5rem 1rem;
                    padding-bottom: 20px;
                `}
            >
                <div>Total {tableTotalCount} rows</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Pagination
                        currentPage={page}
                        numberOfPages={Math.ceil(tableTotalCount / pageSize) || 1}
                        onNavigate={toPage => {
                            setPage(toPage);
                        }}
                    />
                    {/* Page jump input */}
                    <div
                        className={css`
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        `}
                    >
                        {/* local controlled input for typing page number */}
                        <input
                            type="number"
                            min={1}
                            step={1}
                            value={jumpPage}
                            onChange={e => {
                                setJumpPage(e.target.value);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    const num = Number(jumpPage);
                                    const total = Math.max(Math.ceil(tableTotalCount / pageSize) || 1, 1);
                                    if (!Number.isNaN(num)) {
                                        const target = Math.min(Math.max(1, Math.floor(num)), total);
                                        setPage(target);
                                        try {
                                            fetchNextPage && fetchNextPage(target);
                                        } catch { }
                                        setJumpPage(String(target));
                                    } else {
                                        // reset to current page if invalid
                                        setJumpPage(String(page));
                                    }
                                }
                            }}
                            className={css`
                                width: 72px;
                                padding: 6px 8px;
                                border-radius: 4px;
                                border: 1px solid rgba(0,0,0,0.15);
                            `}
                        />
                        <button
                            onClick={() => {
                                const num = Number(jumpPage);
                                const total = Math.max(Math.ceil(tableTotalCount / pageSize) || 1, 1);
                                if (!Number.isNaN(num)) {
                                    const target = Math.min(Math.max(1, Math.floor(num)), total);
                                    setPage(target);
                                    try {
                                        fetchNextPage && fetchNextPage(target);
                                    } catch { }
                                    setJumpPage(String(target));
                                } else {
                                    setJumpPage(String(page));
                                }
                            }}
                            className={css`
                                padding: 6px 10px;
                                border-radius: 4px;
                                border: 1px solid rgba(0,0,0,0.15);
                                background: transparent;
                                cursor: pointer;
                            `}
                        >Go</button>
                    </div>
                </div>
            </div> : null}
            <TraceDetail onClose={() => setDrawerOpen(false)} open={drawerOpen} traceId={selectedRow?.trace_id} traceTable="otel_traces" />

            {surroundingLogsOpen && (
                <Drawer
                    size="lg"
                    title="Surrounding items"
                    onClose={() => {
                        setSurroundingTableData([]);
                        setSurroundingDataFilter([]);
                        setBeforeCount(0);
                        setAfterCount(0);
                        // setSelectedSurroundingFields([]);
                        setSurroundingLogsOpen(false);
                    }}
                >
                    <SurroundingLogs />
                </Drawer>
            )}
        </div>
    );
}
