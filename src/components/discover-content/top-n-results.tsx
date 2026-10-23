import { t } from 'i18n';
import React from 'react';
import { useAtomValue } from 'jotai';
import { Alert, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { topNConfigAtom, topNResultFieldsAtom, topNRowsAtom } from 'store/discover';

export default function TopNResults({ loading, hasRun, error }: { loading: boolean; hasRun: boolean; error?: Error }) {
    const fields = useAtomValue(topNResultFieldsAtom);
    const rows = useAtomValue(topNRowsAtom);
    const config = useAtomValue(topNConfigAtom);
    const theme = useTheme2();
    const metricLabel = config.metric === 'COUNT' ? t('Record count') : `${config.metric}(${config.metricField})`;
    if (!hasRun) {
        return null;
    }
    if (error) {
        return (
            <Alert title={t('Top N statistics failed')} severity="error">
                {error.message}
            </Alert>
        );
    }
    return (
        <section
            aria-label={t('Top N aggregation results')}
            data-testid="discover-top-n-results"
            className={css`
                margin: 0;
                padding-top: ${theme.spacing(3)};
                border-top: 1px solid ${theme.colors.border.weak};
            `}
        >
            <div
                className={css`
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: ${theme.spacing(1)};
                    margin-bottom: ${theme.spacing(1)};
                `}
            >
                <h4
                    className={css`
                        margin: 0;
                        font-size: ${theme.typography.h5.fontSize};
                    `}
                >
                    {t('Aggregation results')}
                </h4>
                <span
                    className={css`
                        color: ${theme.colors.text.secondary};
                        font-size: ${theme.typography.bodySmall.fontSize};
                    `}
                >
                    {loading ? t('Calculating') : t('{{count}} groups', { count: rows.length })}
                </span>
            </div>
            <div
                className={css`
                    margin-bottom: ${theme.spacing(2)};
                    color: ${theme.colors.text.secondary};
                    font-size: ${theme.typography.bodySmall.fontSize};
                    line-height: 1.6;
                    overflow-wrap: anywhere;
                `}
            >
                {config.direction === 'ASC' ? t('Bottom') : t('Top')} {config.limit} · {config.groupField} · {metricLabel}
            </div>
            <div
                className={css`
                    max-height: 480px;
                    overflow: auto;
                    border: 1px solid ${theme.colors.border.weak};
                    border-radius: ${theme.shape.radius.default};
                `}
            >
                <table
                    className={css`
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 14px;
                    `}
                >
                    <thead>
                        <tr>
                            {fields.map(field => (
                                <th
                                    key={field.Field}
                                    className={css`
                                        position: sticky;
                                        top: 0;
                                        background: ${theme.colors.background.secondary};
                                        padding: ${theme.spacing(1.5)};
                                        border-bottom: 1px solid ${theme.colors.border.weak};
                                        text-align: ${field.Field === '__top_n_value' ? 'right' : 'left'};
                                    `}
                                >
                                    {field.Field === '__top_n_value' ? metricLabel : field.Field}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {(loading ? [] : rows).map((row, index) => (
                            <tr
                                key={index}
                                className={css`
                                    &:hover {
                                        background: ${theme.colors.action.hover};
                                    }
                                    &:last-child td {
                                        border-bottom: 0;
                                    }
                                `}
                            >
                                {fields.map(field => (
                                    <td
                                        key={field.Field}
                                        className={css`
                                            padding: ${theme.spacing(1.5)};
                                            border-bottom: 1px solid ${theme.colors.border.weak};
                                            overflow-wrap: anywhere;
                                            font-variant-numeric: tabular-nums;
                                            text-align: ${field.Field === '__top_n_value' ? 'right' : 'left'};
                                        `}
                                    >
                                        {row[field.Field] == null ? 'NULL' : String(row[field.Field])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {loading ? (
                <div
                    role="status"
                    className={css`
                        padding: 16px;
                        font-size: 14px;
                    `}
                >
                    {t('Calculating…')}
                </div>
            ) : rows.length === 0 ? (
                <div
                    className={css`
                        padding: 16px;
                        font-size: 14px;
                    `}
                >
                    {t('No matching groups')}
                </div>
            ) : null}
        </section>
    );
}
