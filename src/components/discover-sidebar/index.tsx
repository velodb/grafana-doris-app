import { useAtom, useAtomValue } from 'jotai';
import React, { useState } from 'react';
import FieldItem from './field-item/field-item';
import { FilterContent } from './filter-content/filter-content';
import { selectedFieldsAtom, tableFieldsAtom, searchableAtom, aggregatableAtom, fieldTypeAtom, indexesAtom, surroundingSelectedFieldsAtom } from 'store/discover';
import { AggregatableEnum, getFieldType, SearchableEnum, FieldTypeEnum } from 'utils/data';
import { Button, CollapsableSection, Icon, Input, useTheme2, Toggletip } from '@grafana/ui';
import { css } from '@emotion/css';

export default function DiscoverSidebar() {
    const [selectedFields, setSelectedFields] = useAtom(selectedFieldsAtom);
    const [selectedSurroundingFields, setSelectedSurroundingFields] = useAtom(surroundingSelectedFieldsAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const [searchable, _setSearchable] = useAtom(searchableAtom);
    const [aggregatable, _setAggregatable] = useAtom(aggregatableAtom);
    const [fieldType, _setFieldType] = useAtom(fieldTypeAtom);
    const [searchValue, setSearchValue] = useState('');
    const indexes = useAtomValue(indexesAtom);
    const theme = useTheme2();
    const filteredFields = tableFields
        .filter(field => {
            if (aggregatable === AggregatableEnum.ANY) {
                return true;
            }
            if (aggregatable === AggregatableEnum.YES) {
                return getFieldType(field.Type) === 'NUMBER';
            }
            if (aggregatable === AggregatableEnum.NO) {
                return getFieldType(field.Type) !== 'NUMBER';
            }
            return false;
        })
        .filter((field: any) => {
            if (searchable === SearchableEnum.ANY) {
                return true;
            }
            if (searchable === SearchableEnum.YES) {
                return indexes.some(index => field.Field === index.Field);
            }
            if (searchable === SearchableEnum.NO) {
                return !indexes.some(index => field.Field === index.Field);
            }
            return false;
        })
        .filter(field => {
            if (fieldType === FieldTypeEnum.ANY) {
                return true;
            }
            return getFieldType(field.Type) === fieldType;
        });
    const hasSelectedFields = selectedFields.length > 0;
    const availableFields = filteredFields.filter(filed => {
        if (selectedFields.find(item => filed['Field'] === item['Field'])) {
            return false;
        }
        return true;
    });

    function handleAdd(field: any) {
        setSelectedFields([...selectedFields, field] as any);
        setSelectedSurroundingFields([...selectedSurroundingFields, field] as any)
    }

    function handleRemove(field: any) {
        const index = selectedFields.findIndex((item: any) => item.Field === field.Field);
        selectedFields.splice(index, 1);

        const surIndex = selectedSurroundingFields.findIndex((item: any) => item.Field === field.Field);
        selectedSurroundingFields.splice(surIndex, 1);
        setSelectedFields([...selectedFields]);
        setSelectedSurroundingFields([...selectedSurroundingFields]);
    }

    return (
        <div
            className={css`
                display: flex;
                flex-direction: column;
                height: 100%;
            `}
        >
            <div
                className={css`
                    display: flex;
                    background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                    padding: 1rem 0.5rem;
                    border-raduis: 0.25rem 0;
                    align-items: center;
                    column-gap: 0.5rem;
                `}
            >
                <Icon name="search" />
                <Input
                    placeholder={`Search`}
                    className={css`
                        border: none;
                    `}
                    value={searchValue}
                    onChange={(e: any) => setSearchValue(e.target.value)}
                />
                <Toggletip content={<FilterContent />}>
                    <Icon name="filter" />
                </Toggletip>
            </div>
            <div
                className={css`
                    margin-top: 1px;
                    flex: 1;
                    padding: 0.5rem 1rem 0.5rem 1rem;
                    background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                    height: 100%;
                    overflow: auto;
                `}
            >
                <CollapsableSection label={<span className={css`
                        margin-left: 4px;
                        font-size: 14px;
                        line-height: 32px;
                    `}>Selected fields</span>} isOpen={true}>
                    <div
                        className={css`
                            width: 100%;
                        `}
                    >
                        {hasSelectedFields ? (
                            <div
                                className={css`
                                    width: 100%;
                                `}
                            >
                                {selectedFields
                                    .filter((field: any) => {
                                        return field['Field'].toLowerCase().includes(searchValue.toLowerCase());
                                    })
                                    .map((field: any, index) => (
                                        <FieldItem type="remove" key={index} field={field} onRemove={field => handleRemove(field)} />
                                    ))}
                            </div>
                        ) : (
                            <Button
                                icon="arrow"
                                size="sm"
                                variant="secondary"
                                fill="text"
                                fullWidth={true}
                                className={css`
                                    width: 100%;
                                    text-align: left;
                                    justify-content: flex-start;
                                `}
                            >
                                _source
                            </Button>
                        )}
                    </div>
                </CollapsableSection>
                <CollapsableSection label={<span className={css`
                        margin-left: 4px;
                        font-size: 14px;
                        line-height: 32px;
                    `}>Available fields</span>}  isOpen={true}>
                    <div
                        className={css`
                            width: 100%;
                        `}
                    >
                        {availableFields
                            .filter((field: any) => {
                                return field['Field'].toLowerCase().includes(searchValue.toLowerCase());
                            })
                            .map((field: any, index) => (
                                <FieldItem type="add" field={field} key={index} onAdd={field => handleAdd(field)} />
                            ))}
                    </div>
                </CollapsableSection>
            </div>
        </div>
    );
}
