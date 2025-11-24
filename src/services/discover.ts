import { getBackendSrv } from '@grafana/runtime';
import { getQueryTableChartsSQL, getQueryTableResultCountSQL, getQueryTableResultSQL, getSurroundingSQL } from './sql';

export function getTableDataService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableResultSQL = getQueryTableResultSQL(rest);
    const response = getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getTableData',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: QueryTableResultSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
    return response;
}

export function getTableDataChartsService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableChartsSQL = getQueryTableChartsSQL(rest);
    const response = getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getTableDataCharts',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: QueryTableChartsSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
    return response;
}

export function getTopDataService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableResultSQL = getQueryTableResultSQL(rest);
    const response = getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getTableTopData',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: QueryTableResultSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
    return response;
}

export function getTableDataCountService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableResultCountSQL = getQueryTableResultCountSQL(rest);
    const response = getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getTableCountData',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: QueryTableResultCountSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
    return response;
}


export function getSurroundingDataService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const surroundingSQL = getSurroundingSQL(rest);
    const response = getBackendSrv().fetch({
        url: '/api/ds/query',
        method: 'POST',
        data: {
            queries: [
                {
                    refId: 'getSurroundingData',
                    datasource: {
                        type: 'mysql',
                        uid: selectdbDS.uid,
                    },
                    rawSql: surroundingSQL,
                    format: 'table',
                },
            ],
        },
        credentials: 'include',
    });
    return response;
}

