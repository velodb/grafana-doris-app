import { t } from 'i18n';
import { formatShareTime, buildAbsoluteTimeRange } from 'utils/time';
import { FieldType, LoadingState, usePluginContext } from '@grafana/data';
import { PanelRenderer, logError } from '@grafana/runtime';
import { Drawer, LoadingPlaceholder } from '@grafana/ui';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useAtom, useAtomValue } from 'jotai';
import React, { useEffect } from 'react';
import { ROUTES } from '../../constants';
import { getTableDataTraceService } from 'services/traces';
import { currentCatalogAtom, currentDatabaseAtom, tableTracesDataAtom, selectedDatasourceAtom, selectedRowAtom, timeZoneAtom } from 'store/discover';
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
    timeZone?: string;
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
    if (params.timeZone) {
        searchParams.set('timeZone', params.timeZone);
    }
    searchParams.set('startTime', formatShareTime(params.start));
    searchParams.set('endTime', formatShareTime(params.end));

    return `${prefixRoute(ROUTES.Discover)}?${searchParams.toString()}`;
}

export default function TraceDetail(props: { onClose?: () => void; open: boolean; traceId?: string; traceTable?: string }) {
    const timeZone = useAtomValue(timeZoneAtom);
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
            timeZone,
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
                title: t('Logs for this span'),
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
    }, [currentDatabase, logsConfig.database, logsConfig.logsTable, props.traceId, selectdbDS?.name, selectdbDS?.uid, timeZone]);

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

        return getTableDataTraceService({
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
        if (open && traceId) {
            const subscription = getTraceData();
            return () => subscription.unsubscribe();
        }
        return undefined;
    }, [selectedRow.trace_id, currentCatalog, currentDatabase, selectdbDS, setTraceData, getTraceData, traceId, open]);

    function renderTracePanel() {
        if (traceData) {
            const starts = traceData.fields.find((field: any) => field.name === 'startTime')?.values || [];
            const durations = traceData.fields.find((field: any) => field.name === 'duration')?.values || [];
            const finiteStarts = Array.from(starts as number[]).map(Number).filter(Number.isFinite);
            const start = finiteStarts.length ? Math.min(...finiteStarts) : Date.now() - 15 * 60 * 1000;
            const end = finiteStarts.length ? Math.max(...Array.from(starts as number[]).map((value, index) => Number(value) + Number(durations[index] || 0))) : Date.now();
            return (
                <PanelRenderer
                    title={t('Trace panel')}
                    width={200}
                    height={300}
                    pluginId="traces"
                    timeZone={timeZone}
                    options={{ createSpanLink }}
                    data={{
                        state: loading ? LoadingState.Loading : LoadingState.Done,
                        series: [traceData],
                        timeRange: buildAbsoluteTimeRange(dayjs.utc(start), dayjs.utc(end)),
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
                    title={t('Trace Panel')}
                    onClose={() => {
                        props?.onClose?.();
                    }}
                    size="lg"
                >
                    {loading ? <LoadingPlaceholder text={t('Loading')} /> : renderTracePanel()}
                </Drawer>
            )}
        </>
    );
}
