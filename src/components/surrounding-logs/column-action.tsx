import { t } from 'i18n';
import { IconButton } from '@grafana/ui';
import { useAtom, useAtomValue } from 'jotai';
import React from 'react';
import { selectedFieldsAtom, tableFieldsAtom } from 'store/discover';

/** Column selection is deliberately shared with the main Discover table. */
export function SurroundingColumnAction({ fieldName }: { fieldName: string }) {
    const [selectedFields, setSelectedFields] = useAtom(selectedFieldsAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const selected = selectedFields.some((field: any) => field.Field === fieldName);

    return (
        <IconButton
            name="plus"
            tooltip={selected ? t('Remove From Table') : t('Add To Table')}
            onClick={event => {
                event.stopPropagation();
                if (selected) {
                    setSelectedFields(current => current.filter((field: any) => field.Field !== fieldName));
                    return;
                }
                const field = tableFields.find(item => item.Field === fieldName);
                if (field) {
                    setSelectedFields(current => [...current, field]);
                }
            }}
        />
    );
}
