import { t } from 'i18n';
import { defer, lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { getFieldStatisticsSummarySQL, getFieldStatisticsTopValuesSQL, getQueryTableChartsSQL, getQueryTableResultCountSQL, getQueryTableResultSQL, getSurroundingSQL, getTopNQuerySQL } from './sql';
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
                        type: selectdbDS.type,
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

export function getTopNDataService(payload: any, fields: Array<{ Field: string; Type?: string }>, options?: DiscoverServiceOptions) {
    const { selectdbDS, ...rest } = payload;
    const sql = getTopNQuerySQL(rest, fields);
    return withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query', method: 'POST',
        data: { queries: [{ refId: 'getTopNData', datasource: { type: selectdbDS.type, uid: selectdbDS.uid }, rawSql: sql, format: 'table' }] },
        credentials: 'include',
    }), { ...options, generatedSql: sql });
}

export function getFieldStatisticsService(payload: any, options?: DiscoverServiceOptions) {
    const { selectdbDS, ...params } = payload;
    const summarySql = getFieldStatisticsSummarySQL(params);
    const topValuesSql = getFieldStatisticsTopValuesSQL(params);
    return withErrorHandler(getBackendSrv().fetch({
        url: '/api/ds/query', method: 'POST',
        data: { queries: [
            { refId: 'getFieldStatisticsSummary', datasource: { type: selectdbDS.type, uid: selectdbDS.uid }, rawSql: summarySql, format: 'table' },
            { refId: 'getFieldStatisticsTopValues', datasource: { type: selectdbDS.type, uid: selectdbDS.uid }, rawSql: topValuesSql, format: 'table' },
        ] },
        credentials: 'include',
    }), { ...options, generatedSql: summarySql });
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
                        type: selectdbDS.type,
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
                        type: selectdbDS.type,
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
                        type: selectdbDS.type,
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
                        type: selectdbDS.type,
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

/** Each wider query replaces the preceding result; the anchor never moves. */
export function getSurroundingDataWithWindow(payload: any) {
    return defer(async () => {
        let response: any;
        for (const windowHours of [1, 6, 24]) {
            response = await lastValueFrom(getSurroundingDataService({ ...payload, windowHours }));
            const result = response?.data?.results?.getSurroundingData;
            if (!response?.ok || result?.error || result?.status >= 400) {
                throw new Error(result?.error || t('Surrounding logs query failed'));
            }
            const count = result?.frames?.reduce((total: number, frame: any) => total + (frame.data?.values?.[0]?.length || 0), 0) || 0;
            if (count >= Number(payload.pageSize)) {
                break;
            }
        }
        return response;
    });
}
