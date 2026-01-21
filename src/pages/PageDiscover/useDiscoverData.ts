import { useCallback, useEffect } from 'react';
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
    topDataAtom,
} from 'store/discover';
import { getTableDataChartsService, getTableDataCountService, getTableDataService, getTopDataService } from 'services/discover';
import { getTableDataTraceService } from 'services/traces';
import {
    encodeBase64,
    getChartsData,
    convertColumnToRow,
    convertColumnToRowViaFieldsType,
    generateHighlightedResults,
    formatTracesResData,
    getIndexesStatement,
} from 'utils/data';
import { generateTableDataUID } from 'utils/utils';
import { message } from 'antd';
import { FORMAT_DATE, getAutoInterval, IntervalEnum } from '../../constants';
import { toDataFrame } from '@grafana/data';
import { useLuceneWhereClause } from './useLuceneWhereClause';

type RefreshOptions = {
    skipPageReset?: boolean;
};

export function useDiscoverData() {
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
    const setTableTotalCount = useSetAtom(tableTotalCountAtom);
    const setTraceData = useSetAtom(tableTracesDataAtom);
    const [loading, setLoading] = useAtom(discoverLoadingAtom);
    const buildLuceneWhereClause = useLuceneWhereClause();

    const getTableData = useCallback(async () => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        setLoading(prev => ({ ...prev, getTableData: true }));
        const indexesStatement = getIndexesStatement(currentIndexes, tableFields, searchValue);
        const payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0]?.format(FORMAT_DATE),
            endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
            cluster: '',
            sort: 'DESC',
            search_type: searchType,
            indexes: '',
            page: page,
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
                console.error('Lucene query build failed', error);
                return;
            }
        }

        if (searchValue && searchType !== 'Lucene') {
            payload.search_value = searchType === 'Search' ? encodeBase64(searchValue) : searchValue;
        }

        getTableDataService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: async ({ data, ok }: any) => {
                setLoading(prev => ({ ...prev, getTableData: false }));
                if (!ok) {
                    return;
                }
                const frames = data?.results?.getTableData?.frames;
                if (!frames || !frames[0]) {
                    setTableData([]);
                    return;
                }
                const rowsData = convertColumnToRow(frames[0]);
                const resData = generateHighlightedResults(
                    {
                        search_value: searchValue,
                        indexes: currentIndexes || [],
                    },
                    rowsData,
                );

                const rowsDataWithUid = await generateTableDataUID(resData);
                setTableData(rowsDataWithUid);
            },
            error: (err: any) => {
                setLoading(prev => ({ ...prev, getTableData: false }));
                console.log('Fetch Error', err);
            },
        });
    }, [
        buildLuceneWhereClause,
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
        setLoading,
        setTableData,
        tableFields,
    ]);

    const getTableDataCharts = useCallback(async () => {
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
            startDate: currentDate[0]?.format(FORMAT_DATE),
            endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
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
                console.error('Lucene query build failed', error);
                return;
            }
        }

        if (searchValue && searchType !== 'Lucene') {
            payload.search_value = searchType === 'Search' ? encodeBase64(searchValue) : searchValue;
        }

        getTableDataChartsService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(prev => ({ ...prev, getTableDataCharts: false }));
                if (!ok) {
                    return;
                }
                const frame = toDataFrame(data.results.getTableDataCharts.frames[0]);
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
                setLoading(prev => ({ ...prev, getTableDataCharts: false }));
                console.log('Fetch Error', err);
            },
        });
    }, [
        buildLuceneWhereClause,
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
        setLoading,
        setTableDataCharts,
        tableFields,
    ]);

    const getTopData = useCallback(async () => {
        if (!currentTable || !currentDatabase || !selectdbDS) {
            return;
        }
        const indexesStatement = getIndexesStatement(currentIndexes, tableFields, searchValue);
        const payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: currentTable,
            timeField: currentTimeField,
            startDate: currentDate[0]?.format(FORMAT_DATE),
            endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
            cluster: '',
            sort: 'DESC',
            search_type: searchType,
            indexes: '',
            page: page,
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
                console.error('Lucene query build failed', error);
                setTopData([]);
                return;
            }
        }

        getTopDataService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (!ok) {
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
                console.log('Fetch Error', err);
                setTopData([]);
            },
        });
    }, [
        buildLuceneWhereClause,
        currentCatalog,
        currentDate,
        currentDatabase,
        currentIndexes,
        currentTable,
        currentTimeField,
        dataFilter,
        page,
        searchType,
        searchValue,
        selectdbDS,
        setTopData,
        tableFields,
    ]);

    const getTableDataCount = useCallback(async () => {
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
            startDate: currentDate[0]?.format(FORMAT_DATE),
            endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
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
                console.error('Lucene query build failed', error);
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
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (!ok) {
                    return;
                }
                const frame = toDataFrame(data.results.getTableCountData.frames[0]);
                const totalCount = frame.fields[0]?.values[0] as number;
                if (!totalCount) {
                    setTableTotalCount(0);
                    return;
                }
                setTableTotalCount(totalCount);
            },
            error: (err: any) => {
                console.log('Fetch Error', err);
            },
        });
    }, [
        buildLuceneWhereClause,
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
                startDate: currentDate[0]?.format(FORMAT_DATE),
                endDate: (currentDate[1] as Dayjs).format(FORMAT_DATE),
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
                    console.log('Fetch Error', err);
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
            setTraceData,
            tableFields,
        ],
    );

    const clearData = useCallback(() => {
        setTableDataCharts([]);
        setTableTotalCount(0);
        setTableData([]);
        setTopData([]);
    }, [setTableData, setTableDataCharts, setTableTotalCount, setTopData]);

    const refreshData = useCallback(
        ({ skipPageReset = false }: RefreshOptions = {}) => {
            if (!skipPageReset) {
                setPage(1);
            }
            if (!currentTimeField) {
                clearData();
                return;
            }
            void getTableDataCharts();
            void getTableDataCount();
            void getTableData();
            void getTopData();
        },
        [
            clearData,
            currentTimeField,
            getTableData,
            getTableDataCharts,
            getTableDataCount,
            getTopData,
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

    useEffect(() => {
        if (!currentTimeField) {
            return;
        }
        void getTableData();
        void getTopData();
        void getTableDataCharts();
        void getTableDataCount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTimeField, page]);

    useEffect(() => {
        refreshData({ skipPageReset: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDate, currentTimeField, dataFilter, interval]);

    return {
        loading,
        onQuerying: handleQuerying,
        getTraceData,
    };
}
