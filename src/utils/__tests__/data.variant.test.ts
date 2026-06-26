jest.mock('lodash-es', () => ({
    flatten: (items: any[]) => items.flat(),
    orderBy: (items: any[]) => items,
    some: (items: any[], predicate: (item: any) => boolean) => items.some(predicate),
}));
jest.mock('nanoid', () => ({
    nanoid: () => 'test-id',
}));

import {
    convertColumnToRowViaFieldsType,
    escapeHtml,
    formatFieldDisplayValue,
    isVariantType,
    parseJsonLikeValue,
} from '../data';

describe('variant display helpers', () => {
    it('detects Doris variant types', () => {
        expect(isVariantType('VARIANT')).toBe(true);
        expect(isVariantType('variant')).toBe(true);
        expect(isVariantType('String')).toBe(false);
    });

    it('parses JSON-like objects, arrays, and strings', () => {
        expect(parseJsonLikeValue('{"level":"error","tags":["a"]}')).toEqual({
            level: 'error',
            tags: ['a'],
        });
        expect(parseJsonLikeValue('[{"k":"v"}]')).toEqual([{ k: 'v' }]);
        expect(parseJsonLikeValue('"plain"')).toBe('plain');
    });

    it('keeps non-JSON strings unchanged', () => {
        expect(parseJsonLikeValue('not json')).toBe('not json');
    });

    it('formats values for compact and pretty display', () => {
        expect(formatFieldDisplayValue({ b: [1, false] }, 'compact')).toBe('{"b":[1,false]}');
        expect(formatFieldDisplayValue({ b: [1, false] }, 'pretty')).toBe(`{
  "b": [
    1,
    false
  ]
}`);
        expect(formatFieldDisplayValue(0)).toBe('0');
        expect(formatFieldDisplayValue(false)).toBe('false');
        expect(formatFieldDisplayValue(null)).toBe('-');
        expect(formatFieldDisplayValue(undefined)).toBe('-');
        expect(formatFieldDisplayValue([])).toBe('[]');
        expect(formatFieldDisplayValue({})).toBe('{}');
    });

    it('escapes HTML special characters', () => {
        expect(escapeHtml(`<script data-id="1">&'</script>`)).toBe(
            '&lt;script data-id=&quot;1&quot;&gt;&amp;&#39;&lt;/script&gt;',
        );
    });

    it('parses variant columns via Doris field metadata', () => {
        const frame = {
            schema: {
                fields: [
                    { name: 'timestamp', type: 'DATETIME', precision: 3 },
                    { name: 'attrs', type: 'string' },
                    { name: 'message', type: 'string' },
                ],
            },
            data: {
                values: [
                    ['2026-06-12 10:00:00.000', '2026-06-12 10:01:00.000'],
                    ['{"status":500,"nested":{"ok":false}}', 'not json'],
                    ['hello', 'world'],
                ],
            },
        };

        const rows = convertColumnToRowViaFieldsType(frame, [
            { Field: 'timestamp', Type: 'DATETIME' },
            { Field: 'attrs', Type: 'VARIANT' },
            { Field: 'message', Type: 'STRING' },
        ]);

        expect(rows[0].attrs).toEqual({ status: 500, nested: { ok: false } });
        expect(rows[1].attrs).toBe('not json');
    });
});
