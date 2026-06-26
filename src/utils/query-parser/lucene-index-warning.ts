import * as lucene from '@hyperdx/lucene';
import { parse } from './ast';
import { IMPLICIT_FIELD } from './constants';

type FieldLike = {
    Field?: string;
    field?: string;
    value?: string;
    Type?: string;
    type?: string;
};

type IndexLike = {
    columnName?: string;
    Field?: string;
    field?: string;
    value?: string;
    type?: string;
};

function normalizeName(name?: string): string {
    return String(name ?? '').trim().toLowerCase();
}

function normalizeLuceneField(field?: string): string {
    const normalized = String(field ?? '').trim();
    return normalized[0] === '-' ? normalized.slice(1) : normalized;
}

function isNodeTerm(ast: lucene.AST): ast is lucene.NodeTerm {
    return (ast as lucene.NodeTerm).term != null;
}

function isNodeRangedTerm(ast: lucene.AST): ast is lucene.NodeRangedTerm {
    return (ast as lucene.NodeRangedTerm).inclusive != null;
}

function isBinaryAST(ast: lucene.AST): ast is lucene.BinaryAST {
    return (ast as lucene.BinaryAST).right != null;
}

function isLeftOnlyAST(ast: lucene.AST): ast is lucene.LeftOnlyAST {
    return (ast as lucene.LeftOnlyAST).left != null;
}

function isTextSearchTerm(node: lucene.NodeTerm): boolean {
    const term = String(node.term ?? '').trim();
    if (!term || term === '*') {
        return false;
    }

    if (!node.quoted && /^(>=|<=|>|<)/.test(term)) {
        return false;
    }

    return true;
}

function collectTextSearchFields(ast: lucene.AST, fields: Set<string>) {
    if (isNodeTerm(ast)) {
        const field = normalizeLuceneField(ast.field);
        if (field && field !== IMPLICIT_FIELD && isTextSearchTerm(ast)) {
            fields.add(field);
        }
        return;
    }

    if (isNodeRangedTerm(ast)) {
        return;
    }

    if (isBinaryAST(ast)) {
        collectTextSearchFields(ast.left, fields);
        collectTextSearchFields(ast.right, fields);
        return;
    }

    if (isLeftOnlyAST(ast)) {
        collectTextSearchFields(ast.left, fields);
    }
}

function hasInvertedIndex(field: string, indexes: IndexLike[]): boolean {
    const normalizedField = normalizeName(field);
    return indexes.some(index => {
        const indexType = String(index?.type ?? '').toUpperCase();
        if (!indexType.includes('INVERT')) {
            return false;
        }

        const indexedColumn = normalizeName(index?.columnName ?? index?.Field ?? index?.field ?? index?.value);
        return indexedColumn === normalizedField;
    });
}

function findFieldMetadata(field: string, tableFields: FieldLike[]): FieldLike | undefined {
    const normalizedField = normalizeName(field);
    const directMatch = tableFields.find(item => normalizeName(item?.Field ?? item?.field ?? item?.value) === normalizedField);
    if (directMatch) {
        return directMatch;
    }

    const fieldPrefix = normalizeName(field.split('.')[0]);
    return tableFields.find(item => normalizeName(item?.Field ?? item?.field ?? item?.value) === fieldPrefix);
}

function getPrimitiveFieldType(columnType?: string): 'NUMBER' | 'DATE' | 'BOOLEAN' | 'TEXT' | '' {
    if (!columnType) {
        return '';
    }

    const normalizedType = columnType.toUpperCase();
    if (['INT', 'LARGEINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'BIGINT', 'FLOAT', 'DOUBLE'].some(type => normalizedType.includes(type))) {
        return 'NUMBER';
    }
    if (['DATE', 'DATETIME', 'DATEV2', 'DATETIMEV2'].some(type => normalizedType.includes(type))) {
        return 'DATE';
    }
    if (normalizedType.includes('BOOLEAN')) {
        return 'BOOLEAN';
    }
    if (['VARCHAR', 'STRING', 'CHAR', 'TEXT', 'JSONB', 'ARRAY', 'VARIANT'].some(type => normalizedType.includes(type))) {
        return 'TEXT';
    }

    return '';
}

function shouldWarnForField(field: string, tableFields: FieldLike[]): boolean {
    const metadata = findFieldMetadata(field, tableFields);
    if (!metadata) {
        return true;
    }

    const fieldType = getPrimitiveFieldType(metadata.Type ?? metadata.type);
    return fieldType !== 'NUMBER' && fieldType !== 'DATE' && fieldType !== 'BOOLEAN';
}

export function getLuceneFieldsWithoutInvertedIndex(query: string, indexes: IndexLike[], tableFields: FieldLike[]): string[] {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery || (!indexes.length && !tableFields.length)) {
        return [];
    }

    try {
        const ast = parse(trimmedQuery);
        const fields = new Set<string>();
        collectTextSearchFields(ast, fields);

        return Array.from(fields).filter(field => shouldWarnForField(field, tableFields) && !hasInvertedIndex(field, indexes));
    } catch (error) {
        return [];
    }
}
