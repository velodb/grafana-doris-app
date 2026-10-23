import { t } from 'i18n';
import { formatDorisTime, getGrafanaUserTimeZone, histogramOrigin, nextHistogramBucket, parseDorisTime, HistogramInterval, buildRelativeTimeRange } from './time';
import { getAutoInterval } from '../constants';
import dayjs, { Dayjs, ManipulateType } from 'dayjs';
import { flatten, some } from 'lodash-es';
import { nanoid } from 'nanoid';
import { DiscoverCurrent } from 'types/type';
export { addSqlFilter, getFilterSQL } from './sql-filter';
import jsTokens from 'js-tokens';
import localeData from 'dayjs/plugin/localeData';
import { DataFrame, FieldType, TimeZone } from '@grafana/data';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);
dayjs.extend(localeData);

export const OPERATORS: string[] = [
    '=',
    '!=',
    'in',
    'not in',
    'is null',
    'is not null',
    'like',
    'not like',
    'between',
    'not between',
    'match_any',
    'match_all',
    'match_phrase',
    'match_phrase_prefix',
];
export const SQL_OPERATORS: string[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'AND', 'OR', 'BETWEEN'];
export const TIME_FIELD_TYPES = ['DATETIME', 'DATE', 'DATETIMEV2', 'DATEV2', 'TIME'];
export function isValidTimeFieldType(fieldType: string): boolean {
    // 提取基础字段类型（移除括号及其内容）
    const baseFieldType = fieldType.split('(')[0];
    return TIME_FIELD_TYPES.includes(baseFieldType);
}
export const CAN_SEARCH_FIELD_TYPE = ['STRING', 'ARRAY', 'NUMBER', 'VARIANT'];
export const ENABLE_SEARCH_FIELD_TYPE = ['DATETIME', 'TIMESTAMP', 'TIME'];
export const getFieldType = (columnType: string | undefined) => {
    if (!columnType) {
        return '';
    }
    const currentColumnType = FIELD_TYPES.find(item => item.value.some(val => columnType.toLocaleUpperCase().includes(val)));
    return currentColumnType?.key;
};

export const isVariantType = (columnType: string | undefined) => {
    return String(columnType || '')
        .toLocaleUpperCase()
        .includes('VARIANT');
};

/** JSON/JSONB fields use the same nested-value shape as Doris VARIANT values in the sidebar. */
export const isStructuredJsonType = (columnType: string | undefined) => {
    const normalizedType = String(columnType || '').toLocaleUpperCase();
    return normalizedType.includes('VARIANT') || normalizedType.includes('JSON');
};

export function parseJsonLikeValue(value: any): any {
    if (typeof value !== 'string') {
        if (Array.isArray(value)) {
            return value.map(item => parseJsonLikeValue(item));
        }
        if (value && typeof value === 'object') {
            return Object.entries(value).reduce<Record<string, any>>((result, [key, item]) => {
                result[key] = parseJsonLikeValue(item);
                return result;
            }, {});
        }
        return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return value;
    }

    let normalized = trimmed;
    if (normalized.includes('\\"')) {
        try {
            normalized = JSON.parse(`"${normalized}"`);
        } catch {
            normalized = trimmed;
        }
    }

    const looksJsonLike =
        (normalized.startsWith('{') && normalized.endsWith('}')) ||
        (normalized.startsWith('[') && normalized.endsWith(']')) ||
        (normalized.startsWith('"') && normalized.endsWith('"'));

    if (!looksJsonLike) {
        return value;
    }

    try {
        return parseJsonLikeValue(JSON.parse(normalized));
    } catch {
        return value;
    }
}

export function formatFieldDisplayValue(value: any, mode: 'compact' | 'pretty' = 'compact'): string {
    if (value === null || value === undefined) {
        return '-';
    }

    const parsedValue = parseJsonLikeValue(value);
    if (parsedValue === null || parsedValue === undefined) {
        return '-';
    }

    if (typeof parsedValue === 'object') {
        try {
            return JSON.stringify(parsedValue, null, mode === 'pretty' ? 2 : 0);
        } catch {
            return String(parsedValue);
        }
    }

    return String(parsedValue);
}

/** Formats a row for plain-text previews and clipboard use without leaking rendered HTML. */
export function formatRecordDisplayValue(record: Record<string, any> | null | undefined): string {
    if (!record || typeof record !== 'object') {
        return '-';
    }

    return Object.entries(record)
        .map(([key, value]) => `${key}: ${formatFieldDisplayValue(value, 'compact')}`)
        .join(' ');
}

export function escapeHtml(value: any): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const DISCOVER_DEFAULT_STATUS: DiscoverCurrent = {
    catalog: 'internal',
    database: '',
    table: '',
    cluster: '',
    timeField: '',
    date: [],
};

export enum SearchableEnum {
    ANY = 'ANY',
    YES = 'YES',
    NO = 'NO',
}
export enum AggregatableEnum {
    ANY = 'ANY',
    YES = 'YES',
    NO = 'NO',
}

export const SEARCHABLE = [
    {
        get label() { return t('Any'); },
        value: SearchableEnum.ANY,
    },
    {
        get label() { return t('Yes'); },
        value: SearchableEnum.YES,
    },
    {
        get label() { return t('No'); },
        value: SearchableEnum.NO,
    },
];

export const AGGREGATABLE = [
    {
        get label() { return t('Any'); },
        value: AggregatableEnum.ANY,
    },
    {
        get label() { return t('Yes'); },
        value: AggregatableEnum.YES,
    },
    {
        get label() { return t('No'); },
        value: AggregatableEnum.NO,
    },
];

export enum FieldTypeEnum {
    ANY = 'ANY',
    STRING = 'STRING',
    NUMBER = 'NUMBER',
    DATE = 'DATE',
    VARIANT = 'VARIANT',
}

export enum ParamsKeyEnum {
    sqlCatalog = 'sqlCatalog',
    sqlDatabase = 'sqlDatabase',
    startDate = 'startDateRange',
    endDate = 'endDateRange',
    sqlSearch = 'sqlSearch',
    selectedTable = 'selectedTable',
    dateInterval = 'dateInterval',
    selectedField = 'selectedField',
    dataFilter = 'dataFilter',
    selectedTimeField = 'selectedTimeField',
    sortedField = 'sortedField',
    searchType = 'searchType',
    selectedIndex = 'selectedIndex',
    selectedCluster = 'selectedCluster',
}

function isWrappedInQuotes(inputString: string): boolean {
    const pattern = /(["'])(.*?)\1/;
    return pattern.test(inputString);
}

export function getIndexesStatement(indexes: any[], allField: any[], keywords: string) {
    let operator: 'MATCH_ANY' | 'MATCH_PHRASE' | 'MATCH_PHRASE_PREFIX' | '=' = 'MATCH_ANY';

    let searchValue = keywords.trim();

    if (!searchValue || !indexes) {
        return '';
    }

    if (isWrappedInQuotes(keywords)) {
        operator = 'MATCH_PHRASE';
    } else {
        searchValue = `'${searchValue}'`;
    }
    const indexesNames = indexes.map(item => item.columnName);
    return indexesNames.reduce((prevValue, currValue) => {
        const currentField = allField.find(field => `${field.value}` === currValue);
        const currentFieldType = getFieldType(currentField.Type)?.toUpperCase();
        if (currentFieldType === 'NUMBER') {
            operator = '=';
        }
        if (currentFieldType === 'STRING' || currentFieldType === 'ARRAY') {
            if (isWrappedInQuotes(keywords)) {
                operator = 'MATCH_PHRASE';
            } else {
                operator = 'MATCH_ANY';
            }
        }
        const canSearchField = CAN_SEARCH_FIELD_TYPE.includes(currentFieldType as string);
        if (canSearchField) {
            if (prevValue) {
                return `${prevValue} OR \`${currValue}\` ${operator} ${searchValue}`;
            } else {
                return `\`${currValue}\` ${operator} ${searchValue}`;
            }
        }
        return prevValue;
    }, '');
}

export const DISCOVER_SHORTCUTS = [
    {
        key: nanoid(),
        get text() { return t('Last 5 Minutes'); },
        get label() { return t('Last 5 Minutes'); },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-5, 'minute').startOf('second'), now],
        format: 'HH:mm',
        raw: {
            from: 'now-5m',
            to: 'now',
        },
        type: 'minute',
        number: -5,
    },
    {
        key: nanoid(),
        get text() { return t('Last 15 Minutes'); },
        get label() { return t('Last 15 Minutes'); },
        raw: {
            from: 'now-15m',
            to: 'now',
        },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-15, 'minute').startOf('second'), now],
        format: 'HH:mm',
        type: 'minute',
        number: -15,
    },
    {
        key: nanoid(),
        get text() { return t('Last 1 Hour'); },
        get label() { return t('Last 1 Hour'); },
        raw: {
            from: 'now-1h',
            to: 'now',
        },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-1, 'hour').startOf('second'), now],
        format: 'HH:mm',
        type: 'hour',
        number: -1,
    },
    {
        key: nanoid(),
        get text() { return t('Last 1 Day'); },
        get label() { return t('Last 1 Day'); },
        raw: {
            from: 'now-1d',
            to: 'now',
        },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-1, 'day').startOf('second'), now],
        format: 'HH:mm',
        type: 'day',
        number: -1,
    },
    {
        key: nanoid(),
        get text() { return t('Last 7 Days'); },
        get label() { return t('Last 1 Days'); },
        raw: {
            from: 'now-7d',
            to: 'now',
        },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-7, 'day').startOf('second'), now],
        format: 'HH:mm',
        type: 'day',
        number: -7,
    },
    {
        key: nanoid(),
        get text() { return t('Last 1 Month'); },
        get label() { return t('Last 1 Month'); },
        raw: {
            from: 'now-1M',
            to: 'now',
        },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-1, 'month').startOf('second'), now],
        format: 'HH:mm',
        type: 'month',
        number: -1,
    },
    {
        key: nanoid(),
        get text() { return t('Last 3 Months'); },
        get label() { return t('Last 3 Months'); },
        raw: {
            from: 'now-3M',
            to: 'now',
        },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-3, 'month').startOf('second'), now],
        format: 'HH:mm',
        type: 'month',
        number: -3,
    },
    {
        key: nanoid(),
        get text() { return t('Last 1 Year'); },
        get label() { return t('Last 1 Year'); },
        raw: {
            from: 'now-1y',
            to: 'now',
        },
        range: (now: dayjs.Dayjs = dayjs()) => [now.add(-1, 'year').startOf('second'), now],
        format: 'HH:mm',
        type: 'year',
        number: -1,
    },
];

export const SURROUNDING_LOGS_OPERATORS = [
    {
        label: '5',
        value: '5',
    },
    {
        label: '10',
        value: '10',
    },
];

export function getLatestTime(id: string, timeZone: TimeZone = getGrafanaUserTimeZone()) {
    if (!id) {
        return null;
    }
    const selectedItem = DISCOVER_SHORTCUTS.find(item => item.key === id);
    if (selectedItem?.raw) {
        const range = buildRelativeTimeRange(String(selectedItem.raw.from), String(selectedItem.raw.to), timeZone);
        return [dayjs(range.from.valueOf()), dayjs(range.to.valueOf())];
    }
    return selectedItem?.range();
}

export const TIME_INTERVALS = [
    {
        value: 'auto',
        get label() { return t('Auto'); },
    },
    {
        value: 'second',
        get label() { return t('Second'); },
    },
    {
        value: 'minute',
        get label() { return t('Minute'); },
    },
    {
        value: 'hour',
        get label() { return t('Hour'); },
    },
    {
        value: 'day',
        get label() { return t('Day'); },
    },
    {
        value: 'week',
        get label() { return t('Week'); },
    },
    {
        value: 'month',
        get label() { return t('Month'); },
    },
    {
        value: 'year',
        get label() { return t('Year'); },
    },
];

export const PAGESIZE_OPTIONS = [10, 20, 50, 100, 200];

export const FIELD_TYPES = [
    {
        key: 'STRING',
        value: ['VARCHAR', 'STRING', 'CHAR', 'TEXT'],
        icon: '',
    },
    {
        key: 'NUMBER',
        value: ['INT', 'LARGEINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'BIGINT', 'FLOAT', 'DOUBLE'],
        icon: '',
    },
    {
        key: 'DATE',
        value: ['DATE', 'DATETIME', 'DATEV2', 'DATETIMEV2'],
        icon: '',
    },
    {
        key: 'JSONB',
        value: ['JSONB'],
        icon: '',
        complex: true,
    },
    {
        key: 'ARRAY',
        value: ['ARRAY'],
        icon: '',
        complex: true,
    },
    {
        key: 'BOOLEAN',
        value: ['BOOLEAN'],
        icon: '',
    },
    {
        key: 'BITMAP',
        value: ['BITMAP'],
        icon: '',
        complex: true,
    },
    {
        key: 'HLL',
        value: ['HLL'],
        icon: '',
        complex: true,
    },
    {
        key: 'VARIANT',
        value: ['VARIANT'],
        icon: '',
        complex: true,
    },
    {
        key: 'JSON',
        value: ['JSON'],
        icon: '',
        complex: true,
    },
];

export function encodeBase64(str: string) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode(parseInt('0x' + p1, 10))));
}

export function decodeBase64(base64: string) {
    return decodeURIComponent(
        Array.from(atob(base64))
            .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join(''),
    );
}

export const isComplexType = (columnType: string | undefined) => {
    if (!columnType) {
        return false;
    }
    const currentColumnType = FIELD_TYPES.find(item => item.value.some(val => columnType.toLocaleUpperCase().includes(val)));
    if (currentColumnType) {
        return !!currentColumnType.complex;
    }
    return true;
};

export function formatDate(interval: ManipulateType) {
    let date_format = 'YYYY-MM-DD HH:mm:ss';
    switch (interval) {
        case 'year':
            date_format = 'YYYY';
            break;
        case 'month':
            date_format = 'YYYY-MM';
            break;
        case 'week':
            date_format = 'YYYY-MM-DD';
            break;
        case 'day':
            date_format = 'YYYY-MM-DD';
            break;
        case 'hour':
            date_format = 'YYYY-MM-DD HH:mm:ss';
            break;
        case 'minute':
            date_format = 'YYYY-MM-DD HH:mm:ss';
            break;
        case 'second':
        default:
            date_format = 'YYYY-MM-DD HH:mm:ss';
            break;
    }
    return date_format;
}

export function resetDate(date: Dayjs, interval: ManipulateType) {
    let date_reset = date;
    switch (interval) {
        case 'year':
            date_reset.set('month', 1).set('date', 1).set('hour', 0).set('minute', 0).set('second', 0);
            break;
        case 'month':
            date_reset.set('date', 1).set('hour', 0).set('minute', 0).set('second', 0);
            break;
        case 'week':
            date_reset.set('hour', 0).set('minute', 0).set('second', 0);
            break;
        case 'day':
            date_reset.set('hour', 0).set('minute', 0).set('second', 0);
            break;
        case 'hour':
            date_reset.set('minute', 0).set('second', 0);
            break;
        case 'minute':
            date_reset.set('second', 0);
            break;
        case 'second':
        default:
            break;
    }
    return date_reset;
}

export function getDateRange(startDate: Dayjs, endDate: Dayjs, interval: HistogramInterval, timeZone: TimeZone = getGrafanaUserTimeZone()): number[] {
    const dates: number[] = [];
    let date = histogramOrigin(startDate, interval, timeZone);
    while (date.valueOf() < endDate.valueOf()) {
        dates.push(date.valueOf());
        const next = nextHistogramBucket(date, interval, timeZone);
        if (next.valueOf() <= date.valueOf()) {
            break;
        }
        date = next;
    }
    return dates;
}

export function getChartsData(tableDataCharts: any[], currentDate: [Dayjs, Dayjs], timeZone: TimeZone = getGrafanaUserTimeZone(), interval?: HistogramInterval) {
    const selected = interval || getAutoInterval(currentDate) as HistogramInterval;
    const values = new Map<number, number | null>(getDateRange(currentDate[0], currentDate[1], selected, timeZone).map(time => [time, null]));
    for (const row of tableDataCharts) {
        const key = parseDorisTime(row.TT).valueOf();
        if (Number.isFinite(key)) {
            values.set(key, Number(row['sum(cnt)'] || 0));
        }
    }
    return [...values.entries()].sort(([a], [b]) => a - b).map(([time, count]) => ({
        TT: time, label: formatDorisTime(time, timeZone, 'YYYY-MM-DD HH:mm:ss Z'),
        bucketEnd: nextHistogramBucket(dayjs.utc(time), selected, timeZone).valueOf(), 'sum(cnt)': count,
    }));
}

export function convertColumnToRow(frame: any): Array<Record<string, any>> {
    const fieldNames = frame.schema.fields.map((f: any) => f.name);
    const columns = frame.data.values;

    if (columns.length === 0) {
        return [];
    }

    const numRows = columns[0].length;
    const rows: Array<Record<string, any>> = [];

    for (let i = 0; i < numRows; i++) {
        const row: Record<string, any> = {};
        for (let j = 0; j < columns.length; j++) {
            row[fieldNames[j]] = columns[j][i];
            if (isValidTimeFieldType(frame.schema.fields[j].type.toUpperCase())) {
                // 如果是时间字段，转换为 Dayjs 对象
                row[fieldNames[j]] = formatTimestampToDateTime(row[fieldNames[j]], frame.schema.fields[j].precision || 3);
            }
            if (isStructuredJsonType(frame.schema.fields[j].type)) {
                // 如果是 VARIANT 类型，转换为 JSON 对象
                row[fieldNames[j]] = parseJsonLikeValue(row[fieldNames[j]]);
            }
        }
        rows.push(row);
    }

    return rows;
}

// 通过查询 Doris 的字段判断类型，不依赖 Grafana 类型
export function convertColumnToRowViaFieldsType(frame: any, fields: any): Array<Record<string, any>> {
    const fieldNames = frame.schema.fields.map((f: any) => f.name);
    const columns = frame.data.values;

    if (columns.length === 0) {
        return [];
    }

    const numRows = columns[0].length;
    const rows: Array<Record<string, any>> = [];
    const fieldsByName = new Map((Array.isArray(fields) ? fields : []).map((field: any) => [field?.Field, field]));

    for (let i = 0; i < numRows; i++) {
        const row: Record<string, any> = {};
        for (let j = 0; j < columns.length; j++) {
            row[fieldNames[j]] = columns[j][i];
            if (isValidTimeFieldType(frame.schema.fields[j].type.toUpperCase())) {
                // 如果是时间字段，转换为 Dayjs 对象
                row[fieldNames[j]] = formatTimestampToDateTime(row[fieldNames[j]], frame.schema.fields[j].precision || 3);
                // row[fieldNames[j]] = dayjs.utc(row[fieldNames[j]]).locale(currentLocale).format('YYYY-MM-DD HH:mm:ss.SSS');
            }
            const currentFieldInfo = fieldsByName.get(frame.schema.fields[j].name);
            // 如果是 VARIANT 类型，转换为 JSON 对象
            if (currentFieldInfo && isStructuredJsonType(currentFieldInfo.Type)) {
                row[fieldNames[j]] = parseJsonLikeValue(row[fieldNames[j]]);
            }
        }
        rows.push(row);
    }

    return rows;
}

// 格式化时间戳为 DATETIME([number]) 格式
export function formatTimestampToDateTime(timestamp: any, precision = 3, timeZone: TimeZone = 'utc') {
    // 基础格式：YYYY-MM-DD HH:mm:ss
    let formatString = 'YYYY-MM-DD HH:mm:ss';

    // 根据精度添加毫秒部分
    if (precision > 0) {
        formatString += `.${'S'.repeat(precision)}`;
    }
    // 转换时间戳并格式化
    return formatDorisTime(timestamp, timeZone, formatString);
}

function parseJsonIfString(item: any) {
    if (typeof item !== 'string') {
        return item;
    }

    const trimmed = item.trim();
    if (!trimmed) {
        return item;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return item;
    }
}

function normalizeTraceTags(item: any) {
    const parsed = parseJsonIfString(item);

    if (Array.isArray(parsed)) {
        return parsed.map(tag => {
            if (tag && typeof tag === 'object' && 'key' in tag && 'value' in tag) {
                return tag;
            }

            return {
                key: String(tag),
                value: '',
            };
        });
    }

    if (parsed && typeof parsed === 'object') {
        const tags: Array<{ key: string; value: string }> = [];
        const visit = (value: any, key: string) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                Object.entries(value).forEach(([child, nested]) => visit(nested, key ? `${key}.${child}` : child));
            } else {
                tags.push({ key, value: typeof value === 'string' ? value : JSON.stringify(value) ?? '' });
            }
        };
        Object.entries(parsed).forEach(([key, value]) => visit(value, key));
        return tags;
    }

    return [];
}

function normalizeTraceLogTimestamp(timestamp: any) {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        return timestamp;
    }

    if (typeof timestamp === 'string') {
        const numericTimestamp = Number(timestamp);
        if (Number.isFinite(numericTimestamp)) {
            return numericTimestamp;
        }

        const parsedTimestamp = dayjs.utc(timestamp.replace(' ', 'T'));
        if (parsedTimestamp.isValid()) {
            return parsedTimestamp.valueOf();
        }
    }

    return timestamp;
}

function normalizeTraceLogs(item: any) {
    const parsed = parseJsonIfString(item);

    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed.map(event => {
        const parsedEvent = parseJsonIfString(event);
        if (!parsedEvent || typeof parsedEvent !== 'object') {
            return {
                timestamp: 0,
                fields: [{ key: 'event', value: parsedEvent }],
            };
        }

        const existingFields = Array.isArray(parsedEvent.fields) ? normalizeTraceTags(parsedEvent.fields) : [];
        const eventName = parsedEvent.name ?? parsedEvent.event ?? parsedEvent.event_name;
        const eventAttributes = normalizeTraceTags(parsedEvent.attributes ?? parsedEvent.event_attributes ?? {});
        const extraFields = Object.entries(parsedEvent)
            .filter(([key]) => !['timestamp', 'time', 'name', 'event', 'event_name', 'attributes', 'event_attributes', 'fields'].includes(key))
            .map(([key, value]) => ({ key, value }));

        return {
            timestamp: normalizeTraceLogTimestamp(parsedEvent.timestamp ?? parsedEvent.time),
            fields: [...(eventName !== undefined ? [{ key: 'event', value: eventName }] : []), ...existingFields, ...eventAttributes, ...extraFields],
        };
    });
}

export function formatTracesResData(frame: any) {
    const { data } = frame;
    const traceDataFrame: DataFrame = {
        name: 'Trace ID',
        refId: frame.schema?.refId || 'Trace ID',
        fields: frame.schema?.fields.map((f: any, i: number) => ({
            name: f.name,
            type: f.type,
            values: data.values[i],
            typeInfo: f.typeInfo,
            config: {},
        })),
        length: data.values[0].length,
    };
    traceDataFrame.fields.forEach(f => {
        if (f.name === 'serviceTags' || f.name === 'tags') {
            f.type = FieldType.other;
            f.values = f.values.map(item => normalizeTraceTags(item));
        }

        if (f.name === 'logs') {
            f.type = FieldType.other;
            f.values = f.values.map(item => normalizeTraceLogs(item));
        }
    });

    return traceDataFrame;
}

function getSearchTableData(tokenizeFields: any[], tableResult: any[]) {
    const result: any = [...tokenizeFields];
    tableResult.forEach(tableItem => {
        result.forEach((token: any) => {
            token['searchValue'] = tableItem[token.columnName];
        });
    });
    return result;
}

function searchField(data: any[], searchString: string) {
    return some(data, item => item.columnName === searchString);
}

function parseKeywords(keyword: string) {
    if (keyword.length >= 2 && keyword[0] === keyword[keyword.length - 1] && (keyword[0] === `'` || keyword[0] === `"`)) {
        keyword = keyword.substring(1, keyword.length - 1);
    }
    return keyword;
}

function insertUnderscore(arr: string[]) {
    return arr.reduce((result: string[], item: string, index) => {
        result.push(item);
        if (index < arr.length - 1) {
            result.push('_');
        }
        return result;
    }, []);
}

type SearchResultItem = { [key: string]: any };
export function generateHighlightedResults(data: { search_value: string; indexes: string[] }, result: SearchResultItem[]) {
    const keyword: string = data.search_value || '';
    const searchTableData = getSearchTableData(data.indexes, result);

    // Detect simple Lucene "field:value" pattern so we can highlight the specified field
    // even when `indexes` (tokenizeFields) is empty. Example: "service_name:frontend"
    const luceneFieldMatch = keyword && keyword.match(/^\s*([^\s:]+)\s*:/);
    const luceneField = luceneFieldMatch ? luceneFieldMatch[1].replace(/['"]+/g, '') : null;

    const _sourceResult = result.map(item => {
        let itemSource = '';

        for (const key in item) {
            let highlightValue: any = formatFieldDisplayValue(item[key], 'compact');
            let itemValue: any = highlightValue;

            if (keyword && (searchField(searchTableData, key) || (luceneField && key === luceneField))) {
                const strValue = typeof itemValue === 'string' ? itemValue : itemValue + '';

                if (isWrappedInQuotes(keyword)) {
                    const parsedKeyword = parseKeywords(keyword);
                    if (parsedKeyword === strValue) {
                        // highlightValue = `<mark>${itemValue}</mark>`;
                        highlightValue = itemValue;
                    } else if (strValue.includes(parsedKeyword)) {
                        // highlightValue = highlightDelimiter(strValue, parsedKeyword);
                        highlightValue = strValue;
                    }
                } else {
                    const tokenizedAns = Array.from(jsTokens(strValue)).map(item => item.value);
                    let ans: string[] = [];

                    if (tokenizedAns.includes(keyword)) {
                        ans = tokenizedAns;
                    } else {
                        const ansWithUnderscore = flatten(
                            tokenizedAns.map(item => {
                                if (item.includes('_')) {
                                    return insertUnderscore(item.split('_'));
                                }
                                return item;
                            }),
                        );
                        ans = ansWithUnderscore;
                    }

                    if (ans.length > 0) {
                        highlightValue = ans.reduce((acc: string, curr: string) => {
                            // if (
                            //     keywordsTokens.filter(token => !isIgnorableHighlightToken(token)).find(token => compare_ignore_quotes(token, curr.toLowerCase())) ||
                            //     compare_ignore_quotes(keyword.toLowerCase(), curr.toLowerCase())
                            // ) {
                            //     return acc + `<mark>${curr}</mark>`;
                            // }
                            return acc + curr;
                        }, '');
                    }
                }
            }

            // ✅ 这里改成用 data-trace-id + class，方便事件委托识别
            if (key === 'trace_id') {
                const traceId = typeof itemValue === 'string' ? itemValue : String(itemValue);

                const content = highlightValue || traceId;

                highlightValue = `<a 
                href="javascript:void(0)" 
                class="trace-link" 
                data-trace-id="${escapeHtml(traceId)}"
            >${escapeHtml(content)}</a>`;
            } else {
                highlightValue = escapeHtml(highlightValue);
            }
            itemSource += `<span class="field-pair"><span class="field-key">${escapeHtml(key)}:</span><span class="field-value">${highlightValue}</span></span>`;
        }

        return {
            _original: item,
            _source: itemSource.trim(),
        };
    });

    return _sourceResult;
}

export const QUERY_TRACE_FIELDS = ['trace_id', 'span_id', 'parent_span_id', 'span_name', 'service_name'];

/** Presentation copy; query cursors and filter values always use the original row. */
export function formatRecordTimes(record: Record<string, any>, fields: any[], timeZone: TimeZone): Record<string, any> {
    const displayed = { ...record };
    for (const field of fields) {
        if (isValidTimeFieldType(String(field.Type || '').toUpperCase()) && displayed[field.Field] != null) {
            displayed[field.Field] = formatTimestampToDateTime(displayed[field.Field], 3, timeZone);
        }
    }
    return displayed;
}
