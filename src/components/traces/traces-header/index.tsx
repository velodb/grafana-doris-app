'use client';
import React, { useEffect } from 'react';
import dayjs from 'dayjs';
import { DiscoverHeaderSearch } from './discover-header.style';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { DataSourcePicker, getDataSourceSrv } from '@grafana/runtime';
import { css } from '@emotion/css';
import {
    indexesAtom,
    discoverCurrentAtom,
    locationAtom,
    // currentClusterAtom,
    tableFieldsAtom,
    timeFieldsAtom,
    currentDateAtom,
    currentTimeFieldAtom,
    currentIndexAtom,
    searchFocusAtom,
    datasourcesAtom,
    selectedDatasourceAtom,
    timeRangeAtom,
    databasesAtom,
    tablesAtom,
    disabledOptionsAtom,
} from 'store/discover';
import { isValidTimeFieldType } from 'utils/data';
import { Select, Field, useTheme2, TimeRangeInput } from '@grafana/ui';
import { FORMAT_DATE } from '../../../constants';
import { getDatabases, getFieldsService, getIndexesService, getTablesService } from 'services/metaservice';
import { currentTraceTableAtom } from 'store/traces';
import { toDataFrame } from '@grafana/data';
import { Subscription } from 'rxjs';

export default function TracesHeader() {
    // const catalogs = useAtomValue(catalogAtom);
    const setIndexes = useSetAtom(indexesAtom);
    const [discoverCurrent, setDiscoverCurrent] = useAtom(discoverCurrentAtom);
    if (process.env.NODE_ENV !== 'production') {
        discoverCurrentAtom.debugLabel = 'current';
    }
    const setLoc = useSetAtom(locationAtom);
    const setTableFields = useSetAtom(tableFieldsAtom);
    const [timeFields, setTimeFields] = useAtom(timeFieldsAtom);
    const [_currentDate, setCurrentDate] = useAtom(currentDateAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const [currentIndex, setCurrentIndex] = useAtom(currentIndexAtom);
    const searchFocus = useAtomValue(searchFocusAtom);
    const [selectedDatasource, setSelectedDatasource] = useAtom(selectedDatasourceAtom);
    const [timeRange, setTimeRange] = useAtom(timeRangeAtom);
    const [currentTable, setCurrentTable] = useAtom(currentTraceTableAtom);
    const [databases, setDatabases] = useAtom(databasesAtom);
    const [tables, setTables] = useAtom(tablesAtom);
    const [_datasources, setDataSource] = useAtom(datasourcesAtom);
    const setDisabledOptions = useSetAtom(disabledOptionsAtom);

    const selectdbDS = useAtomValue(selectedDatasourceAtom);

    useEffect(() => {
        const datasources = getDataSourceSrv().getList();
        setDataSource(datasources);
    }, [setDataSource]);

    useEffect(() => {
        if (currentIndex.length > 0) {
            setDisabledOptions([]);
        } else {
            setDisabledOptions(['Search']);
        }
    }, [currentIndex, setDisabledOptions]);

    const theme = useTheme2();

    useEffect(() => {
        if (!selectdbDS) {
            return;
        }

        const subscription: Subscription = getDatabases(selectdbDS).subscribe({
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

        return () => subscription.unsubscribe();
    }, [selectdbDS, setDatabases]);

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
                        setDiscoverCurrent({
                            ...discoverCurrent,
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
                border-bottom: 1px solid ${theme.colors.border.medium};
            `}
        >
            <DiscoverHeaderSearch>
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
        </div>
    );
}
