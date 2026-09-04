import { deriveVariantFields, flattenVariantLeaves, getVariantFieldValue } from '../variant-fields';

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
});
