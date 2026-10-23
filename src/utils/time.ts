import { dateTime, dateTimeFormat, dateTimeParse, getTimeZone, rangeUtil, TimeRange, TimeZone } from '@grafana/data';
import dayjs, { Dayjs } from 'dayjs';
import { FORMAT_DATE } from '../constants';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const DEFAULT_TIME_ZONE: TimeZone = 'browser';

export function getGrafanaUserTimeZone(): TimeZone {
    return getTimeZone() || DEFAULT_TIME_ZONE;
}

export function normalizeTimeZone(timeZone?: string | null): TimeZone | undefined {
    const normalized = timeZone?.trim();
    if (!normalized) {
        return undefined;
    }
    if (normalized === 'browser') {
        return normalized;
    }
    try {
        new Intl.DateTimeFormat('en', { timeZone: normalized });
        return normalized;
    } catch {
        return undefined;
    }
}

export function parseTimeInZone(value?: string | null, timeZone: TimeZone = getGrafanaUserTimeZone()): Dayjs | undefined {
    if (!value) {
        return undefined;
    }

    // New links are absolute; legacy links contain a wall-clock time in timeZone.
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
        const parsed = dayjs(value);
        return parsed.isValid() ? parsed : undefined;
    }
    const parsedDate = dateTimeParse(value, { timeZone, format: FORMAT_DATE });
    return parsedDate?.isValid() ? dayjs(parsedDate.toDate()) : undefined;
}

export function formatTimeInZone(value: Dayjs, timeZone: TimeZone): string {
    return dateTimeFormat(dateTime(value.toDate()), { timeZone, format: FORMAT_DATE });
}

export function toDayjsRange(timeRange: TimeRange): [Dayjs, Dayjs] {
    return [dayjs(timeRange.from.toDate()), dayjs(timeRange.to.toDate())];
}

export function buildRelativeTimeRange(rawFrom: string, rawTo: string, timeZone: TimeZone): TimeRange {
    return rangeUtil.convertRawToRange({ from: rawFrom, to: rawTo }, timeZone);
}

export function buildAbsoluteTimeRange(start: Dayjs, end: Dayjs): TimeRange {
    return {
        from: dateTime(start.toDate()),
        to: dateTime(end.toDate()),
        raw: {
            from: dateTime(start.toDate()),
            to: dateTime(end.toDate()),
        },
    };
}

/** Doris DATETIME values represent UTC, independently of the display zone. */
export function formatSqlTime(value: Dayjs | number | Date): string {
    return dayjs(value).utc().format(FORMAT_DATE);
}

export function formatShareTime(value: Dayjs): string {
    return value.utc().toISOString();
}

export function parseDorisTime(value: string | number | Date): Dayjs {
    return dayjs.utc(value);
}

export function inDisplayTimeZone(value: Dayjs, timeZone: TimeZone = getGrafanaUserTimeZone()): Dayjs {
    return timeZone === 'browser' ? value.local() : value.tz(timeZone);
}

export function formatDorisTime(value: string | number | Date, timeZone: TimeZone, format = 'YYYY-MM-DD HH:mm:ss.SSS'): string {
    return inDisplayTimeZone(parseDorisTime(value), timeZone).format(format);
}

export type HistogramInterval = { interval_unit: dayjs.ManipulateType; interval_value: number };

export function histogramOrigin(start: Dayjs, interval: HistogramInterval, zone: TimeZone): Dayjs {
    return inDisplayTimeZone(start, zone).startOf(interval.interval_unit);
}

export function nextHistogramBucket(start: Dayjs, interval: HistogramInterval, zone: TimeZone): Dayjs {
    if (['second', 'minute', 'hour'].includes(interval.interval_unit)) {
        return start.utc().add(interval.interval_value, interval.interval_unit);
    }
    const local = inDisplayTimeZone(start, zone).add(interval.interval_value, interval.interval_unit);
    // Re-resolve the wall clock after a calendar increment; a day may be 23/25 hours.
    return zone === 'browser' ? dayjs(local.format('YYYY-MM-DD HH:mm:ss')) : dayjs.tz(local.format('YYYY-MM-DD HH:mm:ss'), zone);
}
