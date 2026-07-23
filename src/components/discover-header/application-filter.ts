import { DataFilterType } from 'types/type';

export const APPLICATION_FILTER_ID = 'application-filter';

export function getConfiguredApplicationAttributeKey(value?: string): string {
    return value?.trim() || '';
}

export function getCommittedApplication(filters: DataFilterType[], attributeKey: string): string {
    const filter = filters.find(item => item.id === APPLICATION_FILTER_ID);
    if (filter?.variantKey !== attributeKey || filter.value[0] == null) {
        return '';
    }

    return String(filter.value[0]);
}

export function applyApplicationFilter(
    filters: DataFilterType[],
    application: string,
    attributeKey: string,
): { changed: boolean; filters: DataFilterType[] } {
    const current = filters.find(filter => filter.id === APPLICATION_FILTER_ID);
    const isCurrent = application
        ? current?.fieldName === 'resource_attributes' &&
          current.variantKey === attributeKey &&
          current.operator === '=' &&
          current.value.length === 1 &&
          String(current.value[0]) === application
        : !current;

    if (isCurrent) {
        return { changed: false, filters };
    }

    const remaining = filters.filter(filter => filter.id !== APPLICATION_FILTER_ID);
    if (!application) {
        return { changed: true, filters: remaining };
    }

    return {
        changed: true,
        filters: [
            ...remaining,
            {
                id: APPLICATION_FILTER_ID,
                fieldName: 'resource_attributes',
                variantKey: attributeKey,
                operator: '=',
                value: [application],
                label: `Application: ${application}`,
            },
        ],
    };
}
