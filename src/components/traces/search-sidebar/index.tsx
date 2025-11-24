'use client';

import React, { useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button, Field, Input, Select } from '@grafana/ui';
import { useAtom, useAtomValue } from 'jotai';
import { currentOperationAtom, currentServiceAtom, maxDurationAtom, minDurationAtom, tagsAtom, traceOperationsAtom, tracesServicesAtom } from 'store/traces';
import { css } from '@emotion/css';
import { currentTimeFieldAtom } from 'store/discover';

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
        setCurrentService({ value: 'all', label: 'ALL' });
    }, [currentTimeField, setCurrentService]);

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div>
                    <Field label="Service" style={{ marginLeft: 8 }}>
                        <Select
                            width={15}
                            options={tracesServices}
                            value={currentService}
                            onChange={(selectedService: any) => {
                                // Handle service change
                                setCurrentService(selectedService);
                                setCurrentOperation({ value: 'all', label: 'ALL' });
                            }}
                        ></Select>
                    </Field>
                </div>

                <div>
                    <Field label="Operation" style={{ marginLeft: 8 }}>
                        <Select
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
                                    justify-content: space-between;
                                `}
                            >
                                Tags
                                <HelpCircle
                                    className={css`
                                        margin-left: 4px;
                                    `}
                                />
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
                                console.log((e.target as HTMLInputElement)?.value);
                                setTags((e.target as HTMLInputElement)?.value);
                            }}
                        />
                    </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Field label="Min Duration" style={{ marginLeft: 8 }}>
                            <Input
                                id="min-duration"
                                placeholder="e.g. 1.2s, 100ms, 500us"
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
                        <Field label="Max Duration" style={{ marginLeft: 8 }}>
                            <Input
                                id="max-duration"
                                placeholder="e.g. 1.2s, 100ms, 500us"
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
                    Find Traces
                </Button>
            </div>
        </div>
    );
}
