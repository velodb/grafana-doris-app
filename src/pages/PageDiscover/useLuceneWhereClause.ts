import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import {
    currentDatabaseAtom,
    currentTableAtom,
    currentTimeFieldAtom,
    searchTypeAtom,
    searchValueAtom,
    selectedDatasourceAtom,
    tableFieldsAtom,
} from 'store/discover';
import { getWhereSQLViaLucene } from 'services/lucene';

export function useLuceneWhereClause() {
    const searchType = useAtomValue(searchTypeAtom);
    const searchValue = useAtomValue(searchValueAtom);
    const currentTable = useAtomValue(currentTableAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);

    return useCallback(async (): Promise<string> => {
        if (searchType !== 'Lucene') {
            return '';
        }

        const trimmedQuery = searchValue?.trim();
        if (!trimmedQuery || !currentTable || !currentDatabase || !selectdbDS) {
            return '';
        }

        const candidateFieldNames = (tableFields || [])
            .map((field: any) => {
                const rawName = field?.Field ?? field?.value ?? field?.name;
                const type = String(field?.Type ?? '').toUpperCase();
                if (!rawName) {
                    return null;
                }

                if (!type) {
                    return rawName;
                }

                return /(CHAR|TEXT|STRING|JSON|VARIANT)/.test(type) ? rawName : null;
            })
            .filter(Boolean) as string[];

        const implicitExpressions = candidateFieldNames.slice(0, 10).map(name => `coalesce(\`${name}\`, '')`);

        let implicitColumnExpression: string | undefined;
        if (implicitExpressions.length > 0) {
            implicitColumnExpression = implicitExpressions.join(',\n');
        } else if (currentTimeField) {
            implicitColumnExpression = `coalesce(\`${currentTimeField}\`, '')`;
        }

        return await getWhereSQLViaLucene({
            query: trimmedQuery,
            databaseName: currentDatabase,
            tableName: currentTable,
            connectionId: selectdbDS.uid,
            datasourceType: selectdbDS.type,
            implicitColumnExpression,
        });
    }, [currentDatabase, currentTable, currentTimeField, searchType, searchValue, selectdbDS, tableFields]);
}
