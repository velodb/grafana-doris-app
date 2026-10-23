'use client';
import { t } from 'i18n';

import { Row, ColumnDef } from '@tanstack/react-table';
import React, { useEffect, useRef, useMemo, useState } from 'react';
import { ColumnStyleWrapper, HoverStyle } from '../discover-content/discover-content.style';
import { useAtom, useAtomValue } from 'jotai';
import { useRequest } from 'ahooks';
import { css } from '@emotion/css';
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
    dataFilterAtom,
    selectedFieldsAtom,
    tableFieldsAtom,
    timeZoneAtom,
} from 'store/discover';
// import dayjs from 'dayjs';
import { sortBy } from 'lodash-es';
import { getSurroundingDataWithWindow as getSurroundingDataService } from 'services/discover';
import { lastValueFrom } from 'rxjs';
import { convertColumnToRowViaFieldsType, escapeHtml, formatFieldDisplayValue, formatRecordDisplayValue, formatRecordTimes, generateHighlightedResults, formatTimestampToDateTime, isStructuredJsonType, isValidTimeFieldType, parseJsonLikeValue } from 'utils/data';
import { generateTableDataUID } from 'utils/utils';
import { SurroundingColumnAction } from './column-action';
import { logError } from '@grafana/runtime';
import { toError } from 'utils/errors';
import { VariantValueViewer } from 'components/discover-content/variant-value-viewer';
import { getVariantFieldValue } from 'utils/variant-fields';
import { LongTextCell } from 'components/long-text-cell';

export default function SurroundingLogs() {
    const theme = useTheme2();
    const timeZone = useAtomValue(timeZoneAtom);
    const selectedRow = useAtomValue(selectedRowAtom);
    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const [selectedFields, setSelectedFields] = useAtom(selectedFieldsAtom);
    const dataFilter = useAtomValue(dataFilterAtom);
    const [filterEnabled, setFilterEnabled] = useState(false);
    const hasSelectedFields = selectedFields.length > 0;
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
    const tableFields = useAtomValue(tableFieldsAtom);
    const contextKey = JSON.stringify([selectdbDS?.uid, currentDatabase, currentTable, currentTimeField, selectedRow._uid, selectedRow.time, filterEnabled, filterEnabled ? dataFilter : []]);
    const contextRef = useRef(contextKey);
    contextRef.current = contextKey;
    const requestSurrounding = (params: SurroundingParams) => lastValueFrom(getSurroundingDataService({ selectdbDS, ...params }))
        .then(response => ({ ...response, surroundingContext: contextKey }));
    const [state, updateState] = useState([
        {
            label: t('Table'),
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
        setSelectedFields(current => current.filter((item: any) => item.Field !== field.Field));
    }


    const { loading: getAfterSurroundingDataLoading, run: getAfterSurroundingData } = useRequest(
        ({ pageSize = afterTimeFieldPageSize, time = afterTime }: any) => {
            const params: SurroundingParams = getQueryParams({
                pageSize,
                operator: '>',
                time,
            });

            return requestSurrounding(params);
        },
        {
            manual: true,
            onSuccess: async (res: any) => {
                if (res.surroundingContext !== contextRef.current) {
                    return;
                }
                if (res.ok) {
                    const rowsData = convertColumnToRowViaFieldsType(res.data.results.getSurroundingData.frames[0], tableFields);
                    const result = generateSurroundingResult(rowsData, currentTimeField);
                    setAfterCount(previous => previous + result.length);
                    if (result.length) {
                        setAfterTime(result[result.length - 1]._original[currentTimeField]);
                    }
                    setSurroundingTableData(previous => [...previous, ...result]);
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
        if (filterEnabled && dataFilter.length > 0) {
            params.data_filters = dataFilter;
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

            return requestSurrounding(params);
        },
        {
            manual: true,
            onSuccess: async (res: any) => {
                if (res.surroundingContext !== contextRef.current) {
                    return;
                }
                if (res.ok) {
                    const rowsData = convertColumnToRowViaFieldsType(res.data.results.getSurroundingData.frames[0], tableFields);
                    const result = generateSurroundingResult(rowsData, currentTimeField);
                    setBeforeCount(previous => previous + result.length);
                    if (result.length) {
                        setBeforeTime(result[0]._original[currentTimeField]);
                    }
                    setSurroundingTableData(previous => [...result, ...previous]);
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
                pageSize: 5
            });
            return Promise.all([
                requestSurrounding(prevTimeParams),
                requestSurrounding(afterTimeParams),
            ]);
        },
        {
            refreshDeps: [contextKey],
            onSuccess: async (res: any) => {
                if (res.some((item: any) => item.surroundingContext !== contextRef.current)) {
                    return;
                }
                if (res[0].ok && res[1].ok) {
                    const rowsData1 = convertColumnToRowViaFieldsType(res[0].data.results.getSurroundingData.frames[0], tableFields);
                    const rowsData2 = convertColumnToRowViaFieldsType(res[1].data.results.getSurroundingData.frames[0], tableFields);
                    const result1 = generateSurroundingResult(rowsData1, currentTimeField);
                    const result2 = generateSurroundingResult(rowsData2, currentTimeField);
                    const selectedResult = generateSurroundingResult([selectedRow._original], currentTimeField);
                    const data = [...result1, ...selectedResult, ...result2];
                    const rowsDataWithUID = await generateTableDataUID(data);
                    if (res.some((item: any) => item.surroundingContext !== contextRef.current)) {
                        return;
                    }

                    setBeforeCount(result1.length);
                    setAfterCount(result2.length);
                    if (result1.length > 0) {
                        setBeforeCount(result1.length);
                        setBeforeTime(result1[0]._original[currentTimeField]);
                    } else {
                        setBeforeTime(selectedRow.time);
                    }
                    if (result2.length > 0) {
                        setAfterCount(result2.length);
                        setAfterTime(result2[result2.length - 1]._original[currentTimeField]);
                    } else {
                        setAfterTime(selectedRow.time);
                    }
                    setSurroundingTableData(rowsDataWithUID);
                    setTimeout(() => {
                        scrollToSelectedRow();
                    }, 50);
                } else {
                    // toast.error(res[1].message);
                }
            },
            onError: err => {
                logError(toError(err), { source: 'SurroundingLogs', action: 'initSurroundingData' });
            },
        },
    );

    useEffect(() => {
        const data = surroundingTableData.map(item => {
            return {
                _original: item._original,
                time: item._original?.[currentTimeField] || '',
                _source: generateHighlightedResults({ search_value: '', indexes: [] }, [formatRecordTimes(item._original, tableFields, timeZone)])[0]._source,
                _uid: item._uid,
                selected: item._uid === selectedRow._uid,
            };
        });
        setFields(data);
    }, [surroundingTableData, currentTimeField, selectedRow._uid, tableFields, timeZone]);

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
                        <table className="bg-b1/20 pl-4 backdrop-blur-md dark:bg-n9/60">
                            <tbody>
                                {subTableData.map((item: any) => {
                                    const fieldName = item.field;
                                    const fieldType = tableFields.find((field: any) => field.Field === fieldName)?.Type;
                                    const fieldValue = isValidTimeFieldType(String(fieldType || '').toUpperCase()) && item.value != null ? formatTimestampToDateTime(item.value, 3, timeZone) : formatFieldDisplayValue(item.value, 'compact');
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
                                                    <SurroundingColumnAction fieldName={fieldName} />
                                                </div>
                                            </td>
                                            <td className="h-8 text-xs">{fieldName || '-'}</td>
                                            <td className="h-8 whitespace-normal text-xs">
                                                <div className="w-full break-all">
                                                    {isStructuredJsonType(fieldType) ? <VariantValueViewer value={item.value} /> : fieldValue}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {state[1].active && (
                        <VariantValueViewer value={processedData} rootName="JSON" />
                    )}
                </TabContent>
                {/* Surrounding items link is handled by parent (DiscoverContent). No action here. */}
             </div>
         );
     };

     function generateSurroundingResult(result: any, timeField: string) {
        const sortedResult = sortBy(result, timeField);
        const _sourceResult = sortedResult.map((item: any) => {
            let itemSource = '';
            for (const key in item) {
                const highlightValue = formatFieldDisplayValue(item[key], 'compact');
                itemSource += `<span style="background-color: ${theme.isDark ? '#3F3F4F' : '#BED8FD'
                    } ; padding: 0px 4px 2px; margin-right: 4px; border-radius: 4px;">${escapeHtml(key)}:</span>${escapeHtml(highlightValue)} `;
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
                id: '__expand',
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
                            <div>
                                {row.getIsExpanded() ? (
                                    <IconButton onClick={row.getToggleExpandedHandler()} name="arrow-down" tooltip={t('Collapse')} />
                                ) : (
                                    <IconButton onClick={row.getToggleExpandedHandler()} name="arrow-right" tooltip={t('Expand')} />
                                )}
                                <div className="ml-1">{getValue<string>()}</div>
                            </div>
                        )
                    );
                },
            },
            {
                id: '__time',
                header: () => t('Time'),
                accessorKey: 'time',
                size: 240,
                minSize: 80,
                maxSize: 800,
                cell: ({ row, getValue }) => {
                    const fieldValue = getValue<string>();
                    const fieldName = currentTimeField;
                    const timeField = formatTimestampToDateTime(fieldValue, 3, timeZone);
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
                                    <SurroundingColumnAction fieldName={fieldName} />
                                </div>
                            </div>
                        </div>
                    );
                },
            },
        ];
        if (!hasSelectedFields) {
            dynamicColumns.push({
                id: '__source',
                accessorKey: '_source',
                header: '_source',
                size: 640,
                minSize: 80,
                maxSize: 800,
                enableSorting: false,
                cell: ({ row, getValue }) => {
                    function createMarkup() {
                        return { __html: getValue<string>() };
                    }
                    return (
                        <LongTextCell
                            copyText={formatRecordDisplayValue(row.original._original)}
                            className={css`
                                display: block;
                                width: 100%;
                                max-height: 12rem;
                                overflow: auto;
                                word-break: break-all;
                                white-space: pre-wrap;
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
                                        display: block;
                                        width: 100%;
                                    `}
                                />
                            </ColumnStyleWrapper>
                        </LongTextCell>
                    );
                },
            });
        } else {
            dynamicColumns = [
                ...dynamicColumns,
                ...selectedFields.map((field: any) => {
                    return {
                        id: `field:${field.Field}`,
                        accessorFn: (row: any) => getVariantFieldValue(row._original, field),
                        size: 240,
                        minSize: 80,
                        maxSize: 800,
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
                                    tooltip={t('Remove')}
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
                            const fieldValue = isValidTimeFieldType(String(field.Type || '').toUpperCase()) && rawFieldValue != null ? formatTimestampToDateTime(rawFieldValue, 3, timeZone) : formatFieldDisplayValue(rawFieldValue, 'compact');
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
                                    {isStructuredJsonType(fieldType) ? <VariantValueViewer value={rawFieldValue} /> : field.value === 'trace_id' && fieldValue ? <Button>{fieldValue}</Button> : <LongTextCell copyText={fieldValue} className="max-h-48 overflow-auto">
                                        <div className="flex items-center break-all py-4">
                                            <span className="text-xs">{fieldValue}</span>
                                        </div>
                                    </LongTextCell>}
                                    {
                                        fieldValue ? <div
                                            className={`filter-content ${css`
                                            visibility: hidden;
                                        `}`}
                                        >
                                            <SurroundingColumnAction fieldName={fieldName} />
                                        </div> : null
                                    }

                                </div>
                            );
                        },
                    };
                }),
            ];
        }
        return dynamicColumns;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeZone, currentTimeField, handleRemove, hasSelectedFields, selectedFields]);

    return (
        <div>
            <SurroundingDiscoverFilter enabled={filterEnabled} onEnabledChange={setFilterEnabled} />
            <div className="h-[2px] bg-b1 dark:bg-black" />
            <div style={{ position: 'relative' }}>
                <SurroundingLogsActions
                    getSurroundingData={getBeforeSurroundingData}
                    getSurroundingDataLoading={getBeforeSurroundingDataLoading}
                    time={beforeTime}
                    type="before"
                    timeFieldPageSize={beforeTimeFieldPageSize}
                    setTimeFieldPageSize={setBeforeTimeFieldPageSize}
                    tips={t('Old records')}
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
                    tips={t('New records')}
                    count={afterCount}
                />
            </div>
        </div>
    );
}
