import { useAtom, useAtomValue } from 'jotai';
import React from 'react';
import { nanoid } from 'nanoid';
import { Select, InlineField, InlineFieldRow, InlineSwitch, Button, Input, Field } from '@grafana/ui';
import { tableFieldsAtom, tableFieldValuesAtom, surroundingDataFilterAtom } from 'store/discover';
import { Operator } from 'types/type';
import { OPERATORS, getFieldType } from 'utils/data';
import { Controller, useForm } from 'react-hook-form';
import { containerStyle, rowStyle, colStyle, footerStyle } from './discover-filter.style';
import { FilterContentProps } from '../types';

export function FilterContent(props: FilterContentProps) {
    const { onHide, dataFilterValue } = props;
    const [surroundingDataFilter, setSurroundingDataFilter] = useAtom(surroundingDataFilterAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    if (process.env.NODE_ENV !== 'production') {
        // add a debug label for dev to help with jotai debugging
        // @ts-ignore
        surroundingDataFilterAtom.debugLabel = 'surroundingDataFilter';
    }
    const tableFieldValue = useAtomValue(tableFieldValuesAtom);

    const {
        control,
        handleSubmit,
        watch,
        register,
        formState: { errors },
    } = useForm({
        defaultValues: {
            field: {
                label: dataFilterValue?.fieldName,
                value: dataFilterValue?.fieldName,
            },
            operator: {
                label: dataFilterValue?.operator,
                value: dataFilterValue?.operator,
            },
            value: dataFilterValue?.value,
            minValue: Array.isArray(dataFilterValue?.value) ? dataFilterValue?.value[0] : '',
            maxValue: Array.isArray(dataFilterValue?.value) ? dataFilterValue?.value[1] : '',
            label: dataFilterValue?.label || '',
            showLabel: !!dataFilterValue?.label, // Initialize based on dataFilterValue
        },
    });
    const field: any = watch('field');
    const operator: any = watch('operator');
    const showLabel: any = watch('showLabel');


    const getValue = (value: string): string | number => (isNaN(+value) ? value : +value);

    // use centralized getFieldType from utils
    const selectedFieldType = React.useMemo(() => {
        const fieldName = typeof field === 'string' ? field : field?.value;
        if (!fieldName) {
            return '';
        }
        const tf = tableFields.find((f: any) => f.Field === fieldName);
        return getFieldType(tf?.Type);
    }, [field, tableFields]);

    const isNumberField = selectedFieldType === 'NUMBER';
    const isBooleanField = selectedFieldType === 'BOOLEAN';
    const isTimeField = selectedFieldType === 'DATE';

    // Normalize OPERATORS to the form {label, value} and filter out inapplicable operators based on field type.
    const operatorOptions = React.useMemo(() => {
        const normalized = ((OPERATORS || []) as any[]).map(op => ({ label: (op && op.label) || op, value: (op && op.value) || op }));
        // text matching ops to remove for numeric fields
        const textMatchOps = ['like', 'not like', 'match_all', 'match_any', 'match_phrase', 'match_phrase_prefix'];

        if (isBooleanField) {
            // BOOLEAN should only allow equality and null checks
            const allowed = new Set(['=', '!=', 'is null', 'is not null']);
            return normalized.filter(opItem => allowed.has(String(opItem.value)));
        }

        const isNumberOrTime = isNumberField || isTimeField;
        if (isNumberOrTime) {
            // remove text match ops for number or time fields
            return normalized.filter(opItem => {
                const v = String(opItem.value).toLowerCase();
                return !textMatchOps.includes(v);
            });
        }

        // non-number, non-boolean, non-time fields: keep full list
        return normalized;
     }, [isNumberField, isBooleanField, isTimeField]);

    // Convert an input value according to current field type.
    // Preserve explicit empty string ('') so users can set an empty-string value.
    const convertValue = (v: any): any => {
        // Preserve explicit empty string so the user can set ''
        if (v === '')  {
            return '';
        }
        if (v === undefined || v === null) {
            return v;
        }

        // If array, convert each element
        if (Array.isArray(v)) {
            return v.map(convertValue);
        }

        // Handle booleans
        if (v === true || v === 'true') {
            return true;
        }
        if (v === false || v === 'false') {
            return false;
        }

        // Prefer field-type-based conversion when possible
        if (isNumberField) {
            return getValue(String(v));
        }

        // Fallback: if the value looks like a number, convert it (this handles cases when field type detection isn't set)
        const asStr = String(v);
        if (asStr.trim() !== '' && !Number.isNaN(Number(asStr))) {
            return Number(asStr);
        }

        return v;
    };

    const onSubmit = (formValues: any) => {
        const { field, operator: opField, value, minValue, maxValue, label } = formValues;
        const current = surroundingDataFilter.find(f => f.id === dataFilterValue?.id);
        const id = dataFilterValue?.id || nanoid();

        // The compatible operator could be string or {label, value}.
        const opValue = typeof opField === 'string' ? opField : opField?.value;

        let newValue: any[] = [];

        if (opValue === 'between' || opValue === 'not between') {
            // Use convertValue so numbers/booleans are properly typed; preserve empty strings if provided
            if ((minValue !== undefined && minValue !== '') && (maxValue !== undefined && maxValue !== '')) {
                newValue = [convertValue(minValue), convertValue(maxValue)];
            }
        } else if (value !== undefined) {
            // accept empty string, 0 and other falsy numeric values.
            if (Array.isArray(value)) {
                newValue = value.map(v => convertValue(v));
            } else {
                newValue = [convertValue(value)];
            }
        }

        const newItem = {
            id,
            fieldName: field.value,
            operator: opValue,
            label,
            value: newValue,
        };

        if (current) {
            const updated = surroundingDataFilter.map(f => (f.id === id ? newItem : f));
            setSurroundingDataFilter(updated);
        } else {
            setSurroundingDataFilter([...surroundingDataFilter, newItem]);
        }

        onHide();
    };

    function renderFiledComponent() {
        const currentOperator = (typeof operator === 'string' ? operator : operator?.value) as Operator | undefined;
        if (currentOperator && currentOperator !== 'is null' && currentOperator !== 'is not null' && (currentOperator === 'between' || currentOperator === 'not between')) {
            return (
                <div className={rowStyle}>
                    <div className={colStyle}>
                        <Field label="Min Value" invalid={!!errors.minValue} error={errors.minValue?.message}>
                            <Input {...register('minValue', { required: 'Enter the minValue' })} />
                        </Field>
                    </div>
                    <div className={colStyle}>
                        <Field label="Max Value" invalid={!!errors.maxValue} error={errors.maxValue?.message}>
                            <Input {...register('maxValue', { required: 'Enter the maxValue' })} />
                        </Field>
                    </div>
                </div>
            );
        }
        if (
            currentOperator === '=' ||
            currentOperator === '!=' ||
            currentOperator === 'like' ||
            currentOperator === 'not like' ||
            currentOperator === 'match_all' ||
            currentOperator === 'match_any' ||
            currentOperator === 'match_phrase' ||
            currentOperator === 'match_phrase_prefix'
        ) {
            return (
                <>
                    <Field label="Value" invalid={!!errors.value} error={(errors.value as any)?.message}>
                        {/* Allow empty string as a valid value: treat undefined as missing but accept '' */}
                        <Input {...register('value', { validate: (v: any) => v !== undefined || 'Enter the value' })} list="field-value-list" />
                    </Field>
                    <datalist id="field-value-list">
                        {tableFieldValue.map((item, idx) => (
                            <option key={idx} value={item.value} />
                        ))}
                    </datalist>
                </>
            );
        }
        if (currentOperator === 'in' || currentOperator === 'not in') {
            return (
                <Field label="Value" invalid={!!errors.value} error={(errors.value as any)?.message}>
                    <Controller
                        name="value"
                        control={control}
                        rules={{ required: 'Enter the value' }}
                        render={({ field }) => (
                            <Select
                                {...field}
                                isMulti={true}
                                options={tableFieldValue.map(item => ({
                                    label: item.value,
                                    value: item.value,
                                }))}
                                placeholder="Select value"
                                onChange={selected => field.onChange(selected ? selected.map((s: any) => s.value) : [])}
                                value={tableFieldValue
                                    .filter(item => Array.isArray(field.value) && field.value.includes(item.value))
                                    .map(item => ({
                                        label: item.value,
                                        value: item.value,
                                    }))}
                            />
                        )}
                    />
                </Field>
            );
        }
        return <></>;
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className={containerStyle}>
            <div className={rowStyle}>
                <div className={colStyle}>
                    <Field label="Columns" invalid={!!errors.field} error={(errors.field as any)?.message}>
                        <Controller
                            name="field"
                            control={control}
                            rules={{ required: 'Select Field' }}
                            render={({ field }) => (
                                <Select
                                    {...field}
                                    options={tableFields.map(f => ({
                                        label: f.Field,
                                        value: f.Field,
                                    }))}
                                />
                            )}
                        />
                    </Field>
                </div>
                <div className={colStyle}>
                    <Field label="Operator" invalid={!!errors.operator} error={(errors.operator as any)?.message}>
                        <Controller
                            name="operator"
                            control={control}
                            rules={{ required: 'Select Operator' }}
                            render={({ field }) => (
                                <Select
                                    {...field}
                                    options={operatorOptions}
                                />
                            )}
                        />
                    </Field>
                </div>
            </div>

            {renderFiledComponent()}

            <InlineFieldRow>
                <InlineField label="Custom Label">
                    <Controller name="showLabel" control={control} render={({ field }) => <InlineSwitch {...field} />}></Controller>
                </InlineField>
            </InlineFieldRow>

            {showLabel && (
                <Field invalid={!!errors.label} error={errors.label?.message}>
                    <Input {...register('label', { required: 'Please enter label' })} />
                </Field>
            )}

            <div className={footerStyle}>
                <Button
                    variant="secondary"
                    onClick={e => {
                        e.preventDefault();
                        onHide();
                    }}
                >
                    Cancel
                </Button>
                <Button type="submit">Confirm</Button>
            </div>
        </form>
    );
}
