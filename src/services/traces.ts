import { t } from 'i18n';
import { defer, lastValueFrom } from 'rxjs';
import SqlString from 'sqlstring';
import { convertColumnToRow } from 'utils/data';
import { parseDorisTime } from 'utils/time';
import { QueryTracesParams } from 'types/type';
import { TraceListResult, TracesCapability } from 'types/traces';
import { getBackendSrv } from '@grafana/runtime';
import {
    buildTraceAggSQLFromParams,
    buildTraceCountSQLFromParams,
    buildTraceSummaryListSQL,
    buildTraceSummaryCountSQL,
    buildTraceSupplementSQL,
    getOperationListSQL,
    getQueryTableTraceSQL,
    getServiceListSQL,
} from './traces.sql';
import { withErrorHandler } from 'components/with-error-handler/withErrorHandler';

type TraceServiceOptions = {
    showBackendError?: boolean;
    defaultMessage?: string;
};

// 获取table的Trace数据
export function getTableDataTraceService(payload: any, options?: TraceServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const traceSQL = getQueryTableTraceSQL(rest);
    return withErrorHandler(
        getBackendSrv().fetch({
            url: '/api/ds/query',
            method: 'POST',
            data: {
                queries: [
                    {
                        refId: 'getTableDataTrace',
                        datasource: {
                            type: selectdbDS.type,
                            uid: selectdbDS.uid,
                        },
                        rawSql: traceSQL,
                        format: 'table',
                    },
                ],
            },
            credentials: 'include',
        }),
        options,
    );
}

function traceRows(response: any, refId: string): Array<Record<string, any>> {
    const result = response?.data?.results?.[refId];
    if (!response?.ok || result?.error || result?.status >= 400) {
        throw new Error(result?.error || response?.statusText || t('Trace query failed'));
    }
    return result?.frames?.length ? result.frames.flatMap((frame: any) => convertColumnToRow(frame)) : [];
}

async function runTraceSQL(selectdbDS: any, queries: Array<{ refId: string; rawSql: string }>, options?: TraceServiceOptions) {
    return lastValueFrom(
        withErrorHandler(
            getBackendSrv().fetch({
                url: '/api/ds/query',
                method: 'POST',
                credentials: 'include',
                data: { queries: queries.map(query => ({ ...query, datasource: { type: selectdbDS.type, uid: selectdbDS.uid }, format: 'table' })) },
            }),
            options,
        ),
    );
}

export function traceCapabilityKey(payload: { selectdbDS: { uid: string }; database: string; table: string }): string {
    return JSON.stringify([payload.selectdbDS.uid, payload.database, payload.table]);
}

const capabilityRequests = new Map<string, Promise<TracesCapability>>();
async function detectTraceCapability(payload: any): Promise<TracesCapability> {
    const key = traceCapabilityKey(payload);
    const existing = capabilityRequests.get(key);
    if (existing) {
        return existing;
    }
    const promise = (async () => {
        try {
            const table = `${SqlString.escapeId(payload.database)}.${SqlString.escapeId(payload.table)}`;
            const response = await runTraceSQL(
                payload.selectdbDS,
                [
                    { refId: 'traceFields', rawSql: `DESC ${table}` },
                    { refId: 'traceIndexes', rawSql: `DESC ${table} ALL` },
                ],
                { showBackendError: false },
            );
            const fields = traceRows(response, 'traceFields');
            const indexes = traceRows(response, 'traceIndexes');
            // DESC ALL lists installed synchronous indexes; incomplete builds
            // are absent. IndexName is only set on the first row of an index.
            return { hasSummary: fields.some(row => row.Field === 'is_root') && indexes.some(row => row.IndexName === `${payload.table}_summary`), rewrites: {} };
        } catch {
            return { hasSummary: false, rewrites: {} };
        }
    })();
    capabilityRequests.set(key, promise);
    try {
        return await promise;
    } finally {
        capabilityRequests.delete(key);
    }
}

type TraceListOptions = TraceServiceOptions & {
    capability?: TracesCapability;
    onCapability?: (capability: TracesCapability) => void;
};

/** Normalize both storage generations at the service boundary. */
export function getTracesService(payload: { selectdbDS: any } & QueryTracesParams, options?: TraceListOptions) {
    return defer(async (): Promise<TraceListResult> => {
        const { selectdbDS, ...params } = payload;
        const backendOptions = { showBackendError: options?.showBackendError, defaultMessage: options?.defaultMessage };
        let capability = options?.capability;
        let useSummary = false;
        if (params.timeField === 'timestamp') {
            capability = capability || (await detectTraceCapability(payload));
            if (capability.hasSummary) {
                const listSQL = buildTraceSummaryListSQL(params);
                const countSQL = buildTraceSummaryCountSQL(params);
                // Literal values do not change rewrite eligibility, but filter
                // structure, sort and grouping do. Avoid EXPLAIN on every page.
                const shape = [listSQL, countSQL]
                    .join('\n')
                    .replace(/'(?:[^'\\]|\\.)*'/g, '?')
                    .replace(/\b\d+\b/g, '#');
                let rewrites = capability.rewrites[shape];
                if (rewrites === undefined) {
                    try {
                        const explain = await runTraceSQL(
                            selectdbDS,
                            [
                                { refId: 'explainTraceList', rawSql: `EXPLAIN ${listSQL}` },
                                { refId: 'explainTraceCount', rawSql: `EXPLAIN ${countSQL}` },
                            ],
                            { showBackendError: false },
                        );
                        const index = `${params.table}_summary`.toLowerCase();
                        rewrites = ['explainTraceList', 'explainTraceCount'].every(refId =>
                            traceRows(explain, refId).some(row => Object.values(row).some(value => String(value).toLowerCase().includes(`(${index})`))),
                        );
                    } catch {
                        rewrites = false;
                    }
                    capability = { ...capability, rewrites: { ...capability.rewrites, [shape]: rewrites } };
                }
                useSummary = rewrites;
            }
            options?.onCapability?.(capability);
        }
        const query = async (summary: boolean): Promise<TraceListResult> => {
            // A single HTTP request runs independent list/count targets together.
            const response = await runTraceSQL(
                selectdbDS,
                [
                    { refId: 'getTraces', rawSql: summary ? buildTraceSummaryListSQL(params) : buildTraceAggSQLFromParams(params) },
                    { refId: 'getTraceCount', rawSql: summary ? buildTraceSummaryCountSQL(params) : buildTraceCountSQLFromParams(params) },
                ],
                summary ? { showBackendError: false } : backendOptions,
            );
            let rows = traceRows(response, 'getTraces');
            const total = Number(traceRows(response, 'getTraceCount')[0]?.total || 0);
            if (summary && rows.length) {
                const supplementResponse = await runTraceSQL(
                    selectdbDS,
                    [
                        {
                            refId: 'traceSupplement',
                            rawSql: buildTraceSupplementSQL(
                                params,
                                rows.map(row => row.trace_id),
                            ),
                        },
                    ],
                    { showBackendError: false },
                );
                const supplements = new Map(traceRows(supplementResponse, 'traceSupplement').map(row => [row.trace_id, row]));
                rows = rows.map(row => {
                    const root = String(row.first_root || '').split('|');
                    const start = parseDorisTime(row.start_time);
                    const end = parseDorisTime(row.end_time);
                    return {
                        ...row,
                        time: start.valueOf() / 1000,
                        root_service: root[1] || '',
                        operation: root.slice(2).join('|'),
                        spans: Number(row.span_count),
                        error_spans: Number(row.error_count),
                        trace_duration_ms: end.diff(start, 'millisecond', true),
                        max_span_duration_ms: Number(row.max_span_duration) / 1000,
                        ...supplements.get(row.trace_id),
                    };
                });
            }
            return { rows, total };
        };
        if (useSummary) {
            try {
                return await query(true);
            } catch {
                // Schema/MV can change after detection. Retry once with the
                // compatible query and expose its real error if that fails too.
                options?.onCapability?.({ hasSummary: false, rewrites: {} });
            }
        }
        return query(false);
    });
}

// 查询Trace Services
export function getServiceListService(payload: any, options?: TraceServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const serviceListSQL = getServiceListSQL(rest);
    return withErrorHandler(
        getBackendSrv().fetch({
            url: '/api/ds/query',
            method: 'POST',
            data: {
                queries: [
                    {
                        refId: 'getServiceList',
                        datasource: {
                            type: selectdbDS.type,
                            uid: selectdbDS.uid,
                        },
                        rawSql: serviceListSQL,
                        format: 'table',
                    },
                ],
            },
            credentials: 'include',
        }),
        options,
    );
}

// 查询Trace Operations
export function getOperationListService(payload: any, options?: TraceServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const operationListSQL = getOperationListSQL(rest);
    return withErrorHandler(
        getBackendSrv().fetch({
            url: '/api/ds/query',
            method: 'POST',
            data: {
                queries: [
                    {
                        refId: 'getOperationList',
                        datasource: {
                            type: selectdbDS.type,
                            uid: selectdbDS.uid,
                        },
                        rawSql: operationListSQL,
                        format: 'table',
                    },
                ],
            },
            credentials: 'include',
        }),
        options,
    );
}
