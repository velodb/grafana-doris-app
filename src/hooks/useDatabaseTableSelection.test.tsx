import { act, renderHook } from '@testing-library/react';
import { FieldType } from '@grafana/data';
import { logError } from '@grafana/runtime';
import { of, Subject, throwError } from 'rxjs';
import { getDatabases, getTablesService } from 'services/metaservice';
import { useDatabaseTableSelection } from './useDatabaseTableSelection';

jest.mock('services/metaservice', () => ({ getDatabases: jest.fn(), getTablesService: jest.fn() }));
jest.mock('@grafana/runtime', () => ({ logError: jest.fn() }));

function response(query: string, values: string[]) {
    return { ok: true, data: { results: { [query]: { frames: [{ fields: [{ name: 'name', type: FieldType.string, values }] }] } } } };
}

function setup() {
    const callbacks = {
        setDatabases: jest.fn(),
        setTables: jest.fn(),
        onDatabaseChange: jest.fn(),
        onTableChange: jest.fn(),
    };
    return { callbacks, ...renderHook(() => useDatabaseTableSelection(callbacks)) };
}

beforeEach(() => {
    jest.clearAllMocks();
    (getDatabases as jest.Mock).mockReturnValue(of(response('getDatabases', ['db1', 'db2'])));
    (getTablesService as jest.Mock).mockReturnValue(of(response('getTables', ['table1', 'table2'])));
});

it('clears downstream selections and chooses the first database and table from the new datasource', () => {
    const { result, callbacks } = setup();
    const datasource = { uid: 'new' };
    act(() => result.current.selectDatasource(datasource));
    expect(callbacks.setDatabases).toHaveBeenNthCalledWith(1, []);
    expect(callbacks.setTables).toHaveBeenNthCalledWith(1, []);
    expect(callbacks.onDatabaseChange.mock.calls).toEqual([[''], ['db1']]);
    expect(callbacks.onTableChange.mock.calls).toEqual([[datasource, '', ''], [datasource, 'db1', 'table1', undefined]]);
    expect(getTablesService).toHaveBeenCalledWith({ selectdbDS: datasource, database: 'db1' });
});

it('selects the first table when changing database', () => {
    const { result, callbacks } = setup();
    act(() => result.current.selectDatabase({ uid: 'ds' }, 'db2'));
    expect(callbacks.setTables).toHaveBeenNthCalledWith(1, []);
    expect(callbacks.onTableChange).toHaveBeenNthCalledWith(1, { uid: 'ds' }, 'db2', '');
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: 'ds' }, 'db2', 'table1', undefined);
    expect(getDatabases).not.toHaveBeenCalled();
});

it('preserves valid initial preferences and passes the preferred time field to metadata loading', () => {
    const { result, callbacks } = setup();
    act(() => result.current.selectDatasource({ uid: 'ds' }, { database: 'db2', table: 'table2', timeField: 'timestamp' }));
    expect(getTablesService).toHaveBeenCalledWith({ selectdbDS: { uid: 'ds' }, database: 'db2' });
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: 'ds' }, 'db2', 'table2', 'timestamp');
});

it('falls back to the first options when stored preferences no longer exist', () => {
    const { result, callbacks } = setup();
    act(() => result.current.selectDatasource({ uid: 'ds' }, { database: 'deleted_db', table: 'deleted_table' }));
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: 'ds' }, 'db1', 'table1', undefined);
});

it('uses the datasource database when no page preference is supplied', () => {
    const { result, callbacks } = setup();
    const datasource = { uid: 'ds', jsonData: { database: 'db2' } };
    act(() => result.current.selectDatasource(datasource));
    expect(getTablesService).toHaveBeenCalledWith({ selectdbDS: datasource, database: 'db2' });
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith(datasource, 'db2', 'table1', undefined);
});

it('preserves a valid page preference over the datasource database', () => {
    const { result, callbacks } = setup();
    const datasource = { uid: 'ds', jsonData: { database: 'db2' } };
    act(() => result.current.selectDatasource(datasource, { database: 'db1' }));
    expect(callbacks.onDatabaseChange).toHaveBeenLastCalledWith('db1');
});

it('falls back to the datasource database when the page preference no longer exists', () => {
    const { result, callbacks } = setup();
    const datasource = { uid: 'ds', jsonData: { database: 'db2' } };
    act(() => result.current.selectDatasource(datasource, { database: 'deleted_db' }));
    expect(callbacks.onDatabaseChange).toHaveBeenLastCalledWith('db2');
});

it('falls back to the first available database when the datasource default is unavailable', () => {
    const { result, callbacks } = setup();
    act(() => result.current.selectDatasource({ uid: 'ds', jsonData: { database: 'unavailable_db' } }));
    expect(callbacks.onDatabaseChange).toHaveBeenLastCalledWith('db1');
});

it('ignores databases from a previous datasource while it is still loading', () => {
    const previous = new Subject<any>();
    (getDatabases as jest.Mock).mockReturnValueOnce(previous);
    const { result, callbacks } = setup();
    act(() => result.current.selectDatasource({ uid: 'old' }));
    expect(result.current.databasesLoading).toBe(true);
    act(() => result.current.selectDatasource({ uid: 'new' }));
    act(() => previous.next(response('getDatabases', ['old_db'])));
    expect(getTablesService).toHaveBeenCalledTimes(1);
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: 'new' }, 'db1', 'table1', undefined);
    expect(result.current.databasesLoading).toBe(false);
});

it.each(['database', 'datasource'])('ignores in-flight tables after switching %s', target => {
    const previous = new Subject<any>();
    (getTablesService as jest.Mock).mockReturnValueOnce(previous);
    const { result, callbacks } = setup();
    act(() => result.current.selectDatabase({ uid: 'ds' }, 'old_db'));
    expect(result.current.tablesLoading).toBe(true);
    act(() => target === 'database' ? result.current.selectDatabase({ uid: 'ds' }, 'new_db') : result.current.selectDatasource({ uid: 'new' }));
    act(() => previous.next(response('getTables', ['old_table'])));
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: target === 'database' ? 'ds' : 'new' }, target === 'database' ? 'new_db' : 'db1', 'table1', undefined);
    expect(result.current.tablesLoading).toBe(false);
});

it('leaves empty databases unselected without requesting tables', () => {
    (getDatabases as jest.Mock).mockReturnValue(of(response('getDatabases', [])));
    const { result, callbacks } = setup();
    act(() => result.current.selectDatasource({ uid: 'ds' }));
    expect(callbacks.onDatabaseChange).toHaveBeenLastCalledWith('');
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: 'ds' }, '', '');
    expect(getTablesService).not.toHaveBeenCalled();
});

it('leaves empty tables unselected', () => {
    (getTablesService as jest.Mock).mockReturnValue(of(response('getTables', [])));
    const { result, callbacks } = setup();
    act(() => result.current.selectDatabase({ uid: 'ds' }, 'empty_db'));
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: 'ds' }, 'empty_db', '', undefined);
});

it.each(['databases', 'tables'])('clears stale values and loading flags after a %s failure', target => {
    const service = target === 'databases' ? getDatabases : getTablesService;
    (service as jest.Mock).mockReturnValue(throwError(() => new Error('unavailable')));
    const { result, callbacks } = setup();
    act(() => result.current.selectDatasource({ uid: 'ds' }));
    expect(callbacks.onTableChange).toHaveBeenLastCalledWith({ uid: 'ds' }, '', '');
    expect(result.current.databasesLoading).toBe(false);
    expect(result.current.tablesLoading).toBe(false);
    expect(logError).toHaveBeenCalled();
});

it('cancels pending requests on unmount', () => {
    const pending = new Subject<any>();
    (getDatabases as jest.Mock).mockReturnValue(pending);
    const { result, unmount, callbacks } = setup();
    act(() => result.current.selectDatasource({ uid: 'ds' }));
    unmount();
    act(() => pending.next(response('getDatabases', ['late'])));
    expect(callbacks.setDatabases).toHaveBeenCalledTimes(1);
    expect(getTablesService).not.toHaveBeenCalled();
});
