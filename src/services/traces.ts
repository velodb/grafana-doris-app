import { getBackendSrv } from "@grafana/runtime";
import { buildTraceAggSQLFromParams, getOperationListSQL, getQueryTableTraceSQL, getServiceListSQL } from "./traces.sql";

// 获取table的Trace数据
export function getTableDataTraceService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const traceSQL = getQueryTableTraceSQL(rest);
    return getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getTableDataTrace',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: traceSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
}

// 查询Traces
export function getTracesService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const getTracesSQL = buildTraceAggSQLFromParams(rest);
    return getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getTraces',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: getTracesSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
}

// 查询Trace Services
export function getServiceListService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const serviceListSQL = getServiceListSQL(rest);
    return getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getServiceList',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: serviceListSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
}

// 查询Trace Operations
export function getOperationListService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const operationListSQL = getOperationListSQL(rest);
    return getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getOperationList',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: operationListSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
}



