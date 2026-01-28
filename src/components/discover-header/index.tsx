'use client';
import React, { PropsWithChildren, useEffect } from 'react';
import dayjs from 'dayjs';
import { DiscoverHeaderSearch } from './discover-header.style';
import SearchType from './search-type';
import SQLSearch from './sql-search';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { DataSourcePicker } from '@grafana/runtime';
import { css } from '@emotion/css';
import {
    indexesAtom,
    searchTypeAtom,
    discoverCurrentAtom,
    locationAtom,
    // currentClusterAtom,
    tableFieldsAtom,
    timeFieldsAtom,
    currentDateAtom,
    currentTimeFieldAtom,
    currentIndexAtom,
    searchFocusAtom,
    activeShortcutAtom,
    datasourcesAtom,
    selectedDatasourceAtom,
    timeRangeAtom,
    databasesAtom,
    tablesAtom,
    currentTableAtom,
} from 'store/discover';
import { getLatestTime, isValidTimeFieldType } from 'utils/data';
import { Select, Field, Button, useTheme2, TimeRangeInput } from '@grafana/ui';
import { FORMAT_DATE } from '../../constants';
import { getDatabases, getFieldsService, getIndexesService, getTablesService } from 'services/metaservice';
import { Subscription } from 'rxjs';
import { toDataFrame } from '@grafana/data';
import Lucene from './lucene';

export default function DiscoverHeader(
    props: PropsWithChildren & {
        onQuerying: () => void;
        loading: boolean;
    },
) {
    // const catalog = 'internal';
    // const catalogs = useAtomValue(catalogAtom);
    const setIndexes = useSetAtom(indexesAtom);
    // const setSearchType = useSetAtom(searchTypeAtom);
    const [discoverCurrent, setDiscoverCurrent] = useAtom(discoverCurrentAtom);
    if (process.env.NODE_ENV !== 'production') {
        discoverCurrentAtom.debugLabel = 'current';
    }
    const [_loc, setLoc] = useAtom(locationAtom);
    // const [currentCluster, setCurrentCluster] = useAtom(currentClusterAtom);
    const setTableFields = useSetAtom(tableFieldsAtom);
    const [timeFields, setTimeFields] = useAtom(timeFieldsAtom);
    const [_currentDate, setCurrentDate] = useAtom(currentDateAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const [, setCurrentIndex] = useAtom(currentIndexAtom);
    const searchFocus = useAtomValue(searchFocusAtom);
    // const { databaseList } = useDatabaseList();
    const [activeItem, _setActiveItem] = useAtom(activeShortcutAtom);
    // const [clusters, setClusters] = useState<any[]>([]);
    // const database = loc.searchParams?.get('database');
    // const table = loc.searchParams?.get('table');
    // const cluster = loc.searchParams?.get('cluster');
    // const startTime = loc.searchParams?.get('startTime');
    // const endTime = loc.searchParams?.get('endTime');
    const [selectedDatasource, setSelectedDatasource] = useAtom(selectedDatasourceAtom);
    const [timeRange, setTimeRange] = useAtom(timeRangeAtom);
    const [currentTable, setCurrentTable] = useAtom(currentTableAtom);
    const [databases, setDatabases] = useAtom(databasesAtom);
    const [tables, setTables] = useAtom(tablesAtom);
    const [_datasources] = useAtom(datasourcesAtom);
    const searchType = useAtomValue(searchTypeAtom);
    const searchMode = searchType === 'Search';

    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const theme = useTheme2();

    const fetchDatabases = React.useCallback((ds: any) => {
        if (!ds) {
            return undefined;
        }

        return getDatabases(ds).subscribe({
            next: (resp: any) => {
                const { data, ok } = resp;
                if (ok) {
                    const frame = toDataFrame(data.results.getDatabases.frames[0]);
                    const values = Array.from(frame.fields[0].values);
                    const options = values.map((item: string) => ({ label: item, value: item }));
                    setDatabases(options);
                }
            },
            error: (err: any) => console.log('Fetch Error', err),
        });
    }, [setDatabases]);

    useEffect(() => {
        if (!selectdbDS) {
            return;
        }

        const subscription: Subscription | undefined = fetchDatabases(selectdbDS);

        return () => subscription?.unsubscribe();
    }, [selectdbDS, fetchDatabases]);

    function getFields(selectedTable: any) {
        getFieldsService({
            selectdbDS,
            database: discoverCurrent.database,
            table: selectedTable.value,
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (ok) {
                    const frame = toDataFrame(data.results.getFields.frames[0]);
                    console.log('frame', frame);
                    const values = Array.from(frame.fields[0].values);
                    const fieldTypes = Array.from(frame.fields[1].values);

                    const tableFields = values.map((item: any, index: number) => {
                        return {
                            label: item,
                            Field: item,
                            value: item,
                            Type: fieldTypes[index],
                        };
                    });

                    setTableFields(tableFields);

                    if (values) {
                        const options = values
                            .filter((field: any, index: number) => {
                                return isValidTimeFieldType(fieldTypes[index].toUpperCase());
                            })
                            .map((item: any) => {
                                return {
                                    label: item,
                                    value: item,
                                };
                            });
                            console.log('bbb,',discoverCurrent);
                            
                        setDiscoverCurrent({
                            ...discoverCurrent,
                            table: selectedTable.value,
                            timeField: options[0]?.value || '',
                        });
                        setTimeFields(options);
                    }
                }
            },
            error: (err: any) => {
                console.log('Fetch Error', err);
            },
        });
    }

    function getIndexes(selectedTable: any) {
        getIndexesService({
            selectdbDS,
            database: discoverCurrent.database,
            table: selectedTable.value,
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (ok) {
                    const frame = toDataFrame(data.results.getIndexes.frames[0]);
                    const values = Array.from(frame.fields[2].values);
                    const columnNames = Array.from(frame.fields[4].values);
                    const indexesTypes = Array.from(frame.fields[10].values);

                    if (!values || values.length === 0) {
                        setIndexes([]);
                        setCurrentIndex([]);
                        return;
                    }

                    const tableIndexes = values?.map((item: any, index: number) => {
                        return {
                            label: item,
                            value: item,
                            type: indexesTypes[index],
                            columnName: columnNames[index],
                        };
                    });

                    setIndexes(tableIndexes);

                    if (tableIndexes) {
                        setCurrentIndex(tableIndexes);
                    }
                }
            },
            error: (err: any) => {
                console.log('Fetch Error', err);
            },
        });
    }

    return (
        <div
            className={css`
                padding: 1rem;
                padding-top: 1.5rem;
                background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                display: flex;
                border-radius: 0.25rem 0.25rem 0 0;
            `}
        >
            <DiscoverHeaderSearch className="h-8 rounded border border-solid border-n9 dark:border-n7">
                <Field label="Datasource">
                    {/* filter 这个版本无效 */}
                    <DataSourcePicker
                         width={20}
                         type={'mysql'}
                         current={selectedDatasource}
                         placeholder="Choose"
                         noDefault
                         filter={ds => ds.type === 'mysql'}
                         onChange={item => {
                             console.log('item', item);
                             setSelectedDatasource(item);
                             // Always fetch databases even if the same datasource is selected
                             fetchDatabases(item);
                         }}
                     />
                 </Field>
                {/* 需要从数据源中获取库表信息 */}
                <Field label="Database" style={{ marginLeft: 8 }}>
                    <Select
                        width={15}
                        options={databases}
                        value={discoverCurrent.database}
                        onChange={(selectedDatabase: any) => {
                            setDiscoverCurrent({
                                ...discoverCurrent,
                                database: selectedDatabase.value,
                            });
                            getTablesService({
                                selectdbDS,
                                database: selectedDatabase.value,
                            }).subscribe({
                                next: (resp: any) => {
                                    const { data, ok } = resp;
                                    if (ok) {
                                        const frame = toDataFrame(data.results.getTables.frames[0]);
                                        const values = Array.from(frame.fields[0].values);
                                        const options = values.map((item: string) => ({ label: item, value: item }));
                                        setTables(options);
                                    }
                                },
                                error: (err: any) => console.log('Fetch Error', err),
                            });
                        }}
                    ></Select>
                </Field>

                <Field label="Table" style={{ marginLeft: 8 }}>
                    <Select
                        options={tables}
                        width={15}
                        value={currentTable}
                        onChange={(selectedTable: any) => {
                            console.log('selectedTable.value',selectedTable.value);
                            
                            setDiscoverCurrent({
                                ...discoverCurrent,
                                table: selectedTable.value,
                            });
                            setCurrentTable(selectedTable.value);
                            getFields(selectedTable);
                            getIndexes(selectedTable);
                        }}
                    />
                </Field>
                <Field label="Mode" style={{ marginLeft: 8, marginRight: 8, width: '120px' }}>
                    <SearchType />
                </Field>
                {searchType === 'Lucene' ? (
                    <Field label="Lucene" style={{ width: '100%' }}>
                        <Lucene onQuerying={() => props?.onQuerying()} />
                    </Field>
                ) : (
                    <Field label={searchMode ? 'Search' : 'SQL'} style={{ width: '100%' }}>
                        <SQLSearch
                            style={{ flex: '1' }}
                            onQuerying={() => {
                                props?.onQuerying();
                            }}
                        />
                    </Field>
                )}
            </DiscoverHeaderSearch>
            {!searchFocus && (
                <>
                    <Field label="Time Field">
                        <Select
                            value={currentTimeField}
                            options={timeFields}
                            onChange={(selectdbTimeFiled: any) => {
                                setDiscoverCurrent({
                                    ...discoverCurrent,
                                    timeField: selectdbTimeFiled.value,
                                });
                                setLoc((prev: any) => {
                                    const searchParams = prev.searchParams;
                                    searchParams?.set('timeField', selectdbTimeFiled.value);
                                    return {
                                        ...prev,
                                        searchParams,
                                    };
                                });
                            }}
                            placeholder={'Time Field'}
                        />
                    </Field>
                    <Field label="Time Range" style={{ marginLeft: 8, marginRight: 8 }}>
                        <TimeRangeInput
                            isReversed={false}
                            onChange={timeRange => {
                                const start = dayjs(timeRange.from.toDate());
                                const end = dayjs(timeRange.to.toDate());
                                setLoc(prev => {
                                    const searchParams = prev.searchParams;
                                    searchParams?.set('startTime', start.format(FORMAT_DATE));
                                    searchParams?.set('endTime', end.format(FORMAT_DATE));
                                    return {
                                        ...prev,
                                        searchParams,
                                    };
                                });
                                setCurrentDate([start, end]);
                                setTimeRange(timeRange);
                            }}
                            value={timeRange}
                        />
                    </Field>
                </>
            )}
            <Field label="">
                <Button
                    onClick={() => {
                        const latestTime = getLatestTime(activeItem?.key as string);
                        if (latestTime) {
                            const [latestStartTime, latestEndTime] = latestTime;
                            setLoc(prev => {
                                const searchParams = prev.searchParams;
                                searchParams?.set('startTime', dayjs(latestStartTime).format(FORMAT_DATE));
                                searchParams?.set('endTime', dayjs(latestEndTime).format(FORMAT_DATE));
                                return {
                                    ...prev,
                                    searchParams,
                                };
                            });
                        }
                        props?.onQuerying();
                    }}
                    variant="primary"
                    className="h-8"
                    icon={props?.loading ? 'fa fa-spinner' : 'sync'}
                    disabled={!currentTimeField}
                >
                    {`Query`}
                </Button>
            </Field>
        </div>
    );
}
