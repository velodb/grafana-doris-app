import {
    getLuceneFieldInsertText,
    getQuerySuggestions,
    getSqlFieldInsertText,
    QueryField,
} from './query-completion';

const fields: QueryField[] = [
    { Field: 'service_name', Type: 'VARCHAR' },
    { Field: 'status_code', Type: 'INT' },
    { Field: 'attributes.k8s.pod.name', Type: 'VARCHAR', variantPath: ['attributes', 'k8s.pod.name'], variantRootType: 'JSON' },
];

const rows = [
    { service_name: 'checkout', status_code: 200, attributes: { 'k8s.pod.name': 'checkout-1' } },
    { service_name: 'payments', status_code: 500, attributes: { 'k8s.pod.name': 'payments-1' } },
];

describe('Discover query completion', () => {
    it('suggests SQL fields at condition boundaries and operators after a selected field', () => {
        expect(getQuerySuggestions({ mode: 'sql', query: '(', fields, rows }).map(item => item.label)).toContain('service_name');
        expect(getQuerySuggestions({ mode: 'sql', query: '`service_name`', fields, rows }).map(item => item.label)).toEqual(expect.arrayContaining(['=', 'LIKE', 'IN']));
    });

    it('formats SQL sample values according to field type', () => {
        expect(getQuerySuggestions({ mode: 'sql', query: '`service_name` = ', fields, rows }).map(item => item.insertText)).toEqual(["'checkout'", "'payments'"]);
        expect(getQuerySuggestions({ mode: 'sql', query: '`status_code` >= ', fields, rows }).map(item => item.insertText)).toEqual(['200', '500']);
    });

    it('formats structured fields safely for SQL and Lucene', () => {
        expect(getSqlFieldInsertText(fields[2])).toBe("CAST(JSON_EXTRACT(`attributes`, '$.\"k8s.pod.name\"') AS STRING)");
        expect(getLuceneFieldInsertText(fields[2])).toBe('attributes["k8s.pod.name"]');
    });

    it('suggests Lucene fields, values and operators in their relevant contexts', () => {
        expect(getQuerySuggestions({ mode: 'lucene', query: '', fields, rows }).map(item => item.label)).toContain('service_name');
        expect(getQuerySuggestions({ mode: 'lucene', query: 'service_name:', fields, rows }).map(item => item.insertText)).toEqual(expect.arrayContaining(['"checkout"', '>', '[ TO ]']));
        expect(getQuerySuggestions({ mode: 'lucene', query: 'service_name:checkout ', fields, rows }).map(item => item.label)).toEqual(expect.arrayContaining(['AND', 'OR', 'NOT']));
    });
});
