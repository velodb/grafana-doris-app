import { useCallback, useEffect, useRef, useState } from 'react';
import { toDataFrame } from '@grafana/data';
import { logError } from '@grafana/runtime';
import { Subscription } from 'rxjs';
import { getDatabases, getTablesService } from 'services/metaservice';
import { toError } from 'utils/errors';

type Option = { label: string; value: string };
type Preferences = { database?: string; table?: string; timeField?: string };
type Callbacks = {
    setDatabases: (options: Option[]) => void;
    setTables: (options: Option[]) => void;
    onDatabaseChange: (database: string) => void;
    onTableChange: (datasource: any, database: string, table: string, timeField?: string) => void;
};

function readOptions(response: any, query: string): Option[] {
    const frame = response.ok && response.data?.results?.[query]?.frames?.[0];
    if (!frame) {
        return [];
    }
    return Array.from(toDataFrame(frame).fields[0]?.values || [], value => ({ label: String(value), value: String(value) }));
}

// All list requests share a generation so an earlier datasource/database cannot
// restore its selections after the user has moved on.
export function useDatabaseTableSelection(callbacks: Callbacks) {
    const latest = useRef(callbacks);
    latest.current = callbacks;
    const generation = useRef(0);
    const requests = useRef(new Subscription());
    const [databasesLoading, setDatabasesLoading] = useState(false);
    const [tablesLoading, setTablesLoading] = useState(false);

    const cancel = useCallback(() => {
        generation.current += 1;
        requests.current.unsubscribe();
        requests.current = new Subscription();
        return generation.current;
    }, []);

    useEffect(() => () => { cancel(); }, [cancel]);

    const loadTables = useCallback((datasource: any, database: string, request: number, preferences: Preferences) => {
        if (!database || !datasource) {
            return;
        }
        setTablesLoading(true);
        requests.current.add(getTablesService({ selectdbDS: datasource, database }).subscribe({
            next: response => {
                if (generation.current !== request) {
                    return;
                }
                const options = readOptions(response, 'getTables');
                latest.current.setTables(options);
                const table = options.find(option => option.value === preferences.table)?.value || options[0]?.value || '';
                latest.current.onTableChange(datasource, database, table, preferences.timeField);
                setTablesLoading(false);
            },
            error: error => {
                if (generation.current === request) {
                    setTablesLoading(false);
                    logError(toError(error), { source: 'useDatabaseTableSelection', action: 'getTables' });
                }
            },
        }));
    }, []);

    const selectDatabase = useCallback((datasource: any, database: string) => {
        const request = cancel();
        setDatabasesLoading(false);
        setTablesLoading(false);
        latest.current.setTables([]);
        latest.current.onDatabaseChange(database);
        latest.current.onTableChange(datasource, database, '');
        loadTables(datasource, database, request, {});
    }, [cancel, loadTables]);

    const selectDatasource = useCallback((datasource: any, preferences: Preferences = {}) => {
        const request = cancel();
        setDatabasesLoading(Boolean(datasource));
        setTablesLoading(false);
        latest.current.setDatabases([]);
        latest.current.setTables([]);
        latest.current.onDatabaseChange('');
        latest.current.onTableChange(datasource, '', '');
        if (!datasource) {
            return;
        }
        requests.current.add(getDatabases(datasource).subscribe({
            next: response => {
                if (generation.current !== request) {
                    return;
                }
                const options = readOptions(response, 'getDatabases');
                latest.current.setDatabases(options);
                const database =
                    options.find(option => option.value === preferences.database)?.value ||
                    options.find(option => option.value === datasource.jsonData?.database)?.value ||
                    options[0]?.value || '';
                latest.current.onDatabaseChange(database);
                setDatabasesLoading(false);
                loadTables(datasource, database, request, preferences);
            },
            error: error => {
                if (generation.current === request) {
                    setDatabasesLoading(false);
                    logError(toError(error), { source: 'useDatabaseTableSelection', action: 'getDatabases' });
                }
            },
        }));
    }, [cancel, loadTables]);

    const cancelSelection = useCallback(() => {
        cancel();
        setDatabasesLoading(false);
        setTablesLoading(false);
    }, [cancel]);

    return { selectDatasource, selectDatabase, databasesLoading, tablesLoading, cancelSelection };
}
