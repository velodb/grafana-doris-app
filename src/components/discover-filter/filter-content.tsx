import { useAtom, useAtomValue } from 'jotai';
import React from 'react';
import { nanoid } from 'nanoid';
import { Select, InlineField, InlineFieldRow, InlineSwitch, Button, Input, Field } from '@grafana/ui';
import { tableFieldsAtom, dataFilterAtom, tableFieldValuesAtom } from 'store/discover';
import { DataFilterType, Operator } from 'types/type';
import { OPERATORS } from 'utils/data';
import { Controller, useForm } from 'react-hook-form';
import { containerStyle, rowStyle, colStyle, footerStyle } from './discover-filter.style';

export function FilterContent({ onHide, dataFilterValue }: { onHide: () => void; dataFilterValue?: DataFilterType }) {
    const tableFields = useAtomValue(tableFieldsAtom);
    const [dataFilter, setDataFilter] = useAtom(dataFilterAtom);
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

    // const field: any = watch('field');
    const operator: any = watch('operator');
    const showLabel: any = watch('showLabel');

    const getValue = (value: string): string | number => (isNaN(+value) ? value : +value);

    const onSubmit = (formValues: any) => {
        const { field, operator, value, minValue, maxValue, label } = formValues;
        const current = dataFilter.find(f => f.id === dataFilterValue?.id);
        const id = dataFilterValue?.id || nanoid();

        let newValue: any[] = [];

        if (operator.value === 'between' || operator.value === 'not between') {
            if (minValue && maxValue) {
                newValue = [getValue(minValue), getValue(maxValue)];
            }
        } else if (value || typeof value === 'number') {
            newValue = [value];
        }

        const newItem = {
            id,
            fieldName: field.value,
            operator: operator.value,
            label,
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
                        <Field label="最小值" invalid={!!errors.minValue} error={errors.minValue?.message}>
                            <Input {...register('minValue', { required: '请输入最小值' })} />
                        </Field>
                    </div>
                    <div className={colStyle}>
                        <Field label="最大值" invalid={!!errors.maxValue} error={errors.maxValue?.message}>
                            <Input {...register('maxValue', { required: '请输入最大值' })} />
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
                    <Field label="值" invalid={!!errors.value} error={(errors.value as any)?.message}>
                        <Input {...register('value', { required: '请输入值' })} list="field-value-list" />
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
                <Field label="值" invalid={!!errors.value} error={(errors.value as any)?.message}>
                    <Controller
                        name="value"
                        control={control}
                        rules={{ required: '请输入值' }}
                        render={({ field }) => (
                            <Select
                                {...field}
                                isMulti={true}
                                options={tableFieldValue.map(item => ({
                                    label: item.value,
                                    value: item.value,
                                }))}
                                placeholder="请选择值"
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
                    <Field label="列名" invalid={!!errors.field} error={(errors.field as any)?.message}>
                        <Controller
                            name="field"
                            control={control}
                            rules={{ required: '请选择字段' }}
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
                    <Field label="条件" invalid={!!errors.operator} error={(errors.operator as any)?.message}>
                        <Controller
                            name="operator"
                            control={control}
                            rules={{ required: '请选择操作符' }}
                            render={({ field }) => (
                                <Select
                                    {...field}
                                    options={OPERATORS.map(op => ({
                                        label: op,
                                        value: op,
                                    }))}
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
                    取消
                </Button>
                <Button type="submit">确定</Button>
            </div>
        </form>
    );
}
