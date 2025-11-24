import { IconButton } from '@grafana/ui';
import { useAtom, useAtomValue } from 'jotai';
import { nanoid } from 'nanoid';
import React from 'react';
import { selectedFieldsAtom, dataFilterAtom, tableFieldsAtom } from 'store/discover';
import { isComplexType } from 'utils/data';

export function ContentTableActions({ fieldName, fieldValue }: any) {
    const [selectedFields, setSelectedFields] = useAtom(selectedFieldsAtom);
    const [dataFilter, setDataFilter] = useAtom(dataFilterAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const fieldType = tableFields.find(field => field.Field === fieldName)?.Type;
    const hasField = selectedFields.some((item: any) => item.Field === fieldName);
    const filterValue = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : fieldValue;
    return (
        <>
            <div className="icons" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {!isComplexType(fieldType) && (
                    <>
                        <IconButton
                            name="plus-circle"
                            tooltip="Equivalent filtration"
                            onClick={() => {
                                setDataFilter([...dataFilter, { fieldName: fieldName, operator: '=', value: [filterValue], id: nanoid() }]);
                            }}
                        />
                        <IconButton
                            name="minus-circle"
                            tooltip="Nonequivalent filtration"
                            onClick={() => {
                                setDataFilter([...dataFilter, { fieldName: fieldName, operator: '!=', value: [filterValue], id: nanoid() }]);
                            }}
                        />
                    </>
                )}
                <IconButton
                        name="plus"
                        tooltip={hasField ? 'Delete From Table' : 'Add To Table'}
                        onClick={() => {
                            const field = tableFields.find(field => field.Field === fieldName);
                            if (hasField) {
                                const index = selectedFields.findIndex((item: any) => item.Field === fieldName);
                                selectedFields.splice(index, 1);
                                setSelectedFields([...selectedFields]);
                            } else {
                                setSelectedFields([...selectedFields, field]);
                            }
                        }}
                    />
            </div>
        </>
    );
}
