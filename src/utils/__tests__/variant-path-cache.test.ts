import { mergeVariantPathSamples, variantPathsFromFrequencies } from '../variant-path-cache';

it('keeps string leaves, literal path segments, and stable frequency order', () => {
    const cache = mergeVariantPathSamples(
        {},
        ['attrs'],
        [{ attrs: { 'team.name': 'x', http: { method: 'GET' }, number: 5, flag: true, nil: null } }, { attrs: '{"http":{"method":"POST"}}' }, { attrs: 'malformed' }],
    );
    expect(variantPathsFromFrequencies(cache)).toEqual({ attrs: [['http', 'method'], ['team.name']] });
    expect(cache.attrs[0].count).toBe(2);
});
