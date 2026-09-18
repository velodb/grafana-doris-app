import {
    deriveVariantFields,
    deriveVariantFieldsFromMetadata,
    flattenVariantLeaves,
    getVariantFieldValue,
    mergeVariantFields,
} from '../variant-fields';

describe('VARIANT sidebar fields', () => {
    const fields = [{ Field: 'resource_attributes', Type: 'VARIANT' }];

    it('derives typed leaves while preserving literal dotted keys', () => {
        const trees = deriveVariantFields(fields, [
            { resource_attributes: { app: 'checkout', 'k8s.namespace.name': 'shop', nested: { retries: 2, enabled: true } } },
            { resource_attributes: { app: 'catalog', nested: { retries: 3, enabled: false } } },
        ]);
        const leaves = flattenVariantLeaves(trees);

        expect(trees[0].leafCount).toBe(4);
        expect(trees[0].children?.map(field => field.label)).toEqual(expect.arrayContaining([
            'app',
            'k8s.namespace.name',
            'nested.retries',
        ]));
        expect(trees[0].children?.every(field => !field.children?.length)).toBe(true);
        expect(leaves).toEqual(expect.arrayContaining([
            expect.objectContaining({ Field: 'resource_attributes.app', Type: 'VARCHAR', variantPath: ['resource_attributes', 'app'] }),
            expect.objectContaining({ Field: 'resource_attributes.k8s.namespace.name', variantPath: ['resource_attributes', 'k8s.namespace.name'] }),
            expect.objectContaining({ Field: 'resource_attributes.nested.retries', Type: 'DOUBLE', variantPath: ['resource_attributes', 'nested', 'retries'] }),
            expect.objectContaining({ Field: 'resource_attributes.nested.enabled', Type: 'BOOLEAN' }),
        ]));
    });

    it('keeps arrays as terminal fields and reads literal dotted keys safely', () => {
        const [tree] = deriveVariantFields(fields, [{ resource_attributes: { tags: ['a', 'b'], 'http.route': '/checkout' } }]);
        const leaves = flattenVariantLeaves([tree]);
        const route = leaves.find(field => field.Field === 'resource_attributes.http.route')!;

        expect(leaves.find(field => field.Field === 'resource_attributes.tags')).toEqual(expect.objectContaining({ Type: 'ARRAY' }));
        expect(getVariantFieldValue({ resource_attributes: { 'http.route': '/checkout' } }, route)).toBe('/checkout');
    });

    it('derives children for JSON fields as well as VARIANT fields', () => {
        const [tree] = deriveVariantFields(
            [{ Field: 'log_attributes', Type: 'JSON' }],
            [{ log_attributes: { source: { ip: '127.0.0.1' }, status: 200 } }],
        );

        expect(tree.Field).toBe('log_attributes');
        expect(tree.children).toEqual(expect.arrayContaining([
            expect.objectContaining({ Field: 'log_attributes.source.ip', Type: 'VARCHAR' }),
            expect.objectContaining({ Field: 'log_attributes.status', Type: 'DOUBLE' }),
        ]));
    });

    it('uses extended DESC subpaths without requiring result rows, then supplements them with samples', () => {
        const metadata = deriveVariantFieldsFromMetadata(fields, [
            { Field: 'resource_attributes.app', Type: 'VARCHAR' },
            { Field: "resource_attributes['k8s.namespace.name']", Type: 'VARCHAR' },
        ]);
        const sampled = deriveVariantFields(fields, [
            { resource_attributes: { app: 'checkout', k8s: { pod: { name: 'checkout-1' } } } },
        ]);
        const [merged] = mergeVariantFields(metadata, sampled);

        expect(metadata[0]).toEqual(expect.objectContaining({ leafCount: 2 }));
        expect(metadata[0].children).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'app', variantPath: ['resource_attributes', 'app'] }),
            expect.objectContaining({ label: 'k8s.namespace.name', variantPath: ['resource_attributes', 'k8s.namespace.name'] }),
        ]));
        expect(merged.children).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'app', Type: 'VARCHAR' }),
            expect.objectContaining({ label: 'k8s.pod.name', variantPath: ['resource_attributes', 'k8s', 'pod', 'name'] }),
        ]));
    });

    it('keeps an empty VARIANT parent when neither DESC nor result rows expose leaves', () => {
        const [tree] = mergeVariantFields(
            deriveVariantFieldsFromMetadata(fields, []),
            deriveVariantFields(fields, []),
        );

        expect(tree).toEqual(expect.objectContaining({ Field: 'resource_attributes', leafCount: 0, children: [] }));
    });
});
