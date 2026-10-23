import { t } from 'i18n';
import { CustomSchemaSQLSerializerV2, genWhereSQL, parse } from 'utils/query-parser/query-parser';
import { canUseDorisSearch } from 'utils/query-parser/ast';
import { supportsJsonSearch, supportsSearch, supportsTryCast } from './metaservice';
import { logError } from '@grafana/runtime';
import { toError } from 'utils/errors';

// Temporarily keep Lucene queries on the SQL serializer path.
const ENABLE_DORIS_SEARCH = false;

type GetWhereSQLParams = {
    query: string;
    databaseName: string;
    tableName: string;
    connectionId: string;
    implicitColumnExpression?: string;
    datasourceType?: string;
    columnMeta?: { columns: Array<{ name: string; type: string }>; invertedIndexColumns: string[] };
    variantImplicitPaths?: Record<string, string[][]>;
};

function assertSupportedLuceneSyntax(query: string): void {
    // @hyperdx/lucene currently preserves slash-delimited regex as ordinary
    // text, so reject it before parsing instead of silently changing meaning.
    if (/(?:^|[\s(])[^\s:()]+:\/(?:\\.|[^/])+\/(?:$|[\s)])/u.test(query)) {
        throw new Error(t('Lucene regular-expression queries are not supported.'));
    }
}

export async function getWhereSQLViaLucene({ query, databaseName, tableName, connectionId, implicitColumnExpression, datasourceType, columnMeta, variantImplicitPaths }: GetWhereSQLParams): Promise<string> {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
        return '';
    }
    assertSupportedLuceneSyntax(trimmedQuery);

    // Probe the actual SQL capability. VERSION() is always 5.7.99 in Doris for
    // MySQL compatibility and cannot identify the Doris release.
    const [tryCastSupported, jsonSearchSupported] = await Promise.all([
        supportsTryCast({ connectionId, datasourceType }),
        supportsJsonSearch({ connectionId, datasourceType }),
    ]);

    let ast: ReturnType<typeof parse>;
    try {
        ast = parse(trimmedQuery);
    } catch (error) {
        logError(toError(error), { source: 'lucene', action: 'getWhereSQLViaLucene' });
        throw error;
    }
    if (ENABLE_DORIS_SEARCH && canUseDorisSearch(ast) && await supportsSearch({ connectionId, datasourceType, databaseName, tableName, query: trimmedQuery })) {
        const escapedQuery = trimmedQuery.replace(/\\/g, '\\\\').replace(/'/g, "''");
        return `SEARCH('${escapedQuery}', '{"mode":"lucene"}')`;
    }

    const serializer = new CustomSchemaSQLSerializerV2({
        databaseName,
        tableName,
        connectionId,
        implicitColumnExpression,
        datasourceType,
        supportsTryCast: tryCastSupported,
        supportsJsonSearch: jsonSearchSupported,
        columnMeta,
        variantImplicitPaths,
    });

    try {
        const whereSQL =  await genWhereSQL(ast, serializer);
        return whereSQL;
    } catch (error) {
        logError(toError(error), { source: 'lucene', action: 'getWhereSQLViaLucene' });
        throw error;
    }
}
