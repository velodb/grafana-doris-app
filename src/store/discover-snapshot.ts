import { atom } from 'jotai';
import {
    currentDatabaseAtom,
    currentDateAtom,
    currentTableAtom,
    currentTimeFieldAtom,
    dataFilterAtom,
    discoverSharedColumnOrderAtom,
    discoverSortAtom,
    searchTypeAtom,
    searchValueAtom,
    selectedDatasourceAtom,
    selectedFieldsAtom,
    timeRangeAtom,
    timeZoneAtom,
} from './discover';
import { DiscoverShareState, DISCOVER_SHARE_STATE_VERSION } from 'utils/discover-share-state';
import { formatShareTime } from 'utils/time';

/** One snapshot representation for sharing and saving; never read it from the URL. */
export const discoverSnapshotAtom = atom<DiscoverShareState>(get => {
    const raw = get(timeRangeAtom)?.raw;
    const relative = typeof raw?.from === 'string' && typeof raw?.to === 'string' && raw.from.startsWith('now') && raw.to.startsWith('now');
    const dates = get(currentDateAtom);
    const ds = get(selectedDatasourceAtom);
    return {
        version: DISCOVER_SHARE_STATE_VERSION,
        datasource: ds?.uid || ds?.name,
        database: get(currentDatabaseAtom),
        table: get(currentTableAtom),
        timeField: get(currentTimeFieldAtom),
        timeZone: get(timeZoneAtom),
        mode: get(searchTypeAtom),
        query: get(searchValueAtom),
        timeRawFrom: relative ? raw.from : undefined,
        timeRawTo: relative ? raw.to : undefined,
        startTime: relative || !dates[0] ? undefined : formatShareTime(dates[0]),
        endTime: relative || !dates[1] ? undefined : formatShareTime(dates[1]),
        filters: get(dataFilterAtom),
        selectedFields: get(selectedFieldsAtom).map(field => ({ Field: field.Field, Type: field.Type, variantPath: field.variantPath, variantKey: field.variantKey })),
        columnOrder: get(discoverSharedColumnOrderAtom),
        sort: get(discoverSortAtom),
    };
});

export const discoverRestoreEpochAtom = atom(0);
export const discoverRestoreErrorAtom = atom('');
export const discoverRestoreWarningAtom = atom('');
