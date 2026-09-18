/** Converts backend count values to a safe non-negative integer for UI state. */
export function normalizeCount(value: unknown): number {
    const count = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}
