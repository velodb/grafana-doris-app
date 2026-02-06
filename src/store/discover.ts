import { atom } from 'jotai';
import { atomWithStorage, selectAtom } from 'jotai/utils';
// import { focusAtom } from 'jotai-optics'
import { atomWithLocation } from 'jotai-location';
import { DataSourceInstanceSettings, DataSourceJsonData } from '@grafana/data';
import { Dayjs } from 'dayjs';
import { DataFilterType, DiscoverCurrent, IntervalEnum, ShortcutItem } from 'types/type';
import { AggregatableEnum, DISCOVER_DEFAULT_STATUS, DISCOVER_SHORTCUTS, FieldTypeEnum, SearchableEnum } from 'utils/data';

export const locationAtom = atomWithLocation();
export const dataFilterAtom = atom<DataFilterType[]>([]);
export const discoverCurrentAtom = atomWithStorage<DiscoverCurrent>('discover-current', DISCOVER_DEFAULT_STATUS);

// databases
export const databasesAtom = atom<any>([]);
export const settingDatabasesAtom = atom<any>([]);
export const tablesAtom = atomWithStorage<any>('discover-tables', []);
export const settingTablesAtom = atom<any>([]);

export const currentCatalogAtom = atomWithStorage<string>('discover-current-catalog', 'internal');
export const searchTypeAtom = atomWithStorage<'SQL' | 'Search' | 'Lucene'>('discover-search-type', 'Lucene');
export const currentDatabaseAtom = selectAtom(discoverCurrentAtom, current => current.database);
export const currentTableAtom = atomWithStorage<string>('discover-current-table', '');
export const currentClusterAtom = atom('');
export const currentTimeFieldAtom = selectAtom(discoverCurrentAtom, current => current.timeField);
export const currentDateAtom = atom<Dayjs[]>( DISCOVER_SHORTCUTS[2].range());
export const currentIndexAtom = atom<any>([]);
export const selectedIndexesAtom = atom<any>([]);
export const searchValueAtom = atom('');
export const searchFocusAtom = atom(false);
export const activeShortcutAtom = atom<ShortcutItem | undefined>(DISCOVER_SHORTCUTS[2]);
export const dorisInfoAtom = atom<any>({});
export const disabledOptionsAtom = atom<string[]>([]);

export const selectedFieldsAtom = atom<any[]>([]);
export const tableFieldsAtom = atomWithStorage<any[]>('discover-table-fields', []);

export const timeFieldsAtom = atomWithStorage<any[]>('discover-time-fields',[]);
export const tableDataAtom = atom<any[]>([]);
export const topDataAtom = atom<any[]>([]);
export const surroundingTableDataAtom = atom<any[]>([]);
export const tableDataChartsAtom = atom<any[]>([]);
export const intervalAtom = atom<IntervalEnum>(IntervalEnum.Auto);
export const tableTotalCountAtom = atom<number>(0);
export const tableEChartsDataAtom = atom<any[]>([]);
export const tableTracesDataAtom = atom<any>();

// Filter Content Atom
export const searchableAtom = atom<SearchableEnum>(SearchableEnum.ANY);
export const aggregatableAtom = atom<AggregatableEnum>(AggregatableEnum.ANY);
export const fieldTypeAtom = atom<FieldTypeEnum>(FieldTypeEnum.ANY);
export const indexesAtom = atom<any[]>([]);
export const selectedRowAtom = atom<any>({});
export const tableFieldValuesAtom = atom<Array<{ label: string; value: string }>>([]);

export const pageAtom = atom<number>(1);
export const pageSizeAtom = atomWithStorage<number>('discover-pagination-size', 50);

// Surrounding Data Atoms
export const surroundingDataFilterAtom = atom<DataFilterType[]>([]);
export const beforeTimeFieldPageSizeAtom = atom<number>(5);
export const afterTimeFieldPageSizeAtom = atom<number>(5);
export const beforeTimeAtom = atom<string>('');
export const afterTimeAtom = atom<string>('');
export const beforeCountAtom = atom<number>(0);
export const afterCountAtom = atom<number>(0);
export const surroundingTableFieldsAtom = atom<any[]>([]);
export const surroundingSelectedFieldsAtom = atom<any[]>([]);

export const datasourcesAtom = atom<Array<DataSourceInstanceSettings<DataSourceJsonData>>>([]);
export const selectedDatasourceAtom = atomWithStorage<DataSourceInstanceSettings<DataSourceJsonData> | undefined>('discover-selected-datasource', undefined);
export const timeRangeAtom = atom<any>({
    from: DISCOVER_SHORTCUTS[2].range()[0].toDate(),
    to: DISCOVER_SHORTCUTS[2].range()[1].toDate(),
    raw: DISCOVER_SHORTCUTS[2].raw,
});


export const discoverLoadingAtom = atom({
    getTableData: false,
    getTopData: false,
    getSurroundingData: false,
    getTableDataCharts: false,
    getTableFieldValues: false,
    getIndexes: false,
    getTimeFields: false,
    getTableFields: false,
});
