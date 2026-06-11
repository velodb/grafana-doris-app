import { config } from '@grafana/runtime';
import { dateTime, dateTimeFormat, dateTimeParse, rangeUtil, TimeRange, TimeZone } from '@grafana/data';
import dayjs, { Dayjs } from 'dayjs';
import { FORMAT_DATE } from '../constants';

export const DEFAULT_TIME_ZONE: TimeZone = 'browser';

export function getGrafanaUserTimeZone(): TimeZone {
    return (config.bootData?.user?.timezone as TimeZone | undefined) || DEFAULT_TIME_ZONE;
}

export function normalizeTimeZone(timeZone?: string | null): TimeZone | undefined {
    const normalized = timeZone?.trim();
    return normalized ? (normalized as TimeZone) : undefined;
}

export function parseTimeInZone(value?: string | null, timeZone: TimeZone = getGrafanaUserTimeZone()): Dayjs | undefined {
    if (!value) {
        return undefined;
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
