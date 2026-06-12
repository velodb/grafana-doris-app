import { getLuceneFieldsWithoutInvertedIndex } from '../lucene-index-warning';

describe('getLuceneFieldsWithoutInvertedIndex', () => {
    const tableFields = [
        { Field: 'message', Type: 'String' },
        { Field: 'service_name', Type: 'String' },
        { Field: 'duration', Type: 'Int64' },
        { Field: 'timestamp', Type: 'DateTime' },
        { Field: 'success', Type: 'Boolean' },
    ];

    it('returns text search fields that do not have inverted indexes', () => {
        expect(
            getLuceneFieldsWithoutInvertedIndex(
                'message:error AND service_name:api',
                [{ columnName: 'service_name', type: 'INVERTED' }],
                tableFields,
            ),
        ).toEqual(['message']);
    });

    it('does not return fields that have inverted indexes', () => {
        expect(
            getLuceneFieldsWithoutInvertedIndex(
                'message:"hello world"',
                [{ columnName: 'message', type: 'INVERTED' }],
                tableFields,
            ),
        ).toEqual([]);
    });

    it('ignores range, comparison, existence, number, time, and boolean searches', () => {
        expect(
            getLuceneFieldsWithoutInvertedIndex(
                'duration:>500 AND timestamp:[2024-01-01 TO 2024-01-31] AND success:true AND message:*',
                [],
                tableFields,
            ),
        ).toEqual([]);
    });

    it('returns unique fields and supports negated field syntax', () => {
        expect(getLuceneFieldsWithoutInvertedIndex('-message:error OR message:failed', [], tableFields)).toEqual([
            'message',
        ]);
    });

    it('returns no fields for invalid Lucene syntax', () => {
        expect(getLuceneFieldsWithoutInvertedIndex('message:(', [], tableFields)).toEqual([]);
    });
});
