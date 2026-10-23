import { t } from 'i18n';
import * as lucene from '@hyperdx/lucene';
import { logWarning } from '@grafana/runtime';
import { decodeSpecialTokens, encodeSpecialTokens, encodeVariantLiteralFieldPaths, normalizeLuceneSingleQuotedValues } from './tokenUtils';
import { IMPLICIT_FIELD } from './constants';
import { EnglishSerializer, Serializer } from './serializers';
import { toError } from 'utils/errors';

export function parse(query: string): lucene.AST {
    return lucene.parse(encodeSpecialTokens(encodeVariantLiteralFieldPaths(normalizeLuceneSingleQuotedValues(query))));
}

/**
 * SEARCH's Lucene mode can preserve explicit text field queries, but it does
 * not replace this parser's typed comparisons, ranges, existence checks, or
 * implicit-field expansion. Keep those on the SQL serializer path.
 */
export function canUseDorisSearch(ast: lucene.AST | lucene.Node): boolean {
    const candidate = ast as any;
    if (candidate.term != null) {
        const field = String(candidate.field ?? '');
        const term = String(candidate.term ?? '');
        return Boolean(field && field !== IMPLICIT_FIELD && !field.startsWith('-') &&
            !field.includes('[') && !field.includes(']') &&
            !candidate.regex && candidate.similarity == null && candidate.proximity == null && candidate.boost == null &&
            !term.includes('?') && term !== '*' &&
            (candidate.quoted || !/^(?:[<>]=?|\d|true\b|false\b)/iu.test(term)));
    }

    if (candidate.inclusive != null || candidate.term_min != null) {
        return false;
    }
    if (candidate.right != null) {
        return (candidate.operator === 'AND' || candidate.operator === 'OR' || candidate.operator === '&&' || candidate.operator === '||') &&
            canUseDorisSearch(candidate.left) && canUseDorisSearch(candidate.right);
    }
    if (candidate.left != null) {
        // Unary negation and leading modifiers have different semantics in
        // Doris Lucene mode, so only accept a plain single child.
        return candidate.start === undefined && canUseDorisSearch(candidate.left);
    }
    return false;
}

async function nodeTerm(node: lucene.Node, serializer: Serializer): Promise<string> {
    const field = node.field[0] === '-' ? node.field.slice(1) : node.field;
    let isNegatedField = node.field[0] === '-';
    const isImplicitField = node.field === IMPLICIT_FIELD;

    if ((node as lucene.NodeTerm).term != null) {
        const nodeTermInstance = node as lucene.NodeTerm;
        if (nodeTermInstance.regex) {
            throw new Error(t('Lucene regular-expression queries are not supported.'));
        }
        if (nodeTermInstance.similarity != null) {
            throw new Error(t('Lucene fuzzy queries are not supported.'));
        }
        if (nodeTermInstance.proximity != null) {
            throw new Error(t('Lucene proximity queries are not supported.'));
        }
        if (nodeTermInstance.boost != null) {
            throw new Error(t('Lucene boost queries are not supported.'));
        }
        if (nodeTermInstance.term.includes('?')) {
            throw new Error(t('Lucene single-character wildcards (?) are not supported.'));
        }
        let term = decodeSpecialTokens(nodeTermInstance.term);
        if (isImplicitField && nodeTermInstance.prefix === '-') {
            isNegatedField = true;
        }
        if (!isImplicitField && nodeTermInstance.prefix === '-') {
            term = nodeTermInstance.prefix + decodeSpecialTokens(nodeTermInstance.term);
        }

        if (field === '_exists_') {
            return serializer.isNotNull(term, isNegatedField);
        }
        if (nodeTermInstance.quoted && !isImplicitField) {
            return serializer.eq(field, term, isNegatedField);
        }

        if (!nodeTermInstance.quoted && term === '*') {
            return serializer.isNotNull(field, isNegatedField);
        }

        if (!nodeTermInstance.quoted && term.substring(0, 2) === '>=') {
            if (isNegatedField) {
                return serializer.lt(field, term.slice(2));
            }
            return serializer.gte(field, term.slice(2));
        }
        if (!nodeTermInstance.quoted && term.substring(0, 2) === '<=') {
            if (isNegatedField) {
                return serializer.gt(field, term.slice(2));
            }
            return serializer.lte(field, term.slice(2));
        }
        if (!nodeTermInstance.quoted && term[0] === '>') {
            if (isNegatedField) {
                return serializer.lte(field, term.slice(1));
            }
            return serializer.gt(field, term.slice(1));
        }
        if (!nodeTermInstance.quoted && term[0] === '<') {
            if (isNegatedField) {
                return serializer.gte(field, term.slice(1));
            }
            return serializer.lt(field, term.slice(1));
        }

        let prefixWildcard = false;
        let suffixWildcard = false;
        if (!nodeTermInstance.quoted && term[0] === '*') {
            prefixWildcard = true;
            term = term.slice(1);
        }
        if (!nodeTermInstance.quoted && term[term.length - 1] === '*') {
            suffixWildcard = true;
            term = term.slice(0, -1);
        }

        return serializer.fieldSearch(field, term, isNegatedField, prefixWildcard, suffixWildcard, Boolean(nodeTermInstance.quoted));
    }

    if ((node as lucene.NodeRangedTerm).inclusive != null) {
        const rangedTerm = node as lucene.NodeRangedTerm;
        return serializer.range(field, rangedTerm.term_min, rangedTerm.term_max, isNegatedField);
    }

    throw new Error(t('Unexpected Node type. {{node}}', { node }));
}

async function serialize(ast: lucene.AST | lucene.Node, serializer: Serializer): Promise<string> {
    if ((ast as lucene.NodeTerm).term != null) {
        return await nodeTerm(ast as lucene.NodeTerm, serializer);
    }
    if ((ast as lucene.NodeRangedTerm).inclusive != null) {
        return await nodeTerm(ast as lucene.NodeTerm, serializer);
    }

    if ((ast as lucene.BinaryAST).right != null) {
        const binaryAST = ast as lucene.BinaryAST;
        const operator = serializer.operator(binaryAST.operator);
        const parenthesized = binaryAST.parenthesized;
        return `${parenthesized ? '(' : ''}${await serialize(binaryAST.left, serializer)} ${operator} ${await serialize(
            binaryAST.right,
            serializer,
        )}${parenthesized ? ')' : ''}`;
    }

    if ((ast as lucene.LeftOnlyAST).left != null) {
        const leftOnlyAST = ast as lucene.LeftOnlyAST;
        const parenthesized = leftOnlyAST.parenthesized;
        return `${parenthesized ? '(' : ''}${
            leftOnlyAST.start !== undefined ? `${leftOnlyAST.start} ` : ''
        }${await serialize(leftOnlyAST.left, serializer)}${parenthesized ? ')' : ''}`;
    }

    return '';
}

export async function genWhereSQL(ast: lucene.AST, serializer: Serializer): Promise<string> {
    return await serialize(ast, serializer);
}

export async function genEnglishExplanation(query: string): Promise<string> {
    try {
        const parsedQ = parse(query);

        if (parsedQ) {
            const serializer = new EnglishSerializer();
            return await serialize(parsedQ, serializer);
        }
    } catch (e) {
        const error = toError(e);
        logWarning('Lucene parse failure', { source: 'query-parser', query, error: error.message });
    }

    return `Message containing ${query}`;
}
