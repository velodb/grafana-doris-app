import { t } from 'i18n';
import { DiscoverShareState, DISCOVER_SHARE_STATE_VERSION } from './discover-share-state';

const record = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const stringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

/** Unlike legacy URL decoding, saved snapshots must not silently lose filters. */
export function validateSavedQueryState(value: unknown): DiscoverShareState {
    if (!record(value) || value.version !== DISCOVER_SHARE_STATE_VERSION) {
        throw new Error(t('Unsupported Discover state version'));
    }
    for (const key of ['datasource', 'database', 'table', 'timeField', 'timeZone']) {
        if (typeof value[key] !== 'string' || !value[key].trim()) {
            throw new Error(t('A valid {{field}} is required', { field: key }));
        }
    }
    if (!['SQL', 'Search', 'Lucene'].includes(value.mode)) {
        throw new Error(t('Invalid query mode'));
    }
    for (const key of ['query', 'timeRawFrom', 'timeRawTo', 'startTime', 'endTime']) {
        if (value[key] !== undefined && typeof value[key] !== 'string') {
            throw new Error(t('Invalid {{field}}', { field: key }));
        }
    }
    const relative = value.timeRawFrom?.startsWith('now') && value.timeRawTo?.startsWith('now');
    if (!relative && !(value.startTime && value.endTime)) {
        throw new Error(t('A complete time range is required'));
    }
    const operators = [
        '=',
        '!=',
        'in',
        'not in',
        'is null',
        'is not null',
        'between',
        'not between',
        'like',
        'not like',
        'match_all',
        'match_any',
        'match_phrase',
        'match_phrase_prefix',
    ];
    const optionalPath = (x: any) => x.variantPath === undefined || stringArray(x.variantPath);
    const optionalText = (x: any, keys: string[]) => keys.every(key => x[key] === undefined || typeof x[key] === 'string');
    if (
        !Array.isArray(value.filters) ||
        !value.filters.every(
            f =>
                record(f) &&
                ['id', 'fieldName', 'operator'].every(key => typeof f[key] === 'string' && f[key]) &&
                operators.includes(f.operator) &&
                Array.isArray(f.value) &&
                f.value.every((v: unknown) => ['string', 'number', 'boolean'].includes(typeof v)) &&
                optionalPath(f) &&
                optionalText(f, ['variantKey', 'variantRootType', 'fieldType', 'label']),
        )
    ) {
        throw new Error(t('Invalid saved filters'));
    }
    if (
        !Array.isArray(value.selectedFields) ||
        !value.selectedFields.every(f => record(f) && typeof f.Field === 'string' && f.Field && optionalPath(f) && optionalText(f, ['Type', 'variantKey']))
    ) {
        throw new Error(t('Invalid selected fields'));
    }
    if (!stringArray(value.columnOrder)) {
        throw new Error(t('Invalid column order'));
    }
    if (
        !record(value.sort) ||
        typeof value.sort.field !== 'string' ||
        !['ASC', 'DESC'].includes(value.sort.direction) ||
        !optionalPath(value.sort) ||
        !optionalText(value.sort, ['variantType'])
    ) {
        throw new Error(t('Invalid saved sort'));
    }
    return value as DiscoverShareState;
}

/** Object key order and omitted optional fields do not make a query dirty. */
export function snapshotKey(state: DiscoverShareState): string {
    const normalize = (value: any): any =>
        Array.isArray(value)
            ? value.map(normalize)
            : record(value)
            ? Object.fromEntries(
                  Object.keys(value)
                      .sort()
                      .filter(key => value[key] !== undefined)
                      .map(key => [key, normalize(value[key])]),
              )
            : value;
    return JSON.stringify(
        normalize({
            ...state,
            query: state.query || '',
            // Discover resolves an empty initial sort to the time field in an
            // effect. That initialization is not an unsaved user modification.
            sort: state.sort.field ? state.sort : { field: state.timeField || '', direction: 'DESC' },
        }),
    );
}
