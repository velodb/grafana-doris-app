'use client';
import React, { PropsWithChildren, useEffect } from 'react';
import dayjs from 'dayjs';
import { DiscoverHeaderSearch } from './discover-header.style';
import SearchType from './search-type';
import SQLSearch from './sql-search';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { DataSourcePicker, getDataSourceSrv, logError } from '@grafana/runtime';
import { css } from '@emotion/css';
import { SelectableValue, TimeZone, dateTime, usePluginContext, toDataFrame } from '@grafana/data';
import { mergeLogsConfig, type AppPluginSettings } from 'types/plugin-settings';
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
    searchValueAtom,
    timeRangeAtom,
    timeZoneAtom,
    databasesAtom,
    tablesAtom,
    currentTableAtom,
    dataFilterAtom,
} from 'store/discover';
import { DISCOVER_SHORTCUTS, getLatestTime, isValidTimeFieldType } from 'utils/data';
import { Select, Field, Button, useTheme2, TimeRangeInput } from '@grafana/ui';
import { getApplicationValuesService, getDatabases, getFieldsService, getIndexesService, getTablesService } from 'services/metaservice';
import { Subscription } from 'rxjs';
import Lucene from './lucene';
import { toError } from 'utils/errors';
import { useDatasourcePermissions } from 'hooks/useDatasourcePermissions';
import {
    buildAbsoluteTimeRange,
    buildRelativeTimeRange,
    formatTimeInZone,
    normalizeTimeZone,
    parseTimeInZone,
    toDayjsRange,
} from 'utils/time';
import {
    APPLICATION_FILTER_ID,
    applyApplicationFilter,
    getCommittedApplication,
    getConfiguredApplicationAttributeKey,
} from './application-filter';

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

function normalizeMode(mode?: string | null): 'SQL' | 'Search' | 'Lucene' | undefined {
    if (!mode) {
        return undefined;
    }

    const normalizedMode = mode.trim().toLowerCase();
    if (normalizedMode === 'sql') {
        return 'SQL';
    }
    if (normalizedMode === 'search') {
        return 'Search';
    }
    if (normalizedMode === 'lucene') {
        return 'Lucene';
    }

    return undefined;
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

function findShortcutByRaw(rawFrom?: string, rawTo?: string) {
    if (!rawFrom || !rawTo) {
        return undefined;
    }

    return DISCOVER_SHORTCUTS.find(shortcut => shortcut.raw.from === rawFrom && shortcut.raw.to === rawTo);
}

export default function DiscoverHeader(
    props: PropsWithChildren & {
        onQuerying: () => void;
        loading: boolean;
    },
) {
    const { loading, onQuerying } = props;
    // const catalog = 'internal';
    // const catalogs = useAtomValue(catalogAtom);
    const setIndexes = useSetAtom(indexesAtom);
    const [searchType, setSearchType] = useAtom(searchTypeAtom);
    const [discoverCurrent, setDiscoverCurrent] = useAtom(discoverCurrentAtom);
    if (process.env.NODE_ENV !== 'production') {
        discoverCurrentAtom.debugLabel = 'current';
    }
    const [loc, setLoc] = useAtom(locationAtom);
    // const [currentCluster, setCurrentCluster] = useAtom(currentClusterAtom);
    const [tableFields, setTableFields] = useAtom(tableFieldsAtom);
    const [timeFields, setTimeFields] = useAtom(timeFieldsAtom);
    const [_currentDate, setCurrentDate] = useAtom(currentDateAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const [, setCurrentIndex] = useAtom(currentIndexAtom);
    const searchFocus = useAtomValue(searchFocusAtom);
    // const { databaseList } = useDatabaseList();
    const [activeItem, setActiveItem] = useAtom(activeShortcutAtom);
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
    const [searchValue, setSearchValue] = useAtom(searchValueAtom);
    const [timeZone, setTimeZone] = useAtom(timeZoneAtom);
    const [dataFilter, setDataFilter] = useAtom(dataFilterAtom);
    const [applicationDraft, setApplicationDraft] = React.useState('');
    const [applicationOptions, setApplicationOptions] = React.useState<Array<SelectableValue<string>>>([]);
    const [applicationOptionsLoading, setApplicationOptionsLoading] = React.useState(false);
    const [resolvedFieldsContext, setResolvedFieldsContext] = React.useState('');
    const searchMode = searchType === 'Search';

    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const theme = useTheme2();
    const context = usePluginContext();
    const jsonData = context.meta.jsonData || {};
    const configuredLogsConfig = (jsonData as AppPluginSettings).logsConfig;
    const logsConfig = mergeLogsConfig(configuredLogsConfig);
    const applicationAttributeKey = getConfiguredApplicationAttributeKey(
        configuredLogsConfig?.applicationAttributeKey,
    );
    const isApplicationFilterConfigured = Boolean(applicationAttributeKey);
    const {
        allowedDatasources,
        allowedDatasourceUids,
        loading: datasourcePermissionsLoading,
        error: datasourcePermissionsError,
    } = useDatasourcePermissions((jsonData as AppPluginSettings).teamDatasourcePermissions, 'DiscoverHeader');
    const hasInitializedUrlSyncRef = React.useRef(false);
    const locSearch = loc?.searchParams?.toString() ?? '';
    const fieldsContext = `${selectdbDS?.uid || ''}\u0000${discoverCurrent.database}\u0000${currentTable}`;
    const hasResourceAttributes =
        isApplicationFilterConfigured &&
        resolvedFieldsContext === fieldsContext &&
        tableFields.some((field: any) => field?.Field === 'resource_attributes');
    const committedApplication = getCommittedApplication(dataFilter, applicationAttributeKey);
    const applicationStartDate = _currentDate[0] ? formatTimeInZone(_currentDate[0], timeZone) : '';
    const applicationEndDate = _currentDate[1] ? formatTimeInZone(_currentDate[1], timeZone) : '';
    const visibleApplicationOptions = React.useMemo(() => {
        if (!applicationDraft || applicationOptions.some(option => option.value === applicationDraft)) {
            return applicationOptions;
        }

        return [{ label: applicationDraft, value: applicationDraft }, ...applicationOptions];
    }, [applicationDraft, applicationOptions]);

    const resetApplicationFilter = React.useCallback(() => {
        setApplicationDraft('');
        setDataFilter(current => {
            const next = current.filter(filter => filter.id !== APPLICATION_FILTER_ID);
            return next.length === current.length ? current : next;
        });
        setApplicationOptions([]);
        setResolvedFieldsContext('');
    }, [setDataFilter]);

    const commitApplicationAndQuery = React.useCallback(() => {
        const result = applyApplicationFilter(dataFilter, applicationDraft, applicationAttributeKey);
        if (!result.changed) {
            onQuerying();
            return;
        }
        setDataFilter(result.filters);
    }, [applicationAttributeKey, applicationDraft, dataFilter, onQuerying, setDataFilter]);

    const applyAbsoluteTimeRange = React.useCallback(
        (start: dayjs.Dayjs, end: dayjs.Dayjs) => {
            setCurrentDate([start, end]);
            setTimeRange((prev: any) => ({
                ...prev,
                ...buildAbsoluteTimeRange(start, end),
            }));
        },
        [setCurrentDate, setTimeRange],
    );

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
            error: (err: any) => logError(toError(err), { source: 'DiscoverHeader', action: 'fetchDatabases' }),
        });
    }, [setDatabases]);

    useEffect(() => {
        if (!selectdbDS) {
            return;
        }

        const subscription: Subscription | undefined = fetchDatabases(selectdbDS);

        return () => subscription?.unsubscribe();
    }, [selectdbDS, fetchDatabases]);

    function getFields(
        selectedTable: any,
        initOptions?: {
            datasource?: any;
            database?: string;
            preferredTimeField?: string;
            onResolved?: (timeField: string) => void;
        },
    ) {
        const effectiveDatasource = initOptions?.datasource ?? selectdbDS;
        const effectiveDatabase = initOptions?.database ?? discoverCurrent.database;
        if (!effectiveDatasource || !effectiveDatabase || !selectedTable?.value) {
            return;
        }

        setResolvedFieldsContext('');

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
                    setResolvedFieldsContext(`${effectiveDatasource.uid || ''}\u0000${effectiveDatabase}\u0000${selectedTable.value}`);

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

                        const preferredTimeField = (initOptions?.preferredTimeField ?? currentTimeField ?? '').trim();
                        const targetTimeField = options.some(option => option.value === preferredTimeField)
                            ? preferredTimeField
                            : options[0]?.value || '';

                        setDiscoverCurrent(prev => ({
                            ...prev,
                            database: effectiveDatabase,
                            table: selectedTable.value,
                            timeField: targetTimeField || prev.timeField,
                        }));
                        setTimeFields(options);
                        initOptions?.onResolved?.(targetTimeField);
                    }
                }
            },
            error: (err: any) => {
                logError(toError(err), { source: 'DiscoverHeader', action: 'getFields' });
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
                    const frameData = data?.results?.getIndexes?.frames?.[0];
                    if (!frameData) {
                        setIndexes([]);
                        setCurrentIndex([]);
                        return;
                    }
                    const frame = toDataFrame(frameData);
                    if (frame.fields.length === 0) {
                        setIndexes([]);
                        setCurrentIndex([]);
                        return;
                    }
                    const values = Array.from(
                        (frame.fields.find(field => field.name === 'Key_name') ?? frame.fields[2])?.values ?? [],
                    );
                    const columnNames = Array.from(
                        (frame.fields.find(field => field.name === 'Column_name') ?? frame.fields[4])?.values ?? [],
                    );
                    const indexesTypes = Array.from(
                        (frame.fields.find(field => field.name === 'Index_type') ?? frame.fields[10])?.values ?? [],
                    );

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
                logError(toError(err), { source: 'DiscoverHeader', action: 'getIndexes' });
            },
        });
    }

    async function initHeaderData() {
        const urlSearchParams = new URLSearchParams(locSearch);
        const persistedDatasourceStorage = getStoredValue<{ uid?: string }>('discover-selected-datasource');
        const persistedDiscoverCurrentStorage = getStoredValue<{ database?: string; table?: string; timeField?: string }>('discover-current');
        const persistedTableStorage = getStoredValue<string>('discover-current-table');
        const urlDatasource = resolveDatasourceFromParam(urlSearchParams.get('datasource'), allowedDatasources);
        const urlDatabase = urlSearchParams.get('database')?.trim() || '';
        const urlTable = urlSearchParams.get('table')?.trim() || '';
        const urlMode = normalizeMode(urlSearchParams.get('mode'));
        const urlSearchValue = urlSearchParams.get('query') ?? urlSearchParams.get('searchValue') ?? '';
        const urlTimeZone = normalizeTimeZone(urlSearchParams.get('timeZone'));
        const effectiveTimeZone = urlTimeZone || timeZone;
        const urlTimeField = urlSearchParams.get('timeField')?.trim() || '';
        const urlStartTime = parseTimeInZone(urlSearchParams.get('startTime'), effectiveTimeZone);
        const urlEndTime = parseTimeInZone(urlSearchParams.get('endTime'), effectiveTimeZone);
        const urlTimeRawFrom = urlSearchParams.get('timeRawFrom')?.trim() || '';
        const urlTimeRawTo = urlSearchParams.get('timeRawTo')?.trim() || '';
        const matchedShortcut = findShortcutByRaw(urlTimeRawFrom, urlTimeRawTo);

        const configuredDatasourceUid = resolveDatasourceUid(logsConfig.datasource, allowedDatasources);
        const persistedDatasourceUid = urlDatasource?.uid || selectedDatasource?.uid || persistedDatasourceStorage?.uid;
        const persistedDatabase = urlDatabase || discoverCurrent.database || persistedDiscoverCurrentStorage?.database || '';
        const persistedTable = urlTable || currentTable || persistedTableStorage || discoverCurrent.table || persistedDiscoverCurrentStorage?.table || '';
        const persistedTimeField = urlTimeField || discoverCurrent.timeField || persistedDiscoverCurrentStorage?.timeField || '';
        const requestedDatasourceUid = persistedDatasourceUid || configuredDatasourceUid || '';
        const defaultDatasourceUid =
            requestedDatasourceUid && allowedDatasourceUids.has(requestedDatasourceUid)
                ? requestedDatasourceUid
                : allowedDatasources[0]?.uid || '';
        const defaultDatabase = persistedDatabase || logsConfig.database || '';
        const defaultLogsTable = persistedTable || logsConfig.logsTable || '';
        const hasRelativeTimeParams = Boolean(urlTimeRawFrom && urlTimeRawTo);
        const hasAbsoluteTimeParams = Boolean(urlStartTime && urlEndTime);

        if (urlTimeZone && urlTimeZone !== timeZone) {
            setTimeZone(urlTimeZone);
        }

        if (hasRelativeTimeParams && urlTimeRawFrom && urlTimeRawTo) {
            const relativeTimeRange = buildRelativeTimeRange(urlTimeRawFrom, urlTimeRawTo, effectiveTimeZone);
            setActiveItem(matchedShortcut);
            setCurrentDate(toDayjsRange(relativeTimeRange));
            setTimeRange((prev: any) => ({
                ...prev,
                ...relativeTimeRange,
            }));
        } else if (hasRelativeTimeParams) {
            setActiveItem(undefined);
        } else if (hasAbsoluteTimeParams && urlStartTime && urlEndTime) {
            setActiveItem(undefined);
            applyAbsoluteTimeRange(urlStartTime, urlEndTime);
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
            if (urlMode) {
                setSearchType(urlMode);
            }
            setSearchValue(urlSearchValue);
            hasInitializedUrlSyncRef.current = true;
            return;
        }

        if (!defaultDatasourceUid || !defaultDatabase) {
            if (urlMode) {
                setSearchType(urlMode);
            }
            if (urlTimeField) {
                setDiscoverCurrent(prev => ({
                    ...prev,
                    timeField: urlTimeField,
                }));
            }
            setSearchValue(urlSearchValue);
            hasInitializedUrlSyncRef.current = true;
            return;
        }

        try {
            if (urlMode) {
                setSearchType(urlMode);
            }
            if (urlTimeField) {
                setDiscoverCurrent(prev => ({
                    ...prev,
                    timeField: urlTimeField,
                }));
            }
            setSearchValue(urlSearchValue);

            const ds =
                selectedDatasource?.uid === defaultDatasourceUid
                    ? selectedDatasource
                    : allowedDatasources.find(datasource => datasource.uid === defaultDatasourceUid) ??
                        await getDataSourceSrv().get({ uid: defaultDatasourceUid });
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
                            options.find(option => option.value === defaultLogsTable)?.value || options[0]?.value || '';

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
                error: (err: any) => logError(toError(err), { source: 'DiscoverHeader', action: 'getTables' }),
            });
        } catch (error) {
            logError(toError(error), { source: 'DiscoverHeader', action: 'initHeaderData' });
        } finally {
            hasInitializedUrlSyncRef.current = true;
        }
    }

    useEffect(() => {
        if (datasourcePermissionsLoading || hasInitializedUrlSyncRef.current) {
            return;
        }

        void initHeaderData();
        // We only want to apply plugin-config defaults once when the page mounts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [datasourcePermissionsLoading]);

    useEffect(() => {
        if (!hasInitializedUrlSyncRef.current) {
            return;
        }

        const urlSearchParams = new URLSearchParams(locSearch);
        const urlTimeRawFrom = urlSearchParams.get('timeRawFrom')?.trim() || '';
        const urlTimeRawTo = urlSearchParams.get('timeRawTo')?.trim() || '';
        const urlStartTimeParam = urlSearchParams.get('startTime')?.trim() || '';
        const urlEndTimeParam = urlSearchParams.get('endTime')?.trim() || '';
        const urlTimeZone = normalizeTimeZone(urlSearchParams.get('timeZone')) || timeZone;
        const urlStartTime = parseTimeInZone(urlStartTimeParam, urlTimeZone);
        const urlEndTime = parseTimeInZone(urlEndTimeParam, urlTimeZone);
        const rawFrom = normalizeRawTimeValue(timeRange?.raw?.from);
        const rawTo = normalizeRawTimeValue(timeRange?.raw?.to);
        const shouldShareRelativeRaw = isRelativeRawRange(timeRange?.raw);
        const currentStartTime = _currentDate[0] ? formatTimeInZone(_currentDate[0], timeZone) : undefined;
        const currentEndTime = _currentDate[1] ? formatTimeInZone(_currentDate[1], timeZone) : undefined;

        const hasRelativeTimeParams = Boolean(urlTimeRawFrom && urlTimeRawTo);
        const hasAbsoluteTimeParams = Boolean(urlStartTime && urlEndTime);
        const isRelativeTimeSynced = hasRelativeTimeParams && rawFrom === urlTimeRawFrom && rawTo === urlTimeRawTo;
        const isAbsoluteTimeSynced =
            hasAbsoluteTimeParams &&
            !shouldShareRelativeRaw &&
            currentStartTime === urlStartTimeParam &&
            currentEndTime === urlEndTimeParam;

        if ((hasRelativeTimeParams || hasAbsoluteTimeParams) && !isRelativeTimeSynced && !isAbsoluteTimeSynced) {
            return;
        }

        updateShareParams({
            datasource: selectedDatasource?.uid || selectedDatasource?.name || '',
            database: discoverCurrent.database,
            table: currentTable || discoverCurrent.table,
            mode: searchType,
            query: searchValue,
            timeField: currentTimeField,
            timeZone,
            startTime: shouldShareRelativeRaw ? undefined : currentStartTime,
            endTime: shouldShareRelativeRaw ? undefined : currentEndTime,
            timeRawFrom: shouldShareRelativeRaw ? rawFrom : undefined,
            timeRawTo: shouldShareRelativeRaw ? rawTo : undefined,
        });
    }, [currentTable, currentTimeField, _currentDate, discoverCurrent.database, discoverCurrent.table, locSearch, searchType, searchValue, selectedDatasource, timeRange?.raw, timeZone, updateShareParams]);

    useEffect(() => {
        setApplicationDraft(committedApplication);
    }, [committedApplication]);

    useEffect(() => {
        if (
            !hasResourceAttributes ||
            !selectdbDS ||
            !discoverCurrent.database ||
            !currentTable ||
            !currentTimeField ||
            !applicationStartDate ||
            !applicationEndDate
        ) {
            setApplicationOptions([]);
            setApplicationOptionsLoading(false);
            return;
        }

        setApplicationOptionsLoading(true);
        const subscription = getApplicationValuesService({
            selectdbDS,
            database: discoverCurrent.database,
            table: currentTable,
            timeField: currentTimeField,
            startDate: applicationStartDate,
            endDate: applicationEndDate,
            attributeKey: applicationAttributeKey,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setApplicationOptionsLoading(false);
                if (!ok) {
                    setApplicationOptions([]);
                    return;
                }

                const frame = data?.results?.getApplicationValues?.frames?.[0];
                if (!frame) {
                    setApplicationOptions([]);
                    return;
                }

                const dataFrame = toDataFrame(frame);
                const values = Array.from(dataFrame.fields[0]?.values || []);
                const uniqueValues = new Set<string>();
                values.forEach(value => {
                    if (value != null && String(value).trim()) {
                        uniqueValues.add(String(value));
                    }
                });
                setApplicationOptions(Array.from(uniqueValues, value => ({ label: value, value })));
            },
            error: (error: any) => {
                setApplicationOptionsLoading(false);
                setApplicationOptions([]);
                logError(toError(error), { source: 'DiscoverHeader', action: 'getApplicationValues' });
            },
        });

        return () => subscription.unsubscribe();
    }, [
        applicationAttributeKey,
        applicationEndDate,
        applicationStartDate,
        currentTable,
        currentTimeField,
        discoverCurrent.database,
        hasResourceAttributes,
        selectdbDS,
    ]);

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
                <Field
                    label="Datasource"
                    description={datasourcePermissionsError ? 'Failed to load team datasource permissions' : undefined}
                >
                    {/* filter 这个版本无效 */}
                    <DataSourcePicker
                         width={15}
                         type={'mysql'}
                         current={selectedDatasource}
                         placeholder="Choose"
                         noDefault
                         disabled={datasourcePermissionsLoading || allowedDatasources.length === 0}
                         isLoading={datasourcePermissionsLoading}
                         filter={ds => ds.type === 'mysql' && allowedDatasourceUids.has(ds.uid)}
                         onChange={item => {
                             if (!allowedDatasourceUids.has(item.uid)) {
                                 return;
                             }
                             resetApplicationFilter();
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
                            resetApplicationFilter();
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
                                error: (err: any) => logError(toError(err), { source: 'DiscoverHeader', action: 'getTables' }),
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
                            resetApplicationFilter();
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
                {isApplicationFilterConfigured ? (
                    <Field label="Application" style={{ marginLeft: 8 }}>
                        <Select
                            options={visibleApplicationOptions}
                            width={14}
                            value={applicationDraft || undefined}
                            placeholder={hasResourceAttributes ? 'All' : 'Unavailable'}
                            isClearable={true}
                            isLoading={applicationOptionsLoading}
                            disabled={!hasResourceAttributes}
                            onChange={(selectedApplication: SelectableValue<string>) => {
                                setApplicationDraft(selectedApplication?.value || '');
                            }}
                        />
                    </Field>
                ) : null}
                <Field label="Mode" style={{ marginLeft: 8, marginRight: 8, width: '120px' }}>
                    <SearchType />
                </Field>
                {searchType === 'Lucene' ? (
                    <Field label="Lucene" style={{ width: '100%' }}>
                        <Lucene onQuerying={commitApplicationAndQuery} />
                    </Field>
                ) : (
                    <Field label={searchMode ? 'Search' : 'SQL'} style={{ width: '100%' }}>
                        <SQLSearch
                            style={{ flex: '1' }}
                            onQuerying={commitApplicationAndQuery}
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
                                    const searchParams = new URLSearchParams(prev?.searchParams?.toString() ?? '');
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
                                const [start, end] = toDayjsRange(timeRange);
                                setActiveItem(undefined);
                                const rawFrom = normalizeRawTimeValue(timeRange.raw?.from);
                                const rawTo = normalizeRawTimeValue(timeRange.raw?.to);
                                const hasRelativeRaw = isRelativeRawRange(timeRange.raw);

                                setLoc(prev => {
                                    const searchParams = new URLSearchParams(prev?.searchParams?.toString() ?? '');
                                    if (hasRelativeRaw && rawFrom && rawTo) {
                                        searchParams?.delete('startTime');
                                        searchParams?.delete('endTime');
                                        searchParams?.set('timeRawFrom', rawFrom);
                                        searchParams?.set('timeRawTo', rawTo);
                                    } else {
                                        searchParams?.set('startTime', formatTimeInZone(start, timeZone));
                                        searchParams?.set('endTime', formatTimeInZone(end, timeZone));
                                        searchParams?.delete('timeRawFrom');
                                        searchParams?.delete('timeRawTo');
                                    }
                                    searchParams?.set('timeZone', timeZone);
                                    return {
                                        ...prev,
                                        searchParams,
                                    };
                                });

                                setCurrentDate([start, end]);
                                setTimeRange({
                                    from: dateTime(timeRange.from.toDate()),
                                    to: dateTime(timeRange.to.toDate()),
                                    raw: hasRelativeRaw && rawFrom && rawTo ? { from: rawFrom, to: rawTo } : { from: dateTime(timeRange.from.toDate()), to: dateTime(timeRange.to.toDate()) },
                                });
                            }}
                            onChangeTimeZone={(nextTimeZone: TimeZone) => {
                                setTimeZone(nextTimeZone);
                                updateShareParams({ timeZone: nextTimeZone });
                            }}
                            timeZone={timeZone}
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
                            const currentShortcut = DISCOVER_SHORTCUTS.find(shortcut => shortcut.key === activeItem?.key);
                            const rawFrom = normalizeRawTimeValue(currentShortcut?.raw?.from);
                            const rawTo = normalizeRawTimeValue(currentShortcut?.raw?.to);
                            setLoc(prev => {
                                const searchParams = new URLSearchParams(prev?.searchParams?.toString() ?? '');
                                searchParams?.delete('startTime');
                                searchParams?.delete('endTime');
                                if (rawFrom && rawTo) {
                                    searchParams?.set('timeRawFrom', rawFrom);
                                    searchParams?.set('timeRawTo', rawTo);
                                } else {
                                    searchParams?.delete('timeRawFrom');
                                    searchParams?.delete('timeRawTo');
                                }
                                return {
                                    ...prev,
                                    searchParams,
                                };
                            });
                            setCurrentDate([dayjs(latestStartTime), dayjs(latestEndTime)]);
                            setTimeRange((prev: any) => ({
                                ...prev,
                                from: dateTime(dayjs(latestStartTime).toDate()),
                                to: dateTime(dayjs(latestEndTime).toDate()),
                                raw: rawFrom && rawTo ? { from: rawFrom, to: rawTo } : buildAbsoluteTimeRange(dayjs(latestStartTime), dayjs(latestEndTime)).raw,
                            }));
                        }
                        commitApplicationAndQuery();
                    }}
                    variant="primary"
                    className="h-8"
                    icon={loading ? 'fa fa-spinner' : 'sync'}
                    disabled={!currentTimeField}
                >
                    {`Query`}
                </Button>
            </Field>
        </div>
    );
}
