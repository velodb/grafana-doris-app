import React, { useEffect } from 'react';
import { SearchSidebar } from 'components/traces/search-sidebar';
import { TraceView } from 'components/traces/traces-viewer';
import { css } from '@emotion/css';
import { LoadingBar, useTheme2 } from '@grafana/ui';
import { currentCatalogAtom, currentDatabaseAtom, currentDateAtom, currentTimeFieldAtom, pageAtom, pageSizeAtom, selectedDatasourceAtom } from 'store/discover';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import TracesHeader from 'components/traces/traces-header';
import { DEFAULT_OPERATION, DEFAULT_SERVICE, FORMAT_DATE } from '../constants';
import { Dayjs } from 'dayjs';
import {
    currentOperationAtom,
    currentServiceAtom,
    currentSortAtom,
    currentTraceTableAtom,
    maxDurationAtom,
    minDurationAtom,
    tagsAtom,
    traceOperationsAtom,
    tracesAtom,
    tracesServicesAtom,
} from 'store/traces';
import { convertColumnToRow } from 'utils/data';
import { PluginPage } from '@grafana/runtime';
import { getOperationListService, getServiceListService, getTracesService } from 'services/traces';
import { toDataFrame } from '@grafana/data';

export default function PageTrace() {
    const theme = useTheme2();
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const currentTable = useAtomValue(currentTraceTableAtom);
    const currentCatalog = useAtomValue(currentCatalogAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const currentDate = useAtomValue(currentDateAtom);
    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const [page, setPage] = useAtom(pageAtom);
    const pageSize = useAtomValue(pageSizeAtom);
    const [traces, setTraces] = useAtom(tracesAtom);
    const setTracesServices = useSetAtom(tracesServicesAtom);
    const setTraceOperations = useSetAtom(traceOperationsAtom);
    const [loading, setLoading] = React.useState(false);
    const currentService = useAtomValue(currentServiceAtom);
    const currentOperation = useAtomValue(currentOperationAtom);
    const tags = useAtomValue(tagsAtom);
    const minDuration = useAtomValue(minDurationAtom);
    const maxDuration = useAtomValue(maxDurationAtom);
    const sort = useAtomValue(currentSortAtom);

    const getTraces = React.useCallback(() => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        setLoading(true);
        const payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0]?.format(FORMAT_DATE),
            endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
            cluster: '',
            page: page,
            page_size: pageSize,
            service_name: currentService.value,
            operation: currentOperation.value,
            sortBy: sort, // 'most-recent' | 'longest-duration'
        };

        if (minDuration) {
            console.log('minDuration', minDuration);
            payload.minDuration = minDuration;
        }
        if (maxDuration) {
            console.log('maxDuration', maxDuration);
            payload.maxDuration = maxDuration;
        }
        if (tags && tags.length > 0) {
            payload.tags = tags;
        }

        getTracesService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                if (ok) {
                    const rowsData = convertColumnToRow(data.results.getTraces.frames[0]);
                    // console.log('查询结果', rowsData);
                    const formateData = rowsData.map((item: any) => {
                        return {
                            ...item,
                            trace_duration_ms: (item.trace_duration_ms as number)?.toFixed(2) || 0,
                        };
                    });
                    setTraces(formateData);
                }
            },
            error: (err: any) => {
                setLoading(false);
                console.log('Fetch Error', err);
            },
        });
    }, [
        currentCatalog,
        currentDatabase,
        currentTable,
        currentTimeField,
        currentDate,
        page,
        pageSize,
        currentService.value,
        currentOperation.value,
        sort,
        minDuration,
        maxDuration,
        tags,
        selectdbDS,
        setTraces,
    ]);

    const getTracesServices = React.useCallback(() => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        let payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0]?.format(FORMAT_DATE),
            endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
            cluster: '',
        };

        getServiceListService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                if (ok) {
                    const frame = toDataFrame(data.results.getServiceList.frames[0]);
                    const values = Array.from(frame.fields[0].values);

                    if (values) {
                        const options = values.map((item: any) => {
                            return {
                                label: item,
                                value: item,
                            };
                        });
                        setTracesServices([DEFAULT_SERVICE, ...options]);
                    }
                }
            },
            error: (err: any) => {
                setLoading(false);
                console.log('Fetch Error', err);
            },
        });
    }, [currentCatalog, currentDatabase, currentDate, currentTable, currentTimeField, selectdbDS, setTracesServices]);

    const getTracesOperations = React.useCallback(() => {
        let payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0]?.format(FORMAT_DATE),
            endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
            service_name: currentService.value,
            cluster: '',
        };

        getOperationListService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                if (ok) {
                    // const frame = toDataFrame(data.results.getOperationList.frames[0]);
                    // const values = Array.from(frame.fields[0].values);
                    // const values = frame.data.values
                    const values = data.results.getOperationList.frames[0].data.values[0];

                    if (values) {
                        const options = values.map((item: any) => {
                            return {
                                label: item,
                                value: item,
                            };
                        });
                        setTraceOperations([DEFAULT_OPERATION, ...options]);
                    } else {
                        setTraceOperations([DEFAULT_OPERATION]);
                    }
                }
            },
            error: (err: any) => {
                setLoading(false);
                console.log('Fetch Error', err);
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCatalog, currentDatabase, currentDate, currentService, currentTable, currentTimeField, selectdbDS, setTraceOperations]);

    useEffect(() => {
        if (currentTimeField && currentTable && currentCatalog && currentDatabase && currentDate) {
            getTraces();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize, currentTimeField, currentDate, sort]);

    useEffect(() => {
        if (currentTimeField && currentTable && currentCatalog && currentDatabase && currentDate) {
            getTracesServices();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTimeField, currentDate, sort]);

    useEffect(() => {
        if (currentTimeField && currentTable && currentCatalog && currentDatabase && currentService) {
            getTracesOperations();
        }
    }, [currentTimeField, currentService, getTracesOperations, currentTable, currentCatalog, currentDatabase]);

    return (
        <div
            className={css`
                height: 100%;
                width: 100%;
                overflow: hidden;
                & > div {
                    height: 100%;
                }
                & > div > div {
                    padding: 0 1rem;
                    height: 100%;
                }
            `}
        >
            <PluginPage pageNav={{ text: '' }}>
                <TracesHeader />
                <div
                    className={css`
                        display: flex;
                        height: calc(100% - 103px);
                        width: 100%;
                        overflow: hidden;
                        background-color: ${theme.colors.background.primary};
                        color: ${theme.colors.text.primary};
                    `}
                >
                    <aside
                        className={css`
                            width: 320px;
                            flex-shrink: 0;
                            border-right: 1px solid ${theme.colors.border.medium};
                            padding: 16px;
                        `}
                    >
                        <SearchSidebar
                            onQuerying={() => {
                                setPage(1);
                                getTraces();
                            }}
                        />
                    </aside>

                    {/* 右侧主内容区 */}
                    <main
                        className={css`
                            flex: 1;
                            height: 100%;
                            padding: 24px;
                            overflow-y: auto;
                        `}
                    >
                        {loading && <LoadingBar width={100} />}
                        <TraceView traces={traces} />
                    </main>
                </div>
            </PluginPage>
        </div>
    );
}
