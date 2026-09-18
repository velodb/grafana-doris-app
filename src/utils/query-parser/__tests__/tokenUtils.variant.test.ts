import { encodeVariantLiteralFieldPaths, splitVariantFieldPath } from '../tokenUtils';

describe('VARIANT literal Lucene field paths', () => {
    it('encodes dotted literal keys without leaving dots in the parser field segment', () => {
        const encoded = encodeVariantLiteralFieldPaths('attrs["k8s.pod.name"]:checkout');

        expect(encoded).toMatch(/^attrs\.__HDX_VARIANT_KEY_[0-9a-f]+:checkout$/);
        expect(splitVariantFieldPath(encoded.split(':')[0])).toEqual(['attrs', 'k8s.pod.name']);
    });

    it('supports literal and ordinary nested path segments together', () => {
        const encoded = encodeVariantLiteralFieldPaths('attrs["service.name"].status.code:200');

        expect(splitVariantFieldPath(encoded.split(':')[0])).toEqual(['attrs', 'service.name', 'status', 'code']);
    });

    it('handles escaped characters in literal keys and leaves malformed syntax unchanged', () => {
        const encoded = encodeVariantLiteralFieldPaths('attrs["team\\\"name"]:platform');

        expect(splitVariantFieldPath(encoded.split(':')[0])).toEqual(['attrs', 'team"name']);
        expect(encodeVariantLiteralFieldPaths('attrs["unterminated:value')).toBe('attrs["unterminated:value');
    });
});
