import { t } from 'i18n';
import React, { useState } from 'react';
import { css } from '@emotion/css';
import { Button, Drawer, Field, Icon, Input, RadioButtonGroup, Select, useTheme2 } from '@grafana/ui';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { tableFieldsAtom, topNConfigAtom, topNConfigurationFieldAtom, topNEnabledAtom, topNRunRequestAtom } from 'store/discover';
import { getFieldType, isComplexType } from 'utils/data';
import { FieldStatisticsField, TopNAggregation } from 'types/type';
import TopNResults from 'components/discover-content/top-n-results';
import { useTopNData } from './useTopNData';
import { useTopNPreferences } from './useTopNPreferences';

function ConfigurationForm({ field, onClose, preferences }: { field: FieldStatisticsField; onClose: () => void; preferences: ReturnType<typeof useTopNPreferences> }) {
    const theme = useTheme2();
    const fields = useAtomValue(tableFieldsAtom);
    const setConfig = useSetAtom(topNConfigAtom);
    const { config, update } = preferences;
    const setEnabled = useSetAtom(topNEnabledAtom);
    const requestRun = useSetAtom(topNRunRequestAtom);
    const numericFields = fields.filter(item => getFieldType(item.Type) === 'NUMBER' && !isComplexType(item.Type) && !item.variantPath?.length);
    const [invalidLimitText, setInvalidLimitText] = useState<string | null>(null);
    const limitText = invalidLimitText ?? String(config.limit);
    const { metric, direction } = config;
    const metricField = config.metricField || numericFields[0]?.Field || '';
    const setLimitText = (text: string) => {
        const value = Number(text);
        if (text.trim() && Number.isInteger(value) && value >= 1 && value <= 10000) {
            update({ limit: value });
            setInvalidLimitText(null);
        } else {
            setInvalidLimitText(text);
        }
    };
    const fieldStyle = css`
        margin-bottom: 0;
    `;
    const resultState = useTopNData(field.Field);
    const limit = Number(limitText);
    const invalidLimit = !Number.isInteger(limit) || limit < 1 || limit > 10000;
    const invalidMetricField = metric !== 'COUNT' && !numericFields.some(item => item.Field === metricField);
    const unavailableField = !fields.some(item => item.Field === field.Field);

    return (
        <Drawer title={t('Top N statistics: {{field}}', { field: field.Field })} width="min(640px, calc(100vw - 32px))" onClose={onClose}>
            <div
                data-testid="top-n-sidebar"
                className={css`
                    padding: ${theme.spacing(0, 1, 2)};
                    display: grid;
                    gap: ${theme.spacing(4)};
                `}
            >
                <form
                    onSubmit={event => {
                        event.preventDefault();
                        if (invalidLimit || invalidMetricField || unavailableField) {
                            return;
                        }
                        setConfig({ groupField: field.Field, metric, metricField: metric === 'COUNT' ? '' : metricField, direction, limit });
                        setEnabled(true);
                        requestRun(value => value + 1);
                    }}
                    className={css`
                        display: grid;
                        gap: ${theme.spacing(2.5)};
                    `}
                >
                    <p
                        className={css`
                            margin: 0;
                            color: ${theme.colors.text.secondary};
                            line-height: 1.6;
                        `}
                    >
                        {t('Aggregate all matching records in the current time range and query, grouped by {{field}}.', { field: field.Field })}
                    </p>
                    <div
                        className={css`
                            display: grid;
                            gap: ${theme.spacing(1.5)};
                        `}
                    >
                        <Field
                            className={fieldStyle}
                            label={t('Number of groups (N)')}
                            htmlFor="top-n-limit"
                            description={t('Enter an integer from 1–10,000, or choose a preset.')}
                            invalid={invalidLimit}
                            error={invalidLimit ? t('N must be an integer from 1–10,000') : undefined}
                        >
                            <Input
                                id="top-n-limit"
                                autoFocus
                                aria-label={t('Number of groups (N)')}
                                type="number"
                                min={1}
                                max={10000}
                                step={1}
                                value={limitText}
                                onChange={event => setLimitText(event.currentTarget.value)}
                                invalid={invalidLimit}
                            />
                        </Field>
                        <RadioButtonGroup
                            aria-label={t('Common Top N counts')}
                            value={invalidLimitText === null ? config.limit : undefined}
                            options={[5, 10, 20, 50, 100].map(value => ({ label: String(value), ariaLabel: `Top ${value}`, value }))}
                            onChange={value => setLimitText(String(value))}
                            fullWidth
                            size="sm"
                        />
                    </div>
                    <Field label={t('Aggregation')} htmlFor="top-n-metric" className={fieldStyle}>
                        <Select placeholder={t('Choose')}
                            inputId="top-n-metric"
                            aria-label={t('Aggregation')}
                            value={metric}
                            options={[
                                { label: t('Count (COUNT)'), value: 'COUNT' },
                                { label: t('Sum (SUM)'), value: 'SUM', isDisabled: !numericFields.length },
                                { label: t('Average (AVG)'), value: 'AVG', isDisabled: !numericFields.length },
                                { label: t('Minimum (MIN)'), value: 'MIN', isDisabled: !numericFields.length },
                                { label: t('Maximum (MAX)'), value: 'MAX', isDisabled: !numericFields.length },
                            ]}
                            onChange={option => {
                                if (option.value) {
                                    const nextMetric = option.value as TopNAggregation;
                                    update({ metric: nextMetric, metricField: nextMetric === 'COUNT' ? config.metricField : metricField });
                                }
                            }}
                        />
                    </Field>
                    {metric !== 'COUNT' && (
                        <Field
                            label={t('Metric field')}
                            htmlFor="top-n-metric-field"
                            className={fieldStyle}
                            invalid={invalidMetricField}
                            error={invalidMetricField ? t('Select an available numeric field') : undefined}
                        >
                            <Select placeholder={t('Choose')}
                                inputId="top-n-metric-field"
                                aria-label={t('Metric field')}
                                value={metricField}
                                options={numericFields.map(item => ({ label: item.Field, value: item.Field }))}
                                onChange={option => update({ metricField: option.value || '' })}
                            />
                        </Field>
                    )}
                    <Field label={t('Sort direction')} htmlFor="top-n-direction" className={fieldStyle}>
                        <Select placeholder={t('Choose')}
                            inputId="top-n-direction"
                            aria-label={t('Sort direction')}
                            value={direction}
                            options={[
                                { label: t('Highest to lowest (Top)'), value: 'DESC' },
                                { label: t('Lowest to highest (Bottom)'), value: 'ASC' },
                            ]}
                            onChange={option => {
                                if (option.value === 'ASC' || option.value === 'DESC') {
                                    update({ direction: option.value });
                                }
                            }}
                        />
                    </Field>
                    {unavailableField && <p role="alert">{t('This grouping field is no longer available. Close the configuration and select a field again.')}</p>}
                    <div
                        className={css`
                            display: grid;
                            gap: ${theme.spacing(1.5)};
                            border-top: 1px solid ${theme.colors.border.weak};
                            padding-top: ${theme.spacing(2.5)};
                        `}
                    >
                        <div
                            className={css`
                                display: flex;
                                gap: ${theme.spacing(1)};
                            `}
                        >
                            <Button type="submit" icon="play" disabled={invalidLimit || invalidMetricField || unavailableField || resultState.loading}>
                                {resultState.loading ? t('Running…') : t('Run aggregation')}
                            </Button>
                            <Button type="button" variant="secondary" onClick={onClose}>
                                {t('Close')}
                            </Button>
                        </div>
                        <span
                            className={css`
                                display: flex;
                                align-items: center;
                                gap: ${theme.spacing(0.5)};
                                color: ${theme.colors.text.secondary};
                                font-size: ${theme.typography.bodySmall.fontSize};
                            `}
                        >
                            <Icon name="check" size="sm" /> {t('Settings are saved automatically and retained after refresh')}
                        </span>
                    </div>
                </form>
                <TopNResults {...resultState} />
            </div>
        </Drawer>
    );
}

export default function TopNConfiguration() {
    const [field, setField] = useAtom(topNConfigurationFieldAtom);
    const preferences = useTopNPreferences(field?.Field || '');
    return field ? <ConfigurationForm key={preferences.key || field.Field} field={field} preferences={preferences} onClose={() => setField(undefined)} /> : null;
}
