import { t } from 'i18n';
import { getFilterFieldReference, quoteSqlLiteral, transformFieldPath } from 'utils/sql-filter';
import { getVariantFieldValue } from 'utils/variant-fields';

export type DiscoverQueryMode = 'sql' | 'lucene';

export type QueryField = {
    Field: string;
    Type?: string;
    variantPath?: string[];
    variantRootType?: string;
};

export type QuerySuggestion = {
    label: string;
    detail?: string;
    documentation?: string;
    insertText?: string;
    kind?: 'field' | 'operator' | 'value' | 'keyword';
};

const getSqlOperators = () => [
    ['=', t('Equal')], ['!=', t('Not equal')], ['>', t('Greater than')], ['>=', t('Greater than or equal')],
    ['<', t('Less than')], ['<=', t('Less than or equal')], ['LIKE', t('Pattern match')], ['IN', t('Match one of several values')],
    ['BETWEEN', t('Inclusive range')], ['IS NULL', t('Missing value')], ['IS NOT NULL', t('Present value')],
];
const LOGICAL_OPERATORS = ['AND', 'OR'];
const getLuceneOperators = () => [
    ['AND', t('Both clauses must match')], ['OR', t('Either clause may match')], ['NOT', t('Exclude the following clause')],
];

function normalizedType(type?: string) {
    return String(type || '').toUpperCase();
}

function isNumber(type?: string) {
    return /(INT|FLOAT|DOUBLE|DECIMAL|NUMBER)/.test(normalizedType(type));
}

function isBoolean(type?: string) {
    return /BOOL/.test(normalizedType(type));
}

function escapeLucenePhrase(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function getSqlFieldInsertText(field: QueryField): string {
    if (!field.variantPath?.length) {
        return transformFieldPath(field.Field);
    }
    return getFilterFieldReference({
        fieldName: field.Field,
        variantPath: field.variantPath,
        variantRootType: field.variantRootType,
        fieldType: field.Type,
        operator: 'is not null',
        value: [],
        id: 'query-completion',
    });
}

export function getLuceneFieldInsertText(field: QueryField): string {
    if (!field.variantPath?.length || field.variantPath.length === 1) {
        return field.Field;
    }
    return field.variantPath[0] + field.variantPath.slice(1).map(part => `["${escapeLucenePhrase(part)}"]`).join('');
}

function sqlValue(value: unknown, field: QueryField): string | undefined {
    if (value === null || value === undefined || typeof value === 'object') {
        return undefined;
    }
    if (typeof value === 'boolean' || isBoolean(field.Type)) {
        return String(value).toLowerCase();
    }
    if (typeof value === 'number' || isNumber(field.Type)) {
        return String(value);
    }
    return quoteSqlLiteral(String(value));
}

function luceneValue(value: unknown, field: QueryField): string | undefined {
    if (value === null || value === undefined || typeof value === 'object') {
        return undefined;
    }
    if (typeof value === 'boolean' || isBoolean(field.Type) || typeof value === 'number' || isNumber(field.Type)) {
        return String(value).toLowerCase();
    }
    return `"${escapeLucenePhrase(String(value))}"`;
}

function valuesForField(field: QueryField | undefined, rows: Array<Record<string, unknown>>, mode: DiscoverQueryMode): QuerySuggestion[] {
    if (!field) {
        return [];
    }
    const seen = new Set<string>();
    const result: QuerySuggestion[] = [];
    for (const row of rows) {
        const raw = field.variantPath?.length ? getVariantFieldValue(row, field) : row[field.Field];
        const text = mode === 'sql' ? sqlValue(raw, field) : luceneValue(raw, field);
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        result.push({ label: text, insertText: text, detail: t('Sample value'), kind: 'value' });
        if (result.length === 50) {
            break;
        }
    }
    return result;
}

function fieldSuggestions(fields: QueryField[], mode: DiscoverQueryMode): QuerySuggestion[] {
    return fields.map(field => ({
        label: field.Field,
        insertText: mode === 'sql' ? getSqlFieldInsertText(field) : getLuceneFieldInsertText(field),
        detail: field.Type || t('Field'),
        documentation: field.variantPath?.length ? t('Structured path: {{path}}', { path: field.variantPath.join('.') }) : undefined,
        kind: 'field',
    }));
}

function lastSqlCondition(query: string): string {
    // The current condition is enough for completion. BETWEEN's inner AND is
    // intentionally retained so values continue to be suggested after it.
    const parts = query.split(/(?:\bOR\b|\()/i);
    return parts[parts.length - 1] || '';
}

function findSqlField(query: string, fields: QueryField[]): QueryField | undefined {
    const escaped = /`([^`]+)`/g;
    const matches = Array.from(query.matchAll(escaped));
    const last = matches[matches.length - 1]?.[1];
    if (!last) {
        return undefined;
    }
    return fields.find(field => (field.variantPath?.[0] || field.Field) === last || field.Field === last);
}

function findLuceneField(query: string, fields: QueryField[]): QueryField | undefined {
    const match = query.match(/([A-Za-z_][\w.\[\]"\\-]*)\s*:\s*[^:]*$/);
    if (!match) {
        return undefined;
    }
    return fields.find(field => getLuceneFieldInsertText(field) === match[1] || field.Field === match[1]);
}

export function getQuerySuggestions({ mode, query, fields, rows }: { mode: DiscoverQueryMode; query: string; fields: QueryField[]; rows: Array<Record<string, unknown>> }): QuerySuggestion[] {
    const before = query.trimEnd();
    if (mode === 'lucene') {
        if (!before || /(?:^|\s|\()(?:(?:AND|OR|NOT)\s*)?$/i.test(before)) {
            return [...fieldSuggestions(fields, mode), ...getLuceneOperators().map(([label, detail]) => ({ label, insertText: `${label} `, detail, kind: 'keyword' as const }))];
        }
        const luceneField = findLuceneField(before, fields);
        const completedLuceneValue = before.match(/[A-Za-z_][\w.\[\]"\\-]*\s*:\s*(.+)$/);
        if (luceneField && completedLuceneValue && /\s$/.test(query)) {
            return getLuceneOperators().map(([label, detail]) => ({ label, insertText: `${label} `, detail, kind: 'keyword' as const }));
        }
        if (luceneField) {
            return [
                ...valuesForField(luceneField, rows, mode),
                { label: '>', insertText: '>', detail: t('Greater than'), kind: 'operator' },
                { label: '>=', insertText: '>=', detail: t('Greater than or equal'), kind: 'operator' },
                { label: '<', insertText: '<', detail: t('Less than'), kind: 'operator' },
                { label: '[min TO max]', insertText: '[ TO ]', detail: t('Inclusive range'), kind: 'operator' },
                { label: '*', insertText: '*', detail: t('Field exists'), kind: 'operator' },
            ];
        }
        if (/^[\w.\[\]"\\-]+$/.test(before.split(/\s+/).pop() || '')) {
            return [...fieldSuggestions(fields, mode), { label: ':', insertText: ':', detail: t('Field/value separator'), kind: 'operator' }];
        }
        return getLuceneOperators().map(([label, detail]) => ({ label, insertText: ` ${label} `, detail, kind: 'keyword' }));
    }

    if (!before || /(?:^|\bAND\b|\bOR\b|\()\s*$/i.test(before)) {
        return fieldSuggestions(fields, mode);
    }
    const condition = lastSqlCondition(before);
    const field = findSqlField(condition, fields);
    const hasOperator = /(?:=|!=|>=|<=|(?<![<>!])>|(?<![<>!])<|\bLIKE\b|\bIN\b|\bBETWEEN\b|\bIS\s+(?:NOT\s+)?NULL\b)\s*$/i.test(condition);
    if (field && !hasOperator && !/(?:=|!=|>=|<=|>|<|\bLIKE\b|\bIN\b|\bBETWEEN\b|\bIS\b)/i.test(condition)) {
        return getSqlOperators().map(([label, detail]) => ({ label, insertText: label.startsWith('IS ') ? ` ${label}` : ` ${label} `, detail, kind: 'operator' }));
    }
    if (field && /(?:=|!=|>=|<=|(?<![<>!])>|(?<![<>!])<|\bLIKE\b|\bIN\b|\bBETWEEN\b)\s*[^)]*$/i.test(condition)) {
        return valuesForField(field, rows, mode);
    }
    if (/\b(?:IS\s+(?:NOT\s+)?NULL)\s*$/i.test(condition)) {
        return LOGICAL_OPERATORS.map(label => ({ label, insertText: ` ${label} `, detail: t('Logical operator'), kind: 'keyword' }));
    }
    return [...fieldSuggestions(fields, mode), ...LOGICAL_OPERATORS.map(label => ({ label, insertText: ` ${label} `, detail: t('Logical operator'), kind: 'keyword' as const }))];
}
