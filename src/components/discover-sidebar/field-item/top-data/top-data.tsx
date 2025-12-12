import { css } from '@emotion/css';
import { IconButton } from '@grafana/ui';
import { Progress } from 'antd';
import { useAtom, useAtomValue } from 'jotai';
import { get } from 'lodash-es';
import { nanoid } from 'nanoid';
import React from 'react';
import { topDataAtom, tableTotalCountAtom, dataFilterAtom } from 'store/discover';
import { isComplexType } from 'utils/data';
interface JsonObject {
    [key: string]: any;
}
function countValueDistribution(jsonArray: JsonObject[], key: string): { [value: string]: number } {
    const valueCountMap = new Map<string, number>();

    jsonArray.forEach(obj => {
        let value = get(obj, key);
        if (value === undefined) {
            value = '';
        }
        valueCountMap.set(value, (valueCountMap.get(value) || 0) + 1);
    });

    const result: { [value: string]: number } = {};
    valueCountMap.forEach((times, valueStr) => {
        const value = valueStr;
        result[value] = times;
    });

    return result;
}

export function TopData({ field }: any) {
    console.log(field);
    const topData = useAtomValue(topDataAtom);
    const tableTotalCount = useAtomValue(tableTotalCountAtom);
    const [dataFilter, setDataFilter] = useAtom(dataFilterAtom);
    const canDisplayTopData = field?.Type?.toUpperCase() !== 'VARIANT';
    const res = Object.entries(countValueDistribution(topData, field.Field)).sort((a: any, b: any) => b[1].count - a[1].count);

    return (
        <div
            className={css`
                max-height: 400px;
                overflow-y: auto;
                padding: 8px;
            `}
        >
            <div className="mb-2 mt-2 break-words text-xs text-n5">
                <span className="mr-2">{field.Field}</span>
                <span>({field.Type})</span>
            </div>
            <div
                className={css`
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                `}
            >
                <div
                    className={css`
                        font-size: 16px;
                        margin: 8px 0;
                    `}
                >
                    TOP5
                </div>
                <small className="text-n2">{tableTotalCount >= 500 ? 500 : tableTotalCount} Items</small>
            </div>
            {canDisplayTopData ? (
                <div className="mt-3 space-y-3 text-n5">
                    {res.map(
                        ([value, count], index) =>
                            index < 5 && (
                                <div key={index} className="flex items-center justify-between">
                                    <div
                                        className={css`
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            white-space: nowrap;
                                        `}
                                    >
                                        <div
                                            className={css`
                                                display: flex;
                                                align-items: center;
                                                width: 180px;
                                                justify-content: space-between;
                                            `}
                                        >
                                            <div
                                                className={css`
                                                    flex: 1 1 0%;
                                                    overflow: hidden;
                                                    text-overflow: ellipsis;
                                                    white-space: nowrap;
                                                `}
                                            >
                                                {value}
                                            </div>
                                            <div
                                                className={css`
                                                    margin-left: 20px;
                                                    flex-shrink: 0;
                                                `}
                                            >
                                                {+((count * 100) / topData.length).toFixed(1)}%
                                            </div>
                                        </div>
                                        <Progress
                                            size={4}
                                            className={css`
                                                .ant-progress-outer {
                                                    .ant-progress-inner {
                                                        position: absolute;
                                                        top: 0px;
                                                    }
                                                }
                                            `}
                                            style={{ width: '100%', height: '0px' }}
                                            percent={+((count * 100) / topData.length).toFixed(1)}
                                            status="normal"
                                            showInfo={false}
                                        />
                                    </div>
                                    {!isComplexType(field.Type) && (
                                        <div
                                            className={css`
                                                margin-left: 30px;
                                            `}
                                        >
                                            <IconButton
                                                name="plus-circle"
                                                onClick={e => {
                                                    console.log(value);
                                                    setDataFilter([
                                                        ...dataFilter,
                                                        {
                                                            fieldName: field.Field,
                                                            operator: '=',
                                                            value: [typeof value === 'string' ? value : +value],
                                                            id: nanoid(),
                                                        },
                                                    ]);
                                                    e.stopPropagation();
                                                }}
                                                tooltip="Equivalent filtration"
                                            />
                                            <IconButton
                                                name="minus-circle"
                                                style={{ marginLeft: '4px' }}
                                                tooltip="Nonequivalent filtration"
                                                onClick={e => {
                                                    setDataFilter([
                                                        ...dataFilter,
                                                        {
                                                            fieldName: field.Field,
                                                            operator: '!=',
                                                            value: [typeof value ? value : +value],
                                                            id: nanoid(),
                                                        },
                                                    ]);
                                                    e.stopPropagation();
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ),
                    )}
                </div>
            ) : (
                <div className="mt-2 text-xs text-n5">Does not supported</div>
            )}
        </div>
    );
}
