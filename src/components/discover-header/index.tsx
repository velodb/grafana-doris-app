'use client';
import { t } from 'i18n';
import React, { PropsWithChildren, useEffect } from 'react';
import dayjs from 'dayjs';
import { DiscoverHeaderControls, DiscoverHeaderSearch, DiscoverHeaderField, DiscoverHeaderActions } from './discover-header.style';
import SearchType from './search-type';
import SQLSearch from './sql-search';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { DataSourcePicker, getDataSourceSrv, logError } from '@grafana/runtime';
import { css } from '@emotion/css';
import { SelectableValue, TimeZone, dateTime, usePluginContext, toDataFrame } from '@grafana/data';
import { mergeLogsConfig, type AppPluginSettings } from 'types/plugin-settings';
import {
    indexesAtom,
    tableMetadataAtom,
    searchTypeAtom,
    discoverCurrentAtom,
    locationAtom,
    // currentClusterAtom,
    tableFieldsAtom,
    variantFieldsAtom,
    variantMetadataFieldsAtom,
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
    discoverShareReadyAtom,
    discoverSharedColumnOrderAtom,
    discoverSortAtom,
    selectedFieldsAtom,
} from 'store/discover';
import { DISCOVER_SHORTCUTS, getLatestTime, isValidTimeFieldType } from 'utils/data';
import { Select, Button, Icon, Tooltip, useTheme2, TimeRangeInput } from '@grafana/ui';
import { getApplicationValuesService, getFieldsService, getIndexesService, getVariantFieldsService } from 'services/metaservice';
import { SUPPORTED_DATASOURCE_TYPES, isSupportedDatasourceType } from 'services/grafana-permissions';
import { useDatabaseTableSelection } from 'hooks/useDatabaseTableSelection';
import Lucene from './lucene';
import { toError } from 'utils/errors';
import { getLuceneFieldsWithoutInvertedIndex } from 'utils/query-parser/lucene-index-warning';
import { useDatasourcePermissions } from 'hooks/useDatasourcePermissions';
import { formatSqlTime, formatShareTime, buildAbsoluteTimeRange, buildRelativeTimeRange, normalizeTimeZone, parseTimeInZone, toDayjsRange } from 'utils/time';
import { APPLICATION_FILTER_ID, applyApplicationFilter, getCommittedApplication, getConfiguredApplicationAttributeKey } from './application-filter';
import { deriveVariantFields, deriveVariantFieldsFromMetadata } from 'utils/variant-fields';
import { readDiscoverShareState } from 'utils/discover-share-state';
import SavedQueries from 'components/saved-queries';
import { useDiscoverRestore } from 'hooks/useDiscoverRestore';
import { discoverSnapshotAtom, discoverRestoreEpochAtom, discoverRestoreErrorAtom, discoverRestoreWarningAtom } from 'store/discover-snapshot';
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
        onRefresh?: () => void;
        loading: boolean;
    },
) {
    const { loading, onQuerying, onRefresh } = props;
    // const catalog = 'internal';
    // const catalogs = useAtomValue(catalogAtom);
    const setIndexes = useSetAtom(indexesAtom);
    const setTableMetadata = useSetAtom(tableMetadataAtom);
    const requestedFieldsKey = React.useRef('');
    const requestedIndexesKey = React.useRef('');
    const metadataGeneration = React.useRef(0);
    useEffect(() => () => { metadataGeneration.current += 1; }, []);
    const [searchType, setSearchType] = useAtom(searchTypeAtom);
    const [discoverCurrent, setDiscoverCurrent] = useAtom(discoverCurrentAtom);
    if (process.env.NODE_ENV !== 'production') {
        discoverCurrentAtom.debugLabel = 'current';
    }
    const [loc, setLoc] = useAtom(locationAtom);
    // const [currentCluster, setCurrentCluster] = useAtom(currentClusterAtom);
    const [tableFields, setTableFields] = useAtom(tableFieldsAtom);
    const setVariantFields = useSetAtom(variantFieldsAtom);
    const setVariantMetadataFields = useSetAtom(variantMetadataFieldsAtom);
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
    const setSelectedFields = useSetAtom(selectedFieldsAtom);
    const setSharedColumnOrder = useSetAtom(discoverSharedColumnOrderAtom);
    const setShareSort = useSetAtom(discoverSortAtom);
    const [shareReady, setDiscoverShareReady] = useAtom(discoverShareReadyAtom);
    const snapshot = useAtomValue(discoverSnapshotAtom);
    const [restoreError, setRestoreError] = useAtom(discoverRestoreErrorAtom);
    const restoreWarning = useAtomValue(discoverRestoreWarningAtom);
    const setRestoreEpoch = useSetAtom(discoverRestoreEpochAtom);
    const [applicationDraft, setApplicationDraft] = React.useState('');
    const [applicationOptions, setApplicationOptions] = React.useState<Array<SelectableValue<string>>>([]);
    const [applicationOptionsLoading, setApplicationOptionsLoading] = React.useState(false);
    const [resolvedFieldsContext, setResolvedFieldsContext] = React.useState('');
    const searchMode = searchType === 'Search';
    const indexes = useAtomValue(indexesAtom);
    const fieldsWithoutInvertedIndex = React.useMemo(
        () => (searchType === 'Lucene' ? getLuceneFieldsWithoutInvertedIndex(searchValue, indexes, tableFields) : []),
        [indexes, searchType, searchValue, tableFields],
    );
    const warningFields = fieldsWithoutInvertedIndex.slice(0, 3).join(', ');
    const remainingWarningFieldCount = fieldsWithoutInvertedIndex.length - 3;
    const jsonFieldsWithoutInvertedIndex = React.useMemo(() => {
        const jsonRoots = new Set(
            tableFields
                .filter((field: any) => String(field?.Type ?? '').toUpperCase().includes('JSON'))
                .map((field: any) => String(field?.Field ?? field?.value ?? field?.name ?? '').toLowerCase()),
        );
        return fieldsWithoutInvertedIndex.filter(field => jsonRoots.has(field.split('.')[0].toLowerCase()));
    }, [fieldsWithoutInvertedIndex, tableFields]);

    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const theme = useTheme2();
    const context = usePluginContext();
    const jsonData = context.meta.jsonData || {};
    const configuredLogsConfig = (jsonData as AppPluginSettings).logsConfig;
    const logsConfig = mergeLogsConfig(configuredLogsConfig);
    const applicationAttributeKey = getConfiguredApplicationAttributeKey(configuredLogsConfig?.applicationAttributeKey);
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
        isApplicationFilterConfigured && resolvedFieldsContext === fieldsContext && tableFields.some((field: any) => field?.Field === 'resource_attributes');
    const committedApplication = getCommittedApplication(dataFilter, applicationAttributeKey);
    const applicationStartDate = _currentDate[0] ? formatSqlTime(_currentDate[0]) : '';
    const applicationEndDate = _currentDate[1] ? formatSqlTime(_currentDate[1]) : '';
    const visibleApplicationOptions = React.useMemo(() => {
        if (!applicationDraft || applicationOptions.some(option => option.value === applicationDraft)) {
            return applicationOptions;
        }

        return [{ label: applicationDraft, value: applicationDraft }, ...applicationOptions];
    }, [applicationDraft, applicationOptions]);

    const resetApplicationFilter = React.useCallback(() => {
        requestedFieldsKey.current = '';
        requestedIndexesKey.current = '';
        setApplicationDraft('');
        setDataFilter(current => {
            const next = current.filter(filter => filter.id !== APPLICATION_FILTER_ID);
            return next.length === current.length ? current : next;
        });
        setApplicationOptions([]);
        setResolvedFieldsContext('');
    }, [setDataFilter]);

    const commitApplicationAndQuery = React.useCallback(() => {
        if (!shareReady) {return;}
        const result = applyApplicationFilter(dataFilter, applicationDraft, applicationAttributeKey);
        if (!result.changed) {
            onQuerying();
            return;
        }
        setDataFilter(result.filters);
    }, [applicationAttributeKey, applicationDraft, dataFilter, onQuerying, setDataFilter, shareReady]);

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
                    setVariantFields(deriveVariantFields(tableFields, []));
                    setVariantMetadataFields([]);
                    setResolvedFieldsContext(`${effectiveDatasource.uid || ''}\u0000${effectiveDatabase}\u0000${selectedTable.value}`);

                    getVariantFieldsService({ selectdbDS: effectiveDatasource, database: effectiveDatabase, table: selectedTable.value }).subscribe({
                        next: ({ data, ok }: any) => {
                            if (requestedFieldsKey.current !== metadataKey || metadataGeneration.current !== generation) {
                                return;
                            }
                            const metadataFrame = data?.results?.getVariantFields?.frames?.[0];
                            if (!ok || !metadataFrame) {
                                return;
                            }
                            const metadata = toDataFrame(metadataFrame);
                            const names = Array.from(metadata.fields[0]?.values || []);
                            const types = Array.from(metadata.fields[1]?.values || []);
                            const variantMetadata = deriveVariantFieldsFromMetadata(
                                tableFields,
                                names.map((Field: any, index: number) => ({ Field, Type: types[index] })),
                            );
                            setVariantMetadataFields(variantMetadata);
                            setVariantFields(variantMetadata);
                        },
                        error: () => {
                            // Extended DESC is optional. Sampling remains available below.
                        },
                    });

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
                        const targetTimeField = options.some(option => option.value === preferredTimeField) ? preferredTimeField : options[0]?.value || '';

                        setDiscoverCurrent(prev => ({
                            ...prev,
                            database: effectiveDatabase,
                            table: selectedTable.value,
                            timeField: targetTimeField,
                        }));
                        setTimeFields(options);
                        initOptions?.onResolved?.(targetTimeField);
                        // Enable Discover's initial query after datasource, table, and time field
                        // have been resolved, including links that use the individual URL params.
                        setDiscoverShareReady(true);
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
                    const frameData = data?.results?.getIndexes?.frames?.[0];
                    if (!frameData) {
                        setTableMetadata(previous => ({ ...previous, [metadataKey]: { ...previous[metadataKey], indexes: [] } }));
                        setIndexes([]);
                        setCurrentIndex([]);
                        return;
                    }
                    const frame = toDataFrame(frameData);
                    if (frame.fields.length === 0) {
                        setTableMetadata(previous => ({ ...previous, [metadataKey]: { ...previous[metadataKey], indexes: [] } }));
                        setIndexes([]);
                        setCurrentIndex([]);
                        return;
                    }
                    const values = Array.from((frame.fields.find(field => field.name === 'Key_name') ?? frame.fields[2])?.values ?? []);
                    const columnNames = Array.from((frame.fields.find(field => field.name === 'Column_name') ?? frame.fields[4])?.values ?? []);
                    const indexesTypes = Array.from((frame.fields.find(field => field.name === 'Index_type') ?? frame.fields[10])?.values ?? []);

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
                logError(toError(err), { source: 'DiscoverHeader', action: 'getIndexes' });
            },
        });
    }

    const applyTableSelection = (datasource: any, database: string, table: string, timeField?: string) => {
        setRestoreEpoch(n => n + 1);
        setRestoreError('');
        metadataGeneration.current += 1;
        requestedFieldsKey.current = '';
        requestedIndexesKey.current = '';
        setTableFields([]);
        setTimeFields([]);
        setIndexes([]);
        setCurrentIndex([]);
        resetApplicationFilter();
        setVariantFields([]);
        setVariantMetadataFields([]);
        setSelectedFields([]);
        setDataFilter([]);
        setSharedColumnOrder([]);
        setShareSort({ field: '', direction: 'DESC' });
        setDiscoverShareReady(false);
        setCurrentTable(table);
        setDiscoverCurrent(prev => ({ ...prev, database, table, timeField: '' }));
        if (table) {
            getFields({ value: table }, { datasource, database, preferredTimeField: timeField ?? '' });
            getIndexes({ value: table }, { datasource, database });
        }
    };

    const { selectDatasource, selectDatabase, databasesLoading, tablesLoading, cancelSelection } = useDatabaseTableSelection({
        setDatabases,
        setTables,
        onDatabaseChange: database => setDiscoverCurrent(prev => ({ ...prev, database, table: '', timeField: '' })),
        onTableChange: applyTableSelection,
    });

    const invalidateMetadata = React.useCallback(() => {
        metadataGeneration.current += 1;
        requestedFieldsKey.current = '';
        requestedIndexesKey.current = '';

        cancelSelection();
    }, [cancelSelection]);
    const restoreSnapshot = useDiscoverRestore(allowedDatasources, invalidateMetadata);
    const restore = React.useCallback(async (state: Parameters<typeof restoreSnapshot>[0], strict = true) => {
        const applied = await restoreSnapshot(state, strict);
        if (applied) {
            const datasource = allowedDatasources.find(ds => ds.uid === state.datasource || ds.name === state.datasource);
            setResolvedFieldsContext(`${datasource?.uid || ''}\u0000${state.database}\u0000${state.table}`);
        }
        return applied;
    }, [allowedDatasources, restoreSnapshot]);

    async function initHeaderData() {
        const urlSearchParams = new URLSearchParams(locSearch);
        const sharedState = readDiscoverShareState(urlSearchParams);
        if (sharedState) {
            hasInitializedUrlSyncRef.current = true;
            await restore({ ...sharedState,
                datasource: sharedState.datasource || resolveDatasourceUid(logsConfig.datasource, allowedDatasources),
                database: sharedState.database || logsConfig.database,
                table: sharedState.table || logsConfig.logsTable,
            }, false);
            return;
        }
        setDiscoverShareReady(false);
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
        const defaultDatasourceUid = requestedDatasourceUid && allowedDatasourceUids.has(requestedDatasourceUid) ? requestedDatasourceUid : allowedDatasources[0]?.uid || '';
        const defaultDatabase = persistedDatabase || configuredLogsConfig?.database || '';
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
            setDiscoverShareReady(true);
            return;
        }

        if (!defaultDatasourceUid) {
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
            setDiscoverShareReady(true);
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

            const ds = allowedDatasources.find(datasource => datasource.uid === defaultDatasourceUid) ??
                (await getDataSourceSrv().get({ uid: defaultDatasourceUid }));
            if (!ds) {
                return;
            }
            setSelectedDatasource(ds as any);
            selectDatasource(ds, { database: defaultDatabase, table: defaultLogsTable, timeField: persistedTimeField });
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
        if (!hasInitializedUrlSyncRef.current || !shareReady) {
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
        const currentStartTime = _currentDate[0] ? formatShareTime(_currentDate[0]) : undefined;
        const currentEndTime = _currentDate[1] ? formatShareTime(_currentDate[1]) : undefined;

        const hasRelativeTimeParams = Boolean(urlTimeRawFrom && urlTimeRawTo);
        const hasAbsoluteTimeParams = Boolean(urlStartTime && urlEndTime);
        const isRelativeTimeSynced = hasRelativeTimeParams && rawFrom === urlTimeRawFrom && rawTo === urlTimeRawTo;
        const isAbsoluteTimeSynced = hasAbsoluteTimeParams && !shouldShareRelativeRaw && currentStartTime === urlStartTimeParam && currentEndTime === urlEndTimeParam;

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
    }, [
        currentTable,
        currentTimeField,
        _currentDate,
        discoverCurrent.database,
        discoverCurrent.table,
        locSearch,
        searchType,
        searchValue,
        selectedDatasource,
        timeRange?.raw,
        timeZone,
        updateShareParams,
        shareReady,
    ]);

    useEffect(() => {
        setApplicationDraft(committedApplication);
    }, [committedApplication]);

    useEffect(() => {
        if (!hasResourceAttributes || !selectdbDS || !discoverCurrent.database || !currentTable || !currentTimeField || !applicationStartDate || !applicationEndDate) {
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
    }, [applicationAttributeKey, applicationEndDate, applicationStartDate, currentTable, currentTimeField, discoverCurrent.database, hasResourceAttributes, selectdbDS]);

    return (
        <div
            data-testid="discover-header"
            className={css`
                padding: 12px;
                background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                display: flex;
                flex-direction: column;
                gap: 8px;
                border-radius: 0.25rem 0.25rem 0 0;
            `}
        >
            {restoreError && <div role="alert" style={{ color: theme.colors.error.text }}>
                {restoreError}{t('. Automatic querying is paused.')}<Button variant="secondary" size="sm" onClick={() => { setRestoreError(''); setDiscoverShareReady(true); }}>{t('Keep current query')}</Button>
            </div>}
            {restoreWarning && <div role="status" style={{ color: theme.colors.warning.text }}>{restoreWarning}</div>}
            <DiscoverHeaderControls data-testid="discover-header-controls">
                <DiscoverHeaderField label={t('Datasource')} description={datasourcePermissionsError ? t('Failed to load team datasource permissions') : undefined}>
                    {/* filter 这个版本无效 */}
                    <DataSourcePicker
                        width={15}
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
                </DiscoverHeaderField>
                {/* 需要从数据源中获取库表信息 */}
                <DiscoverHeaderField label={t('Database')}>
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
                </DiscoverHeaderField>

                <DiscoverHeaderField label={t('Table')}>
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
                </DiscoverHeaderField>
                {isApplicationFilterConfigured ? (
                    <DiscoverHeaderField label={t('Application')}>
                        <Select
                            options={visibleApplicationOptions}
                            width={14}
                            value={applicationDraft || undefined}
                            placeholder={hasResourceAttributes ? t('All') : t('Unavailable')}
                            isClearable={true}
                            isLoading={applicationOptionsLoading}
                            disabled={!hasResourceAttributes}
                            onChange={(selectedApplication: SelectableValue<string>) => {
                                setApplicationDraft(selectedApplication?.value || '');
                            }}
                        />
                    </DiscoverHeaderField>
                ) : null}
                {!searchFocus && (
                    <>
                        <DiscoverHeaderField label={t('Time Field')}>
                            <Select
                                value={currentTimeField}
                                width={15}
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
                                placeholder={t('Time Field')}
                            />
                        </DiscoverHeaderField>
                        <DiscoverHeaderField label={t('Time Range')} className={timeRangeFieldClass} style={{ marginLeft: 'auto' }}>
                            <TimeRangeInput
                                hideTimeZone={false}
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
                                            searchParams?.set('startTime', formatShareTime(start));
                                            searchParams?.set('endTime', formatShareTime(end));
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
                                        raw:
                                            hasRelativeRaw && rawFrom && rawTo
                                                ? { from: rawFrom, to: rawTo }
                                                : { from: dateTime(timeRange.from.toDate()), to: dateTime(timeRange.to.toDate()) },
                                    });
                                }}
                                onChangeTimeZone={(nextTimeZone: TimeZone) => {
                                    setTimeZone(nextTimeZone);
                                    updateShareParams({ timeZone: nextTimeZone });
                                }}
                                timeZone={timeZone}
                                value={timeRange}
                            />
                        </DiscoverHeaderField>
                    </>
                )}
            </DiscoverHeaderControls>
            <DiscoverHeaderSearch data-testid="discover-header-search">
                <DiscoverHeaderField label={t('Mode')} style={{ flex: '0 0 auto' }}>
                    <SearchType />
                </DiscoverHeaderField>
                {searchType === 'Lucene' ? (
                    <DiscoverHeaderField label="Lucene" style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <Lucene onQuerying={commitApplicationAndQuery} />
                    </DiscoverHeaderField>
                ) : (
                    <DiscoverHeaderField label={searchMode ? 'Search' : 'SQL'} style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <SQLSearch style={{ minWidth: 0, width: '100%' }} onQuerying={commitApplicationAndQuery} />
                    </DiscoverHeaderField>
                )}
                <DiscoverHeaderActions>
                    {fieldsWithoutInvertedIndex.length > 0 ? (
                        <Tooltip
                            content={
                                <span>
                                    {remainingWarningFieldCount > 0 ? t('{{fields}} and other fields ({{count}} total) have no inverted index. Lucene queries may be slow.', { fields: warningFields, count: fieldsWithoutInvertedIndex.length }) : t('{{fields}} have no inverted index. Lucene queries may be slow.', { fields: warningFields })}
                                    {jsonFieldsWithoutInvertedIndex.length > 0 ? t(' JSON subpaths use JSON functions for filtering and usually scan data.') : ''}
                                </span>
                            }
                            placement="top"
                        >
                            <span aria-label={t('Lucene inverted index warning')} style={{ color: theme.colors.warning.text, cursor: 'help', display: 'inline-flex' }}>
                                <Icon name="exclamation-triangle" size="sm" />
                            </span>
                        </Tooltip>
                    ) : null}
                    <Tooltip content={t('Refresh table metadata and sampled attribute paths')}>
                        <Button aria-label={t('Refresh search metadata')} variant="secondary" icon="sync" disabled={loading || !currentTimeField} onClick={onRefresh} />
                    </Tooltip>
                    <Button
                        onClick={() => {
                            const latestTime = getLatestTime(activeItem?.key as string, timeZone);
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
                        disabled={!currentTimeField || !shareReady}
                    >
                        {t('Query')}
                    </Button>
                    <SavedQueries
                        snapshot={{ ...snapshot, filters: applicationAttributeKey ? applyApplicationFilter(dataFilter, applicationDraft, applicationAttributeKey).filters : dataFilter }}
                        ready={shareReady}
                        restore={restore}
                    />
                </DiscoverHeaderActions>
            </DiscoverHeaderSearch>
        </div>
    );
}
