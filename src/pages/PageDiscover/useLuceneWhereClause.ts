import { t } from 'i18n';
import { useCallback, useRef } from 'react';
import { useStore } from 'jotai';
import { lastValueFrom } from 'rxjs';
import { toDataFrame } from '@grafana/data';
import {
    currentDatabaseAtom,
    currentTableAtom,
    currentDateAtom,
    currentTimeFieldAtom,
    searchTypeAtom,
    searchValueAtom,
    selectedDatasourceAtom,
    tableMetadataAtom,
    tableFieldsAtom,
    indexesAtom,
    variantImplicitPathsAtom,
    variantPathFrequenciesAtom,
    variantSamplingWarningAtom,
} from 'store/discover';
import { discoverRestoreEpochAtom } from 'store/discover-snapshot';
import { getWhereSQLViaLucene } from 'services/lucene';
import { getFieldsService, getIndexesService, getVariantPathSampleService } from 'services/metaservice';
import { formatSqlTime } from 'utils/time';
import { mergeVariantPathSamples, variantPathsFromFrequencies } from 'utils/variant-path-cache';
import SqlString from 'sqlstring';

export type LuceneBuildOptions = { refreshMetadata?: boolean; refreshPaths?: boolean };

function rowsFromResponse(response: any, refId: string): Array<Record<string, any>> {
    const result = response?.data?.results?.[refId];
    if (!response?.ok || result?.error) {
        throw new Error(result?.error || t('Failed to load search metadata'));
    }
    const frame = result?.frames?.[0];
    if (!frame) {
        return [];
    }
    const fields = toDataFrame(frame).fields;
    return Array.from(fields[0]?.values || []).map((_, i) => Object.fromEntries(fields.map(field => [field.name, field.values[i]])));
}

export function rememberVariantSamples(store: ReturnType<typeof useStore>, key: string, columns: string[], rows: Array<Record<string, unknown>>) {
    const oldPaths = store.get(variantImplicitPathsAtom)[key] || {};
    const previous =
        store.get(variantPathFrequenciesAtom)[key] || Object.fromEntries(Object.entries(oldPaths).map(([column, paths]) => [column, paths.map(path => ({ path, count: 0 }))]));
    const frequencies = mergeVariantPathSamples(previous, columns, rows);
    store.set(variantPathFrequenciesAtom, all => ({ ...all, [key]: frequencies }));
    store.set(variantImplicitPathsAtom, all => ({ ...all, [key]: variantPathsFromFrequencies(frequencies) }));
}

export function useLuceneWhereClause() {
    const store = useStore();
    const sampledContext = useRef('');
    const inFlight = useRef<{ key: string; promise: Promise<string> } | null>(null);
    return useCallback(
        (options: LuceneBuildOptions = {}): Promise<string> => {
            const datasource = store.get(selectedDatasourceAtom);
            const database = store.get(currentDatabaseAtom);
            const table = store.get(currentTableAtom);
            const query = store.get(searchValueAtom).trim();
            const mode = store.get(searchTypeAtom);
            if ((mode !== 'Lucene' && !options.refreshMetadata) || !datasource || !database || !table) {
                return Promise.resolve('');
            }
            const epoch = store.get(discoverRestoreEpochAtom);
            const key = JSON.stringify([datasource.uid, database, table]);
            const requestKey = JSON.stringify([key, epoch, query, store.get(currentDateAtom).map(date => date.valueOf()), options]);
            if (inFlight.current?.key === requestKey) {
                return inFlight.current.promise;
            }
            const isCurrent = () => epoch === store.get(discoverRestoreEpochAtom) && key === JSON.stringify([store.get(selectedDatasourceAtom)?.uid, store.get(currentDatabaseAtom), store.get(currentTableAtom)]);
            const promise = (async () => {
                let meta = store.get(tableMetadataAtom)[key];
                if (options.refreshMetadata || !meta?.fields || !meta?.indexes) {
                    const [fields, indexes] = await Promise.all([
                        options.refreshMetadata || !meta?.fields
                            ? lastValueFrom(getFieldsService({ selectdbDS: datasource, database, table })).then(response =>
                                  rowsFromResponse(response, 'getFields').map(field => ({ ...field, label: field.Field, value: field.Field })),
                              )
                            : meta.fields,
                        options.refreshMetadata || !meta?.indexes
                            ? lastValueFrom(getIndexesService({ selectdbDS: datasource, database, table })).then(response =>
                                  rowsFromResponse(response, 'getIndexes').map(index => ({
                                      type: index.Index_type,
                                      columnName: index.Column_name,
                                      label: index.Key_name,
                                      value: index.Key_name,
                                  })),
                              )
                            : meta.indexes,
                    ]);
                    meta = { fields, indexes };
                    if (!isCurrent()) {
                        throw new Error(t('Search table changed while loading metadata'));
                    }
                    store.set(tableMetadataAtom, previous => ({ ...previous, [key]: meta! }));
                    store.set(tableFieldsAtom, fields);
                    store.set(indexesAtom, indexes);
                }
                if (!isCurrent()) {
                    throw new Error(t('Search table changed while loading metadata'));
                }
                const fields = meta.fields!;
                const columns = fields.filter(field => /^VARIANT/i.test(field.Type || '')).map(field => String(field.Field));
                if (columns.length && (options.refreshPaths || sampledContext.current !== key)) {
                    const dates = store.get(currentDateAtom);
                    try {
                        const response = await lastValueFrom(
                            getVariantPathSampleService({
                                selectdbDS: datasource,
                                database,
                                table,
                                columns,
                                timeField: store.get(currentTimeFieldAtom),
                                startDate: formatSqlTime(dates[0]),
                                endDate: formatSqlTime(dates[1]),
                            }),
                        );
                        const samples = rowsFromResponse(response, 'sampleVariantPaths').map(row =>
                            Object.fromEntries(columns.map((column, index) => [column, row[`c${index + 1}`]])),
                        );
                        if (!isCurrent()) {throw new Error(t('Search table changed while sampling attributes'));}
                        rememberVariantSamples(store, key, columns, samples);
                        store.set(variantSamplingWarningAtom, previous => ({ ...previous, [key]: '' }));
                        if (isCurrent()) {
                            sampledContext.current = key;
                        }
                    } catch {
                        if (!isCurrent()) {throw new Error(t('Search table changed while sampling attributes'));}
                        store.set(variantSamplingWarningAtom, previous => ({
                            ...previous,
                            [key]: 'Attribute path sampling failed. Free-text search uses cached paths and may miss attribute values.',
                        }));
                    }
                }
                if (!isCurrent()) {
                    throw new Error(t('Search table changed while sampling attributes'));
                }
                const implicitFields = fields.filter(field => /^(?:CHAR|VARCHAR|TEXT|STRING|JSON)/i.test(field.Type || ''));
                if (!query || mode !== 'Lucene') {
                    return '';
                }
                return getWhereSQLViaLucene({
                    query,
                    connectionId: datasource.uid,
                    datasourceType: datasource.type,
                    databaseName: database,
                    tableName: table,
                    implicitColumnExpression:
                        implicitFields
                            .slice(0, 10)
                            .map(field => `coalesce(${SqlString.escapeId(field.Field)}, '')`)
                            .join(',\n') || undefined,
                    columnMeta: {
                        columns: fields.map(field => ({ name: String(field.Field), type: String(field.Type || t('Unknown')) })),
                        invertedIndexColumns: meta.indexes!.filter(index => /inverted/i.test(index.type || '')).map(index => String(index.columnName)),
                    },
                    variantImplicitPaths: store.get(variantImplicitPathsAtom)[key] || {},
                });
            })().finally(() => {
                if (inFlight.current?.key === requestKey) {
                    inFlight.current = null;
                }
            });
            inFlight.current = { key: requestKey, promise };
            return promise;
        },
        [store],
    );
}
