import { normalizeCount } from '../count';

describe('normalizeCount', () => {
    it.each([
        [42, 42],
        ['42', 42],
        [3.8, 3],
        ['<nil>', 0],
        [null, 0],
        [undefined, 0],
        [-1, 0],
    ])('normalizes %p to %p', (value, expected) => {
        expect(normalizeCount(value)).toBe(expected);
    });
});
