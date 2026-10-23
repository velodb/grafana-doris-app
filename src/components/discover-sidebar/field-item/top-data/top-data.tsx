import { t } from 'i18n';
import { css } from '@emotion/css';
import { Button, IconButton, useTheme2 } from '@grafana/ui';
import { useAtom, useAtomValue } from 'jotai';
import { get } from 'lodash-es';
import { nanoid } from 'nanoid';
import React from 'react';
import { topDataAtom, tableTotalCountAtom, dataFilterAtom } from 'store/discover';
import { formatFieldDisplayValue, isComplexType } from 'utils/data';
import { getVariantFieldValue } from 'utils/variant-fields';
import { normalizeCount } from 'utils/count';
interface JsonObject {
    [key: string]: any;
}

function normalizeTopDataValue(value: any): string {
    return formatFieldDisplayValue(value, 'compact');
}

function countValueDistribution(jsonArray: JsonObject[], field: any): Array<[any, number]> {
    const valueCountMap = new Map<string, { value: any; count: number }>();

    jsonArray.forEach(obj => {
        const value = field.variantPath?.length ? getVariantFieldValue(obj, field) : get(obj, field.Field);
        // A missing nested key is not a real "-" value and must not be offered
        // as a filter value.
        if (value === undefined || value === null) {
            return;
        }
        const key = JSON.stringify([typeof value, value]);
        const entry = valueCountMap.get(key);
        if (entry) {
            entry.count += 1;
        } else {
            valueCountMap.set(key, { value, count: 1 });
        }
    });

    return Array.from(valueCountMap.values()).map(({ value, count }) => [value, count]);
}

type TopDataProps = {
    field: any;
    onTopN?: (field: any) => void;
    canRunTopN?: boolean;
    canShowStatistics?: boolean;
    onFieldStatistics?: (field: any) => void;
    onPointerEnter?: React.PointerEventHandler<HTMLDivElement>;
    onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
};

function DistributionRows({ field, rows, total, onFilter }: { field: any; rows: Array<[any, number]>; total?: number; onFilter: (value: any, operator: '=' | '!=') => void }) {
    const theme = useTheme2();
    return (
        <div
            role="list"
            className={css`
                display: grid;
                gap: 12px;
                margin-top: 12px;
            `}
        >
            {rows.length ? (
                rows.map(([rawValue, count], index) => {
                    const value = normalizeTopDataValue(rawValue);
                    const percent = total ? Math.min(100, (count * 100) / total) : 0;
                    const canFilter = !isComplexType(field.Type) && rawValue !== undefined && rawValue !== null && value !== '-';
                    return (
                        <div
                            key={index}
                            role="listitem"
                            className={css`
                                display: flex;
                                align-items: center;
                                gap: 12px;
                            `}
                        >
                            <div
                                className={css`
                                    flex: 1;
                                    min-width: 0;
                                `}
                            >
                                <div
                                    className={css`
                                        display: flex;
                                        align-items: center;
                                        gap: 12px;
                                    `}
                                >
                                    <span
                                        title={value}
                                        className={css`
                                            flex: 1;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            white-space: nowrap;
                                        `}
                                    >
                                        {value}
                                    </span>
                                    <span title={total !== undefined ? t('{{count}} / {{total}} records', { count: count.toLocaleString(), total: total.toLocaleString() }) : String(count)}>
                                        {total !== undefined ? `${+percent.toFixed(1)}%` : count.toLocaleString()}
                                    </span>
                                </div>
                                {total !== undefined && (
                                    <div
                                        aria-hidden="true"
                                        className={css`
                                            height: 4px;
                                            margin-top: 5px;
                                            background: ${theme.colors.background.secondary};
                                            border-radius: 2px;
                                        `}
                                    >
                                        <div
                                            style={{ width: `${percent}%` }}
                                            className={css`
                                                height: 100%;
                                                background: ${theme.colors.primary.main};
                                                border-radius: 2px;
                                            `}
                                        />
                                    </div>
                                )}
                            </div>
                            {canFilter && (
                                <div
                                    className={css`
                                        display: flex;
                                        flex: none;
                                        gap: 4px;
                                    `}
                                >
                                    <IconButton
                                        name="plus-circle"
                                        tooltip={t('Include value')}
                                        onClick={event => {
                                            event.stopPropagation();
                                            onFilter(rawValue, '=');
                                        }}
                                    />
                                    <IconButton
                                        name="minus-circle"
                                        tooltip={t('Exclude value')}
                                        onClick={event => {
                                            event.stopPropagation();
                                            onFilter(rawValue, '!=');
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })
            ) : (
                <div
                    className={css`
                        color: ${theme.colors.text.secondary};
                    `}
                >
                    {t('No non-null field values')}
                </div>
            )}
        </div>
    );
}

export function TopData({ field, onTopN, canRunTopN = true, canShowStatistics = false, onFieldStatistics, onPointerEnter, onPointerLeave }: TopDataProps) {
    const theme = useTheme2();
    const topData = useAtomValue(topDataAtom);
    const tableTotalCount = normalizeCount(useAtomValue(tableTotalCountAtom));
    const [, setDataFilter] = useAtom(dataFilterAtom);
    const sampleRows = countValueDistribution(topData, field)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    const addFilter = (value: any, operator: '=' | '!=') => {
        setDataFilter(current => [
            ...current,
            {
                fieldName: field.Field,
                variantPath: field.variantPath,
                variantRootType: field.variantRootType,
                fieldType: field.Type,
                operator,
                value: [value],
                id: nanoid(),
            },
        ]);
    };
    const sectionHeader = css`
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    `;
    const description = css`
        color: ${theme.colors.text.secondary};
        font-size: 12px;
        line-height: 1.5;
        margin-top: 6px;
    `;

    return (
        <div
            role="region"
            aria-label={t('{{field}} field card', { field: field.Field })}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            className={css`
                width: 340px;
                max-width: min(340px, calc(100vw - 24px));
                max-height: min(560px, calc(100vh - 32px));
                box-sizing: border-box;
                overflow-y: auto;
                padding: 8px;
                color: ${theme.colors.text.primary};
            `}
        >
            <div
                className={css`
                    overflow-wrap: anywhere;
                    margin-bottom: 16px;
                `}
            >
                <strong>{field.Field}</strong> <span className={description}>({field.Type})</span>
            </div>
            <section aria-label={t('Current query results')}>
                <div className={sectionHeader}>
                    <strong>{t('Current query results')}</strong>
                    <small>{t('{{count}} samples', { count: topData.length })}</small>
                </div>
                <div className={description}>{t('Based on up to 500 records returned by the current query. Shows the top 5 values; percentages use the sample record count.')}</div>
                <DistributionRows field={field} rows={sampleRows} total={topData.length} onFilter={addFilter} />
            </section>
            {(canRunTopN || canShowStatistics) && (
                <section
                    aria-label={t('All matching data')}
                    className={css`
                        margin-top: 16px;
                        padding-top: 16px;
                        border-top: 1px solid ${theme.colors.border.weak};
                    `}
                >
                    <div className={sectionHeader}>
                        <strong>{t('All matching data')}</strong>
                        <small>{t('{{count}} matching records', { count: tableTotalCount })}</small>
                    </div>
                    <div className={description}>{t('Statistics cover all matching records in the current time range and query, without the 500-record sample limit.')}</div>
                    <div
                        className={css`
                            display: flex;
                            flex-wrap: wrap;
                            gap: 8px;
                            margin-top: 12px;
                        `}
                    >
                        {canShowStatistics && (
                            <Button size="sm" variant="secondary" icon="info-circle" onClick={() => onFieldStatistics?.(field)}>
                                {t('Field statistics')}
                            </Button>
                        )}
                        {canRunTopN && (
                            <Button size="sm" variant="secondary" onClick={() => onTopN?.(field)} title={t('Configure count, aggregation, and sort order for all matching records')}>
                                {t('Top N configuration')}
                            </Button>
                        )}
                    </div>
                    {canShowStatistics && <div className={description}>{t('Click “Field statistics” to view non-null values, unique counts, and distributions in the sidebar.')}</div>}
                </section>
            )}
        </div>
    );
}
