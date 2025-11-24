'use client';
import { ColumnDef, Row } from '@tanstack/react-table';
import React, { useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Drawer, IconButton, Pagination, Tab, TabContent, TabsBar, useTheme2 } from '@grafana/ui';
import JsonView from '@uiw/react-json-view';
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
    surroundingSelectedFieldsAtom,
    currentTimeFieldAtom,
} from 'store/discover';
import { get } from 'lodash-es';
import { Button as AntButton } from 'antd';
import SDCollapsibleTable from 'components/selectdb-ui/sd-collapsible-table';
import { ColumnStyleWrapper, HoverStyle } from './discover-content.style';
import { css } from '@emotion/css';
import { ContentTableActions } from './content-table-actions';
import { SELECTDB_THEME, SELECTDB_THEME_LIGHT } from './json-viewer.theme';
import { ContentItem } from './content-item';
import SurroundingLogs from 'components/surrounding-logs';
import TraceDetail from 'components/trace-detail';

export default function DiscoverContent({ fetchNextPage, getTraceData }: { fetchNextPage: (page: number) => void; getTraceData: (traceId: string) => any }) {
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
    const setSelectedSurroundingFields = useSetAtom(surroundingSelectedFieldsAtom);
    const setBeforeCount = useSetAtom(beforeCountAtom);
    const setAfterCount = useSetAtom(afterCountAtom);
    const [pageSize, _setPageSize] = useAtom(pageSizeAtom);
    const [page, setPage] = useAtom(pageAtom);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [surroundingLogsOpen, setSurroundingLogsOpen] = useState(false);
    const [_fieldKeyBg, setFieldKeyBg] = useState<string>('#3f3f4f');

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
        const subTableData = Object.keys(row.original._original).map(key => {
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
                            <JsonView
                                value={row.original._original}
                                className={`-mt-2 pl-11 !leading-6 ${css`
                                    .w-rjv-wrap {
                                        border-left: none !important;
                                    }
                                `}`}
                                shortenTextAfterLength={0}
                                indentWidth={36}
                                displayDataTypes={false}
                                enableClipboard={false}
                                style={theme.isDark ? SELECTDB_THEME : SELECTDB_THEME_LIGHT}
                            />
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
                            color: rgb(43, 102, 253);
                        }
                    `}
                >
                    Surrounding Logs
                </a>
            </div>
        );
    };

    const openTraceDrawer = (traceId: string) => {
        // request
        setDrawerOpen(true);
        getTraceData(traceId);
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
                                    <IconButton onClick={row.getToggleExpandedHandler()} name="arrow-down" tooltip="收起" />
                                ) : (
                                    <IconButton onClick={row.getToggleExpandedHandler()} name="arrow-right" tooltip="展开" />
                                )}
                                <div className="ml-1">{getValue<string>()}</div>
                            </div>
                        )
                    );
                },
            },
            {
                header: 'Time',
                accessorKey: 'time',
                cell: ({ row, getValue }) => {
                    const fieldValue = getValue<string>();
                    const fieldName = currentTimeField;
                    const fieldType = 'DATE';
                    const timeField = fieldValue;
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
                cell: ({ row, getValue }) => {
                    function createMarkup() {
                        return { __html: getValue<string>() };
                    }
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
                                `}
                            >
                                <div
                                    dangerouslySetInnerHTML={createMarkup()}
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
                                                padding: 16px;
                                                word-break: break-all;
                                            `}
                                        >
                                            {field.value === 'trace_id' ? (
                                                <AntButton onClick={() => openTraceDrawer(fieldValue)} type="link">
                                                    {fieldValue}
                                                </AntButton>
                                            ) : (
                                                <span
                                                    className={css`
                                                        font-size: 12px;
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
                <Pagination
                    currentPage={page}
                    numberOfPages={Math.ceil(tableTotalCount / pageSize) || 1}
                    onNavigate={toPage => {
                        setPage(toPage);
                    }}
                />
            </div>
            <TraceDetail onClose={() => setDrawerOpen(false)} open={drawerOpen} traceId={selectedRow?.trace_id} />

            {surroundingLogsOpen && (
                <Drawer
                    size="lg"
                    title="Surrounding Logs"
                    onClose={() => {
                        setSurroundingTableData([]);
                        setSurroundingDataFilter([]);
                        setBeforeCount(0);
                        setAfterCount(0);
                        setSelectedSurroundingFields([]);
                        setSurroundingLogsOpen(false);
                    }}
                >
                    <SurroundingLogs />
                </Drawer>
            )}
        </div>
    );
}
