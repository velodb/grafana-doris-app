
import { useAtom, useAtomValue } from 'jotai';
import { nanoid } from 'nanoid';
import { IconButton } from '@grafana/ui';
import React from 'react';
import { surroundingDataFilterAtom, tableFieldsAtom } from 'store/discover';
import { isComplexType } from 'utils/data';
import { css } from '@emotion/css';

export function SurroundingContentTableActions({ fieldName, fieldValue }: any) {
    console.log(fieldName, fieldValue);
    // const [selectedSurroundingFields, setSelectedSurroundingFields] = useAtom(surroundingSelectedFieldsAtom);
    const [surroundingDataFilter, setSurroundingDataFilter] = useAtom(surroundingDataFilterAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const fieldType = tableFields.find(field => field.Field === fieldName).Type;
    // const hasField = selectedSurroundingFields.some((item: any) => item.Field === fieldName);
    // const filterValue = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : fieldValue;
    return (
        <>
            <div className="icons" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {!isComplexType(fieldType) && (
                    <div
                        className={css`
                            display: flex;
                            align-items: 'center';
                            margin-left: 10px;
                        `}
                    >
                        <IconButton
                            name="plus-circle"
                            onClick={e => {
                                console.log(e);
                                setSurroundingDataFilter([...surroundingDataFilter, { fieldName, operator: '=', value: [fieldValue], id: nanoid() }]);
                                e.stopPropagation();
                            }}
                            tooltip="Equivalent filtration"
                        />
                        <IconButton
                            name="minus-circle"
                            style={{ marginLeft: '4px' }}
                            onClick={e => {
                                console.log(e);
                                setSurroundingDataFilter([
                                    ...surroundingDataFilter,
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
        </>
    );
}
