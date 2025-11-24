'use client';

import { Row, ColumnDef } from '@tanstack/react-table';
import JsonView from '@uiw/react-json-view';
import React, { useEffect, useMemo, useState } from 'react';
import { ColumnStyleWrapper, HoverStyle } from '../discover-content/discover-content.style';
import { SELECTDB_THEME, SELECTDB_THEME_LIGHT } from '../discover-content/json-viewer.theme';
import { useAtom, useAtomValue } from 'jotai';
import { useRequest } from 'ahooks';
import { css } from '@emotion/css';
import { SurroundingContentItem } from './surrounding-content-item';
import { SurroundingLogsActions } from './logs-actions';
import SurroundingDiscoverFilter from './discover-filter';
import { Button, IconButton, LoadingBar, Tab, TabContent, TabsBar, useTheme2 } from '@grafana/ui';
import { SurroundingParams } from './types';
import SDCollapsibleTable from 'components/selectdb-ui/sd-collapsible-table';
import {
    selectedRowAtom,
    currentTimeFieldAtom,
    currentClusterAtom,
    currentTableAtom,
    currentCatalogAtom,
    currentDatabaseAtom,
    surroundingTableDataAtom,
    selectedDatasourceAtom,
    afterCountAtom,
    afterTimeAtom,
    afterTimeFieldPageSizeAtom,
    beforeCountAtom,
    beforeTimeAtom,
    beforeTimeFieldPageSizeAtom,
    surroundingDataFilterAtom,
    surroundingSelectedFieldsAtom,
} from 'store/discover';
// import dayjs from 'dayjs';
import { get, sortBy } from 'lodash-es';
import { getSurroundingDataService } from 'services/discover';
import { lastValueFrom } from 'rxjs';
import { convertColumnToRow, formatTimestampToDateTime } from 'utils/data';
import { generateTableDataUID } from 'utils/utils';
import { SurroundingContentTableActions } from './content/content-table-actions';

export default function SurroundingLogs() {
    const theme = useTheme2();
    const selectedRow = useAtomValue(selectedRowAtom);
    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const [selectedSurroundingFields, setSelectedSurroundingFields] = useAtom(surroundingSelectedFieldsAtom);
    const [surroundingDataFilter] = useAtom<any>(surroundingDataFilterAtom);
    const hasSelectedFields = selectedSurroundingFields.length > 0;
    const [fields, setFields] = useState<any[]>([]);
    const currentCluster = useAtomValue(currentClusterAtom);
    const currentTable = useAtomValue(currentTableAtom);
    const currentCatalog = useAtomValue(currentCatalogAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const [surroundingTableData, setSurroundingTableData] = useAtom(surroundingTableDataAtom);
    const [beforeCount, setBeforeCount] = useAtom(beforeCountAtom);
    const [afterCount, setAfterCount] = useAtom(afterCountAtom);
    const [beforeTimeFieldPageSize, setBeforeTimeFieldPageSize] = useAtom(beforeTimeFieldPageSizeAtom);
    const [afterTimeFieldPageSize, setAfterTimeFieldPageSize] = useAtom(afterTimeFieldPageSizeAtom);
    const [beforeTime, setBeforeTime] = useAtom(beforeTimeAtom);
    const [afterTime, setAfterTime] = useAtom(afterTimeAtom);
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

    function handleRemove(field: any) {
        const index = selectedSurroundingFields.findIndex((item: any) => item.Field === field.Field);
        selectedSurroundingFields.splice(index, 1);
        setSelectedSurroundingFields([...selectedSurroundingFields]);
    }

    const { loading: getAfterSurroundingDataLoading, run: getAfterSurroundingData } = useRequest(
        ({ pageSize = afterTimeFieldPageSize, time = afterTime }: any) => {
            console.log(time);
            const params: SurroundingParams = getQueryParams({
                pageSize,
                operator: '>',
                time,
            });
            console.log(params.time);

            return lastValueFrom(
                getSurroundingDataService({
                    selectdbDS,
                    ...params,
                }),
            );
        },
        {
            manual: true,
            onSuccess: async (res: any, params: any) => {
                if (res.ok) {
                    const rowsData = convertColumnToRow(res.data.results.getSurroundingData.frames[0]);
                    const result = generateSurroundingResult(rowsData, currentTimeField);
                    let data = [...surroundingTableData];
                    data.push(...result);
                    setAfterCount(afterCount + data.length);
                    setAfterTime(result[0]._original[currentTimeField]);
                    setSurroundingTableData(data);
                    // setTimeout(() => {
                    //     scrollToSelectedRow();
                    // }, 50);
                }
            },
        },
    );

    function getQueryParams({ pageSize = 5, operator = '>', time = selectedRow.time }: any) {
        const params: SurroundingParams = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            time,
            data_filters: [],
            pageSize,
            operator,
            cluster: currentCluster,
            theme: theme.isDark ? 'dark' : 'light',
        };
        if (surroundingDataFilter.length > 0) {
            params.data_filters = surroundingDataFilter;
        }
        return params;
    }

    const { loading: getBeforeSurroundingDataLoading, run: getBeforeSurroundingData } = useRequest(
        ({ pageSize = beforeTimeFieldPageSize, time = selectedRow.time }: any) => {
            const params: SurroundingParams = getQueryParams({
                pageSize,
                operator: '<',
                time,
            });

            return lastValueFrom(
                getSurroundingDataService({
                    selectdbDS,
                    ...params,
                }),
            );
        },
        {
            manual: true,
            onSuccess: async (res: any, params: any) => {
                if (res.ok) {
                    const rowsData = convertColumnToRow(res.data.results.getSurroundingData.frames[0]);
                    const result = generateSurroundingResult(rowsData, currentTimeField);
                    let data = [...surroundingTableData];
                    data.unshift(...res.data);
                    setBeforeCount(beforeCount + result.length);
                    setBeforeTime(res.data[0]._original[currentTimeField]);
                    setSurroundingTableData(data);
                    // setTimeout(() => {
                    //     scrollToSelectedRow();
                    // }, 50);
                }
            },
        },
    );

    function scrollToSelectedRow() {
        const selectedElement = document.getElementById('selected');
        if (selectedElement) {
            selectedElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }

    const { loading: initLoading } = useRequest(
        () => {
            const prevTimeParams: SurroundingParams = getQueryParams({
                operator: '<',
            });
            const afterTimeParams: SurroundingParams = getQueryParams({
                operator: '>',
            });
            return Promise.all([
                lastValueFrom(
                    getSurroundingDataService({
                        selectdbDS,
                        ...prevTimeParams,
                    }),
                ),
                lastValueFrom(
                    getSurroundingDataService({
                        selectdbDS,
                        ...afterTimeParams,
                    }),
                ),
            ]);
        },
        {
            refreshDeps: [surroundingDataFilter],
            onSuccess: async (res: any) => {
                if (res[0].ok && res[1].ok) {
                    const rowsData1 = convertColumnToRow(res[0].data.results.getSurroundingData.frames[0]);
                    const rowsData2 = convertColumnToRow(res[1].data.results.getSurroundingData.frames[0]);
                    const result1 = generateSurroundingResult(rowsData1, currentTimeField);
                    const result2 = generateSurroundingResult(rowsData2, currentTimeField);
                    const selectedResult = generateSurroundingResult([selectedRow._original], currentTimeField);
                    const data = [...result1, ...selectedResult, ...result2];
                    const rowsDataWithUid = await generateTableDataUID(data);
                    if (result1.length > 0) {
                        setBeforeCount(result1.length);
                        setBeforeTime(result1[0]._original[currentTimeField]);
                    } else {
                        setBeforeTime(selectedRow.time);
                    }
                    if (result1.length > 0) {
                        setAfterCount(result1.length);
                        setAfterTime(result1[0]._original[currentTimeField]);
                    } else {
                        setAfterTime(selectedRow.time);
                    }
                    setSurroundingTableData(rowsDataWithUid);
                    setTimeout(() => {
                        scrollToSelectedRow();
                    }, 50);
                } else {
                    // toast.error(res[1].message);
                }
            },
            onError: err => {
                console.log(err);
            },
        },
    );

    useEffect(() => {
        const data = surroundingTableData.map(item => {
            return {
                _original: item._original,
                time: item._original?.[currentTimeField] || '',
                _source: item._source,
                _uid: item._uid,
                selected: item._uid === selectedRow._uid,
            };
        });
        setFields(data);
    }, [surroundingTableData, currentTimeField, selectedRow._uid]);

    const renderBeforeLoadingBar = () => {
        if (initLoading || getBeforeSurroundingDataLoading) {
            return (
                <div
                    className={css`
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        width: 100%;
                    `}
                >
                    <LoadingBar width={100} />
                </div>
            );
        }
        return null;
    };

    const renderAfterLoadingBar = () => {
        if (initLoading || getAfterSurroundingDataLoading) {
            return (
                <div
                    className={css`
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                    `}
                >
                    <LoadingBar width={100} />
                </div>
            );
        }
        return null;
    };

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
                <TabsBar>
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
                        <table className="bg-b1/20 pl-4 backdrop-blur-md dark:bg-n9/60">
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
                                                    <SurroundingContentTableActions fieldName={fieldName} fieldValue={fieldValue} />
                                                </div>
                                            </td>
                                            <td className="h-8 text-xs">{fieldName || '-'}</td>
                                            <td className="h-8 whitespace-normal text-xs">
                                                <div className="w-full break-all">{fieldValue || '-'}</div>
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
            </div>
        );
    };

    function generateSurroundingResult(result: any, timeField: string) {
        const sortedResult = sortBy(result, timeField);
        const _sourceResult = sortedResult.map((item: any) => {
            let itemSource = '';
            for (const key in item) {
                let highlightValue = item[key];
                // 兼容 Variant 类型
                if (typeof highlightValue === 'object') {
                    highlightValue = JSON.stringify(highlightValue);
                }
                itemSource += `<span style="background-color: ${
                    theme.isDark ? '#3F3F4F' : '#BED8FD'
                } ; padding: 0px 4px 2px; margin-right: 4px; border-radius: 4px;">${key}:</span>${highlightValue} `;
            }
            return {
                _original: item,
                _source: itemSource,
            };
        });
        return _sourceResult;
    }

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
                    const timeField = formatTimestampToDateTime(fieldValue);
                    return (
                        <div
                            className={`${css`
                                width: 230px;
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
                                    <SurroundingContentItem fieldName={fieldName} fieldValue={fieldValue} fieldType={fieldType} />
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
                                    .field-key {
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
                ...selectedSurroundingFields.map((field: any) => {
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
                                    <div className={`max-h-48 overflow-auto`}>
                                        <div className="flex items-center break-all py-4">
                                            {field.value === 'trace_id' ? <Button>{fieldValue}</Button> : <span className="text-xs">{fieldValue}</span>}
                                        </div>
                                    </div>
                                    <div
                                        className={`filter-content ${css`
                                            visibility: hidden;
                                        `}`}
                                    >
                                        <SurroundingContentItem fieldName={fieldName} fieldValue={fieldValue} fieldType={fieldType} />
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
    }, [currentTimeField, handleRemove, hasSelectedFields, selectedSurroundingFields]);

    return (
        <div>
            <SurroundingDiscoverFilter dataFilter={surroundingDataFilter} />
            <div className="h-[2px] bg-b1 dark:bg-black" />
            <div style={{ position: 'relative' }}>
                <SurroundingLogsActions
                    getSurroundingData={getBeforeSurroundingData}
                    getSurroundingDataLoading={getBeforeSurroundingDataLoading}
                    time={beforeTime}
                    type="before"
                    timeFieldPageSize={beforeTimeFieldPageSize}
                    setTimeFieldPageSize={setBeforeTimeFieldPageSize}
                    tips="Old records"
                    count={beforeCount}
                />
                {renderBeforeLoadingBar()}
            </div>
            <div style={{ height: 'calc(100vh - 220px)', overflow: 'auto', position: 'relative' }}>
                <div className="mx-6 border">
                    <SDCollapsibleTable data={fields} columns={columns} getRowCanExpand={() => true} renderSubComponent={renderSubComponent} />
                </div>
                {/* {initLoading ? (
                    <LoadingBar width={100} />
                ) : (
                    {renderBeforeLoadingBar}
                    <div className="mx-6 border">
                        <SDCollapsibleTable data={fields} columns={columns} getRowCanExpand={() => true} renderSubComponent={renderSubComponent} />
                    </div>
                )} */}
            </div>
            <div style={{ position: 'relative' }}>
                {renderAfterLoadingBar()}
                <SurroundingLogsActions
                    getSurroundingData={getAfterSurroundingData}
                    getSurroundingDataLoading={getAfterSurroundingDataLoading}
                    time={afterTime}
                    type="after"
                    timeFieldPageSize={afterTimeFieldPageSize}
                    setTimeFieldPageSize={setAfterTimeFieldPageSize}
                    tips={`New records`}
                    count={afterCount}
                />
            </div>
        </div>
    );
}
