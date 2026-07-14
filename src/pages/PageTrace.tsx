import React from 'react';
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
import { PluginPage, logError } from '@grafana/runtime';
import { getOperationListService, getServiceListService, getTracesService } from 'services/traces';
import { toDataFrame, usePluginContext } from '@grafana/data';
import { toError } from 'utils/errors';
import { mergeLogsConfig, type AppPluginSettings } from 'types/plugin-settings';
import { X } from 'lucide-react';

type TraceRequestKind = 'traces' | 'services' | 'operations';

function getFirstResultError(error: any) {
    const results = error?.data?.results || error?.response?.data?.results;
    if (!results) {
        return undefined;
    }

    const refId = Object.keys(results).find(key => results[key]?.error || results[key]?.status >= 400);
    if (!refId) {
        return undefined;
    }

    return {
        refId,
        ...results[refId],
    };
}

function getErrorText(error: any) {
    const resultError = getFirstResultError(error);

    return (
        error?.backendError ||
        resultError?.error ||
        error?.data?.message ||
        error?.response?.data?.message ||
        error?.statusText ||
        error?.message ||
        'Request failed'
    );
}

function hasQueryResultError(data: any) {
    return getFirstResultError({ data });
}

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
    const [traceError, setTraceError] = React.useState('');
    const currentService = useAtomValue(currentServiceAtom);
    const currentOperation = useAtomValue(currentOperationAtom);
    const tags = useAtomValue(tagsAtom);
    const minDuration = useAtomValue(minDurationAtom);
    const maxDuration = useAtomValue(maxDurationAtom);
    const sort = useAtomValue(currentSortAtom);
    const context = usePluginContext();
    const jsonData = context.meta.jsonData || {};
    const rawLogsConfig = (jsonData as AppPluginSettings).logsConfig;
    const logsConfig = mergeLogsConfig(rawLogsConfig);
    const configuredTraceTable = logsConfig.targetTraceTable || '';
    const hasExplicitTraceTableConfig = Boolean(rawLogsConfig?.targetTraceTable);

    const showTraceError = React.useCallback((content: string, duration = 5) => {
        setTraceError(content);

        if (duration > 0) {
            window.setTimeout(() => {
                setTraceError(currentError => currentError === content ? '' : currentError);
            }, duration * 1000);
        }
    }, []);

    const showTraceSetupError = React.useCallback((action: string) => {
        if (!selectdbDS) {
            showTraceError(`Cannot ${action}: no Doris datasource is selected. Select a datasource first.`);
            return true;
        }

        if (!currentDatabase) {
            showTraceError(`Cannot ${action}: no database is selected. Select a database first.`);
            return true;
        }

        if (!currentTable) {
            showTraceError(
                hasExplicitTraceTableConfig
                    ? `Cannot ${action}: the configured trace table "${configuredTraceTable}" is not selected. Switch to that table before querying.`
                    : `Cannot ${action}: no trace table is selected. Select a trace table, or configure a default trace table in app settings.`,
            );
            return true;
        }

        if (!currentTimeField) {
            showTraceError(`Cannot ${action}: no time field is selected. Select a time field first.`);
            return true;
        }

        return false;
    }, [configuredTraceTable, currentDatabase, currentTable, currentTimeField, hasExplicitTraceTableConfig, selectdbDS, showTraceError]);

    const showTraceQueryError = React.useCallback((err: any, requestKind: TraceRequestKind) => {
        if (showTraceSetupError(requestKind === 'traces' ? 'query traces' : `load trace ${requestKind}`)) {
            return;
        }

        if (hasExplicitTraceTableConfig && currentTable !== configuredTraceTable) {
            showTraceError(
                `Cannot query traces from "${currentTable}": the configured trace table is "${configuredTraceTable}". Switch to the configured trace table and try again.`,
            );
            return;
        }

        const backendMessage = getErrorText(err);
        const tableContext = `"${currentDatabase}.${currentTable}"`;

        if (requestKind === 'services') {
            showTraceError(`Failed to load trace services from ${tableContext}. Verify the table, time field, and Doris permissions. Backend: ${backendMessage}`);
            return;
        }

        if (requestKind === 'operations') {
            showTraceError(`Failed to load trace operations from ${tableContext}. Verify the table, time field, service filter, and Doris permissions. Backend: ${backendMessage}`);
            return;
        }

        showTraceError(
            `Trace query failed for ${tableContext}. Verify the trace schema includes required columns such as trace_id, span_id, parent_span_id, span_name, service_name, timestamp, duration, and status_code. Backend: ${backendMessage}`,
            6,
        );
    }, [configuredTraceTable, currentDatabase, currentTable, hasExplicitTraceTableConfig, showTraceError, showTraceSetupError]);

    const getTraces = React.useCallback((nextPage = page) => {
        if (showTraceSetupError('query traces')) {
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
            page: nextPage,
            page_size: pageSize,
            service_name: currentService.value,
            operation: currentOperation.value,
            sortBy: sort, // 'most-recent' | 'longest-duration'
        };

        if (minDuration) {
            payload.minDuration = minDuration;
        }
        if (maxDuration) {
            payload.maxDuration = maxDuration;
        }
        if (tags && tags.length > 0) {
            payload.tags = tags;
        }

        getTracesService({
            selectdbDS,
            ...payload,
        }, {
            showBackendError: false,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                const resultError = hasQueryResultError(data);
                if (!ok || resultError) {
                    showTraceQueryError({
                        data,
                        backendError: resultError?.error,
                        backendStatus: resultError?.status,
                        errorSource: resultError?.errorSource,
                        refId: resultError?.refId,
                    }, 'traces');
                    return;
                }

                if (ok) {
                    const rowsData = convertColumnToRow(data.results.getTraces.frames[0]);
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
                logError(toError(err), { source: 'PageTrace', action: 'getTraces' });
                showTraceQueryError(err, 'traces');
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
        showTraceSetupError,
        showTraceQueryError,
    ]);

    const getTracesServices = React.useCallback(() => {
        if (!currentTable || !currentDatabase || !selectdbDS || !currentTimeField) {
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
        }, {
            showBackendError: false,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                const resultError = hasQueryResultError(data);
                if (!ok || resultError) {
                    showTraceQueryError({
                        data,
                        backendError: resultError?.error,
                        backendStatus: resultError?.status,
                        errorSource: resultError?.errorSource,
                        refId: resultError?.refId,
                    }, 'services');
                    return;
                }

                if (ok) {
                    const frame = toDataFrame(data.results.getServiceList.frames[0]);
                    const values = Array.from(frame.fields[0]?.values || []);

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
                logError(toError(err), { source: 'PageTrace', action: 'getTracesServices' });
                showTraceQueryError(err, 'services');
            },
        });
    }, [currentCatalog, currentDatabase, currentDate, currentTable, currentTimeField, selectdbDS, setTracesServices, showTraceQueryError]);

    const getTracesOperations = React.useCallback(() => {
        if (!currentTable || !currentDatabase || !selectdbDS || !currentTimeField) {
            return;
        }

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
        }, {
            showBackendError: false,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                const resultError = hasQueryResultError(data);
                if (!ok || resultError) {
                    showTraceQueryError({
                        data,
                        backendError: resultError?.error,
                        backendStatus: resultError?.status,
                        errorSource: resultError?.errorSource,
                        refId: resultError?.refId,
                    }, 'operations');
                    return;
                }

                if (ok) {
                    // const frame = toDataFrame(data.results.getOperationList.frames[0]);
                    // const values = Array.from(frame.fields[0].values);
                    // const values = frame.data.values
                    const values = data.results.getOperationList.frames[0]?.data?.values?.[0] || [];

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
                logError(toError(err), { source: 'PageTrace', action: 'getTracesOperations' });
                showTraceQueryError(err, 'operations');
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCatalog, currentDatabase, currentDate, currentService, currentTable, currentTimeField, selectdbDS, setTraceOperations, showTraceQueryError]);

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
                {traceError && (
                    <div
                        role="alert"
                        className={css`
                            position: fixed;
                            top: 72px;
                            right: 24px;
                            z-index: 1000;
                            display: flex;
                            align-items: flex-start;
                            gap: 12px;
                            width: min(520px, calc(100vw - 48px));
                            padding: 12px 12px 12px 16px;
                            border-radius: 4px;
                            background: ${theme.colors.error.main};
                            color: ${theme.colors.error.contrastText};
                            box-shadow: ${theme.shadows.z3};
                            font-size: 14px;
                            line-height: 20px;
                        `}
                    >
                        <div
                            className={css`
                                flex: 1;
                                min-width: 0;
                                overflow-wrap: anywhere;
                            `}
                        >
                            {traceError}
                        </div>
                        <button
                            type="button"
                            aria-label="Close trace error"
                            onClick={() => setTraceError('')}
                            className={css`
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                width: 24px;
                                height: 24px;
                                flex: 0 0 24px;
                                border: 0;
                                border-radius: 4px;
                                padding: 0;
                                background: transparent;
                                color: ${theme.colors.error.contrastText};
                                cursor: pointer;

                                &:hover {
                                    background: ${theme.colors.action.hover};
                                }
                            `}
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    </div>
                )}
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
                                getTracesServices();
                                getTracesOperations();
                                getTraces(1);
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
