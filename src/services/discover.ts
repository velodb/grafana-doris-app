import { getBackendSrv } from '@grafana/runtime';
import { getQueryTableChartsSQL, getQueryTableResultCountSQL, getQueryTableResultSQL, getSurroundingSQL } from './sql';
import { withErrorHandler } from 'components/with-error-handler/withErrorHandler';

type DiscoverServiceOptions = {
    showBackendError?: boolean;
    defaultMessage?: string;
};

export function getTableDataService(payload: any, options?: DiscoverServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableResultSQL = getQueryTableResultSQL(rest);
    const response = withErrorHandler(getBackendSrv().fetch({
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
    }), { ...options, generatedSql: QueryTableResultSQL });
    return response;
}

export function getTableDataChartsService(payload: any, options?: DiscoverServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableChartsSQL = getQueryTableChartsSQL(rest);
    const response = withErrorHandler(getBackendSrv().fetch({
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
    }), { ...options, generatedSql: QueryTableChartsSQL });
    return response;
}

export function getTopDataService(payload: any, options?: DiscoverServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableResultSQL = getQueryTableResultSQL(rest);
    const response = withErrorHandler(getBackendSrv().fetch({
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
    }), { ...options, generatedSql: QueryTableResultSQL });
    return response;
}

export function getTableDataCountService(payload: any, options?: DiscoverServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const QueryTableResultCountSQL = getQueryTableResultCountSQL(rest);
    const response = withErrorHandler(getBackendSrv().fetch({
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
    }), { ...options, generatedSql: QueryTableResultCountSQL });
    return response;
}


export function getSurroundingDataService(payload: any) {
    const { selectdbDS, ...rest } = payload;
    const surroundingSQL = getSurroundingSQL(rest);
    const response = withErrorHandler(getBackendSrv().fetch({
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
    }));
    return response;
}
