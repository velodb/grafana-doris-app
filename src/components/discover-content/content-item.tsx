import { useAtom } from 'jotai';
import { css } from '@emotion/css';
import { nanoid } from 'nanoid';
import { dataFilterAtom } from 'store/discover';
import React from 'react';
import { isComplexType } from 'utils/data';
import { IconButton } from '@grafana/ui';

interface ContentItemProps {
    fieldName: string;
    fieldValue: string | number;
    fieldType: string;
}

export function ContentItem({ fieldName, fieldValue, fieldType }: ContentItemProps) {
    const [dataFilter, setDataFilter] = useAtom(dataFilterAtom);
    return (
        <div>
            {!isComplexType(fieldType) && (
                <div className={css`
                    display: flex;
                    alignItems: 'center';
                    margin-left: 10px;
                `}>
                    <IconButton
                        name="plus-circle"
                        onClick={e => {
                            setDataFilter([...dataFilter, { fieldName, operator: '=', value: [fieldValue], id: nanoid() }]);
                            e.stopPropagation();
                        }}
                        tooltip="Equivalent filtration"
                    />
                    <IconButton
                        name="minus-circle"
                        style={{ marginLeft: '4px' }}
                        onClick={e => {
                            setDataFilter([
                                ...dataFilter,
                                {
                                    fieldName,
                                    operator: '!=',
                                    value: [fieldValue],
                                    id: nanoid(),
                                },
                            ]);
                            e.stopPropagation();
                        }}
                        tooltip="Nonequivalent filtration"
                    />
                </div>
            )}
        </div>
    );
}
