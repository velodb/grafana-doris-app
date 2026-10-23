import { t } from 'i18n';
import React from 'react';
import { SearchSidebar } from 'components/traces/search-sidebar';
import { TraceView } from 'components/traces/traces-viewer';
import { css } from '@emotion/css';
import { LoadingBar, useTheme2 } from '@grafana/ui';
import { currentCatalogAtom, currentDatabaseAtom, currentDateAtom, currentTimeFieldAtom, pageAtom, pageSizeAtom, selectedDatasourceAtom } from 'store/discover';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import TracesHeader from 'components/traces/traces-header';
import { DEFAULT_OPERATION, DEFAULT_SERVICE } from '../constants';
import { formatSqlTime } from 'utils/time';
import {
    currentOperationAtom,
    currentServiceAtom,
    currentSortAtom,
    currentTraceTableAtom,
    maxDurationAtom,
    minDurationAtom,
    tagsAtom,
    tracesCapabilityAtom,
    traceOperationsAtom,
    tracesAtom,
    tracesServicesAtom,
} from 'store/traces';
import { PluginPage, logError } from '@grafana/runtime';
import { getOperationListService, getServiceListService, getTracesService, traceCapabilityKey } from 'services/traces';
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
        t('Request failed')
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
    const [total, setTotal] = React.useState(0);
    const [capabilities, setCapabilities] = useAtom(tracesCapabilityAtom);
    const traceGeneration = React.useRef(0);
    const tableContext = JSON.stringify([selectdbDS?.uid, currentDatabase, currentTable, currentTimeField]);
    const tableContextRef = React.useRef(tableContext);
    tableContextRef.current = tableContext;
    React.useEffect(() => {
        traceGeneration.current += 1;
        setTraces([]);
        setTotal(0);
        setLoading(false);
        return () => { traceGeneration.current += 1; };
    }, [selectdbDS?.uid, currentDatabase, currentTable, setTraces]);
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
            showTraceError(t('Cannot {{action}}: no Doris datasource is selected. Select a datasource first.', { action: action }));
            return true;
        }

        if (!currentDatabase) {
            showTraceError(t('Cannot {{action}}: no database is selected. Select a database first.', { action: action }));
            return true;
        }

        if (!currentTable) {
            showTraceError(
                hasExplicitTraceTableConfig
                    ? t('Cannot {{action}}: the configured trace table "{{table}}" is not selected. Switch to that table before querying.', { action: action, table: configuredTraceTable })
                    : t('Cannot {{action}}: no trace table is selected. Select a trace table, or configure a default trace table in app settings.', { action: action }),
            );
            return true;
        }

        if (!currentTimeField) {
            showTraceError(t('Cannot {{action}}: no time field is selected. Select a time field first.', { action: action }));
            return true;
        }

        return false;
    }, [configuredTraceTable, currentDatabase, currentTable, currentTimeField, hasExplicitTraceTableConfig, selectdbDS, showTraceError]);

    const showTraceQueryError = React.useCallback((err: any, requestKind: TraceRequestKind) => {
        if (showTraceSetupError(requestKind === 'traces' ? t('query traces') : requestKind === 'services' ? t('load trace services') : t('load trace operations'))) {
            return;
        }

        if (hasExplicitTraceTableConfig && currentTable !== configuredTraceTable) {
            showTraceError(
                t('Cannot query traces from "{{table}}": the configured trace table is "{{configuredTable}}". Switch to the configured trace table and try again.', { table: currentTable, configuredTable: configuredTraceTable }),
            );
            return;
        }

        const backendMessage = getErrorText(err);
        const tableContext = `"${currentDatabase}.${currentTable}"`;

        if (requestKind === 'services') {
            showTraceError(t('Failed to load trace services from {{table}}. Verify the table, time field, and Doris permissions. Backend: {{message}}', { table: tableContext, message: backendMessage }));
            return;
        }

        if (requestKind === 'operations') {
            showTraceError(t('Failed to load trace operations from {{table}}. Verify the table, time field, service filter, and Doris permissions. Backend: {{message}}', { table: tableContext, message: backendMessage }));
            return;
        }

        showTraceError(
            t('Trace query failed for {{table}}. Verify the trace schema includes required columns such as trace_id, span_id, parent_span_id, span_name, service_name, timestamp, duration, and status_code. Backend: {{message}}', { table: tableContext, message: backendMessage }),
            6,
        );
    }, [configuredTraceTable, currentDatabase, currentTable, hasExplicitTraceTableConfig, showTraceError, showTraceSetupError]);

    const getTraces = React.useCallback((nextPage = page, nextSort = sort) => {
        if (showTraceSetupError(t('query traces'))) {
            return;
        }
        const requestId = ++traceGeneration.current;
        setLoading(true);
        const payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0] ? formatSqlTime(currentDate[0]) : '',
            endDate: formatSqlTime(currentDate[1]),
            cluster: '',
            page: nextPage,
            page_size: pageSize,
            service_name: currentService.value,
            operation: currentOperation.value,
            sortBy: nextSort, // 'most-recent' | 'longest-duration'
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

        const capabilityKey = traceCapabilityKey({ selectdbDS: selectdbDS!, database: currentDatabase, table: currentTable });
        getTracesService({ selectdbDS, ...payload }, {
            showBackendError: false,
            capability: capabilities[capabilityKey],
            onCapability: capability => setCapabilities(previous => ({ ...previous, [capabilityKey]: capability })),
        }).subscribe({
            next: ({ rows, total: nextTotal }) => {
                if (traceGeneration.current !== requestId) {
                    return;
                }
                setLoading(false);
                setTotal(nextTotal);
                setTraces(rows.map(item => ({ ...item, trace_duration_ms: Number(item.trace_duration_ms || 0).toFixed(2) })));
            },
            error: (err: any) => {
                if (traceGeneration.current !== requestId) {
                    return;
                }
                setLoading(false);
                setTraces([]);
                setTotal(0);
                logError(toError(err), { source: 'PageTrace', action: 'getTraces' });
                showTraceQueryError(err, 'traces');
            },
        });
    }, [
        capabilities,
        setCapabilities,
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
        const requestedContext = tableContext;
        let payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0] ? formatSqlTime(currentDate[0]) : '',
            endDate: formatSqlTime(currentDate[1]),
            cluster: '',
        };

        getServiceListService({
            selectdbDS,
            ...payload,
        }, {
            showBackendError: false,
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (requestedContext !== tableContextRef.current) {
                    return;
                }
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
                if (requestedContext !== tableContextRef.current) {
                    return;
                }
                logError(toError(err), { source: 'PageTrace', action: 'getTracesServices' });
                showTraceQueryError(err, 'services');
            },
        });
    }, [tableContext, currentCatalog, currentDatabase, currentDate, currentTable, currentTimeField, selectdbDS, setTracesServices, showTraceQueryError]);

    const getTracesOperations = React.useCallback(() => {
        if (!currentTable || !currentDatabase || !selectdbDS || !currentTimeField) {
            return;
        }

        const requestedContext = tableContext;
        let payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0] ? formatSqlTime(currentDate[0]) : '',
            endDate: formatSqlTime(currentDate[1]),
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
                if (requestedContext !== tableContextRef.current) {
                    return;
                }
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
                if (requestedContext !== tableContextRef.current) {
                    return;
                }
                logError(toError(err), { source: 'PageTrace', action: 'getTracesOperations' });
                showTraceQueryError(err, 'operations');
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableContext, currentCatalog, currentDatabase, currentDate, currentService, currentTable, currentTimeField, selectdbDS, setTraceOperations, showTraceQueryError]);

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
                            aria-label={t('Close trace error')}
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
                        <TraceView traces={traces} total={total} onPageChange={(nextPage: number) => { setPage(nextPage); getTraces(nextPage); }} onSortByChange={(nextSort: string) => { setPage(1); getTraces(1, nextSort); }} />
                    </main>
                </div>
            </PluginPage>
        </div>
    );
}
