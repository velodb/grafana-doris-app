import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { FieldType } from '@grafana/data';
import { of, Subject } from 'rxjs';
import DiscoverHeader from './index';
import TracesHeader from 'components/traces/traces-header';
import AppConfig from 'components/AppConfig/AppConfig';
import { getDatabases, getTablesService, getFieldsService, getIndexesService, getVariantFieldsService } from 'services/metaservice';
import { discoverCurrentAtom, currentTableAtom, locationAtom, tableFieldsAtom, timeFieldsAtom, dataFilterAtom, selectedFieldsAtom, discoverSortAtom, discoverShareReadyAtom } from 'store/discover';
import { currentTraceTableAtom } from 'store/traces';
import { encodeDiscoverShareState } from 'utils/discover-share-state';
import { LogsConfig } from 'types/plugin-settings';

const datasources = [
    { uid: 'ds1', name: 'Doris 1', type: 'doris', jsonData: { database: '' } },
    { uid: 'ds2', name: 'Doris 2', type: 'doris', jsonData: { database: '' } },
];
const logsConfig: LogsConfig = { datasource: datasources[0], database: 'db1', logsTable: 'table2', targetTraceTable: 'table2', applicationAttributeKey: '' };

jest.mock('@grafana/data', () => ({
    ...jest.requireActual('@grafana/data'),
    usePluginContext: () => ({ meta: { jsonData: { logsConfig } } }),
}));
jest.mock('@grafana/runtime', () => ({
    ...jest.requireActual('@grafana/runtime'),
    logError: jest.fn(),
    getDataSourceSrv: () => ({ getList: () => datasources }),
    DataSourcePicker: ({ onChange, current }: any) => (
        <select value={current?.uid || ''} onChange={event => onChange(datasources.find(ds => ds.uid === event.target.value))}>
            <option value="" />
            {datasources.map(ds => <option key={ds.uid} value={ds.uid}>{ds.name}</option>)}
        </select>
    ),
}));
jest.mock('@grafana/ui', () => ({
    ...jest.requireActual('@grafana/ui'),
    Field: ({ label, children }: any) => <label>{label}{children}</label>,
    Select: ({ options = [], value, onChange, disabled }: any) => (
        <select value={value || ''} disabled={disabled} onChange={event => onChange({ value: event.target.value })}>
            <option value="" />
            {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    ),
    TimeRangeInput: () => null,
    Tooltip: ({ children }: any) => <>{children}</>,
    useTheme2: () => jest.requireActual('@grafana/data').createTheme(),
}));
jest.mock('hooks/useDatasourcePermissions', () => ({
    useDatasourcePermissions: () => ({ allowedDatasources: datasources, allowedDatasourceUids: new Set(['ds1', 'ds2']), loading: false }),
}));
jest.mock('services/metaservice', () => ({
    getDatabases: jest.fn(),
    getTablesService: jest.fn(),
    getFieldsService: jest.fn(),
    getIndexesService: jest.fn(),
    getVariantFieldsService: jest.fn(),
    getApplicationValuesService: jest.fn(),
}));
jest.mock('services/grafana-permissions', () => ({
    ...jest.requireActual('services/grafana-permissions'),
    fetchTeams: () => new Promise(() => undefined),
}));
jest.mock('./search-type', () => () => null);
jest.mock('./sql-search', () => () => null);
jest.mock('./lucene', () => () => null);

function response(query: string, columns: any[][]) {
    return { ok: true, data: { results: { [query]: { frames: [{ fields: columns.map((values, index) => ({ name: `column${index}`, type: FieldType.string, values })) }] } } } };
}
function fields(name = 'timestamp', type = 'DATETIMEV2') {
    return response('getFields', [[name], [type]]);
}

beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    jest.clearAllMocks();
    logsConfig.database = 'db1';
    datasources.forEach(datasource => { datasource.jsonData.database = ''; });
    (getDatabases as jest.Mock).mockReturnValue(of(response('getDatabases', [['db1', 'db2']])));
    (getTablesService as jest.Mock).mockReturnValue(of(response('getTables', [['table1', 'table2']])));
    (getFieldsService as jest.Mock).mockReturnValue(of(fields()));
    (getIndexesService as jest.Mock).mockReturnValue(of(response('getIndexes', [])));
    (getVariantFieldsService as jest.Mock).mockReturnValue(of(response('getVariantFields', [])));
});

describe.each([
    ['Discover', DiscoverHeader, currentTableAtom],
    ['Traces', TracesHeader, currentTraceTableAtom],
] as const)('%s selection', (_name, Header, tableAtom) => {
    function setup(search = '') {
        const store = createStore();
        store.set(locationAtom, { searchParams: new URLSearchParams(search) });
        render(<Provider store={store}><Header loading={false} onQuerying={jest.fn()} /></Provider>);
        return store;
    }

    it('preserves initial choices, then selects the first database, table and time field on datasource/database changes', async () => {
        const store = setup();
        await waitFor(() => expect(store.get(tableAtom)).toBe('table2'));
        expect(getDatabases).toHaveBeenCalledTimes(1);
        expect(store.get(discoverCurrentAtom).timeField).toBe('timestamp');
        fireEvent.change(screen.getByLabelText('Datasource'), { target: { value: 'ds2' } });
        expect(store.get(discoverCurrentAtom)).toMatchObject({ database: 'db1', table: 'table1', timeField: 'timestamp' });
        expect(getFieldsService).toHaveBeenLastCalledWith({ selectdbDS: datasources[1], database: 'db1', table: 'table1' });
        fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'db2' } });
        expect(store.get(tableAtom)).toBe('table1');
        expect(getFieldsService).toHaveBeenLastCalledWith({ selectdbDS: datasources[1], database: 'db2', table: 'table1' });
    });

    it('restores valid datasource/database/table/time-field choices from a link', async () => {
        datasources[1].jsonData.database = 'db1';
        (getFieldsService as jest.Mock).mockReturnValue(of(response('getFields', [['timestamp', 'other_time'], ['DATETIMEV2', 'DATETIMEV2']])));
        const store = setup('datasource=ds2&database=db2&table=table2&timeField=other_time');
        await waitFor(() => expect(store.get(discoverCurrentAtom).timeField).toBe('other_time'));
        expect(store.get(discoverCurrentAtom)).toMatchObject({ database: 'db2', table: 'table2' });
        expect(getFieldsService).toHaveBeenLastCalledWith({ selectdbDS: datasources[1], database: 'db2', table: 'table2' });
    });

    it('uses the selected datasource default database and still allows manually selecting another database', async () => {
        datasources[1].jsonData.database = 'db2';
        const store = setup();
        await waitFor(() => expect(store.get(tableAtom)).toBe('table2'));
        fireEvent.change(screen.getByLabelText('Datasource'), { target: { value: 'ds2' } });
        expect(store.get(discoverCurrentAtom)).toMatchObject({ database: 'db2', table: 'table1', timeField: 'timestamp' });
        expect(getFieldsService).toHaveBeenLastCalledWith({ selectdbDS: datasources[1], database: 'db2', table: 'table1' });
        fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'db1' } });
        expect(store.get(discoverCurrentAtom).database).toBe('db1');
    });

    it('uses current datasource settings on first load instead of stored settings or the built-in otel default', async () => {
        delete logsConfig.database;
        datasources[0].jsonData.database = 'db2';
        localStorage.setItem('discover-selected-datasource', JSON.stringify({ ...datasources[0], jsonData: { database: 'db1' } }));
        (getDatabases as jest.Mock).mockReturnValue(of(response('getDatabases', [['otel', 'db1', 'db2']])));
        const store = setup();
        await waitFor(() => expect(store.get(discoverCurrentAtom).timeField).toBe('timestamp'));
        expect(store.get(discoverCurrentAtom).database).toBe('db2');
        expect(getFieldsService).toHaveBeenLastCalledWith({ selectdbDS: datasources[0], database: 'db2', table: 'table2' });
    });

    it('preserves an explicitly configured plugin database over the datasource default', async () => {
        datasources[0].jsonData.database = 'db2';
        const store = setup();
        await waitFor(() => expect(store.get(discoverCurrentAtom).timeField).toBe('timestamp'));
        expect(store.get(discoverCurrentAtom).database).toBe('db1');
    });

    it('clears the old table and metadata while new tables load, including tables without a time field', async () => {
        const store = setup();
        await waitFor(() => expect(store.get(tableAtom)).toBe('table2'));
        const pending = new Subject<any>();
        (getTablesService as jest.Mock).mockReturnValueOnce(pending);
        fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'db2' } });
        expect(store.get(tableAtom)).toBe('');
        expect(store.get(discoverCurrentAtom)).toMatchObject({ table: '', timeField: '' });
        expect(store.get(tableFieldsAtom)).toEqual([]);
        expect(store.get(timeFieldsAtom)).toEqual([]);
        expect(screen.getByLabelText('Table')).toBeDisabled();
        (getFieldsService as jest.Mock).mockReturnValueOnce(of(fields('message', 'STRING')));
        act(() => pending.next(response('getTables', [['new_table']])));
        expect(store.get(tableAtom)).toBe('new_table');
        expect(store.get(discoverCurrentAtom).timeField).toBe('');
        expect(screen.getByLabelText('Table')).toBeEnabled();
    });

    it('ignores stale metadata even when switching away and back to the same table', async () => {
        const pending = new Subject<any>();
        (getFieldsService as jest.Mock).mockReturnValueOnce(pending);
        const store = setup();
        await waitFor(() => expect(store.get(tableAtom)).toBe('table2'));
        fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'table1' } });
        fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'table2' } });
        act(() => pending.next(fields('stale_timestamp')));
        expect(store.get(discoverCurrentAtom).timeField).toBe('timestamp');
        expect(store.get(tableFieldsAtom)[0].Field).toBe('timestamp');
    });
});

it('cascades default datasource/database changes to both tables in plugin settings', async () => {
    render(<Provider><AppConfig plugin={{ meta: { jsonData: { logsConfig } } } as any} query={{} as any} /></Provider>);
    await waitFor(() => expect(screen.getByLabelText('Default Logs Table')).toHaveValue('table2'));
    expect(screen.getByLabelText('Default Trace Table')).toHaveValue('table2');
    fireEvent.change(screen.getByLabelText('Default Datasource'), { target: { value: 'ds2' } });
    expect(screen.getByLabelText('Default Database')).toHaveValue('db1');
    expect(screen.getByLabelText('Default Logs Table')).toHaveValue('table1');
    expect(screen.getByLabelText('Default Trace Table')).toHaveValue('table1');
    fireEvent.change(screen.getByLabelText('Default Database'), { target: { value: 'db2' } });
    expect(getTablesService).toHaveBeenLastCalledWith({ selectdbDS: datasources[1], database: 'db2' });
    expect(screen.getByLabelText('Default Logs Table')).toHaveValue('table1');
    expect(screen.getByLabelText('Default Trace Table')).toHaveValue('table1');
});

it('restores Discover shared filters, columns and sorting after resolving the initial selection', async () => {
    const filters = [{ id: 'time-filter', fieldName: 'timestamp', operator: '=' as const, value: ['2026-10-19'] }];
    const state = encodeDiscoverShareState({
        version: 1, datasource: 'ds2', database: 'db2', table: 'table2', timeField: 'timestamp',
        filters, selectedFields: [{ Field: 'timestamp', Type: 'DATETIMEV2' }], columnOrder: ['field:timestamp'],
        sort: { field: 'timestamp', direction: 'ASC' },
    });
    const store = createStore();
    store.set(locationAtom, { searchParams: new URLSearchParams({ discoverState: state }) });
    render(<Provider store={store}><DiscoverHeader loading={false} onQuerying={jest.fn()} /></Provider>);
    await waitFor(() => expect(store.get(discoverShareReadyAtom)).toBe(true));
    expect(store.get(discoverCurrentAtom)).toMatchObject({ database: 'db2', table: 'table2', timeField: 'timestamp' });
    expect(store.get(dataFilterAtom)).toEqual(filters);
    expect(store.get(selectedFieldsAtom)).toEqual([expect.objectContaining({ Field: 'timestamp' })]);
    expect(store.get(discoverSortAtom)).toMatchObject({ field: 'timestamp', direction: 'ASC' });
});

it('uses the datasource default in plugin settings when an explicit database was not configured', async () => {
    delete logsConfig.database;
    datasources[0].jsonData.database = 'db2';
    const storedDatasource = { ...datasources[0], jsonData: { database: 'db1' } };
    (getDatabases as jest.Mock).mockReturnValue(of(response('getDatabases', [['otel', 'db1', 'db2']])));
    render(<Provider><AppConfig plugin={{ meta: { jsonData: { logsConfig: { ...logsConfig, datasource: storedDatasource } } } } as any} query={{} as any} /></Provider>);
    await waitFor(() => expect(screen.getByLabelText('Default Database')).toHaveValue('db2'));
    expect(getDatabases).toHaveBeenCalledWith(datasources[0]);
});
