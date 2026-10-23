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

export function transformFieldPath(fieldPath: string, variantPath?: string[]): string {
    const parts = variantPath?.length ? [...variantPath] : fieldPath.split('.');
    const root = parts.shift() || '';

    return (
        escapeSqlIdentifier(root) +
        parts.map(part => `[${quoteSqlLiteral(part)}]`).join('')
    );
}

function getJsonPath(path: string[]): string {
    // Quote every member: telemetry attribute names commonly contain dots, and
    // quoted JSON-path members preserve those dots as part of the key.
    return '$' + path.map(part => `."${String(part).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('');
}

function getJsonCastType(fieldType?: string): string {
    const type = String(fieldType || '').toUpperCase();
    if (type.includes('BOOL')) return 'BOOLEAN';
    if (/(DOUBLE|FLOAT|DECIMAL|INT|NUMBER)/.test(type)) return 'DOUBLE';
    return 'STRING';
}

export function getFilterFieldReference({ fieldName, variantKey, variantPath, variantRootType, fieldType }: DataFilterType): string {
    const path = variantPath?.length ? variantPath : variantKey !== undefined ? [fieldName, variantKey] : undefined;
    const rootType = String(variantRootType || '').toUpperCase();
    if (path?.length && rootType.includes('JSON')) {
        const root = path[0];
        return `CAST(JSON_EXTRACT(${escapeSqlIdentifier(root)}, ${quoteSqlLiteral(getJsonPath(path.slice(1)))}) AS ${getJsonCastType(fieldType)})`;
    }
    if (variantPath?.length) {
        const expression = transformFieldPath(fieldName, variantPath);
        // Doris VARIANT values cannot be used directly in filters or aggregates.
        // Cast the extracted scalar to its discovered leaf type first.
        return rootType.includes('VARIANT') ? `CAST(${expression} AS ${getJsonCastType(fieldType)})` : expression;
    }
    if (variantKey !== undefined) {
        return `${escapeSqlIdentifier(fieldName)}[${quoteSqlLiteral(variantKey)}]`;
    }

    return transformFieldPath(fieldName);
}

function getFilterValue(value: string | number | boolean): string {
    return typeof value === 'string' ? quoteSqlLiteral(value) : String(value);
}

/**
 * Adds schema information to filters restored from local storage or the URL.
 * Older saved filters predate JSON-specific SQL generation, so they do not
 * carry the root type created by the current filter editor.
 */
export function enrichStructuredFilterTypes(filters: DataFilterType[], fields: Array<{ Field?: string; Type?: string }>): DataFilterType[] {
    return filters.map(filter => {
        const path = filter.variantPath;
        if (!path?.length || filter.variantRootType) {
            return filter;
        }

        const root = fields.find(field => field.Field === path[0]);
        if (!root?.Type) {
            return filter;
        }

        const leaf = fields.find(field => field.Field === filter.fieldName);
        return {
            ...filter,
            variantRootType: root.Type,
            fieldType: filter.fieldType || leaf?.Type,
        };
    });
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
