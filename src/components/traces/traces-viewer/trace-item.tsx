import React from 'react';
import { useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';

interface Trace {
    trace_id: string;
    operation: string;
    trace_duration_ms: number;
    root_span_duration_ms: number;
    max_span_duration_ms: number;
    root_service: string;
    services: string;
    time: string;
    error_spans: number;
    spans: number;
    timeAgo: string;
    progress: number;
}

interface TraceItemProps {
    trace: Trace;
    onClick?: () => void;
}

export const TraceItem: React.FC<TraceItemProps> = ({ trace, onClick }) => {
    const theme = useTheme2();

    return (
        <div
            onClick={onClick}
            className={css`
                display: flex;
                align-items: center;
                background: ${theme.colors.background.primary};
                border: 1px solid ${theme.colors.border.weak};
                border-radius: ${theme.shape.borderRadius()};
                padding: ${theme.spacing(1.5)};
                position: relative;
                overflow: hidden;
                box-shadow: ${theme.shadows.z1};

                &:hover {
                    background-color: rgb(34, 37, 43);
                    cursor: pointer;
                }
            `}
        >
            {/* Progress bar background */}
            <div
                className={css`
                    position: absolute;
                    left: 0;
                    top: 0;
                    height: 100%;
                    width: ${trace.progress}%;
                    background: ${theme.colors.primary.main};
                    opacity: 0.1;
                `}
            />

            <div
                className={css`
                    flex: 1;
                    display: grid;
                    gap: ${theme.spacing(0.5)};
                    z-index: 10;
                `}
            >
                <div
                    className={css`
                        display: flex;
                        justify-content: space-between;
                        font-weight: ${theme.typography.fontWeightMedium};
                        color: ${theme.colors.text.primary};
                    `}
                >
                    <span>
                        {trace.root_service}:{trace.operation}{' '}
                        <span
                            className={css`
                                color: ${theme.colors.text.secondary};
                            `}
                        >
                            {trace.trace_id}
                        </span>
                    </span>
                    <span>{trace.trace_duration_ms} ms</span>
                </div>

                <div
                    className={css`
                        display: flex;
                        justify-content: space-between;
                        font-size: ${theme.typography.size.sm};
                        color: ${theme.colors.text.secondary};
                    `}
                >
                    <div
                        className={css`
                            display: flex;
                            align-items: center;
                            gap: ${theme.spacing(1)};
                        `}
                    >
                        <span>{trace.spans} Spans</span>
                        <div
                            className={css`
                                display: flex;
                                gap: ${theme.spacing(0.5)};
                            `}
                        >
                            {JSON.parse(trace.services).map((service: any, index: number) => (
                                <span
                                    key={index}
                                    className={css`
                                        padding: 2px 6px;
                                        border-radius: 9999px;
                                        font-size: ${theme.typography.size.xs};
                                        color: ${theme.colors.text.secondary};
                                    `}
                                >
                                    {service}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div
                        className={css`
                            text-align: right;
                        `}
                    >
                        <div>{trace.time}</div>
                        <div
                            className={css`
                                font-size: ${theme.typography.size.xs};
                                color: ${theme.colors.text.disabled};
                            `}
                        >
                            {trace.timeAgo}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
