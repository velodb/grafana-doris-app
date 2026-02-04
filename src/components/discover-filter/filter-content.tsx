import { useAtom, useAtomValue } from 'jotai';
import React from 'react';
import { nanoid } from 'nanoid';
import { Select, InlineField, InlineFieldRow, InlineSwitch, Button, Input, Field } from '@grafana/ui';
import { tableFieldsAtom, dataFilterAtom, tableFieldValuesAtom, tableDataAtom, indexesAtom } from 'store/discover';
import { DataFilterType, Operator } from 'types/type';
import { OPERATORS, getFieldType } from 'utils/data';
import { Controller, useForm } from 'react-hook-form';
import { containerStyle, rowStyle, colStyle, footerStyle } from './discover-filter.style';
import { uniqBy } from 'lodash-es';

export function FilterContent({ onHide, dataFilterValue }: { onHide: () => void; dataFilterValue?: DataFilterType }) {
    const tableFields = useAtomValue(tableFieldsAtom);
    const [dataFilter, setDataFilter] = useAtom(dataFilterAtom);
    const [tableFieldValue, setTableFieldValue] = useAtom(tableFieldValuesAtom);
    const tableData = useAtomValue(tableDataAtom);
    const indexes = useAtomValue(indexesAtom);

    const {
        control,
        handleSubmit,
        watch,
        register,
        setValue,
        formState: { errors },
    } = useForm({
        defaultValues: {
            field: {
                label: dataFilterValue?.fieldName,
                value: dataFilterValue?.fieldName
            },
            operator: {
                label: dataFilterValue?.operator,
                value: dataFilterValue?.operator
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

    // When user turns off the Custom Label switch, clear the label form value so it won't persist.
    React.useEffect(() => {
        if (!showLabel) {
            // Clear the label in the form state so it won't be saved or re-displayed.
            setValue('label', '');

            // If we're editing an existing filter, also remove the label from the stored filter
            // so the filter chip/list updates immediately and the switch remains off when reopened.
            if (dataFilterValue?.id) {
                setDataFilter(prev => {
                    let changed = false;
                    const updated = prev.map(f => {
                        if (f.id === dataFilterValue.id) {
                            if (f.label) {
                                changed = true;
                                return { ...f, label: '' };
                            }
                            return f;
                        }
                        return f;
                    });
                    return changed ? updated : prev;
                });
            }
        }
    }, [showLabel, setValue, dataFilterValue?.id, setDataFilter]);

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
        // match_* operators require doris inverted index. Keep LIKE/NOT LIKE available for string-like fields
        const matchOnlyOps = ['match_all', 'match_any', 'match_phrase', 'match_phrase_prefix'];

        if (isBooleanField) {
            // BOOLEAN should only allow equality and null checks
            const allowed = new Set(['=', '!=', 'is null', 'is not null']);
            return normalized.filter(opItem => allowed.has(String(opItem.value)));
        }

        const isNumberOrTime = isNumberField || isTimeField;
        if (isNumberOrTime) {
            // remove text match ops (including LIKE/NOT LIKE and match_*) for number or time fields
            return normalized.filter(opItem => {
                const v = String(opItem.value).toLowerCase();
                return !(v === 'like' || v === 'not like' || matchOnlyOps.includes(v));
            });
        }

        // non-number, non-boolean, non-time fields: keep full list
        // For string-like fields, only allow doris inverted-index text operators when the field has an inverted index
        try {
            const fieldName = typeof field === 'string' ? field : field?.value;
            // If the user hasn't selected a field yet, show the full list (no gating)
            if (!fieldName) {
                return normalized;
            }
            // treat "string" here as any type except NUMBER, BOOLEAN, DATE
            if (!isNumberField && !isBooleanField && !isTimeField) {
                const hasInverted = Array.isArray(indexes) && indexes.some((idx: any) => {
                    if (!idx || !idx.columnName) {
                        return false;
                    }
                    const t = idx.type || '';
                    return String(idx.columnName) === String(fieldName) && t.toUpperCase().includes('INVERT');
                });

                if (!hasInverted) {
                    // remove only the match_* operators; allow LIKE/NOT LIKE to remain because they work without inverted index
                    return normalized.filter(opItem => {
                        const v = String(opItem.value).toLowerCase();
                        return !matchOnlyOps.includes(v);
                    });
                }
             }
         } catch (e) {
             // swallow any unexpected errors and fall back to returning full list
         }

         return normalized;
      }, [isNumberField, isBooleanField, isTimeField, field, indexes]);

    const getValue = (value: string): string | number => (isNaN(+value) ? value : +value);

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

        // NOTE: removed previous fallback that converted numeric-looking strings to Number for
        // non-number fields. Now we only convert to Number when the field type is numeric.

        return v;
    };

    const onSubmit = (formValues: any) => {
        const { field, operator: opField, value, minValue, maxValue, label, showLabel } = formValues;
        const current = dataFilter.find(f => f.id === dataFilterValue?.id);
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
            // Only persist label when showLabel is true. Otherwise ensure it's empty.
            label: showLabel ? label : '',
            value: newValue,
        };
        if (current) {
            const updated = dataFilter.map(f => (f.id === id ? newItem : f));
            setDataFilter(updated);
        } else {
            setDataFilter([...dataFilter, newItem]);
        }

        onHide();
    };

    function renderFiledComponent() {
        // const currentField = field.value;
        // console.log(operator);
        console.log(operator);
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
        console.log('currentOperator', currentOperator);
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
                        <Input {...register('value', { validate: (v: any) => v !== undefined || 'Enter the value' })} />
                    </Field>
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
                                    onChange={(selected) => {
                                        // Only update tableFieldValue when we actually have table data and a selected field
                                        if (selected?.value && Array.isArray(tableData) && tableData.length > 0) {
                                            setTableFieldValue(
                                                uniqBy(
                                                    tableData.map((item) => ({
                                                        label: selected.value,
                                                        value: item._original[selected.value],
                                                    })),
                                                    'value',
                                                ),
                                            );
                                        } else {
                                            setTableFieldValue([]);
                                        }
                                        field.onChange(selected)
                                    }}

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
