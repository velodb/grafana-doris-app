import { t } from 'i18n';
import { useCallback, useEffect } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { useStore } from 'jotai';
import { DataSourceInstanceSettings, toDataFrame } from '@grafana/data';
import { Observable, lastValueFrom, timeout } from 'rxjs';
import * as atoms from 'store/discover';
import { discoverRestoreEpochAtom, discoverRestoreErrorAtom, discoverRestoreWarningAtom } from 'store/discover-snapshot';
import { DiscoverShareState } from 'utils/discover-share-state';
import { validateSavedQueryState } from 'utils/saved-query-state';
import { buildAbsoluteTimeRange, buildRelativeTimeRange, normalizeTimeZone, parseTimeInZone, toDayjsRange } from 'utils/time';
import { DISCOVER_SHORTCUTS, isStructuredJsonType, isValidTimeFieldType } from 'utils/data';
import { deriveVariantFields, deriveVariantFieldsFromMetadata, flattenVariantLeaves } from 'utils/variant-fields';
import { getDatabases, getTablesService, getFieldsService, getIndexesService, getVariantFieldsService } from 'services/metaservice';

async function frameFor(request: Observable<any>, ref: string) {
    const response = await lastValueFrom(request.pipe(timeout(20000)));
    const result = response?.data?.results?.[ref];
    if (!response?.ok || result?.error || !result?.frames?.[0]) {
        throw new Error(result?.error || t('Failed to load {{resource}}', { resource: ref }));
    }
    return toDataFrame(result.frames[0]);
}

export function useDiscoverRestore(allowedDatasources: DataSourceInstanceSettings[], invalidateMetadata: () => void) {
    const store = useStore();
    useEffect(
        () => () => {
            store.set(discoverRestoreEpochAtom, n => n + 1);
        },
        [store],
    );

    return useCallback(
        async (input: DiscoverShareState, strict = true): Promise<boolean> => {
            const epoch = store.get(discoverRestoreEpochAtom) + 1;
            store.set(discoverRestoreEpochAtom, epoch);
            store.set(atoms.discoverShareReadyAtom, false);
            store.set(discoverRestoreErrorAtom, '');
            store.set(discoverRestoreWarningAtom, '');
            invalidateMetadata();
            store.set(atoms.topNEnabledAtom, false);
            store.set(atoms.topNResultFieldsAtom, []);
            store.set(atoms.topNRowsAtom, []);
            store.set(atoms.tableDataAtom, []);
            store.set(atoms.tableDataChartsAtom, []);
            store.set(atoms.tableEChartsDataAtom, []);
            store.set(atoms.tableTotalCountAtom, 0);
            store.set(atoms.topDataAtom, []);
            store.set(atoms.discoverQueryStateAtom, { status: 'idle', rowCount: 0, auxiliaryErrors: [] });
            store.set(atoms.discoverLoadingAtom, previous => Object.fromEntries(Object.keys(previous).map(key => [key, false])) as typeof previous);
            const current = () => store.get(discoverRestoreEpochAtom) === epoch;
            try {
                const state = strict ? validateSavedQueryState(input) : input;
                const ds = allowedDatasources.find(ds => ds.uid === state.datasource || (!strict && ds.name === state.datasource));
                if (!ds) {
                    throw new Error(t('The saved datasource is unavailable or you do not have permission to use it'));
                }
                const databasesFrame = await frameFor(getDatabases(ds), 'getDatabases');
                if (!current()) {
                    return false;
                }
                const databases = Array.from(databasesFrame.fields[0]?.values || [], value => ({ label: String(value), value: String(value) }));
                if (!databases.some(db => db.value === state.database)) {
                    throw new Error(t('Database is unavailable: {{database}}', { database: state.database }));
                }
                const tablesFrame = await frameFor(getTablesService({ selectdbDS: ds, database: state.database! }), 'getTables');
                if (!current()) {
                    return false;
                }
                const tables = Array.from(tablesFrame.fields[0]?.values || [], value => ({ label: String(value), value: String(value) }));
                if (!tables.some(table => table.value === state.table)) {
                    throw new Error(t('Table is unavailable: {{table}}', { table: state.table }));
                }
                const params = { selectdbDS: ds, database: state.database!, table: state.table! };
                // Start independent metadata requests together. Optional extended DESC
                // may fail, but it must settle before the first restored query runs.
                const [fieldsFrame, variantsFrame, indexesFrame] = await Promise.all([
                    frameFor(getFieldsService(params), 'getFields'),
                    frameFor(getVariantFieldsService(params), 'getVariantFields').catch(() => undefined),
                    frameFor(getIndexesService(params), 'getIndexes').catch(() => undefined),
                ]);
                if (!current()) {
                    return false;
                }
                const fields = Array.from(fieldsFrame.fields[0]?.values || [], (value, i) => ({
                    Field: String(value),
                    Type: String(fieldsFrame.fields[1]?.values[i] || ''),
                    label: String(value),
                    value: String(value),
                }));
                const timeFields = fields.filter(field => isValidTimeFieldType(field.Type.toUpperCase())).map(field => ({ label: field.Field, value: field.Field }));
                if (!state.timeField && !strict) {
                    state.timeField = timeFields[0]?.value;
                }
                if (!timeFields.some(field => field.value === state.timeField)) {
                    throw new Error(t('Time field is unavailable: {{field}}', { field: state.timeField }));
                }
                const variants = variantsFrame
                    ? deriveVariantFieldsFromMetadata(
                          fields,
                          Array.from(variantsFrame.fields[0]?.values || [], (Field, i) => ({ Field, Type: variantsFrame.fields[1]?.values[i] })),
                      )
                    : deriveVariantFields(fields, []);
                const byName = new Map<string, any>([...fields, ...flattenVariantLeaves(variants)].map(field => [field.Field, field]));
                const resolve = (name: string, path?: string[], type?: string, key?: string) => {
                    const leafPath = path || (key ? [name, key] : undefined);
                    // Explicit JSON/VARIANT paths can be sparse and absent from DESC.
                    // Keep them only when the physical root still has a structured type.
                    if (leafPath?.length) {
                        const root = fields.find(field => field.Field === leafPath[0]);
                        if (!root || !isStructuredJsonType(root.Type)) {
                            return undefined;
                        }
                        const found = byName.get(name);
                        return {
                            ...found,
                            Field: name,
                            Type: found?.variantPath ? found.Type : type || 'VARCHAR',
                            variantPath: leafPath,
                            variantKey: key,
                            value: name,
                            label: name,
                        };
                    }
                    return byName.get(name);
                };
                const invalidFilters = state.filters.filter(filter => !resolve(filter.fieldName, filter.variantPath, filter.fieldType, filter.variantKey));
                if (invalidFilters.length) {
                    throw new Error(t('Filter fields are unavailable: {{fields}}', { fields: invalidFilters.map(f => f.fieldName).join(', ') }));
                }
                if (state.sort.field && !resolve(state.sort.field, state.sort.variantPath, state.sort.variantType)) {
                    throw new Error(t('Sort field is unavailable: {{field}}', { field: state.sort.field }));
                }
                const selectedFields = state.selectedFields.map(field => resolve(field.Field, field.variantPath, field.Type, field.variantKey)).filter(Boolean);
                const missing = state.selectedFields.filter(field => !resolve(field.Field, field.variantPath, field.Type, field.variantKey));
                const zone = state.timeZone ? normalizeTimeZone(state.timeZone) : store.get(atoms.timeZoneAtom);
                if (!zone) {
                    throw new Error(t('Invalid saved time zone'));
                }
                let range = store.get(atoms.timeRangeAtom);
                if (state.timeRawFrom && state.timeRawTo) {
                    range = buildRelativeTimeRange(state.timeRawFrom, state.timeRawTo, zone);
                } else if (state.startTime && state.endTime) {
                    const start = parseTimeInZone(state.startTime, zone),
                        end = parseTimeInZone(state.endTime, zone);
                    if (!start?.isValid() || !end?.isValid() || start.isAfter(end)) {
                        throw new Error(t('Invalid saved time range'));
                    }
                    range = buildAbsoluteTimeRange(start, end);
                }
                if (!range?.from?.isValid() || !range?.to?.isValid() || range.from.valueOf() > range.to.valueOf()) {
                    throw new Error(t('Invalid saved time range'));
                }
                if (!current()) {
                    return false;
                }
                const indexFields = indexesFrame?.fields || [];
                const names = indexFields.find(f => f.name === 'Key_name') || indexFields[2];
                const columns = indexFields.find(f => f.name === 'Column_name') || indexFields[4];
                const types = indexFields.find(f => f.name === 'Index_type') || indexFields[10];
                const indexes = Array.from(names?.values || [], (value, i) => ({ label: value, value, columnName: columns?.values[i], type: types?.values[i] }));
                unstable_batchedUpdates(() => {
                    store.set(atoms.selectedDatasourceAtom, ds);
                    store.set(atoms.databasesAtom, databases);
                    store.set(atoms.tablesAtom, tables);
                    store.set(atoms.currentTableAtom, state.table!);
                    store.set(atoms.discoverCurrentAtom, previous => ({ ...previous, database: state.database!, table: state.table!, timeField: state.timeField! }));
                    store.set(atoms.tableFieldsAtom, fields);
                    store.set(atoms.timeFieldsAtom, timeFields);
                    store.set(atoms.variantMetadataFieldsAtom, variants);
                    store.set(atoms.variantFieldsAtom, variants);
                    store.set(atoms.indexesAtom, indexes);
                    store.set(atoms.currentIndexAtom, indexes);
                    const metadataKey = JSON.stringify([ds.uid, state.database, state.table]);
                    store.set(atoms.tableMetadataAtom, previous => ({ ...previous, [metadataKey]: { fields, indexes } }));
                    store.set(atoms.timeZoneAtom, zone);
                    store.set(atoms.timeRangeAtom, range);
                    store.set(atoms.currentDateAtom, toDayjsRange(range));
                    store.set(
                        atoms.activeShortcutAtom,
                        DISCOVER_SHORTCUTS.find(shortcut => shortcut.raw.from === state.timeRawFrom && shortcut.raw.to === state.timeRawTo),
                    );
                    store.set(atoms.searchTypeAtom, state.mode || store.get(atoms.searchTypeAtom));
                    store.set(atoms.searchValueAtom, state.query || '');
                    store.set(atoms.dataFilterAtom, state.filters);
                    store.set(atoms.selectedFieldsAtom, selectedFields);
                    store.set(atoms.discoverSharedColumnOrderAtom, state.columnOrder);
                    store.set(atoms.discoverSortAtom, state.sort);
                    store.set(atoms.pageAtom, 1);
                    if (missing.length) {
                        store.set(discoverRestoreWarningAtom, `Unavailable display columns were skipped: ${missing.map(field => field.Field).join(', ')}`);
                    }
                    store.set(atoms.discoverShareReadyAtom, true);
                });
                return true;
            } catch (error) {
                if (current()) {
                    store.set(discoverRestoreErrorAtom, error instanceof Error ? error.message : 'Failed to restore query');
                }
                return false;
            }
        },
        [allowedDatasources, invalidateMetadata, store],
    );
}
