'use client';
import { t } from 'i18n';

import React, { useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button, Field, Input, Select } from '@grafana/ui';
import { useAtom, useAtomValue } from 'jotai';
import { Tooltip } from 'antd';
import { currentOperationAtom, currentServiceAtom, maxDurationAtom, minDurationAtom, tagsAtom, traceOperationsAtom, tracesServicesAtom } from 'store/traces';
import { css } from '@emotion/css';
import { currentTimeFieldAtom } from 'store/discover';
import { trimSpacesAroundEquals } from 'utils/utils';

export function SearchSidebar(props: {
    onQuerying?: () => void;
    onServiceChange?: (service: any) => void;
    onOperationChange?: (operation: any) => void;
    onTagsChange?: (tags: string) => void;
    onMinDurationChange?: (minDuration: string) => void;
    onMaxDurationChange?: (maxDuration: string) => void;
    onLimitResultsChange?: (limit: number) => void;
}) {
    const tracesServices = useAtomValue(tracesServicesAtom);
    const traceOperations = useAtomValue(traceOperationsAtom);
    const [currentService, setCurrentService] = useAtom(currentServiceAtom);
    const [currentOperation, setCurrentOperation] = useAtom(currentOperationAtom);
    const [tags, setTags] = useAtom(tagsAtom);
    const currentTimeField = useAtomValue(currentTimeFieldAtom);
    const [minDuration, setMinDuration] = useAtom(minDurationAtom);
    const [maxDuration, setMaxDuration] = useAtom(maxDurationAtom);

    useEffect(() => {
        setCurrentService({ value: 'all', label: t('All') });
    }, [currentTimeField, setCurrentService]);

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div>
                    <Field label={t('Service')} style={{ marginLeft: 8 }}>
                        <Select placeholder={t('Choose')}
                            width={15}
                            options={tracesServices}
                            value={currentService}
                            onChange={(selectedService: any) => {
                                // Handle service change
                                setCurrentService(selectedService);
                                setCurrentOperation({ value: 'all', label: t('All') });
                            }}
                        ></Select>
                    </Field>
                </div>

                <div>
                    <Field label={t('Operation')} style={{ marginLeft: 8 }}>
                        <Select placeholder={t('Choose')}
                            width={15}
                            options={traceOperations}
                            value={currentOperation}
                            onChange={(selectedOperation: any) => {
                                setCurrentOperation(selectedOperation);
                            }}
                        ></Select>
                    </Field>
                </div>

                <div>
                    {/* <Label htmlFor="tags" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                        Tags <HelpCircle className="w-3 h-3 text-gray-400" />
                    </Label> */}
                    <Field
                        label={
                            <span
                                className={css`
                                    display: flex;
                                    align-items: center;
                                `}
                            >
                                {t('Tags')}<Tooltip title={<div>
                                    {t('Filter traces using')} <a className={css`font-weight:500px;color:#3D71D9;`} href='https://brandur.org/logfmt' target='_blank' rel="noreferrer">logfmt</a> {t('syntax:')}
                                    <br />
                                    <ul className={css`list-style-type: disc;list-style-position: inside;`}>
                                        <li>{t('Equality: http.status_code=200')}</li>
                                        <li>{t('Inequality: error!=true')}</li>
                                        <li>{t('Contains: message~="timeout"')}</li>
                                        <li>{t('Multiple (AND): method=POST duration>1000')}</li>
                                        <li>{t('OR conditions: error=true OR status>=500')}</li>
                                    </ul>
                                </div>}>
                                    <HelpCircle
                                        size={16}
                                        className={css`
                                        margin-left: 4px;
                                    `}
                                    />
                                </Tooltip>

                            </span>
                        }
                        style={{ marginLeft: 8 }}
                    >
                        <Input
                            id="tags"
                            placeholder="http.status_code=200 error=true"
                            className="mt-1"
                            value={tags}
                            onChange={e => {
                                const value = trimSpacesAroundEquals((e.target as HTMLInputElement)?.value);
                                setTags(value);
                            }}
                        />
                    </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Field label={t('Min Duration')} style={{ marginLeft: 8 }}>
                            <Input
                                id="min-duration"
                                placeholder={t('e.g. 1.2s, 100ms, 500us')}
                                className="mt-1"
                                value={minDuration}
                                onChange={e => {
                                    setMinDuration((e.target as HTMLInputElement)?.value);
                                    props?.onMinDurationChange?.((e.target as HTMLInputElement)?.value);
                                }}
                            />
                        </Field>
                    </div>
                    <div>
                        <Field label={t('Max Duration')} style={{ marginLeft: 8 }}>
                            <Input
                                id="max-duration"
                                placeholder={t('e.g. 1.2s, 100ms, 500us')}
                                className="mt-1"
                                value={maxDuration}
                                onChange={e => {
                                    setMaxDuration((e.target as HTMLInputElement)?.value);
                                    props?.onMaxDurationChange?.((e.target as HTMLInputElement)?.value);
                                }}
                            />
                        </Field>
                    </div>
                </div>

                <Button
                    onClick={() => {
                        props?.onQuerying?.();
                    }}
                    style={{ marginLeft: 8 }}
                >
                    {t('Find Traces')}
                </Button>
            </div>
        </div>
    );
}
