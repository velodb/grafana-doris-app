import { t } from 'i18n';
import React, { useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { Drawer, IconButton, LoadingPlaceholder, useTheme2 } from '@grafana/ui';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { nanoid } from 'nanoid';
import {
    currentCatalogAtom, currentDatabaseAtom, currentDateAtom, currentIndexAtom, currentTableAtom, currentTimeFieldAtom,
    dataFilterAtom, discoverQueryStateAtom, fieldStatisticsErrorAtom, fieldStatisticsFieldAtom, fieldStatisticsLoadingAtom,
    fieldStatisticsResultAtom, searchTypeAtom, searchValueAtom, selectedDatasourceAtom, tableFieldsAtom, timeZoneAtom, variantFieldsAtom,
} from 'store/discover';
import { getFieldStatisticsService } from 'services/discover';
import { convertColumnToRow, encodeBase64, formatFieldDisplayValue, getIndexesStatement } from 'utils/data';
import { flattenVariantLeaves } from 'utils/variant-fields';
import { enrichStructuredFilterTypes } from 'utils/sql-filter';
import { formatTimeInZone } from 'utils/time';
import { useLuceneWhereClause } from 'pages/PageDiscover/useLuceneWhereClause';
import { createDiscoverQueryError } from 'utils/query-error';
import { FieldStatisticsBucket } from 'types/discover';

function numberValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function parseHistogram(value: unknown): FieldStatisticsBucket[] {
    if (!value) {
        return [];
    }
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray((parsed as any)?.buckets)
            ? (parsed as any).buckets.map((bucket: any) => ({ lower: String(bucket.lower), upper: String(bucket.upper), count: numberValue(bucket.count), ndv: numberValue(bucket.ndv) }))
            : [];
    } catch {
        return [];
    }
}

function isContinuousType(type?: string) {
    return /(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|LARGEINT|FLOAT|DOUBLE|DECIMAL|DATE|TIME|TIMESTAMP)/i.test(type || '');
}

export default function FieldStatistics() {
    const theme = useTheme2();
    const [field, setField] = useAtom(fieldStatisticsFieldAtom);
    const [result, setResult] = useAtom(fieldStatisticsResultAtom);
    const [loading, setLoading] = useAtom(fieldStatisticsLoadingAtom);
    const [error, setError] = useAtom(fieldStatisticsErrorAtom);
    const [filters, setFilters] = useAtom(dataFilterAtom);
    const datasource = useAtomValue(selectedDatasourceAtom);
    const catalog = useAtomValue(currentCatalogAtom);
    const database = useAtomValue(currentDatabaseAtom);
    const table = useAtomValue(currentTableAtom);
    const timeField = useAtomValue(currentTimeFieldAtom);
    const date = useAtomValue(currentDateAtom);
    const timeZone = useAtomValue(timeZoneAtom);
    const indexes = useAtomValue(currentIndexAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const variantFields = useAtomValue(variantFieldsAtom);
    const searchType = useAtomValue(searchTypeAtom);
    const searchValue = useAtomValue(searchValueAtom);
    const setQueryState = useSetAtom(discoverQueryStateAtom);
    const buildLuceneWhereClause = useLuceneWhereClause();
    const generation = useRef(0);

    useEffect(() => {
        const requestId = generation.current + 1;
        generation.current = requestId;
        setResult(undefined);
        setError(undefined);
        if (!field || !datasource || !database || !table || !timeField || !date[0] || !date[1]) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const allFields = [...tableFields, ...flattenVariantLeaves(variantFields)];
        const payload: any = {
            catalog, database, table, timeField,
            startDate: formatTimeInZone(date[0], timeZone), endDate: formatTimeInZone(date[1], timeZone),
            search_type: searchType, data_filters: enrichStructuredFilterTypes(filters, allFields), field,
        };
        if (searchType === 'Search') {
            payload.indexes_statement = getIndexesStatement(indexes, tableFields, searchValue);
        }
        if (searchValue && searchType !== 'Lucene') {
            payload.search_value = searchType === 'Search' ? encodeBase64(searchValue) : searchValue;
        }

        const run = async () => {
            try {
                if (searchType === 'Lucene') {
                    payload.lucene_where = await buildLuceneWhereClause();
                }
                if (generation.current !== requestId) {
                    return;
                }
                getFieldStatisticsService({ selectdbDS: datasource, ...payload }, { showBackendError: false }).subscribe({
                    next: ({ data }: any) => {
                        if (generation.current !== requestId) {
                            return;
                        }
                        const summaryFrame = data?.results?.getFieldStatisticsSummary?.frames?.[0];
                        const topFrame = data?.results?.getFieldStatisticsTopValues?.frames?.[0];
                        const summary = summaryFrame ? convertColumnToRow(summaryFrame)[0] || {} : {};
                        const topValues = topFrame ? convertColumnToRow(topFrame).map((row: any) => ({ value: row.__field_stats_value, count: numberValue(row.__field_stats_count) })) : [];
                        setResult({
                            totalCount: numberValue(summary.__field_stats_total), nonNullCount: numberValue(summary.__field_stats_non_null),
                            approximateDistinctCount: numberValue(summary.__field_stats_distinct), min: summary.__field_stats_min,
                            max: summary.__field_stats_max, histogram: parseHistogram(summary.__field_stats_histogram), topValues,
                        });
                        setLoading(false);
                    },
                    error: (requestError: any) => {
                        if (generation.current !== requestId) {
                            return;
                        }
                        setLoading(false);
                        setError(requestError instanceof Error ? requestError : new Error(String(requestError?.message || t('Field statistics request failed'))));
                        const queryError = createDiscoverQueryError(requestError, { source: 'fieldStatistics', searchType, searchValue });
                        setQueryState(current => ({ ...current, auxiliaryErrors: [...current.auxiliaryErrors.filter(item => item.source !== 'fieldStatistics'), queryError] }));
                    },
                });
            } catch (requestError: any) {
                if (generation.current !== requestId) {
                    return;
                }
                setLoading(false);
                setError(requestError instanceof Error ? requestError : new Error(String(requestError?.message || t('Field statistics request failed'))));
            }
        };
        void run();
        return () => { generation.current += 1; };
    }, [buildLuceneWhereClause, catalog, database, datasource, date, field, filters, indexes, searchType, searchValue, setError, setLoading, setQueryState, setResult, table, tableFields, timeField, timeZone, variantFields]);

    if (!field) {
        return null;
    }
    const close = () => { generation.current += 1; setField(undefined); setResult(undefined); setError(undefined); };
    const percentage = result?.totalCount ? (result.nonNullCount * 100) / result.totalCount : 0;
    const maxTopCount = Math.max(...(result?.topValues.map(item => item.count) || []), 1);

    return <Drawer title={t('Field statistics: {{field}}', { field: field.Field })} size="md" onClose={close}>
        <div className={css`display:grid; gap:16px; padding: 0 8px 16px;`}>
            <div className={css`color:${theme.colors.text.secondary}; font-size:12px;`}>
                <div>{field.Type || t('Unknown type')} {t('· All matching data')}</div>
                <div>{t('Statistics cover all matching records in the current time range and query, beyond the card preview\'s 500-record sample.')}</div>
            </div>
            {loading ? <LoadingPlaceholder text={t('Loading field statistics')} /> : null}
            {error ? <div role="alert" className={css`color:${theme.colors.error.text};`}>{error.message}</div> : null}
            {result ? <>
                <section><h4>{t('Non-null values')}</h4><strong>{result.nonNullCount.toLocaleString()} / {result.totalCount.toLocaleString()} ({percentage.toFixed(1)}%)</strong></section>
                <section><h4>{t('Approximate unique values')}</h4><strong>≈ {result.approximateDistinctCount.toLocaleString()}</strong></section>
                <section><h4>{t('Top values')}</h4>
                    <div className={css`display:grid; gap:10px;`}>
                        {result.topValues.length ? result.topValues.map((item, index) => {
                            const display = formatFieldDisplayValue(item.value, 'compact');
                            const filterValue = typeof item.value === 'string' || typeof item.value === 'number' || typeof item.value === 'boolean' ? item.value : undefined;
                            return <div key={`${display}-${index}`} className={css`display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:8px; align-items:center;`}>
                                <div><div className={css`overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`} title={display}>{display}</div><div className={css`height:5px; background:${theme.colors.background.secondary}; margin-top:4px;`}><div className={css`height:100%; background:${theme.colors.primary.main};`} style={{ width: `${(item.count * 100) / maxTopCount}%` }} /></div></div>
                                <div className={css`display:flex; align-items:center; gap:4px;`}><span>{item.count.toLocaleString()}</span>{filterValue !== undefined ? <><IconButton name="plus-circle" tooltip={t('Include value')} onClick={() => setFilters(current => [...current, { fieldName: field.Field, variantPath: field.variantPath, variantRootType: field.variantRootType, fieldType: field.Type, operator: '=', value: [filterValue], id: nanoid() }])} /><IconButton name="minus-circle" tooltip={t('Exclude value')} onClick={() => setFilters(current => [...current, { fieldName: field.Field, variantPath: field.variantPath, variantRootType: field.variantRootType, fieldType: field.Type, operator: '!=', value: [filterValue], id: nanoid() }])} /></> : null}</div>
                            </div>;
                        }) : <span>{t('No non-null values')}</span>}
                    </div>
                </section>
                {isContinuousType(field.Type) ? <section><h4>{t('Range and distribution')}</h4><div>{t('Min:')}{formatFieldDisplayValue(result.min)} {t('· Max:')}{formatFieldDisplayValue(result.max)}</div>
                    <div className={css`display:flex; align-items:end; gap:2px; height:120px; margin-top:12px;`}>
                        {result.histogram.map((bucket, index) => <div key={`${bucket.lower}-${index}`} title={`${bucket.lower} – ${bucket.upper}: ${bucket.count}`} className={css`flex:1; min-width:4px; background:${theme.colors.primary.main};`} style={{ height: `${result.nonNullCount ? Math.max(2, (bucket.count * 100) / result.nonNullCount) : 0}%` }} />)}
                    </div>
                </section> : null}
            </> : null}
        </div>
    </Drawer>;
}
