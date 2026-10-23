import { t } from 'i18n';
import { normalizeColumnType } from './column-types';
import * as lucene from '@hyperdx/lucene';
import SqlString from './sqlstring-browser';
import { getColumn as getColumnMetadata, getInvertedIndexColumns } from '../../services/metaservice';
import { convertCHTypeToPrimitiveJSType, JSDataType } from './enums';
import { splitAndTrimWithBracket } from './utils';
import { splitVariantFieldPath } from './tokenUtils';
import { IMPLICIT_FIELD } from './constants';

export type ColumnLookup = {
    name: string;
    type: string;
    dataType?: string;
    columnType?: string;
};

export type LegacyMetadataProvider = {
    getColumn: (params: {
        databaseName: string;
        tableName: string;
        column: string;
        connectionId: string;
    }) => Promise<{ name: string; type: string } | null>;
};

type ImplicitTextSearchTarget = {
    column: string;
    sourceColumn: string;
    propertyType?: JSDataType;
    supportsTextSearch?: boolean;
    exactVariantValue?: boolean;
};

type JsonField = {
    root: string;
    path: string;
    extracted: string;
    isRoot: boolean;
};

export interface Serializer {
    operator(op: lucene.Operator): string;
    eq(field: string, term: string, isNegatedField: boolean): Promise<string>;
    isNotNull(field: string, isNegatedField: boolean): Promise<string>;
    gte(field: string, term: string): Promise<string>;
    lte(field: string, term: string): Promise<string>;
    lt(field: string, term: string): Promise<string>;
    gt(field: string, term: string): Promise<string>;
    fieldSearch(
        field: string,
        term: string,
        isNegatedField: boolean,
        prefixWildcard: boolean,
        suffixWildcard: boolean,
        isPhrase: boolean,
    ): Promise<string>;
    range(field: string, start: string, end: string, isNegatedField: boolean): Promise<string>;
}

export class EnglishSerializer implements Serializer {
    private translateField(field: string) {
        if (field === IMPLICIT_FIELD) {
            return 'event';
        }

        return `'${field}'`;
    }

    operator(op: lucene.Operator) {
        switch (op) {
            case 'NOT':
            case 'AND NOT':
                return 'AND NOT';
            case 'OR NOT':
                return 'OR NOT';
            case '&&':
            case '<implicit>':
            case 'AND':
                return 'AND';
            case '||':
            case 'OR':
                return 'OR';
            default:
                throw new Error(t('Unexpected operator. {{operator}}', { operator: op }));
        }
    }

    async eq(field: string, term: string, isNegatedField: boolean) {
        return `${this.translateField(field)} ${isNegatedField ? 'is not' : 'is'} ${term}`;
    }

    async isNotNull(field: string, isNegatedField: boolean) {
        return `${this.translateField(field)} ${isNegatedField ? 'is null' : 'is not null'}`;
    }

    async gte(field: string, term: string) {
        return `${this.translateField(field)} is greater than or equal to ${term}`;
    }

    async lte(field: string, term: string) {
        return `${this.translateField(field)} is less than or equal to ${term}`;
    }

    async lt(field: string, term: string) {
        return `${this.translateField(field)} is less than ${term}`;
    }

    async gt(field: string, term: string) {
        return `${this.translateField(field)} is greater than ${term}`;
    }

    async fieldSearch(
        field: string,
        term: string,
        isNegatedField: boolean,
        prefixWildcard: boolean,
        suffixWildcard: boolean,
        isPhrase: boolean,
    ) {
        if (field === IMPLICIT_FIELD) {
            return `${this.translateField(field)} ${
                prefixWildcard && suffixWildcard
                    ? isNegatedField
                        ? 'does not contain'
                        : 'contains'
                    : prefixWildcard
                      ? isNegatedField
                          ? 'does not end with'
                          : 'ends with'
                      : suffixWildcard
                        ? isNegatedField
                            ? 'does not start with'
                            : 'starts with'
                        : isNegatedField
                          ? 'does not have whole word'
                          : 'has whole word'
            } ${term}`;
        }

        return `${this.translateField(field)} ${isNegatedField ? 'does not contain' : 'contains'} ${term}`;
    }

    async range(field: string, start: string, end: string, isNegatedField: boolean) {
        return `${field} ${isNegatedField ? 'is not' : 'is'} between ${start} and ${end}`;
    }
}

export abstract class SQLSerializer implements Serializer {
    private NOT_FOUND_QUERY = '(1 = 0)';
    protected supportsTryCast = true;
    protected supportsJsonSearch = true;

    abstract getColumnForField(field: string): Promise<{
        column?: string;
        propertyType?: JSDataType;
        supportsTextSearch?: boolean;
        sourceColumn?: string;
        implicitTargets?: ImplicitTextSearchTarget[];
        variantRoot?: boolean;
        json?: JsonField;
        found: boolean;
    }>;

    operator(op: lucene.Operator) {
        switch (op) {
            case 'NOT':
            case 'AND NOT':
                return 'AND NOT';
            case 'OR NOT':
                return 'OR NOT';
            case '&&':
            case '<implicit>':
            case 'AND':
                return 'AND';
            case '||':
            case 'OR':
                return 'OR';
            default:
                throw new Error(t('Unexpected operator. {{operator}}', { operator: op }));
        }
    }

    async eq(field: string, term: string, isNegatedField: boolean) {
        const { column, found, propertyType, supportsTextSearch, sourceColumn, variantRoot, json } =
            await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }
        if (propertyType === JSDataType.Bool) {
            const normTerm = `${term}`.trim().toLowerCase();
            return SqlString.format(`(?? ${isNegatedField ? '!' : ''}= ?)`, [
                column,
                normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : parseInt(normTerm, 10),
            ]);
        } else if (propertyType === JSDataType.Number) {
            return SqlString.format(`(${column} ${isNegatedField ? '!' : ''}= CAST(? AS DOUBLE))`, [term]);
        } else if (propertyType === JSDataType.JSON) {
            return this.jsonEquality(json, term, isNegatedField);
        } else if (propertyType === JSDataType.Variant) {
            return this.variantEquality(column, term, isNegatedField, supportsTextSearch, sourceColumn, Boolean(variantRoot));
        } else if (propertyType === JSDataType.String && supportsTextSearch) {
            const searchTarget = column && column.length > 0 ? column : sourceColumn;
            if (!searchTarget) {
                return this.NOT_FOUND_QUERY;
            }
            return SqlString.format(`(? ${isNegatedField ? 'NOT ' : ''}MATCH_PHRASE ?)`, [
                SqlString.raw(searchTarget),
                term,
            ]);
        }
        return SqlString.format(`(${column} ${isNegatedField ? '!' : ''}= ?)`, [term]);
    }

    async isNotNull(field: string, isNegatedField: boolean) {
        const { column, found, propertyType, json, variantRoot } = await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }
        if (propertyType === JSDataType.JSON) {
            if (!json) {
                return this.NOT_FOUND_QUERY;
            }
            const exists = `JSON_EXISTS_PATH(${json.root}, ${SqlString.format('?', [json.path])})`;
            const nonNull = `JSON_TYPE(${json.root}, ${SqlString.format('?', [json.path])}) != 'null'`;
            return isNegatedField ? `(NOT (${exists} AND ${nonNull}))` : `(${exists} AND ${nonNull})`;
        }
        if (propertyType === JSDataType.Variant) {
            if (!variantRoot && column) {
                return `${column} IS ${isNegatedField ? '' : 'NOT '}NULL`;
            }
            return `CAST(${column} AS STRING) IS ${isNegatedField ? '' : 'NOT '}NULL`;
        }
        return `notEmpty(${column}) ${isNegatedField ? '!' : ''}= 1`;
    }

    async gte(field: string, term: string) {
        const { column, found, propertyType, variantRoot, json } = await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }
        if (propertyType === JSDataType.JSON) {
            return this.jsonNumericComparison(json, '>=', term);
        }
        if (propertyType === JSDataType.Variant) {
            return this.variantNumericComparison(column, '>=', term, Boolean(variantRoot));
        }
        return SqlString.format(`(${column} >= ?)`, [term]);
    }

    async lte(field: string, term: string) {
        const { column, found, propertyType, variantRoot, json } = await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }
        if (propertyType === JSDataType.JSON) {
            return this.jsonNumericComparison(json, '<=', term);
        }
        if (propertyType === JSDataType.Variant) {
            return this.variantNumericComparison(column, '<=', term, Boolean(variantRoot));
        }
        return SqlString.format(`(${column} <= ?)`, [term]);
    }

    async lt(field: string, term: string) {
        const { column, found, propertyType, variantRoot, json } = await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }
        if (propertyType === JSDataType.JSON) {
            return this.jsonNumericComparison(json, '<', term);
        }
        if (propertyType === JSDataType.Variant) {
            return this.variantNumericComparison(column, '<', term, Boolean(variantRoot));
        }
        return SqlString.format(`(${column} < ?)`, [term]);
    }

    async gt(field: string, term: string) {
        const { column, found, propertyType, variantRoot, json } = await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }
        if (propertyType === JSDataType.JSON) {
            return this.jsonNumericComparison(json, '>', term);
        }
        if (propertyType === JSDataType.Variant) {
            return this.variantNumericComparison(column, '>', term, Boolean(variantRoot));
        }
        return SqlString.format(`(${column} > ?)`, [term]);
    }

    private attemptToParseNumber(term: string): string | number {
        const number = Number.parseFloat(term);
        if (Number.isNaN(number)) {
            return term;
        }
        return number;
    }

    private tokenizeTerm(term: string): string[] {
        return term.split(/[ -/:-@[-`{-~\t\n\r]+/).filter(t => t.length > 0);
    }

    private termHasSeperators(term: string): boolean {
        return term.match(/[ -/:-@[-`{-~\t\n\r]+/) != null;
    }

    private isNumericTerm(term: string): boolean {
        return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(`${term}`.trim());
    }

    private isBooleanTerm(term: string): boolean {
        return /^(true|false)$/i.test(`${term}`.trim());
    }

    private wrapNegation(clause: string, isNegated: boolean): string {
        return isNegated ? `(NOT ${clause})` : clause;
    }

    private variantNumericComparison(
        column: string | undefined,
        operator: '=' | '>' | '>=' | '<' | '<=',
        term: string,
        variantRoot: boolean,
    ): string {
        if (!column || variantRoot || !this.isNumericTerm(term)) {
            return this.NOT_FOUND_QUERY;
        }

        const targetType = /^[-+]?\d+$/.test(`${term}`.trim()) ? 'BIGINT' : 'DOUBLE';
        return SqlString.format(`(${this.variantCast(column, targetType)} ${operator} CAST(? AS ${targetType}))`, [term]);
    }

    private variantBooleanComparison(column: string | undefined, term: string, isNegatedField: boolean): string {
        if (!column || !this.isBooleanTerm(term)) {
            return this.NOT_FOUND_QUERY;
        }

        const clause = SqlString.format(`(${this.variantCast(column, 'BOOLEAN')} = CAST(? AS BOOLEAN))`, [
            `${term}`.trim().toLowerCase(),
        ]);
        return this.wrapNegation(clause, isNegatedField);
    }

    protected variantCast(column: string, targetType: 'DOUBLE' | 'BIGINT' | 'BOOLEAN'): string {
        return `${this.supportsTryCast ? 'TRY_CAST' : 'CAST'}(${column} AS ${targetType})`;
    }

    private jsonCast(column: string, targetType: 'DOUBLE' | 'BOOLEAN' | 'STRING'): string {
        return `CAST(${column} AS ${targetType})`;
    }

    private jsonType(json: JsonField): string {
        return `JSON_TYPE(${json.root}, ${SqlString.format('?', [json.path])})`;
    }

    private jsonScalarType(json: JsonField, types: string[]): string {
        return `${this.jsonType(json)} IN (${types.map(type => SqlString.format('?', [type])).join(', ')})`;
    }

    private jsonNumericComparison(
        json: JsonField | undefined,
        operator: '=' | '>' | '>=' | '<' | '<=',
        term: string,
    ): string {
        if (!json || json.isRoot || !this.isNumericTerm(term)) {
            return this.NOT_FOUND_QUERY;
        }
        const scalar = `${this.jsonScalarType(json, ['int', 'bigint', 'largeint', 'double'])} AND ` +
            `${this.jsonCast(json.extracted, 'DOUBLE')} ${operator} CAST(${SqlString.format('?', [term])} AS DOUBLE)`;
        const array = `(${this.jsonType(json)} = 'array' AND JSON_CONTAINS(${json.extracted}, CAST(${SqlString.format('?', [term])} AS JSON)))`;
        return `((${scalar}) OR ${array})`;
    }

    private jsonBooleanComparison(json: JsonField | undefined, term: string, isNegatedField: boolean): string {
        if (!json || json.isRoot || !this.isBooleanTerm(term)) {
            return this.NOT_FOUND_QUERY;
        }
        const value = `${term}`.trim().toLowerCase();
        const scalar = `(${this.jsonType(json)} = 'bool' AND ${this.jsonCast(json.extracted, 'BOOLEAN')} = CAST(${SqlString.format('?', [value])} AS BOOLEAN))`;
        const array = `(${this.jsonType(json)} = 'array' AND JSON_CONTAINS(${json.extracted}, CAST(${SqlString.format('?', [value])} AS JSON)))`;
        const clause = `(${scalar} OR ${array})`;
        return this.wrapNegation(clause, isNegatedField);
    }

    private escapeLikePattern(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    }

    private async jsonTextSearch(
        json: JsonField | undefined,
        term: string,
        isNegatedField: boolean,
        prefixWildcard: boolean,
        suffixWildcard: boolean,
        isPhrase: boolean,
    ): Promise<string> {
        if (!json || json.isRoot) {
            return this.NOT_FOUND_QUERY;
        }
        if (!this.supportsJsonSearch) {
            throw new Error(t('JSON array text search requires Doris JSON_SEARCH support.'));
        }
        const pattern = `${prefixWildcard ? '%' : '%'}${this.escapeLikePattern(term)}${suffixWildcard ? '%' : '%'}`;
        const scalar = `(${this.jsonType(json)} = 'string' AND lower(JSON_UNQUOTE(${json.extracted})) ${isNegatedField ? 'NOT ' : ''}LIKE lower(${SqlString.format('?', [pattern])}) ESCAPE '\\\\')`;
        const array = `(${this.jsonType(json)} = 'array' AND JSON_SEARCH(${json.extracted}, 'one', ${SqlString.format('?', [pattern])}) IS ${isNegatedField ? '' : 'NOT '}NULL)`;
        return `(${scalar} OR ${array})`;
    }

    private async jsonEquality(json: JsonField | undefined, term: string, isNegatedField: boolean): Promise<string> {
        if (`${term}`.trim().toLowerCase() === 'null') {
            if (!json || json.isRoot) {
                return this.NOT_FOUND_QUERY;
            }
            const clause = `(${this.jsonType(json)} = 'null' OR (${this.jsonType(json)} = 'array' AND JSON_CONTAINS(${json.extracted}, CAST('null' AS JSON))))`;
            return this.wrapNegation(clause, isNegatedField);
        }
        if (this.isBooleanTerm(term)) {
            return this.jsonBooleanComparison(json, term, isNegatedField);
        }
        if (this.isNumericTerm(term)) {
            const clause = this.jsonNumericComparison(json, '=', term);
            return clause === this.NOT_FOUND_QUERY ? clause : this.wrapNegation(clause, isNegatedField);
        }
        return this.jsonTextSearch(json, term, isNegatedField, false, false, true);
    }

    private variantLikePattern(
        term: string,
        prefixWildcard: boolean,
        suffixWildcard: boolean,
        isPhrase: boolean,
    ): string {
        if (prefixWildcard || suffixWildcard) {
            return `${prefixWildcard ? '%' : ''}${term}${suffixWildcard ? '%' : ''}`;
        }

        return isPhrase ? `%${term}%` : `%${term}%`;
    }

    private variantTextSearch(
        column: string | undefined,
        term: string,
        isNegatedField: boolean,
        prefixWildcard: boolean,
        suffixWildcard: boolean,
        isPhrase: boolean,
        supportsTextSearch?: boolean,
        sourceColumn?: string,
        variantRoot = false,
    ): string {
        if (!column) {
            return this.NOT_FOUND_QUERY;
        }

        // Doris VARIANT child values are indexed as whole values. Exact terms
        // and phrases should therefore use equality; only an explicit prefix
        // wildcard can use the inverted index's phrase-prefix operator.
        if (!variantRoot) {
            const usePrefix = !isPhrase && suffixWildcard && !prefixWildcard;
            if (usePrefix) {
                return SqlString.format(`(? ${isNegatedField ? 'NOT ' : ''}MATCH_PHRASE_PREFIX ?)`, [
                    SqlString.raw(column), term,
                ]);
            }
            if (usePrefix || prefixWildcard) {
                return SqlString.format(`(lower(CAST(? AS STRING)) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`, [
                    SqlString.raw(column),
                    `${prefixWildcard ? '%' : ''}${this.escapeLikePattern(term)}${suffixWildcard ? '%' : ''}`,
                ]);
            }
            return SqlString.format(`(? ${isNegatedField ? '!=' : '='} ?)`, [SqlString.raw(column), term]);
        }

        if (supportsTextSearch && sourceColumn) {
            const usePhrasePrefix = !isPhrase && suffixWildcard && !prefixWildcard;
            const matchTerm = isPhrase
                ? term
                : usePhrasePrefix
                    ? term
                    : `${prefixWildcard ? '*' : ''}${term}${suffixWildcard ? '*' : ''}`;
            const operator = isPhrase
                ? 'MATCH_PHRASE'
                : usePhrasePrefix
                    ? 'MATCH_PHRASE_PREFIX'
                    : 'MATCH_ANY';
            const searchTarget = variantRoot ? sourceColumn : `CAST(${column} AS STRING)`;
            return SqlString.format(`(? ${isNegatedField ? 'NOT ' : ''}${operator} ?)`, [
                SqlString.raw(searchTarget),
                matchTerm,
            ]);
        }

        return SqlString.format(`(lower(CAST(? AS STRING)) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`, [
            SqlString.raw(column),
            this.variantLikePattern(term, prefixWildcard, suffixWildcard, isPhrase),
        ]);
    }

    private variantEquality(
        column: string | undefined,
        term: string,
        isNegatedField: boolean,
        supportsTextSearch?: boolean,
        sourceColumn?: string,
        variantRoot = false,
    ): string {
        if (this.isBooleanTerm(term)) {
            return this.variantBooleanComparison(column, term, isNegatedField);
        }

        if (this.isNumericTerm(term)) {
            const clause = this.variantNumericComparison(column, '=', term, variantRoot);
            return clause === this.NOT_FOUND_QUERY ? clause : this.wrapNegation(clause, isNegatedField);
        }

        return this.variantTextSearch(
            column,
            term,
            isNegatedField,
            false,
            false,
            true,
            supportsTextSearch,
            sourceColumn,
            variantRoot,
        );
    }

    async fieldSearch(
        field: string,
        term: string,
        isNegatedField: boolean,
        prefixWildcard: boolean,
        suffixWildcard: boolean,
        isPhrase: boolean,
    ) {
        const isImplicitField = field === IMPLICIT_FIELD;
        const { column, found, propertyType, supportsTextSearch, sourceColumn, implicitTargets, variantRoot, json } =
            await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }

        if (propertyType === JSDataType.Bool) {
            const normTerm = `${term}`.trim().toLowerCase();
            return SqlString.format(`(?? ${isNegatedField ? '!' : ''}= ?)`, [
                column,
                normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : parseInt(normTerm, 10),
            ]);
        } else if (propertyType === JSDataType.Number) {
            return SqlString.format(`(?? ${isNegatedField ? '!' : ''}= CAST(? AS DOUBLE))`, [column, term]);
        } else if (propertyType === JSDataType.Variant) {
            if (this.isBooleanTerm(term)) {
                return this.variantBooleanComparison(column, term, isNegatedField);
            }
            if (this.isNumericTerm(term)) {
                const clause = this.variantNumericComparison(column, '=', term, Boolean(variantRoot));
                return clause === this.NOT_FOUND_QUERY ? clause : this.wrapNegation(clause, isNegatedField);
            }
            return this.variantTextSearch(
                column,
                term,
                isNegatedField,
                prefixWildcard,
                suffixWildcard,
                isPhrase,
                supportsTextSearch,
                sourceColumn,
                Boolean(variantRoot),
            );
        } else if (propertyType === JSDataType.JSON) {
            if (`${term}`.trim().toLowerCase() === 'null') {
                return this.jsonEquality(json, term, isNegatedField);
            }
            if (this.isBooleanTerm(term)) {
                return this.jsonBooleanComparison(json, term, isNegatedField);
            }
            if (this.isNumericTerm(term)) {
                const clause = this.jsonNumericComparison(json, '=', term);
                return clause === this.NOT_FOUND_QUERY ? clause : this.wrapNegation(clause, isNegatedField);
            }
            return await this.jsonTextSearch(json, term, isNegatedField, prefixWildcard, suffixWildcard, isPhrase);
        }

        if (term.length === 0) {
            return '(1=1)';
        }

        if (isImplicitField) {
            if (implicitTargets && implicitTargets.length > 0) {
                const usePhrasePrefix = !isPhrase && suffixWildcard && !prefixWildcard;
                const matchTerm = isPhrase
                    ? term
                    : usePhrasePrefix
                        ? term
                        : `${prefixWildcard ? '*' : ''}${term}${suffixWildcard ? '*' : ''}`;
                const clauses = implicitTargets
                    .map(target => {
                        if (!target) {
                            return null;
                        }

                        if (
                            isPhrase &&
                            target.propertyType !== JSDataType.String &&
                            target.propertyType !== JSDataType.JSON &&
                            target.propertyType !== JSDataType.Variant
                        ) {
                            return null;
                        }

                        if (
                            (target.propertyType === JSDataType.String || target.propertyType === JSDataType.JSON || target.propertyType === JSDataType.Variant) &&
                            target.supportsTextSearch
                        ) {
                            const identifier = target.sourceColumn ?? target.column;
                            if (!identifier) {
                                return null;
                            }
                            const operator = isPhrase
                                ? 'MATCH_PHRASE'
                                : usePhrasePrefix
                                    ? 'MATCH_PHRASE_PREFIX'
                                    : 'MATCH_ANY';
                            return SqlString.format(`(?? ${operator} ?)`, [identifier, matchTerm]);
                        }

                        if (target.propertyType === JSDataType.Variant) {
                            const identifier = target.column ?? target.sourceColumn;
                            if (!identifier) {
                                return null;
                            }
                            if (target.exactVariantValue) {
                                const usePrefix = !isPhrase && suffixWildcard && !prefixWildcard;
                                if (usePrefix) {
                                    return SqlString.format(`(? ${isNegatedField ? 'NOT ' : ''}MATCH_PHRASE_PREFIX ?)`, [
                                        SqlString.raw(identifier), term,
                                    ]);
                                }
                                return SqlString.format(`(? ${isNegatedField ? '!=' : '='} ?)`, [SqlString.raw(identifier), term]);
                            }
                            return SqlString.format(`(lower(CAST(? AS STRING)) LIKE lower(?))`, [
                                SqlString.raw(identifier),
                                this.variantLikePattern(term, prefixWildcard, suffixWildcard, isPhrase),
                            ]);
                        }

                        if (target.propertyType === JSDataType.Number) {
                            const identifier = target.sourceColumn ?? target.column;
                            if (!identifier) {
                                return null;
                            }
                            return SqlString.format(`(?? = CAST(? AS DOUBLE))`, [identifier, term]);
                        }

                        if (target.propertyType === JSDataType.Bool) {
                            const identifier = target.sourceColumn ?? target.column;
                            if (!identifier) {
                                return null;
                            }
                            const normTerm = `${term}`.trim().toLowerCase();
                            const boolValue =
                                normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : parseInt(normTerm, 10);
                            return SqlString.format(`(?? = ?)`, [identifier, boolValue]);
                        }

                        return null;
                    })
                    .filter((clause): clause is string => clause != null);

                if (clauses.length === 0) {
                    return this.NOT_FOUND_QUERY;
                }

                const orClause = clauses.join(' OR ');
                const wrapped = clauses.length === 1 ? clauses[0] : `(${orClause})`;

                if (isNegatedField) {
                    return `(NOT ${wrapped})`;
                }

                return wrapped;
            }

            if (column) {
                if (prefixWildcard || suffixWildcard) {
                    return SqlString.format(
                        `(lower(?) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`,
                        [
                            SqlString.raw(column ?? ''),
                            `${prefixWildcard ? '%' : ''}${term}${suffixWildcard ? '%' : ''}`,
                        ],
                    );
                } else {
                    const hasSeperators = this.termHasSeperators(term);
                    if (hasSeperators) {
                        const tokens = this.tokenizeTerm(term);
                        return `(${isNegatedField ? 'NOT (' : ''}${[
                            ...tokens.map(token =>
                                SqlString.format(`hasToken(lower(?), lower(?))`, [SqlString.raw(column ?? ''), token]),
                            ),
                            SqlString.format(`(lower(?) LIKE lower(?))`, [SqlString.raw(column ?? ''), `%${term}%`]),
                        ].join(' AND ')}${isNegatedField ? ')' : ''})`;
                    }

                    return SqlString.format(
                        `(${isNegatedField ? 'NOT ' : ''}hasToken(lower(?), lower(?)))`,
                        [SqlString.raw(column ?? ''), term],
                    );
                }
            }

            return this.NOT_FOUND_QUERY;
        } else {
            if (supportsTextSearch === false) {
                return this.NOT_FOUND_QUERY;
            }

            const searchTarget = column && column.length > 0 ? column : sourceColumn;
            if (!searchTarget) {
                return this.NOT_FOUND_QUERY;
            }

            const usePhrasePrefix = !isPhrase && suffixWildcard && !prefixWildcard;
            const matchTerm = isPhrase
                ? term
                : usePhrasePrefix
                    ? term
                    : `${prefixWildcard ? '*' : ''}${term}${suffixWildcard ? '*' : ''}`;
            const operator = isPhrase
                ? 'MATCH_PHRASE'
                : usePhrasePrefix
                    ? 'MATCH_PHRASE_PREFIX'
                    : 'MATCH_ANY';
            return SqlString.format(`(? ${isNegatedField ? 'NOT ' : ''}${operator} ?)`, [
                SqlString.raw(searchTarget),
                matchTerm,
            ]);
        }
    }

    async range(field: string, start: string, end: string, isNegatedField: boolean) {
        const { column, found, propertyType, variantRoot, json } = await this.getColumnForField(field);
        if (!found) {
            return this.NOT_FOUND_QUERY;
        }
        if (propertyType === JSDataType.Variant) {
            const startClause = this.variantNumericComparison(column, '>=', start, Boolean(variantRoot));
            const endClause = this.variantNumericComparison(column, '<=', end, Boolean(variantRoot));
            if (startClause === this.NOT_FOUND_QUERY || endClause === this.NOT_FOUND_QUERY) {
                return this.NOT_FOUND_QUERY;
            }
            return this.wrapNegation(`(${startClause} AND ${endClause})`, isNegatedField);
        }
        if (propertyType === JSDataType.JSON) {
            const startClause = this.jsonNumericComparison(json, '>=', start);
            const endClause = this.jsonNumericComparison(json, '<=', end);
            if (startClause === this.NOT_FOUND_QUERY || endClause === this.NOT_FOUND_QUERY) {
                return this.NOT_FOUND_QUERY;
            }
            return this.wrapNegation(`(${startClause} AND ${endClause})`, isNegatedField);
        }
        return SqlString.format(`(${column} ${isNegatedField ? 'NOT ' : ''}BETWEEN ? AND ?)`, [
            this.attemptToParseNumber(start),
            this.attemptToParseNumber(end),
        ]);
    }
}

export type CustomSchemaConfig = {
    databaseName: string;
    implicitColumnExpression?: string;
    tableName: string;
    connectionId: string;
    datasourceType?: string;
    supportsTryCast?: boolean;
    supportsJsonSearch?: boolean;
    columnMeta?: { columns: Array<{ name: string; type: string }>; invertedIndexColumns: string[] };
    variantImplicitPaths?: Record<string, string[][]>;
};

export class CustomSchemaSQLSerializerV2 extends SQLSerializer {
    private tableName: string;
    private databaseName: string;
    private implicitColumnExpression?: string;
    private connectionId: string;
    private datasourceType?: string;
    private legacyMetadataProvider?: LegacyMetadataProvider;
    private columnMetadataCache = new Map<string, ColumnLookup | null>();
    private invertedIndexColumns?: Set<string>;
    private invertedIndexColumnsPromise?: Promise<Set<string>>;
    private providedColumnMetadata = new Map<string, ColumnLookup>();
    private variantImplicitPaths: Record<string, string[][]> = {};
    private hasProvidedColumnMetadata = false;

    constructor({
        metadata,
        databaseName,
        tableName,
        connectionId,
        implicitColumnExpression,
        datasourceType,
        supportsTryCast = true,
        supportsJsonSearch = true,
        columnMeta,
        variantImplicitPaths,
    }: { metadata?: LegacyMetadataProvider } & CustomSchemaConfig) {
        super();
        this.legacyMetadataProvider = metadata;
        this.databaseName = databaseName;
        this.tableName = tableName;
        this.implicitColumnExpression = implicitColumnExpression;
        this.connectionId = connectionId;
        this.datasourceType = datasourceType;
        this.supportsTryCast = supportsTryCast;
        this.supportsJsonSearch = supportsJsonSearch;
        this.variantImplicitPaths = variantImplicitPaths ?? {};
        this.hasProvidedColumnMetadata = Boolean(columnMeta);
        for (const column of columnMeta?.columns ?? []) {
            this.providedColumnMetadata.set(column.name.toLowerCase(), { name: column.name, type: normalizeColumnType({ columnType: column.type }) || 'Unknown' });
        }
        if (columnMeta) {
            this.invertedIndexColumns = new Set(columnMeta.invertedIndexColumns.map(name => name.toLowerCase()));
        }
    }

    private async fetchColumnMetadata(column: string): Promise<ColumnLookup | null> {
        if (this.columnMetadataCache.has(column)) {
            return this.columnMetadataCache.get(column) ?? null;
        }

        let resolved: ColumnLookup | null = null;

        resolved = this.providedColumnMetadata.get(column.toLowerCase()) ?? null;

        try {
            if (resolved) {
                this.columnMetadataCache.set(column, resolved);
                return resolved;
            }
            if (this.hasProvidedColumnMetadata) {
                this.columnMetadataCache.set(column, null);
                return null;
            }
            const result = await getColumnMetadata({
                connectionId: this.connectionId,
                database: this.databaseName,
                table: this.tableName,
                column,
                datasourceType: this.datasourceType,
            });

            if (result) {
                resolved = {
                    name: result.name,
                    type: result.normalizedType || result.columnType || result.dataType || 'Unknown',
                    dataType: result.dataType,
                    columnType: result.columnType,
                };
            }
        } catch (error) {
            // ignore service errors and fallback to legacy metadata provider if available
        }

        if (!resolved && this.legacyMetadataProvider?.getColumn) {
            try {
                const legacy = await this.legacyMetadataProvider.getColumn({
                    databaseName: this.databaseName,
                    tableName: this.tableName,
                    column,
                    connectionId: this.connectionId,
                });

                if (legacy) {
                    resolved = {
                        name: legacy.name,
                        type: legacy.type || 'Unknown',
                    };
                }
            } catch (legacyError) {
                // swallow legacy metadata errors
            }
        }

        this.columnMetadataCache.set(column, resolved);
        return resolved;
    }

    private async loadInvertedIndexColumns(): Promise<Set<string>> {
        if (this.invertedIndexColumns) {
            return this.invertedIndexColumns;
        }

        if (!this.invertedIndexColumnsPromise) {
            this.invertedIndexColumnsPromise = (async () => {
                try {
                    const columns = await getInvertedIndexColumns({
                        connectionId: this.connectionId,
                        database: this.databaseName,
                        table: this.tableName,
                        datasourceType: this.datasourceType,
                    });
                    return new Set(columns.map(name => name.toLowerCase()));
                } catch (error) {
                    return new Set<string>();
                }
            })();
        }

        const resolved = await this.invertedIndexColumnsPromise;
        this.invertedIndexColumns = resolved;
        return resolved;
    }

    private async columnHasInvertedIndex(column: string): Promise<boolean> {
        if (!column) {
            return false;
        }

        const indexes = await this.loadInvertedIndexColumns();
        return indexes.has(column.toLowerCase());
    }

    private isVariantColumnType(columnType: string): boolean {
        return columnType.toLowerCase().startsWith('variant');
    }

    private isJsonColumnType(columnType: string): boolean {
        return columnType.toLowerCase().startsWith('json');
    }

    private getDorisJsonPath(path: string[]): string {
        // Quote every member so dots in telemetry attribute keys remain literal
        // keys instead of being interpreted as nested JSON-path separators.
        return '$' + path.map(part => `."${String(part).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('');
    }

    private async buildColumnExpressionFromField(field: string) {
        const exactMatch = await this.fetchColumnMetadata(field);

        if (exactMatch) {
            const isVariantRoot = this.isVariantColumnType(exactMatch.type);
            const isJsonRoot = this.isJsonColumnType(exactMatch.type);
            return {
                found: true,
                columnType: exactMatch.type,
                columnExpression: isVariantRoot || isJsonRoot ? SqlString.format(`??`, [exactMatch.name]) : exactMatch.name,
                sourceColumn: exactMatch.name,
                // Both structured root types disallow scalar numeric comparisons
                // until a JSON/VARIANT child path has been selected.
                variantRoot: isVariantRoot || isJsonRoot,
                json: isJsonRoot
                    ? { root: SqlString.format('??', [exactMatch.name]), path: '$', extracted: SqlString.format('??', [exactMatch.name]), isRoot: true }
                    : undefined,
            };
        }

        const fieldPath = splitVariantFieldPath(field);
        const fieldPrefix = fieldPath[0];
        const prefixMatch = await this.fetchColumnMetadata(fieldPrefix);

        if (!prefixMatch && field.includes('__HDX_VARIANT_KEY_')) {
            throw new Error(t('Unknown column "{{column}}" in Lucene field "{{field}}". Check the field name.', { column: fieldPrefix, field: fieldPath.join('.') }));
        }

        if (prefixMatch) {
            const fieldPostfix = fieldPath.slice(1).join('.');

            if (prefixMatch.type.startsWith('Map')) {
                const valueType = prefixMatch.type.match(/,\s+(\w+)\)$/)?.[1];
                return {
                    found: true,
                    columnExpression: SqlString.format(`??[?]`, [prefixMatch.name, fieldPostfix]),
                    columnType: valueType ?? 'Unknown',
                    sourceColumn: prefixMatch.name,
                };
            } else if (this.isJsonColumnType(prefixMatch.type)) {
                const nestedPaths = fieldPath.slice(1).filter(Boolean);
                return {
                    found: true,
                    columnExpression: SqlString.format(`JSON_EXTRACT(??, ?)`, [
                        prefixMatch.name,
                        this.getDorisJsonPath(nestedPaths),
                    ]),
                    columnType: 'JSON',
                    sourceColumn: prefixMatch.name,
                    variantRoot: nestedPaths.length === 0,
                    json: {
                        root: SqlString.format('??', [prefixMatch.name]),
                        path: this.getDorisJsonPath(nestedPaths),
                        extracted: SqlString.format(`JSON_EXTRACT(??, ?)`, [prefixMatch.name, this.getDorisJsonPath(nestedPaths)]),
                        isRoot: nestedPaths.length === 0,
                    },
                };
            } else if (this.isVariantColumnType(prefixMatch.type)) {
                // Bracketed Lucene paths are encoded before parsing. Expand a
                // dotted bracket value here so Doris receives one accessor per
                // VARIANT path segment, e.g. attrs["k8s.pod.name"] becomes
                // attrs['k8s']['pod']['name'].
                const nestedPaths = splitVariantFieldPath(field, true).slice(1).filter(Boolean);
                return {
                    found: true,
                    columnExpression: SqlString.format(
                        `??${Array(nestedPaths.length).fill('[?]').join('')}`,
                        [prefixMatch.name, ...nestedPaths],
                    ),
                    columnType: 'Variant',
                    sourceColumn: prefixMatch.name,
                    variantRoot: nestedPaths.length === 0,
                };
            } else if (prefixMatch.type === 'String') {
                const nestedPaths = fieldPath.slice(1);
                return {
                    found: true,
                    columnExpression: SqlString.format(
                        `JSONExtractString(??, ${Array(nestedPaths.length).fill('?').join(',')})`,
                        [prefixMatch.name, ...nestedPaths],
                    ),
                    columnType: 'String',
                    sourceColumn: prefixMatch.name,
                };
            }

            throw new Error(t('Unsupported column type for prefix match'));
        }

        return {
            found: true,
            columnExpression: field,
            columnType: 'Unknown',
            sourceColumn: field,
            variantRoot: false,
        };
    }

    async getColumnForField(field: string) {
        if (field === IMPLICIT_FIELD) {
            if (!this.implicitColumnExpression && !Object.values(this.variantImplicitPaths).some(paths => paths.length > 0)) {
                throw new Error(t('Can not search bare text without an implicit column set.'));
            }

            const expressions = this.implicitColumnExpression ? splitAndTrimWithBracket(this.implicitColumnExpression) : [];
            const implicitFieldCandidates = Array.from(
                new Set(
                    expressions
                        .reduce<string[]>((acc, expression) => {
                            acc.push(...this.extractFieldNamesFromExpression(expression));
                            return acc;
                        }, [])
                        .filter((name): name is string => !!name),
                ),
            );

            const implicitTargets: any[] = (
                await Promise.all(
                    implicitFieldCandidates.map(async candidate => {
                        try {
                            const candidateExpression = await this.buildColumnExpressionFromField(candidate);
                            const candidatePropertyType =
                                convertCHTypeToPrimitiveJSType(candidateExpression.columnType) ?? undefined;

                            // Implicit search must never stringify a whole VARIANT root,
                            // nor send numeric/time/unknown columns to text operators.
                            if (![JSDataType.String, JSDataType.JSON].includes(candidatePropertyType as JSDataType)) {
                                return null;
                            }
                            let candidateSupportsTextSearch: boolean | undefined;
                            if (
                                (candidatePropertyType === JSDataType.String ||
                                    candidatePropertyType === JSDataType.JSON ||
                                    candidatePropertyType === JSDataType.Variant) &&
                                candidateExpression.sourceColumn &&
                                (candidateExpression.columnExpression === candidateExpression.sourceColumn ||
                                    candidateExpression.variantRoot !== undefined)
                            ) {
                                candidateSupportsTextSearch = await this.columnHasInvertedIndex(
                                    candidateExpression.sourceColumn,
                                );
                            } else if (
                                candidatePropertyType === JSDataType.String ||
                                candidatePropertyType === JSDataType.JSON ||
                                candidatePropertyType === JSDataType.Variant
                            ) {
                                candidateSupportsTextSearch = false;
                            }

                            return {
                                column: candidateExpression.columnExpression,
                                sourceColumn: candidateExpression.sourceColumn ?? candidate,
                                propertyType: candidatePropertyType,
                                supportsTextSearch: candidateSupportsTextSearch,
                            };
                        } catch (error) {
                            return null;
                        }
                    }),
                )
            ).filter((target) => target !== null);

            for (const [root, paths] of Object.entries(this.variantImplicitPaths)) {
                const rootMeta = await this.fetchColumnMetadata(root);
                if (!rootMeta || !this.isVariantColumnType(rootMeta.type)) {
                    continue;
                }
                (paths || []).slice(0, 200).forEach(path => {
                    if (!path.length) {
                        return;
                    }
                    const expression = SqlString.format(`??${Array(path.length).fill('[?]').join('')}`, [root, ...path]);
                    implicitTargets.push({
                        column: expression,
                        sourceColumn: root,
                        propertyType: JSDataType.Variant,
                        supportsTextSearch: false,
                        exactVariantValue: true,
                    });
                });
            }

            return {
                column: expressions.length === 0 || implicitTargets.length === 0
                    ? undefined
                    :
                    expressions.length > 1
                        ? `concatWithSeparator(';',${expressions.join(',')})`
                        : this.implicitColumnExpression,
                propertyType: JSDataType.String,
                supportsTextSearch: undefined,
                sourceColumn: undefined,
                implicitTargets,
                found: true,
            };
        }

        const expression = await this.buildColumnExpressionFromField(field);
        const propertyType = convertCHTypeToPrimitiveJSType(expression.columnType) ?? undefined;

        let supportsTextSearch: boolean | undefined;
        if (
            (propertyType === JSDataType.String || propertyType === JSDataType.JSON || propertyType === JSDataType.Variant) &&
            expression.sourceColumn &&
            (expression.columnExpression === expression.sourceColumn || expression.variantRoot !== undefined)
        ) {
            supportsTextSearch = await this.columnHasInvertedIndex(expression.sourceColumn);
        } else if (propertyType === JSDataType.String || propertyType === JSDataType.JSON || propertyType === JSDataType.Variant) {
            supportsTextSearch = false;
        }

        return {
            column: expression.columnExpression,
            propertyType,
            supportsTextSearch,
            sourceColumn: expression.sourceColumn,
            implicitTargets: undefined,
            variantRoot: expression.variantRoot,
            json: expression.json,
            found: expression.found,
        };
    }

    private extractFieldNamesFromExpression(expression: string): string[] {
        const matches = expression.match(/`([^`]+)`/g);
        if (!matches) {
            return [];
        }
        return matches.map(match => match.slice(1, -1));
    }
}
