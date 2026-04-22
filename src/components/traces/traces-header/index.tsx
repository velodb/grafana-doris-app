'use client';
import React, { useEffect } from 'react';
import dayjs from 'dayjs';
import { DiscoverHeaderSearch } from './discover-header.style';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { DataSourcePicker, getDataSourceSrv, logError } from '@grafana/runtime';
import { css } from '@emotion/css';
import { dateTime, rangeUtil, usePluginContext, toDataFrame } from '@grafana/data';
import { mergeLogsConfig, type AppPluginSettings } from 'types/plugin-settings';
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
import { Subscription } from 'rxjs';
import { toError } from 'utils/errors';

function getStoredValue<T>(key: string): T | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return undefined;
        }
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

function resolveDatasourceUid(dataSource: any): string {
    if (!dataSource) {
        return '';
    }
    if (typeof dataSource === 'string') {
        const matched = getDataSourceSrv()
            .getList()
            .find(ds => ds.uid === dataSource || ds.name === dataSource);
        return matched?.uid || dataSource;
    }
    if (typeof dataSource === 'object') {
        if (dataSource.uid) {
            return dataSource.uid;
        }
        if (dataSource.name) {
            const matched = getDataSourceSrv()
                .getList()
                .find(ds => ds.name === dataSource.name);
            return matched?.uid || '';
        }
    }
    return '';
}

function resolveDatasourceFromParam(datasourceParam?: string | null) {
    if (!datasourceParam) {
        return undefined;
    }

    const normalizedDatasource = datasourceParam.trim();
    if (!normalizedDatasource) {
        return undefined;
    }

    return getDataSourceSrv()
        .getList()
        .find(ds => ds.uid === normalizedDatasource || ds.name === normalizedDatasource);
}

function parseUrlDate(value?: string | null) {
    if (!value) {
        return undefined;
    }

    const parsedDate = dayjs(value);
    return parsedDate.isValid() ? parsedDate : undefined;
}

function buildAbsoluteTimeRange(start: dayjs.Dayjs, end: dayjs.Dayjs) {
    return {
        from: dateTime(start.toDate()),
        to: dateTime(end.toDate()),
        raw: {
            from: dateTime(start.toDate()),
            to: dateTime(end.toDate()),
        },
    };
}

function buildRelativeTimeRange(rawFrom: string, rawTo: string) {
    const relativeRange = rangeUtil.convertRawToRange({ from: rawFrom, to: rawTo });

    return {
        from: relativeRange.from,
        to: relativeRange.to,
        raw: {
            from: rawFrom,
            to: rawTo,
        },
    };
}

function normalizeRawTimeValue(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalizedValue = value.trim();
    return normalizedValue || undefined;
}

function isRelativeRawRange(raw?: { from?: unknown; to?: unknown }) {
    const from = normalizeRawTimeValue(raw?.from);
    const to = normalizeRawTimeValue(raw?.to);

    return Boolean(from?.startsWith('now') && to?.startsWith('now'));
}

export default function TracesHeader() {
    // const catalogs = useAtomValue(catalogAtom);
    const setIndexes = useSetAtom(indexesAtom);
    const [discoverCurrent, setDiscoverCurrent] = useAtom(discoverCurrentAtom);
    if (process.env.NODE_ENV !== 'production') {
        discoverCurrentAtom.debugLabel = 'current';
    }
    const [loc, setLoc] = useAtom(locationAtom);
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
    const context = usePluginContext();
    const jsonData = context.meta.jsonData || {};
    const logsConfig = mergeLogsConfig((jsonData as AppPluginSettings).logsConfig);
    const hasInitializedUrlSyncRef = React.useRef(false);
    const locSearch = loc?.searchParams?.toString() ?? '';

    const updateShareParams = React.useCallback(
        (updates: Record<string, string | undefined>) => {
            setLoc((prev: any) => {
                const currentSearch = prev?.searchParams?.toString() ?? '';
                const searchParams = new URLSearchParams(currentSearch);

                Object.entries(updates).forEach(([key, value]) => {
                    const normalizedValue = value?.trim();
                    if (normalizedValue) {
                        searchParams.set(key, normalizedValue);
                    } else {
                        searchParams.delete(key);
                    }
                });

                if (searchParams.toString() === currentSearch) {
                    return prev;
                }

                return {
                    ...prev,
                    searchParams,
                };
            });
        },
        [setLoc],
    );

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
            error: (err: any) => logError(toError(err), { source: 'TracesHeader', action: 'fetchDatabases' }),
        });
    }, [setDatabases]);

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

        const subscription: Subscription | undefined = fetchDatabases(selectdbDS);

        return () => subscription?.unsubscribe();
    }, [selectdbDS, fetchDatabases]);

    function getFields(
        selectedTable: any,
        initOptions?: { datasource?: any; database?: string; preferredTimeField?: string },
    ) {
        const effectiveDatasource = initOptions?.datasource ?? selectdbDS;
        const effectiveDatabase = initOptions?.database ?? discoverCurrent.database;
        if (!effectiveDatasource || !effectiveDatabase || !selectedTable?.value) {
            return;
        }

        getFieldsService({
            selectdbDS: effectiveDatasource,
            database: effectiveDatabase,
            table: selectedTable.value,
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (ok) {
                    const frame = toDataFrame(data.results.getFields.frames[0]);
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
                        const preferredTimeField = initOptions?.preferredTimeField ?? currentTimeField;
                        const targetTimeField =
                            options.find((option: any) => option.value === preferredTimeField)?.value || options[0]?.value || '';
                        setDiscoverCurrent(prev => ({
                            ...prev,
                            database: effectiveDatabase,
                            table: selectedTable.value,
                            timeField: targetTimeField || prev.timeField,
                        }));
                        setTimeFields(options);
                    }
                }
            },
            error: (err: any) => {
                logError(toError(err), { source: 'TracesHeader', action: 'getFields' });
            },
        });
    }

    function getIndexes(selectedTable: any, initOptions?: { datasource?: any; database?: string }) {
        const effectiveDatasource = initOptions?.datasource ?? selectdbDS;
        const effectiveDatabase = initOptions?.database ?? discoverCurrent.database;
        if (!effectiveDatasource || !effectiveDatabase || !selectedTable?.value) {
            return;
        }

        getIndexesService({
            selectdbDS: effectiveDatasource,
            database: effectiveDatabase,
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
                logError(toError(err), { source: 'TracesHeader', action: 'getIndexes' });
            },
        });
    }

    async function initHeaderData() {
        const urlSearchParams =
            loc?.searchParams instanceof URLSearchParams
                ? loc.searchParams
                : new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const persistedDatasourceStorage = getStoredValue<{ uid?: string }>('discover-selected-datasource');
        const persistedDiscoverCurrentStorage = getStoredValue<{ database?: string; table?: string; timeField?: string }>('discover-current');
        const persistedTraceTableStorage = getStoredValue<string>('trace-current-table');
        const urlDatasource = resolveDatasourceFromParam(urlSearchParams.get('datasource'));
        const urlDatabase = urlSearchParams.get('database')?.trim() || '';
        const urlTable = urlSearchParams.get('table')?.trim() || '';
        const urlTimeField = urlSearchParams.get('timeField')?.trim() || '';
        const urlStartTime = parseUrlDate(urlSearchParams.get('startTime'));
        const urlEndTime = parseUrlDate(urlSearchParams.get('endTime'));
        const urlTimeRawFrom = urlSearchParams.get('timeRawFrom')?.trim() || '';
        const urlTimeRawTo = urlSearchParams.get('timeRawTo')?.trim() || '';

        const configuredDatasourceUid = resolveDatasourceUid(logsConfig.datasource);
        const persistedDatasourceUid = urlDatasource?.uid || selectedDatasource?.uid || persistedDatasourceStorage?.uid;
        const persistedDatabase = urlDatabase || discoverCurrent.database || persistedDiscoverCurrentStorage?.database || '';
        const persistedTable = urlTable || currentTable || persistedTraceTableStorage || '';
        const persistedTimeField = urlTimeField || discoverCurrent.timeField || persistedDiscoverCurrentStorage?.timeField || '';

        const defaultDatasourceUid = persistedDatasourceUid || configuredDatasourceUid || '';
        const defaultDatabase = persistedDatabase || logsConfig.database || '';
        const defaultTraceTable = persistedTable || logsConfig.targetTraceTable || logsConfig.logsTable || '';

        if (urlTimeRawFrom && urlTimeRawTo) {
            const relativeTimeRange = buildRelativeTimeRange(urlTimeRawFrom, urlTimeRawTo);
            setCurrentDate([dayjs(relativeTimeRange.from.toDate()), dayjs(relativeTimeRange.to.toDate())]);
            setTimeRange((prev: any) => ({
                ...prev,
                ...relativeTimeRange,
            }));
        } else if (urlStartTime && urlEndTime) {
            setCurrentDate([urlStartTime, urlEndTime]);
            setTimeRange((prev: any) => ({
                ...prev,
                ...buildAbsoluteTimeRange(urlStartTime, urlEndTime),
            }));
        }

        if (!defaultDatasourceUid || !defaultDatabase) {
            hasInitializedUrlSyncRef.current = true;
            return;
        }

        try {
            const ds =
                selectedDatasource?.uid === defaultDatasourceUid
                    ? selectedDatasource
                    : await getDataSourceSrv().get({ uid: defaultDatasourceUid });

            if (!ds) {
                return;
            }
            if (selectedDatasource?.uid !== defaultDatasourceUid) {
                setSelectedDatasource(ds as any);
            }
            fetchDatabases(ds);

            getTablesService({
                selectdbDS: ds,
                database: defaultDatabase,
            }).subscribe({
                next: (resp: any) => {
                    const { data, ok } = resp;
                    if (ok) {
                        const frame = toDataFrame(data.results.getTables.frames[0]);
                        const values = Array.from(frame.fields[0].values);
                        const options = values.map((item: string) => ({ label: item, value: item }));
                        const targetTable =
                            options.find(option => option.value === defaultTraceTable)?.value || options[0]?.value || '';

                        setTables(options);
                        setCurrentTable(targetTable);
                        setDiscoverCurrent(prev => ({
                            ...prev,
                            database: defaultDatabase,
                            table: targetTable,
                        }));

                        if (targetTable) {
                            getFields(
                                { value: targetTable },
                                {
                                    datasource: ds,
                                    database: defaultDatabase,
                                    preferredTimeField: persistedTimeField,
                                },
                            );
                            getIndexes({ value: targetTable }, { datasource: ds, database: defaultDatabase });
                        }
                    }
                },
                error: (err: any) => logError(toError(err), { source: 'TracesHeader', action: 'getTables' }),
            });

        } catch (error) {
            logError(toError(error), { source: 'TracesHeader', action: 'initHeaderData' });
        } finally {
            hasInitializedUrlSyncRef.current = true;
        }
    }

    useEffect(() => {
        void initHeaderData();
        // Initialize once: keep persisted values if they exist; otherwise apply config defaults.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!hasInitializedUrlSyncRef.current) {
            return;
        }

        const urlSearchParams = new URLSearchParams(locSearch);
        const urlTimeRawFrom = urlSearchParams.get('timeRawFrom')?.trim() || '';
        const urlTimeRawTo = urlSearchParams.get('timeRawTo')?.trim() || '';
        const urlStartTime = parseUrlDate(urlSearchParams.get('startTime'));
        const urlEndTime = parseUrlDate(urlSearchParams.get('endTime'));
        const rawFrom = normalizeRawTimeValue(timeRange?.raw?.from);
        const rawTo = normalizeRawTimeValue(timeRange?.raw?.to);
        const shouldShareRelativeRaw = isRelativeRawRange(timeRange?.raw);
        const currentStartTime = _currentDate[0]?.format(FORMAT_DATE);
        const currentEndTime = _currentDate[1]?.format(FORMAT_DATE);

        const hasRelativeTimeParams = Boolean(urlTimeRawFrom && urlTimeRawTo);
        const hasAbsoluteTimeParams = Boolean(urlStartTime && urlEndTime);
        const isRelativeTimeSynced = hasRelativeTimeParams && rawFrom === urlTimeRawFrom && rawTo === urlTimeRawTo;
        const isAbsoluteTimeSynced =
            hasAbsoluteTimeParams &&
            !shouldShareRelativeRaw &&
            currentStartTime === urlStartTime?.format(FORMAT_DATE) &&
            currentEndTime === urlEndTime?.format(FORMAT_DATE);

        if ((hasRelativeTimeParams || hasAbsoluteTimeParams) && !isRelativeTimeSynced && !isAbsoluteTimeSynced) {
            return;
        }

        updateShareParams({
            datasource: selectedDatasource?.uid || selectedDatasource?.name || '',
            database: discoverCurrent.database,
            table: currentTable || discoverCurrent.table,
            timeField: currentTimeField,
            startTime: shouldShareRelativeRaw ? undefined : currentStartTime,
            endTime: shouldShareRelativeRaw ? undefined : currentEndTime,
            timeRawFrom: shouldShareRelativeRaw ? rawFrom : undefined,
            timeRawTo: shouldShareRelativeRaw ? rawTo : undefined,
        });
    }, [currentTable, currentTimeField, _currentDate, discoverCurrent.database, discoverCurrent.table, locSearch, selectedDatasource, timeRange?.raw, updateShareParams]);

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
                            setSelectedDatasource(item);
                            updateShareParams({
                                datasource: item?.uid || item?.name || '',
                            });
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
                            updateShareParams({
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
                                error: (err: any) => logError(toError(err), { source: 'TracesHeader', action: 'getTables' }),
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
                            updateShareParams({
                                table: selectedTable.value,
                            });
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
                                updateShareParams({
                                    timeField: selectdbTimeFiled.value,
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
                                const rawFrom = normalizeRawTimeValue(timeRange.raw?.from);
                                const rawTo = normalizeRawTimeValue(timeRange.raw?.to);
                                const hasRelativeRaw = isRelativeRawRange(timeRange.raw);
                                setCurrentDate([start, end]);
                                setTimeRange({
                                    from: dateTime(timeRange.from.toDate()),
                                    to: dateTime(timeRange.to.toDate()),
                                    raw: hasRelativeRaw && rawFrom && rawTo ? { from: rawFrom, to: rawTo } : { from: dateTime(timeRange.from.toDate()), to: dateTime(timeRange.to.toDate()) },
                                });
                                updateShareParams({
                                    startTime: hasRelativeRaw ? undefined : start.format(FORMAT_DATE),
                                    endTime: hasRelativeRaw ? undefined : end.format(FORMAT_DATE),
                                    timeRawFrom: hasRelativeRaw ? rawFrom : undefined,
                                    timeRawTo: hasRelativeRaw ? rawTo : undefined,
                                });
                            }}
                            value={timeRange}
                        />
                    </Field>
                </>
            )}
        </div>
    );
}
