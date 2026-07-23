import { DataFilterType } from 'types/type';

export function escapeSqlIdentifier(identifier: string): string {
    return `\`${String(identifier).replace(/`/g, '``')}\``;
}

export function escapeSqlLiteral(value: string): string {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

export function quoteSqlLiteral(value: string): string {
    return `'${escapeSqlLiteral(value)}'`;
}

export function transformFieldPath(fieldPath: string): string {
    const parts = fieldPath.split('.');
    const root = parts.shift() || '';

    return (
        escapeSqlIdentifier(root) +
        parts.map(part => `[${quoteSqlLiteral(part)}]`).join('')
    );
}

function getFilterFieldReference({ fieldName, variantKey }: DataFilterType): string {
    if (variantKey !== undefined) {
        return `${escapeSqlIdentifier(fieldName)}[${quoteSqlLiteral(variantKey)}]`;
    }

    return transformFieldPath(fieldName);
}

function getFilterValue(value: string | number): string {
    return typeof value === 'string' ? quoteSqlLiteral(value) : String(value);
}

export function getFilterSQL(filter: DataFilterType): string {
    const { operator, value } = filter;
    const fieldReference = getFilterFieldReference(filter);
    const values = value.map(getFilterValue);

    if (
        operator === '=' ||
        operator === '!=' ||
        operator === 'like' ||
        operator === 'not like' ||
        operator === 'match_all' ||
        operator === 'match_any' ||
        operator === 'match_phrase' ||
        operator === 'match_phrase_prefix'
    ) {
        return `${fieldReference} ${operator} ${values[0]}`;
    }

    if (operator === 'is null' || operator === 'is not null') {
        return `${fieldReference} ${operator}`;
    }

    if (operator === 'between' || operator === 'not between') {
        return `${fieldReference} ${operator} ${values[0]} AND ${values[1]}`;
    }

    if (operator === 'in' || operator === 'not in') {
        return `${fieldReference} ${operator} (${values.join(', ')})`;
    }

    return '';
}

export function addSqlFilter(sql: string, dataFilterValue: DataFilterType): string {
    const conjunction = sql.toUpperCase().includes('WHERE') ? ' AND' : ' WHERE';
    return `${sql}${conjunction} (${getFilterSQL(dataFilterValue)})`;
}
