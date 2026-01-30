'use client';
import { ColumnDef, Row } from '@tanstack/react-table';
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
    tableFieldsAtom
} from 'store/discover';
import { get } from 'lodash-es';
import { Button as AntButton } from 'antd';
import SDCollapsibleTable from 'components/selectdb-ui/sd-collapsible-table';
import { ColumnStyleWrapper, HoverStyle } from './discover-content.style';
import { css } from '@emotion/css';
import { ContentTableActions } from './content-table-actions';
import { ContentItem } from './content-item';
import SurroundingLogs from 'components/surrounding-logs';
import TraceDetail from 'components/trace-detail';
import { usePluginContext } from '@grafana/data';
import type { AppPluginSettings } from 'components/AppConfig/AppConfig';
import { formatTimestampToDateTime, isValidTimeFieldType  } from 'utils/data';


export default function DiscoverContent({ fetchNextPage, getTraceData }: { fetchNextPage: (page: number) => void; getTraceData: (traceId: string, table?: string, callback?: Function) => any }) {
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
    const context = usePluginContext();
    // user settings
    const jsonData = context.meta.jsonData || {};
    console.log('jsonData',jsonData);
    
    const { logsConfig = {} } = jsonData as AppPluginSettings;
    const { database = "", datasource = {}, logsTable = "", targetTraceTable = "" } = logsConfig;
    // local input state for page-jump control
    const [jumpPage, setJumpPage] = useState<string>(String(page));

    useEffect(() => {
        setJumpPage(String(page));
    }, [page]);

    const isTargetLogTable = discoverCurrent.table === logsTable && discoverCurrent.database === database && currentDatasource?.id === datasource?.id;

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

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleRemove = React.useCallback(
        (field: any) => {
            const index = selectedFields.findIndex((item: any) => item.Field === field.Field);
            selectedFields.splice(index, 1);
            setSelectedFields([...selectedFields]);
        },
        [selectedFields, setSelectedFields],
    );

    const renderSubComponent = ({ row }: { row: Row<any> }) => {
        // process object
        const processObject = (obj: any): any => {
            if (typeof obj !== 'object' || obj === null) {
                return obj;
            }

            const result: any = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    let value = obj[key];

                    if (typeof value === 'string') {
                        let cleanValue = value.trim();

                        // check for escaped double quotes
                        if (cleanValue.includes('\\"')) {
                            try {
                                cleanValue = JSON.parse(`"${cleanValue}"`);
                            } catch (e) {
                                // if parsing fails, keep the original value
                            }
                        }

                        // check for JSON
                        if ((cleanValue.startsWith('{') && cleanValue.endsWith('}')) || (cleanValue.startsWith('[') && cleanValue.endsWith(']'))) {
                            try {
                                const parsed = JSON.parse(cleanValue);
                                value = processObject(parsed);
                            } catch (e) {
                                value = obj[key];
                            }
                        } else {
                            value = obj[key];
                        }
                    } else if (Array.isArray(value)) {
                        value = value.map(item => {
                            if (typeof item === 'string') {
                                let cleanItem = item.trim();

                                if (cleanItem.includes('\\"')) {
                                    try {
                                        cleanItem = JSON.parse(`"${cleanItem}"`);
                                    } catch (e) { }
                                }

                                if ((cleanItem.startsWith('{') && cleanItem.endsWith('}')) || (cleanItem.startsWith('[') && cleanItem.endsWith(']'))) {
                                    try {
                                        const parsed = JSON.parse(cleanItem);
                                        return processObject(parsed);
                                    } catch {
                                        return item;
                                    }
                                }
                                return item;
                            }
                            return typeof item === 'object' && item !== null ? processObject(item) : item;
                        });
                    } else if (typeof value === 'object' && value !== null) {
                        value = processObject(value);
                    }

                    result[key] = value;
                }
            }
            return result;
        };

        const processedData = processObject(row.original._original);

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
                                    let fieldValue = item.value;
                                    const fieldName = item.field;
                                    if (typeof fieldValue === 'object') {
                                        fieldValue = JSON.stringify(fieldValue);
                                    }
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
                                                    {fieldValue || '-'}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {state[1].active && (
                        <div>
                            <pre
                                className={css`
                                    padding: 16px;
                                    margin: 0;
                                    overflow-x: auto;
                                    white-space: pre-wrap;
                                    word-break: break-all;
                                    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                                    font-size: 12px;
                                    line-height: 1.5;
                                    ${theme.isDark ? 'background-color: #1e1e1e; color: #d4d4d4;' : 'background-color: #f5f5f5; color: #333;'}
                                    border-radius: 4px;
                                    max-height: 400px;
                                    overflow-y: auto;
                                `}
                            >
                                {JSON.stringify(processedData, null, 2)}
                            </pre>
                        </div>
                    )}
                </TabContent>
                <a
                    onClick={() => {
                        console.log('row', row);
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
                    Surrounding Logs
                </a>
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
                accessorKey: 'collapse',
                header: ``,
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
                header: () => currentTimeField || 'Time',
                accessorKey: 'time',
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
                             className={`${css`
                                 width: 240px;
                             `} ${HoverStyle}`}
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
                accessorKey: '_source',
                header: '_source',
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
                        accessorKey: field.Field,
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
                        cell: ({ row, getValue }: any) => {
                            // let fieldValue = row.original._original[field.Field];
                            let fieldValue = get(row.original._original, field.Field);
                            const fieldName = field.Field;
                            const fieldType = field.Type;
                            if (typeof fieldValue === 'object') {
                                fieldValue = JSON.stringify(fieldValue);
                            }
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
                                            {field.value === 'trace_id' ? <AntButton
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
                                                        font-size: 12px;
                                                        white-space: nowrap;
                                                        text-overflow: ellipsis;
                                                        overflow: hidden;
                                                        max-width: 200px;
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

    return (
        <div
            className={css`
                overflow-x: scroll;
            `}
        >
            {/* {
                loading.getTableDataCharts && <LoadingBar width={100} />
            } */}
            <SDCollapsibleTable
                className={css`
                    width: 100%;
                `}
                data={fields}
                columns={columns}
                getRowCanExpand={() => true}
                renderSubComponent={renderSubComponent}
            />
            <div
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
                                        } catch {}
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
                                    } catch {}
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
              </div>
            <TraceDetail onClose={() => setDrawerOpen(false)} open={drawerOpen} traceId={selectedRow?.trace_id} traceTable="otel_traces" />

            {surroundingLogsOpen && (
                <Drawer
                    size="lg"
                    title="Surrounding Logs"
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
