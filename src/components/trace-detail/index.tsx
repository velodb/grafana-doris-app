import { FieldType, LoadingState, usePluginContext } from '@grafana/data';
import { PanelRenderer, logError } from '@grafana/runtime';
import { Drawer, LoadingPlaceholder } from '@grafana/ui';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useAtom, useAtomValue } from 'jotai';
import React, { useEffect } from 'react';
import { FORMAT_DATE, ROUTES } from '../../constants';
import { getTableDataTraceService } from 'services/traces';
import { currentCatalogAtom, currentDatabaseAtom, tableTracesDataAtom, selectedDatasourceAtom, selectedRowAtom } from 'store/discover';
import { currentTraceTableAtom } from 'store/traces';
import { mergeLogsConfig, type AppPluginSettings } from 'types/plugin-settings';
import { formatTracesResData } from 'utils/data';
import { toError } from 'utils/errors';
import { prefixRoute } from 'utils/utils.routing';

const SPAN_LOGS_WINDOW_PADDING_MS = 30 * 1000;

dayjs.extend(utc);

function escapeLucenePhrase(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getSpanTimeRange(span: any) {
    const spanStartTimeMs = Math.floor(Number(span.startTime || 0) / 1000);
    const spanDurationMs = Math.ceil(Number(span.duration || 0) / 1000);
    const start = dayjs.utc(spanStartTimeMs - SPAN_LOGS_WINDOW_PADDING_MS);
    const end = dayjs.utc(spanStartTimeMs + Math.max(spanDurationMs, 0) + SPAN_LOGS_WINDOW_PADDING_MS);

    return { start, end };
}

function buildDiscoverLogsUrl(params: {
    datasource?: string;
    database?: string;
    table?: string;
    timeField?: string;
    traceId: string;
    spanId?: string;
    serviceName?: string;
    start: dayjs.Dayjs;
    end: dayjs.Dayjs;
}) {
    const searchParams = new URLSearchParams();
    const traceQuery = `trace_id:"${escapeLucenePhrase(params.traceId)}"`;
    const spanScopeQuery = [
        params.spanId ? `span_id:"${escapeLucenePhrase(params.spanId)}"` : '',
        params.serviceName ? `service_name:"${escapeLucenePhrase(params.serviceName)}"` : '',
    ].filter(Boolean);

    if (params.datasource) {
        searchParams.set('datasource', params.datasource);
    }
    if (params.database) {
        searchParams.set('database', params.database);
    }
    if (params.table) {
        searchParams.set('table', params.table);
    }
    searchParams.set('mode', 'Lucene');
    searchParams.set('query', spanScopeQuery.length > 0 ? `${traceQuery} AND (${spanScopeQuery.join(' OR ')})` : traceQuery);
    searchParams.set('timeField', params.timeField || 'timestamp');
    searchParams.set('startTime', params.start.format(FORMAT_DATE));
    searchParams.set('endTime', params.end.format(FORMAT_DATE));

    return `${prefixRoute(ROUTES.Discover)}?${searchParams.toString()}`;
}

export default function TraceDetail(props: { onClose?: () => void; open: boolean; traceId?: string; traceTable?: string }) {
    const currentTable = useAtomValue(currentTraceTableAtom);
    const currentCatalog = useAtomValue(currentCatalogAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const [traceData, setTraceData] = useAtom(tableTracesDataAtom);
    const selectedRow = useAtomValue(selectedRowAtom);
    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const traceTable = props?.traceTable || currentTable || 'otel_traces';
    const [loading, setLoading] = React.useState(false);
    const context = usePluginContext();
    const logsConfig = mergeLogsConfig((context.meta.jsonData as AppPluginSettings | undefined)?.logsConfig);

    const { open, traceId } = props;

    const createSpanLink = React.useCallback((span: any) => {
        const traceId = span.traceID || props.traceId || '';
        const spanId = span.spanID || '';
        const serviceName = span.process?.serviceName || '';

        if (!traceId) {
            return undefined;
        }

        const { start, end } = getSpanTimeRange(span);
        const href = buildDiscoverLogsUrl({
            datasource: selectdbDS?.uid || selectdbDS?.name || '',
            database: logsConfig.database || currentDatabase,
            table: logsConfig.logsTable || 'otel_logs',
            timeField: 'timestamp',
            traceId,
            spanId,
            serviceName,
            start,
            end,
        });

        return [
            {
                href,
                content: 'Logs',
                title: 'Logs for this span',
                type: 'log',
                field: {
                    name: 'span_id',
                    type: FieldType.string,
                    config: {},
                    values: [],
                },
                onClick: () => {
                    window.location.assign(href);
                },
            },
        ];
    }, [currentDatabase, logsConfig.database, logsConfig.logsTable, props.traceId, selectdbDS?.name, selectdbDS?.uid]);

    const getTraceData = React.useCallback(() => {
        let payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: traceTable,
            cluster: '',
            sort: 'DESC',
            trace_id: traceId || '',
        };
        setLoading(true);

        getTableDataTraceService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                if (ok) {
                    const formatedData = formatTracesResData(data.results.getTableDataTrace.frames[0]);
                    setTraceData(formatedData);
                }
            },
            error: (err: any) => {
                setLoading(false);
                logError(toError(err), { source: 'TraceDetail', action: 'getTraceData' });
            },
        });
    }, [currentCatalog, currentDatabase, traceTable, selectdbDS, setTraceData, traceId]);

    useEffect(() => {
        if (traceId) {
            getTraceData();
        }
    }, [selectedRow.trace_id, currentCatalog, currentDatabase, selectdbDS, setTraceData, getTraceData, traceId]);

    function renderTracePanel() {
        if (traceData) {
            return (
                <PanelRenderer
                    title="trace panel"
                    width={200}
                    height={300}
                    pluginId="traces"
                    options={{ createSpanLink }}
                    data={{
                        state: loading ? LoadingState.Loading : LoadingState.Done,
                        series: [traceData],
                        timeRange: {
                            from: new Date(Date.now() - 15 * 60 * 1000) as any, // 15 分钟前
                            to: new Date() as any,
                            raw: {
                                from: 'now-15m',
                                to: 'now',
                            },
                        },
                    }}
                />
            );
        }
        return null;
    }

    return (
        <>
            {open && (
                <Drawer
                    title="Trace Panel"
                    onClose={() => {
                        props?.onClose?.();
                    }}
                    size="lg"
                >
                    {loading ? <LoadingPlaceholder text={`Loading`} /> : renderTracePanel()}
                </Drawer>
            )}
        </>
    );
}
