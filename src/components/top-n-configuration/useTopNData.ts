import { t } from 'i18n';
import { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { Subscription } from 'rxjs';
import {
    currentCatalogAtom,
    currentDatabaseAtom,
    currentDateAtom,
    currentIndexAtom,
    currentTableAtom,
    currentTimeFieldAtom,
    dataFilterAtom,
    searchTypeAtom,
    searchValueAtom,
    selectedDatasourceAtom,
    tableFieldsAtom,
    topNConfigAtom,
    topNEnabledAtom,
    topNResultFieldsAtom,
    topNRowsAtom,
    topNRunRequestAtom,
    variantFieldsAtom,
} from 'store/discover';
import { getTopNDataService } from 'services/discover';
import { convertColumnToRow, encodeBase64, getIndexesStatement } from 'utils/data';
import { flattenVariantLeaves } from 'utils/variant-fields';
import { enrichStructuredFilterTypes } from 'utils/sql-filter';
import { formatSqlTime } from 'utils/time';
import { useLuceneWhereClause } from 'pages/PageDiscover/useLuceneWhereClause';

/** Runs sidebar aggregation independently from the main table and its query state. */
export function useTopNData(fieldName: string) {
    const store = useStore();
    const datasource = useAtomValue(selectedDatasourceAtom);
    const catalog = useAtomValue(currentCatalogAtom);
    const database = useAtomValue(currentDatabaseAtom);
    const table = useAtomValue(currentTableAtom);
    const timeField = useAtomValue(currentTimeFieldAtom);
    const dates = useAtomValue(currentDateAtom);
    const filters = useAtomValue(dataFilterAtom);
    const searchType = useAtomValue(searchTypeAtom);
    const searchValue = useAtomValue(searchValueAtom);
    const config = useAtomValue(topNConfigAtom);
    const enabled = useAtomValue(topNEnabledAtom);
    const request = useAtomValue(topNRunRequestAtom);
    const setFields = useSetAtom(topNResultFieldsAtom);
    const setRows = useSetAtom(topNRowsAtom);
    const buildLuceneWhereClause = useLuceneWhereClause();
    const [state, setState] = useState<{ loading: boolean; hasRun: boolean; error?: Error }>({ loading: false, hasRun: false });

    useEffect(() => {
        if (!enabled || !request || config.groupField !== fieldName) {
            setState({ loading: false, hasRun: false });
            return;
        }
        let active = true;
        let subscription: Subscription | undefined;
        setState({ loading: true, hasRun: true });
        setFields([]);
        setRows([]);
        const fail = (error: unknown) => {
            if (active) {
                setState({ loading: false, hasRun: true, error: error instanceof Error ? error : new Error(String(error)) });
            }
        };
        const run = async () => {
            if (!datasource || !database || !table || !timeField || !dates[0] || !dates[1]) {
                throw new Error(t('Select a datasource, table, time field, and time range first'));
            }
            const luceneWhere = searchType === 'Lucene' ? await buildLuceneWhereClause() : undefined;
            if (!active) {
                return;
            }
            const physicalFields = store.get(tableFieldsAtom);
            const allFields = [...physicalFields, ...flattenVariantLeaves(store.get(variantFieldsAtom))];
            const payload = {
                selectdbDS: datasource,
                catalog,
                database,
                table,
                timeField,
                startDate: formatSqlTime(dates[0]),
                endDate: formatSqlTime(dates[1]),
                search_type: searchType,
                data_filters: enrichStructuredFilterTypes(filters, allFields),
                ...(searchType === 'Search' ? { indexes_statement: getIndexesStatement(store.get(currentIndexAtom), physicalFields, searchValue) } : {}),
                ...(searchValue && searchType !== 'Lucene' ? { search_value: searchType === 'Search' ? encodeBase64(searchValue) : searchValue } : {}),
                lucene_where: luceneWhere,
                ...config,
            };
            subscription = getTopNDataService(payload, allFields, { showBackendError: false }).subscribe({
                next: ({ data }: any) => {
                    if (!active) {
                        return;
                    }
                    const frame = data?.results?.getTopNData?.frames?.[0];
                    setFields(frame ? frame.schema.fields.map((item: any) => ({ Field: item.name, Type: item.type || 'STRING' })) : []);
                    setRows(frame ? convertColumnToRow(frame) : []);
                    setState({ loading: false, hasRun: true });
                },
                error: fail,
            });
        };
        void run().catch(fail);
        return () => {
            active = false;
            subscription?.unsubscribe();
        };
    }, [
        buildLuceneWhereClause,
        catalog,
        config,
        database,
        datasource,
        dates,
        enabled,
        fieldName,
        filters,
        request,
        searchType,
        searchValue,
        setFields,
        setRows,
        store,
        table,
        timeField,
    ]);

    return state;
}
