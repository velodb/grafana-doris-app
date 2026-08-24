import { useCallback, useEffect, useRef } from 'react';
import { Dayjs } from 'dayjs';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    currentCatalogAtom,
    currentDatabaseAtom,
    currentDateAtom,
    currentIndexAtom,
    currentTableAtom,
    currentTimeFieldAtom,
    dataFilterAtom,
    discoverQueryStateAtom,
    discoverSortAtom,
    discoverLoadingAtom,
    intervalAtom,
    pageAtom,
    pageSizeAtom,
    searchTypeAtom,
    searchValueAtom,
    selectedDatasourceAtom,
    tableDataAtom,
    tableDataChartsAtom,
    tableFieldsAtom,
    tableTotalCountAtom,
    tableTracesDataAtom,
    timeZoneAtom,
    topDataAtom,
} from 'store/discover';
import { getTableDataChartsService, getTableDataCountService, getTableDataService, getTopDataService } from 'services/discover';
import { getTableDataTraceService } from 'services/traces';
import {
    encodeBase64,
    getChartsData,
    convertColumnToRowViaFieldsType,
    generateHighlightedResults,
    formatTracesResData,
    getIndexesStatement,
} from 'utils/data';
import { generateTableDataUID } from 'utils/utils';
import { message } from 'antd';
import { getAutoInterval, IntervalEnum } from '../../constants';
import { toDataFrame } from '@grafana/data';
import { logError } from '@grafana/runtime';
import { useLuceneWhereClause } from './useLuceneWhereClause';
import { toError } from 'utils/errors';
import { formatTimeInZone } from 'utils/time';
import { createDiscoverQueryError } from 'utils/query-error';
import { DiscoverQuerySource, DiscoverSort } from 'types/discover';
import { resolveQuerySortField } from 'services/sql';

type RefreshOptions = {
    skipPageReset?: boolean;
};

export function useDiscoverData() {
    const didRunPageEffect = useRef(false);
    const didRunAutoRefreshEffect = useRef(false);
    const requestGenerationRef = useRef(0);
    const suppressNextPageEffectRef = useRef(false);
    const [page, setPage] = useAtom(pageAtom);
    const pageSize = useAtomValue(pageSizeAtom);
    const setTableData = useSetAtom(tableDataAtom);
    const setTableDataCharts = useSetAtom(tableDataChartsAtom);
    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const interval = useAtomValue(intervalAtom);
    const currentIndexes = useAtomValue(currentIndexAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const searchType = useAtomValue(searchTypeAtom);
    const dataFilter = useAtomValue(dataFilterAtom);
    const searchValue = useAtomValue(searchValueAtom);
    const setTopData = useSetAtom(topDataAtom);
    const currentTable = useAtomValue(currentTableAtom);
    const currentCatalog = useAtomValue(currentCatalogAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const currentDate = useAtomValue(currentDateAtom);
    const timeZone = useAtomValue(timeZoneAtom);
    const setTableTotalCount = useSetAtom(tableTotalCountAtom);
    const setTraceData = useSetAtom(tableTracesDataAtom);
    const [loading, setLoading] = useAtom(discoverLoadingAtom);
    const [sort, setSort] = useAtom(discoverSortAtom);
    const [queryState, setQueryState] = useAtom(discoverQueryStateAtom);
    const buildLuceneWhereClause = useLuceneWhereClause();
    const sortContextKey = `${selectdbDS?.uid || ''}\u0000${currentDatabase}\u0000${currentTable}\u0000${currentTimeField}`;
    const sortContextRef = useRef(sortContextKey);
    const formatCurrentTime = useCallback(
        (time?: Dayjs) => {
            return time ? formatTimeInZone(time, timeZone) : undefined;
        },
        [timeZone],
    );

    const beginQuery = useCallback(() => {
        const requestId = requestGenerationRef.current + 1;
        requestGenerationRef.current = requestId;
        setQueryState({ status: 'loading', rowCount: 0, auxiliaryErrors: [] });
        return requestId;
    }, [setQueryState]);

    const addAuxiliaryError = useCallback((requestId: number, source: DiscoverQuerySource, error: any) => {
        if (requestGenerationRef.current !== requestId) {
            return;
        }
        const queryError = createDiscoverQueryError(error, { source, searchType, searchValue });
        setQueryState(previous => ({
            ...previous,
            auxiliaryErrors: [
                ...previous.auxiliaryErrors.filter(item => item.source !== source),
                queryError,
            ],
        }));
    }, [searchType, searchValue, setQueryState]);

    const getTableData = useCallback(async (options?: { requestId?: number; nextPage?: number; nextSort?: DiscoverSort }) => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        const requestId = options?.requestId ?? beginQuery();
        const nextPage = options?.nextPage ?? page;
        const requestedSort = options?.nextSort ?? (
            sortContextRef.current === sortContextKey
                ? sort
                : { field: currentTimeField, direction: 'DESC' as const }
        );
        const availableFields = tableFields.map((field: any) => String(field?.Field || field?.value || ''));
        const sortField = resolveQuerySortField(requestedSort.field, currentTimeField, availableFields);
        setLoading(prev => ({ ...prev, getTableData: true }));
        const indexesStatement = getIndexesStatement(currentIndexes, tableFields, searchValue);
        const payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: formatCurrentTime(currentDate[0]),
            endDate: formatCurrentTime(currentDate[1] as Dayjs),
            cluster: '',
            sort: requestedSort.direction,
            sortField,
            search_type: searchType,
            indexes: '',
            page: nextPage,
            page_size: pageSize,
        };

        if (searchType === 'Search') {
            payload.indexes_statement = indexesStatement;
        }
        payload.data_filters = dataFilter.length > 0 ? dataFilter : [];

        if (searchType === 'Lucene') {
            try {
                const luceneWhere = await buildLuceneWhereClause();
                if (luceneWhere) {
                    payload.lucene_where = luceneWhere;
                }
            } catch (error) {
                setLoading(prev => ({ ...prev, getTableData: false }));
                setTableData([]);
                if (requestGenerationRef.current === requestId) {
                    setQueryState({
                        status: 'error',
                        rowCount: 0,
                        error: createDiscoverQueryError(error, { source: 'lucene', searchType, searchValue }),
                        auxiliaryErrors: [],
                    });
                }
                logError(toError(error), { source: 'useDiscoverData', action: 'buildLuceneWhereClause' });
                return;
            }
        }

        if (searchValue && searchType !== 'Lucene') {
            payload.search_value = searchType === 'Search' ? encodeBase64(searchValue) : searchValue;
        }

        getTableDataService({
            selectdbDS,
            ...payload,
        }, { showBackendError: false }).subscribe({
            next: async ({ data }: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                setLoading(prev => ({ ...prev, getTableData: false }));
                const frames = data?.results?.getTableData?.frames;
                if (!frames || !frames[0]) {
                    setTableData([]);
                    setQueryState(previous => ({
                        ...previous,
                        status: 'success',
                        rowCount: 0,
                        error: undefined,
                    }));
                    return;
                }
                const rowsData = convertColumnToRowViaFieldsType(frames[0], tableFields);
                const resData = generateHighlightedResults(
                    {
                        search_value: searchValue,
                        indexes: currentIndexes || [],
                    },
                    rowsData,
                );

                const rowsDataWithUid = await generateTableDataUID(resData);
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                setTableData(rowsDataWithUid);
                setQueryState(previous => ({
                    ...previous,
                    status: 'success',
                    rowCount: rowsDataWithUid.length,
                    error: undefined,
                }));
            },
            error: (err: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                setLoading(prev => ({ ...prev, getTableData: false }));
                setTableData([]);
                setQueryState(previous => ({
                    status: 'error',
                    rowCount: 0,
                    error: createDiscoverQueryError(err, { source: 'results', searchType, searchValue }),
                    auxiliaryErrors: previous.auxiliaryErrors,
                }));
                logError(toError(err), { source: 'useDiscoverData', action: 'getTableData' });
            },
        });
    }, [
        buildLuceneWhereClause,
        beginQuery,
        currentCatalog,
        currentDate,
        currentDatabase,
        currentIndexes,
        currentTable,
        currentTimeField,
        dataFilter,
        page,
        pageSize,
        searchType,
        searchValue,
        selectdbDS,
        formatCurrentTime,
        setLoading,
        setQueryState,
        setTableData,
        sort,
        sortContextKey,
        tableFields,
    ]);

    const getTableDataCharts = useCallback(async (requestId: number) => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        setLoading(prev => ({ ...prev, getTableDataCharts: true }));
        const autoInterval = getAutoInterval(currentDate as any);
        const timeInterval = interval === IntervalEnum.Auto ? autoInterval.interval_unit : interval;
        const timeIntervalValue = interval === IntervalEnum.Auto ? autoInterval.interval_value : 1;
        const indexesStatement = getIndexesStatement(currentIndexes, tableFields, searchValue);
        const payload: any = {
            catalog: 'internal',
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: formatCurrentTime(currentDate[0]),
            endDate: formatCurrentTime(currentDate[1] as Dayjs),
            cluster: '',
            data_filters: [],
            sort: 'DESC',
            interval: timeInterval,
            interval_value: timeIntervalValue,
            search_type: searchType,
            indexes: indexesStatement,
        };

        if (dataFilter.length > 0) {
            payload.data_filters = dataFilter;
        }

        if (searchType === 'Lucene') {
            try {
                const luceneWhere = await buildLuceneWhereClause();
                if (luceneWhere) {
                    payload.lucene_where = luceneWhere;
                }
            } catch (error) {
                setLoading(prev => ({ ...prev, getTableDataCharts: false }));
                setTableDataCharts([]);
                logError(toError(error), { source: 'useDiscoverData', action: 'buildLuceneWhereClause' });
                return;
            }
        }

        if (searchValue && searchType !== 'Lucene') {
            payload.search_value = searchType === 'Search' ? encodeBase64(searchValue) : searchValue;
        }

        getTableDataChartsService({
            selectdbDS,
            ...payload,
        }, { showBackendError: false }).subscribe({
            next: ({ data }: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                setLoading(prev => ({ ...prev, getTableDataCharts: false }));
                const frameData = data?.results?.getTableDataCharts?.frames?.[0];
                const frame = frameData ? toDataFrame(frameData) : undefined;
                const times = Array.from(frame?.fields[0]?.values || []);
                const values = Array.from(frame?.fields[1]?.values || []);
                if (!times.length || !values.length) {
                    setTableDataCharts([]);
                    return;
                }
                const tableDataCharts = times.map((item: any, index: number) => ({
                    TT: item,
                    'sum(cnt)': values[index],
                }));
                const chartsData = getChartsData(tableDataCharts, currentDate as [Dayjs, Dayjs]);
                setTableDataCharts(chartsData);
            },
            error: (err: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                setLoading(prev => ({ ...prev, getTableDataCharts: false }));
                setTableDataCharts([]);
                addAuxiliaryError(requestId, 'histogram', err);
                logError(toError(err), { source: 'useDiscoverData', action: 'getTableDataCharts' });
            },
        });
    }, [
        buildLuceneWhereClause,
        addAuxiliaryError,
        currentDate,
        currentDatabase,
        currentIndexes,
        currentTable,
        currentTimeField,
        dataFilter,
        interval,
        searchType,
        searchValue,
        selectdbDS,
        formatCurrentTime,
        setLoading,
        setTableDataCharts,
        tableFields,
    ]);

    const getTopData = useCallback(async (requestId: number, nextPage = 1) => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        const indexesStatement = getIndexesStatement(currentIndexes, tableFields, searchValue);
        const payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: formatCurrentTime(currentDate[0]),
            endDate: formatCurrentTime(currentDate[1] as Dayjs),
            cluster: '',
            sort: 'DESC',
            search_type: searchType,
            indexes: '',
            page: nextPage,
            page_size: 500,
        };

        if (searchType === 'Search') {
            payload.indexes_statement = indexesStatement;
        }
        payload.data_filters = dataFilter.length > 0 ? dataFilter : [];

        if (searchValue && searchType !== 'Lucene') {
            payload.search_value = searchType === 'Search' ? encodeBase64(searchValue) : searchValue;
        }

        if (searchType === 'Lucene') {
            try {
                const luceneWhere = await buildLuceneWhereClause();
                if (luceneWhere) {
                    payload.lucene_where = luceneWhere;
                }
            } catch (error) {
                logError(toError(error), { source: 'useDiscoverData', action: 'buildLuceneWhereClause' });
                setTopData([]);
                return;
            }
        }

        getTopDataService({
            selectdbDS,
            ...payload,
        }, { showBackendError: false }).subscribe({
            next: ({ data }: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                const frames = data?.results?.getTableTopData?.frames;
                if (!frames || !frames[0]) {
                    setTopData([]);
                    return;
                }
                const rowsData = convertColumnToRowViaFieldsType(frames[0], tableFields);
                setTopData(rowsData);
            },
            error: (err: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                logError(toError(err), { source: 'useDiscoverData', action: 'getTopData' });
                setTopData([]);
                addAuxiliaryError(requestId, 'topData', err);
            },
        });
    }, [
        buildLuceneWhereClause,
        addAuxiliaryError,
        currentCatalog,
        currentDate,
        currentDatabase,
        currentIndexes,
        currentTable,
        currentTimeField,
        dataFilter,
        searchType,
        searchValue,
        selectdbDS,
        formatCurrentTime,
        setTopData,
        tableFields,
    ]);

    const getTableDataCount = useCallback(async (requestId: number) => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        const autoInterval = getAutoInterval(currentDate as any);
        const timeInterval = interval === IntervalEnum.Auto ? autoInterval.interval_unit : interval;
        const timeIntervalValue = interval === IntervalEnum.Auto ? autoInterval.interval_value : 1;
        const indexesStatement = getIndexesStatement(currentIndexes, tableFields, searchValue);
        const payload: any = {
            catalog: 'internal',
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: formatCurrentTime(currentDate[0]),
            endDate: formatCurrentTime(currentDate[1] as Dayjs),
            cluster: '',
            sort: 'DESC',
            interval: timeInterval,
            data_filters: [],
            interval_value: timeIntervalValue,
            search_type: searchType,
            indexes: indexesStatement,
        };

        if (dataFilter.length > 0) {
            payload.data_filters = dataFilter;
        }

        if (searchType === 'Lucene') {
            try {
                const luceneWhere = await buildLuceneWhereClause();
                if (luceneWhere) {
                    payload.lucene_where = luceneWhere;
                }
            } catch (error) {
                logError(toError(error), { source: 'useDiscoverData', action: 'buildLuceneWhereClause' });
                setTableTotalCount(0);
                return;
            }
        }

        if (searchValue && searchType !== 'Lucene') {
            payload.search_value = searchType === 'Search' ? encodeBase64(searchValue) : searchValue;
        }

        getTableDataCountService({
            selectdbDS,
            ...payload,
        }, { showBackendError: false }).subscribe({
            next: ({ data }: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                setLoading(prev => ({ ...prev, getTableDataCount: false }));
                const frameData = data?.results?.getTableCountData?.frames?.[0];
                const frame = frameData ? toDataFrame(frameData) : undefined;
                const totalCount = frame?.fields[0]?.values[0] as number;
                if (!totalCount) {
                    setTableTotalCount(0);
                    return;
                }
                setTableTotalCount(totalCount);
            },
            error: (err: any) => {
                if (requestGenerationRef.current !== requestId) {
                    return;
                }
                setTableTotalCount(0);
                addAuxiliaryError(requestId, 'count', err);
                logError(toError(err), { source: 'useDiscoverData', action: 'getTableDataCount' });
            },
        });
    }, [
        buildLuceneWhereClause,
        addAuxiliaryError,
        currentDate,
        currentDatabase,
        currentIndexes,
        currentTable,
        currentTimeField,
        dataFilter,
        interval,
        searchType,
        searchValue,
        selectdbDS,
        formatCurrentTime,
        setLoading,
        setTableTotalCount,
        tableFields,
    ]);

    const getTraceData = useCallback(
        (trace_id: string, table?: string, callback?: Function) => {
            const indexesStatement = getIndexesStatement(currentIndexes, tableFields, searchValue);
            const payload: any = {
                catalog: currentCatalog,
                database: currentDatabase,
                table: table || currentTable || 'otel_traces',
                timeField: currentTimeField,
                startDate: formatCurrentTime(currentDate[0]),
                endDate: formatCurrentTime(currentDate[1] as Dayjs),
                cluster: '',
                sort: 'DESC',
                search_type: searchType,
                indexes: '',
                page: page,
                page_size: pageSize,
                trace_id,
            };
            if (searchType === 'Search') {
                payload.indexes_statement = indexesStatement;
            }

            payload.data_filters = dataFilter.length > 0 ? dataFilter : [];

            if (searchValue) {
                payload.search_value = encodeBase64(searchValue);
            }

            getTableDataTraceService({
                selectdbDS,
                ...payload,
            }).subscribe({
                next: ({ data, ok }: any) => {
                    callback && callback(data.results.getTableDataTrace.status)
                    if (!ok) {
                        message.error('Failed to request trace');
                        return;
                    }
                    const formattedData = formatTracesResData(data.results.getTableDataTrace.frames[0]);
                    setTraceData(formattedData);
                },
                error: (err: any) => {
                    // Clear trace data on error
                    setTraceData([]);
                    logError(toError(err), { source: 'useDiscoverData', action: 'getTraceData' });
                    callback && callback(err.status)
                    message.error('Failed to request trace');
                    setTraceData(null);
                },
            });
        },
        [
            currentCatalog,
            currentDate,
            currentDatabase,
            currentIndexes,
            currentTable,
            currentTimeField,
            dataFilter,
            page,
            pageSize,
            searchType,
            searchValue,
            selectdbDS,
            formatCurrentTime,
            setTraceData,
            tableFields,
        ],
    );

    const clearData = useCallback(() => {
        requestGenerationRef.current += 1;
        setTableDataCharts([]);
        setTableTotalCount(0);
        setTableData([]);
        setTopData([]);
        setQueryState({ status: 'idle', rowCount: 0, auxiliaryErrors: [] });
    }, [setQueryState, setTableData, setTableDataCharts, setTableTotalCount, setTopData]);

    const refreshData = useCallback(
        ({ skipPageReset = false }: RefreshOptions = {}) => {
            if (!selectdbDS || !currentDatabase || !currentTable || !currentTimeField) {
                clearData();
                return;
            }
            const nextPage = skipPageReset ? page : 1;
            if (!skipPageReset && page !== 1) {
                suppressNextPageEffectRef.current = true;
                setPage(1);
            }
            const requestId = beginQuery();
            void getTableDataCharts(requestId);
            void getTableDataCount(requestId);
            void getTableData({ requestId, nextPage });
            void getTopData(requestId, nextPage);
        },
        [
            beginQuery,
            clearData,
            currentDatabase,
            currentTable,
            currentTimeField,
            getTableData,
            getTableDataCharts,
            getTableDataCount,
            getTopData,
            page,
            selectdbDS,
            setPage,
        ],
    );

    const handleQuerying = useCallback(() => {
        if (!currentTimeField) {
            clearData();
            return;
        }
        refreshData();
    }, [clearData, currentTimeField, refreshData]);

    const handleSortChange = useCallback((nextSort: DiscoverSort) => {
        if (!currentTimeField) {
            return;
        }
        setSort(nextSort);
        if (page !== 1) {
            suppressNextPageEffectRef.current = true;
            setPage(1);
        }
        const requestId = beginQuery();
        void getTableData({ requestId, nextPage: 1, nextSort });
    }, [beginQuery, currentTimeField, getTableData, page, setPage, setSort]);

    useEffect(() => {
        sortContextRef.current = sortContextKey;
        setSort({ field: currentTimeField, direction: 'DESC' });
    }, [currentTimeField, setSort, sortContextKey]);

    useEffect(() => {
        if (!didRunPageEffect.current) {
            didRunPageEffect.current = true;
            return;
        }
        if (!currentTimeField) {
            return;
        }
        if (suppressNextPageEffectRef.current) {
            suppressNextPageEffectRef.current = false;
            return;
        }
        void getTableData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page]);

    useEffect(() => {
        if (!didRunAutoRefreshEffect.current) {
            didRunAutoRefreshEffect.current = true;
            return;
        }
        refreshData({ skipPageReset: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDate, currentDatabase, currentTable, currentTimeField, dataFilter, interval, selectdbDS]);

    return {
        loading,
        queryState,
        sort,
        onSortChange: handleSortChange,
        onQuerying: handleQuerying,
        getTraceData,
    };
}
