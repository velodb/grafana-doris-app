import { useAtom, useAtomValue } from 'jotai';
import { currentCatalogAtom, currentDatabaseAtom, currentTableAtom, selectedDatasourceAtom, topNPreferencesAtom } from 'store/discover';
import { TopNConfig } from 'types/type';

function readConfig(saved: Partial<TopNConfig> | undefined, fieldName: string): TopNConfig {
    const limit = saved?.limit;
    return {
        groupField: fieldName,
        metric: saved?.metric && ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(saved.metric) ? saved.metric : 'COUNT',
        metricField: typeof saved?.metricField === 'string' ? saved.metricField : '',
        direction: saved?.direction === 'ASC' ? 'ASC' : 'DESC',
        limit: typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 10000 ? limit : 5,
    };
}

export function useTopNPreferences(fieldName: string) {
    const datasource = useAtomValue(selectedDatasourceAtom);
    const catalog = useAtomValue(currentCatalogAtom);
    const database = useAtomValue(currentDatabaseAtom);
    const table = useAtomValue(currentTableAtom);
    const [preferences, setPreferences] = useAtom(topNPreferencesAtom);
    const datasourceId = datasource?.uid || datasource?.id || datasource?.name;
    const key = datasourceId && database && table ? JSON.stringify([datasourceId, catalog || 'internal', database, table, fieldName]) : '';
    const config = readConfig(key ? preferences[key] : undefined, fieldName);
    const update = (patch: Partial<Omit<TopNConfig, 'groupField'>>) => {
        if (key) {
            setPreferences(previous => ({ ...previous, [key]: { ...readConfig(previous[key], fieldName), ...patch } }));
        }
    };
    return { key, config, update };
}
