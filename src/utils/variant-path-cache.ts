import { collectStringVariantPaths } from './variant-fields';

export type VariantPathFrequency = { path: string[]; count: number };
export type VariantPathFrequencies = Record<string, VariantPathFrequency[]>;

/** Count a path once per sampled row. Deterministic ties keep persisted caches stable. */
export function mergeVariantPathSamples(previous: VariantPathFrequencies, columns: string[], rows: Array<Record<string, unknown>>): VariantPathFrequencies {
    const result = { ...previous };
    for (const column of columns) {
        const counts = new Map((previous[column] || []).map(entry => [JSON.stringify(entry.path), { ...entry }]));
        for (const row of rows) {
            let value = row[column];
            if (typeof value === 'string') {
                try {
                    value = JSON.parse(value);
                } catch {
                    continue;
                }
            }
            const paths = new Map(collectStringVariantPaths(value).map(path => [JSON.stringify(path), path]));
            for (const [key, path] of paths) {
                const entry = counts.get(key);
                counts.set(key, { path, count: (entry?.count || 0) + 1 });
            }
        }
        result[column] = [...counts.values()].sort((a, b) => b.count - a.count || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path))).slice(0, 200);
    }
    return result;
}

export function variantPathsFromFrequencies(frequencies: VariantPathFrequencies): Record<string, string[][]> {
    return Object.fromEntries(Object.entries(frequencies).map(([column, entries]) => [column, entries.map(entry => entry.path)]));
}
