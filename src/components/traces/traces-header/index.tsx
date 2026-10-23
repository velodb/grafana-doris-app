'use client';
import { t } from 'i18n';
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
    tableMetadataAtom,
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
    timeZoneAtom,
    databasesAtom,
    tablesAtom,
    disabledOptionsAtom,
} from 'store/discover';
import { isValidTimeFieldType } from 'utils/data';
import { Select, Field, useTheme2, TimeRangeInput } from '@grafana/ui';
import { formatShareTime, parseTimeInZone, getGrafanaUserTimeZone as getDisplayTimeZone, normalizeTimeZone } from 'utils/time';
import { getFieldsService, getIndexesService } from 'services/metaservice';
import { currentTraceTableAtom } from 'store/traces';
import { useDatabaseTableSelection } from 'hooks/useDatabaseTableSelection';
import { toError } from 'utils/errors';
import { useDatasourcePermissions } from 'hooks/useDatasourcePermissions';
import { SUPPORTED_DATASOURCE_TYPES, isSupportedDatasourceType } from 'services/grafana-permissions';
import { timeRangeFieldClass } from 'components/time-range-input/time-range-input.styles';

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

function resolveDatasourceUid(dataSource: any, datasources = getDataSourceSrv().getList()): string {
    if (!dataSource) {
        return '';
    }
    if (typeof dataSource === 'string') {
        const matched = datasources.find(ds => ds.uid === dataSource || ds.name === dataSource);
        return matched?.uid || dataSource;
    }
    if (typeof dataSource === 'object') {
        if (dataSource.uid) {
            return dataSource.uid;
        }
        if (dataSource.name) {
            const matched = datasources.find(ds => ds.name === dataSource.name);
            return matched?.uid || '';
        }
    }
    return '';
}

function resolveDatasourceFromParam(datasourceParam: string | null | undefined, datasources = getDataSourceSrv().getList()) {
    if (!datasourceParam) {
        return undefined;
    }

    const normalizedDatasource = datasourceParam.trim();
    if (!normalizedDatasource) {
        return undefined;
    }

    return datasources.find(ds => ds.uid === normalizedDatasource || ds.name === normalizedDatasource);
}

function parseUrlDate(value?: string | null) {
    if (!value) {
        return undefined;
    }

    const parsedDate = parseTimeInZone(value, 'browser');
    return parsedDate?.isValid() ? parsedDate : undefined;
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

function buildRelativeTimeRange(rawFrom: string, rawTo: string, zone = getDisplayTimeZone()) {
    const relativeRange = rangeUtil.convertRawToRange({ from: rawFrom, to: rawTo }, zone);

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
    const setTableMetadata = useSetAtom(tableMetadataAtom);
    const requestedFieldsKey = React.useRef('');
    const requestedIndexesKey = React.useRef('');
    const metadataGeneration = React.useRef(0);
    useEffect(() => () => { metadataGeneration.current += 1; }, []);
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
    const configuredLogsConfig = (jsonData as AppPluginSettings).logsConfig;
    const logsConfig = mergeLogsConfig(configuredLogsConfig);
    const {
        allowedDatasources,
        allowedDatasourceUids,
        loading: datasourcePermissionsLoading,
        error: datasourcePermissionsError,
    } = useDatasourcePermissions((jsonData as AppPluginSettings).teamDatasourcePermissions, 'TracesHeader');
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

    useEffect(() => {
        setDataSource(allowedDatasources);
    }, [allowedDatasources, setDataSource]);

    useEffect(() => {
        if (currentIndex.length > 0) {
            setDisabledOptions([]);
        } else {
            setDisabledOptions(['Search']);
        }
    }, [currentIndex, setDisabledOptions]);

    const theme = useTheme2();
    const [timeZone, setTimeZone] = useAtom(timeZoneAtom);

    function getFields(
        selectedTable: any,
        initOptions?: { datasource?: any; database?: string; preferredTimeField?: string },
    ) {
        const effectiveDatasource = initOptions?.datasource ?? selectdbDS;
        const effectiveDatabase = initOptions?.database ?? discoverCurrent.database;
        if (!effectiveDatasource || !effectiveDatabase || !selectedTable?.value) {
            return;
        }

        const generation = metadataGeneration.current;
        const metadataKey = JSON.stringify([effectiveDatasource.uid, effectiveDatabase, selectedTable.value]);
        requestedFieldsKey.current = metadataKey;
        getFieldsService({
            selectdbDS: effectiveDatasource,
            database: effectiveDatabase,
            table: selectedTable.value,
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (requestedFieldsKey.current !== metadataKey || metadataGeneration.current !== generation) {
                    return;
                }
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

                    setTableMetadata(previous => ({ ...previous, [metadataKey]: { ...previous[metadataKey], fields: tableFields } }));
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
                            timeField: targetTimeField,
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

        const generation = metadataGeneration.current;
        const metadataKey = JSON.stringify([effectiveDatasource.uid, effectiveDatabase, selectedTable.value]);
        requestedIndexesKey.current = metadataKey;
        getIndexesService({
            selectdbDS: effectiveDatasource,
            database: effectiveDatabase,
            table: selectedTable.value,
        }).subscribe({
            next: ({ data, ok }: any) => {
                if (requestedIndexesKey.current !== metadataKey || metadataGeneration.current !== generation) {
                    return;
                }
                if (ok) {
                    const frame = toDataFrame(data.results.getIndexes.frames[0]);
                    const values = Array.from(frame.fields[2]?.values || []);
                    const columnNames = Array.from(frame.fields[4]?.values || []);
                    const indexesTypes = Array.from(frame.fields[10]?.values || []);

                    if (!values || values.length === 0) {
                        setTableMetadata(previous => ({ ...previous, [metadataKey]: { ...previous[metadataKey], indexes: [] } }));
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

                    setTableMetadata(previous => ({ ...previous, [metadataKey]: { ...previous[metadataKey], indexes: tableIndexes } }));
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

    const applyTableSelection = (datasource: any, database: string, table: string, timeField?: string) => {
        metadataGeneration.current += 1;
        requestedFieldsKey.current = '';
        requestedIndexesKey.current = '';
        setTableFields([]);
        setTimeFields([]);
        setIndexes([]);
        setCurrentIndex([]);
        setCurrentTable(table);
        setDiscoverCurrent(prev => ({ ...prev, database, table, timeField: '' }));
        if (table) {
            getFields({ value: table }, { datasource, database, preferredTimeField: timeField ?? '' });
            getIndexes({ value: table }, { datasource, database });
        }
    };

    const { selectDatasource, selectDatabase, databasesLoading, tablesLoading } = useDatabaseTableSelection({
        setDatabases,
        setTables,
        onDatabaseChange: database => setDiscoverCurrent(prev => ({ ...prev, database, table: '', timeField: '' })),
        onTableChange: applyTableSelection,
    });

    async function initHeaderData() {
        const urlSearchParams =
            loc?.searchParams instanceof URLSearchParams
                ? loc.searchParams
                : new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const persistedDatasourceStorage = getStoredValue<{ uid?: string }>('discover-selected-datasource');
        const persistedDiscoverCurrentStorage = getStoredValue<{ database?: string; table?: string; timeField?: string }>('discover-current');
        const persistedTraceTableStorage = getStoredValue<string>('trace-current-table');
        const urlDatasource = resolveDatasourceFromParam(urlSearchParams.get('datasource'), allowedDatasources);
        const urlDatabase = urlSearchParams.get('database')?.trim() || '';
        const urlTable = urlSearchParams.get('table')?.trim() || '';
        const urlTimeField = urlSearchParams.get('timeField')?.trim() || '';
        const urlTimeZone = normalizeTimeZone(urlSearchParams.get('timeZone')) || timeZone;
        if (urlTimeZone !== timeZone) {
            setTimeZone(urlTimeZone);
        }
        const urlStartTime = parseUrlDate(urlSearchParams.get('startTime'));
        const urlEndTime = parseUrlDate(urlSearchParams.get('endTime'));
        const urlTimeRawFrom = urlSearchParams.get('timeRawFrom')?.trim() || '';
        const urlTimeRawTo = urlSearchParams.get('timeRawTo')?.trim() || '';

        const configuredDatasourceUid = resolveDatasourceUid(logsConfig.datasource, allowedDatasources);
        const persistedDatasourceUid = urlDatasource?.uid || selectedDatasource?.uid || persistedDatasourceStorage?.uid;
        const persistedDatabase = urlDatabase || discoverCurrent.database || persistedDiscoverCurrentStorage?.database || '';
        const persistedTable = urlTable || currentTable || persistedTraceTableStorage || '';
        const persistedTimeField = urlTimeField || discoverCurrent.timeField || persistedDiscoverCurrentStorage?.timeField || '';

        const requestedDatasourceUid = persistedDatasourceUid || configuredDatasourceUid || '';
        const defaultDatasourceUid =
            requestedDatasourceUid && allowedDatasourceUids.has(requestedDatasourceUid)
                ? requestedDatasourceUid
                : allowedDatasources[0]?.uid || '';
        const defaultDatabase = persistedDatabase || configuredLogsConfig?.database || '';
        const defaultTraceTable = persistedTable || logsConfig.targetTraceTable || logsConfig.logsTable || '';

        if (urlTimeRawFrom && urlTimeRawTo) {
            const relativeTimeRange = buildRelativeTimeRange(urlTimeRawFrom, urlTimeRawTo, urlTimeZone);
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

        if (allowedDatasources.length === 0) {
            setSelectedDatasource(undefined);
            setDatabases([]);
            setTables([]);
            setCurrentTable('');
            setDiscoverCurrent(prev => ({
                ...prev,
                database: '',
                table: '',
                timeField: '',
            }));
            hasInitializedUrlSyncRef.current = true;
            return;
        }

        if (!defaultDatasourceUid) {
            hasInitializedUrlSyncRef.current = true;
            return;
        }

        try {
            const ds = allowedDatasources.find(datasource => datasource.uid === defaultDatasourceUid) ??
                await getDataSourceSrv().get({ uid: defaultDatasourceUid });

            if (!ds) {
                return;
            }
            setSelectedDatasource(ds as any);
            selectDatasource(ds, { database: defaultDatabase, table: defaultTraceTable, timeField: persistedTimeField });
        } catch (error) {
            logError(toError(error), { source: 'TracesHeader', action: 'initHeaderData' });
        } finally {
            hasInitializedUrlSyncRef.current = true;
        }
    }

    useEffect(() => {
        if (datasourcePermissionsLoading || hasInitializedUrlSyncRef.current) {
            return;
        }

        void initHeaderData();
        // Initialize once: keep persisted values if they exist; otherwise apply config defaults.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [datasourcePermissionsLoading]);

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
        const currentStartTime = _currentDate[0] ? formatShareTime(_currentDate[0]) : undefined;
        const currentEndTime = _currentDate[1] ? formatShareTime(_currentDate[1]) : undefined;

        const hasRelativeTimeParams = Boolean(urlTimeRawFrom && urlTimeRawTo);
        const hasAbsoluteTimeParams = Boolean(urlStartTime && urlEndTime);
        const isRelativeTimeSynced = hasRelativeTimeParams && rawFrom === urlTimeRawFrom && rawTo === urlTimeRawTo;
        const isAbsoluteTimeSynced =
            hasAbsoluteTimeParams &&
            !shouldShareRelativeRaw &&
            currentStartTime === (urlStartTime ? formatShareTime(urlStartTime) : undefined) &&
            currentEndTime === (urlEndTime ? formatShareTime(urlEndTime) : undefined);

        if ((hasRelativeTimeParams || hasAbsoluteTimeParams) && !isRelativeTimeSynced && !isAbsoluteTimeSynced) {
            return;
        }

        updateShareParams({
            datasource: selectedDatasource?.uid || selectedDatasource?.name || '',
            database: discoverCurrent.database,
            table: currentTable || discoverCurrent.table,
            timeField: currentTimeField,
            timeZone,
            startTime: shouldShareRelativeRaw ? undefined : currentStartTime,
            endTime: shouldShareRelativeRaw ? undefined : currentEndTime,
            timeRawFrom: shouldShareRelativeRaw ? rawFrom : undefined,
            timeRawTo: shouldShareRelativeRaw ? rawTo : undefined,
        });
    }, [currentTable, currentTimeField, _currentDate, discoverCurrent.database, discoverCurrent.table, locSearch, selectedDatasource, timeRange?.raw, updateShareParams, timeZone]);

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
                <Field
                    label={t('Datasource')}
                    description={datasourcePermissionsError ? t('Failed to load team datasource permissions') : undefined}
                >
                    {/* filter 这个版本无效 */}
                    <DataSourcePicker
                        width={20}
                        type={SUPPORTED_DATASOURCE_TYPES}
                        current={selectedDatasource}
                        placeholder={t('Choose')}
                        noDefault
                        disabled={datasourcePermissionsLoading || allowedDatasources.length === 0}
                        isLoading={datasourcePermissionsLoading}
                        filter={ds => isSupportedDatasourceType(ds.type) && allowedDatasourceUids.has(ds.uid)}
                        onChange={item => {
                            if (!allowedDatasourceUids.has(item.uid)) {
                                return;
                            }
                            setSelectedDatasource(item);
                            selectDatasource(item);
                        }}
                    />
                </Field>
                {/* 需要从数据源中获取库表信息 */}
                <Field label={t('Database')} style={{ marginLeft: 8 }}>
                    <Select placeholder={t('Choose')}
                        width={15}
                        options={databases}
                        value={discoverCurrent.database}
                        disabled={databasesLoading || !selectedDatasource || databases.length === 0}
                        isLoading={databasesLoading}
                        onChange={(selectedDatabase: any) => {
                            selectDatabase(selectdbDS, selectedDatabase.value);
                        }}
                    ></Select>
                </Field>

                <Field label={t('Table')} style={{ marginLeft: 8 }}>
                    <Select placeholder={t('Choose')}
                        options={tables}
                        width={15}
                        value={currentTable}
                        disabled={databasesLoading || tablesLoading || !discoverCurrent.database || tables.length === 0}
                        isLoading={tablesLoading}
                        onChange={(selectedTable: any) => {
                            applyTableSelection(selectdbDS, discoverCurrent.database, selectedTable.value);
                        }}
                    />
                </Field>
            </DiscoverHeaderSearch>
            {!searchFocus && (
                <>
                    <Field label={t('Time Field')}>
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
                            placeholder={t('Time Field')}
                        />
                    </Field>
                    <Field label={t('Time Range')} className={timeRangeFieldClass} style={{ marginLeft: 8, marginRight: 8 }}>
                        <TimeRangeInput
                            hideTimeZone={false}
                            timeZone={timeZone}
                            onChangeTimeZone={zone => { setTimeZone(zone); updateShareParams({ timeZone: zone }); }}
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
                                    startTime: hasRelativeRaw ? undefined : formatShareTime(start),
                                    endTime: hasRelativeRaw ? undefined : formatShareTime(end),
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
