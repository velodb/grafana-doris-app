import { css } from '@emotion/css';
import { Button, IconButton } from '@grafana/ui';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface SurroundingLogsActionsProps {
    getSurroundingData: (params: { time: string }) => void;
    getSurroundingDataLoading: boolean;
    time: string;
    timeFieldPageSize: number;
    setTimeFieldPageSize: (value: number) => void;
    tips: string;
    count: number;
    type: 'before' | 'after';
}

export function SurroundingLogsActions(props: SurroundingLogsActionsProps) {
    const { getSurroundingData, getSurroundingDataLoading, time, timeFieldPageSize, tips, count, type } = props;
    const { t } = useTranslation();
    return (
        <div
            className={css`
                display: flex;
                align-items: center;
                justify-content: flex-start;
            `}
        >
            <Button
                // loading={getSurroundingDataLoading}
                className="font-normal text-n2 hover:text-b7 hover:no-underline"
                onClick={() => {
                    getSurroundingData({ time: time });
                }}
                type="reset"
            >
                {!getSurroundingDataLoading && (
                    <>{type === 'before' ? <IconButton name="arrow-up" aria-label={`Load After`} /> : <IconButton name="arrow-down" aria-label={`Load Before`} />}</>
                )}
                {`Load`} {timeFieldPageSize} {t`Items`}
            </Button>
            <div
                className={css`
                    margin-left: 8px;
                `}
            >
                {count} {`Items`} {` `}
                {tips}
            </div>
        </div>
    );
}
