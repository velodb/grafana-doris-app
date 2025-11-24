import { CustomSchemaSQLSerializerV2, genWhereSQL, parse } from 'utils/query-parser/query-parser';

type GetWhereSQLParams = {
    query: string;
    databaseName: string;
    tableName: string;
    connectionId: string;
    implicitColumnExpression?: string;
    datasourceType?: string;
};

export async function getWhereSQLViaLucene({ query, databaseName, tableName, connectionId, implicitColumnExpression, datasourceType }: GetWhereSQLParams): Promise<string> {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
        return '';
    }

    const serializer = new CustomSchemaSQLSerializerV2({
        databaseName,
        tableName,
        connectionId,
        implicitColumnExpression,
        datasourceType,
    });

    try {
        const ast = parse(trimmedQuery);
        const whereSQL =  await genWhereSQL(ast, serializer);
        console.log({
            query,
            whereSQL,
        });
        return whereSQL;
    } catch (error) {
        console.error('Failed to generate Lucene WHERE SQL', error);
        throw error;
    }
}
