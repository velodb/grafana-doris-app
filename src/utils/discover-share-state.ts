import { DataFilterType } from 'types/type';
import { DiscoverSort } from 'types/discover';

export const DISCOVER_SHARE_STATE_PARAM = 'discoverState';
export const DISCOVER_SHARE_STATE_VERSION = 1;

export type DiscoverSharedField = {
    Field: string;
    Type?: string;
    variantPath?: string[];
    variantKey?: string;
};

export type DiscoverShareState = {
    version: number;
    datasource?: string;
    database?: string;
    table?: string;
    timeField?: string;
    timeZone?: string;
    timeRawFrom?: string;
    timeRawTo?: string;
    startTime?: string;
    endTime?: string;
    mode?: 'SQL' | 'Search' | 'Lucene';
    query?: string;
    filters: DataFilterType[];
    selectedFields: DiscoverSharedField[];
    columnOrder: string[];
    sort: DiscoverSort;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMode(value: unknown): value is DiscoverShareState['mode'] {
    return value === 'SQL' || value === 'Search' || value === 'Lucene';
}

export function encodeDiscoverShareState(state: DiscoverShareState): string {
    return encodeURIComponent(JSON.stringify(state));
}

export function decodeDiscoverShareState(value?: string | null): DiscoverShareState | undefined {
    if (!value) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(decodeURIComponent(value));
        if (!isRecord(parsed) || parsed.version !== DISCOVER_SHARE_STATE_VERSION) {
            return undefined;
        }
        if (!Array.isArray(parsed.filters) || !Array.isArray(parsed.selectedFields) || !Array.isArray(parsed.columnOrder) || !isRecord(parsed.sort)) {
            return undefined;
        }
        return {
            version: DISCOVER_SHARE_STATE_VERSION,
            datasource: typeof parsed.datasource === 'string' ? parsed.datasource : undefined,
            database: typeof parsed.database === 'string' ? parsed.database : undefined,
            table: typeof parsed.table === 'string' ? parsed.table : undefined,
            timeField: typeof parsed.timeField === 'string' ? parsed.timeField : undefined,
            timeZone: typeof parsed.timeZone === 'string' ? parsed.timeZone : undefined,
            timeRawFrom: typeof parsed.timeRawFrom === 'string' ? parsed.timeRawFrom : undefined,
            timeRawTo: typeof parsed.timeRawTo === 'string' ? parsed.timeRawTo : undefined,
            startTime: typeof parsed.startTime === 'string' ? parsed.startTime : undefined,
            endTime: typeof parsed.endTime === 'string' ? parsed.endTime : undefined,
            mode: isMode(parsed.mode) ? parsed.mode : undefined,
            query: typeof parsed.query === 'string' ? parsed.query : undefined,
            filters: parsed.filters
                .filter(isRecord)
                .filter(item => typeof item.id === 'string' && typeof item.fieldName === 'string' && typeof item.operator === 'string' && Array.isArray(item.value))
                .map(item => ({ ...item } as unknown as DataFilterType)),
            selectedFields: parsed.selectedFields
                .filter(isRecord)
                .filter(item => typeof item.Field === 'string')
                .map(item => ({
                    Field: item.Field as string,
                    Type: typeof item.Type === 'string' ? item.Type : undefined,
                    variantPath: Array.isArray(item.variantPath) ? item.variantPath.filter(value => typeof value === 'string') : undefined,
                    variantKey: typeof item.variantKey === 'string' ? item.variantKey : undefined,
                })),
            columnOrder: parsed.columnOrder.filter(item => typeof item === 'string'),
            sort: {
                field: typeof parsed.sort.field === 'string' ? parsed.sort.field : '',
                direction: parsed.sort.direction === 'ASC' ? 'ASC' : 'DESC',
                variantPath: Array.isArray(parsed.sort.variantPath) ? parsed.sort.variantPath.filter(item => typeof item === 'string') : undefined,
                variantType: typeof parsed.sort.variantType === 'string' ? parsed.sort.variantType : undefined,
            },
        };
    } catch {
        return undefined;
    }
}

export function readDiscoverShareState(searchParams: URLSearchParams): DiscoverShareState | undefined {
    return decodeDiscoverShareState(searchParams.get(DISCOVER_SHARE_STATE_PARAM));
}
