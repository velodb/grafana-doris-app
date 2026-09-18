import {
    DEFAULT_DISCOVER_LAYOUT,
    DISCOVER_CHART_MIN_HEIGHT,
    DISCOVER_LAYOUT_STORAGE_KEY,
    DISCOVER_SIDEBAR_MAX_WIDTH,
    DISCOVER_SIDEBAR_MIN_WIDTH,
    hasSavedDiscoverLayout,
    normalizeDiscoverLayout,
    readDiscoverLayout,
    saveDiscoverLayout,
} from './discover-layout';

describe('Discover layout persistence', () => {
    it('uses defaults when no saved layout is available', () => {
        expect(readDiscoverLayout({ getItem: () => null })).toEqual(DEFAULT_DISCOVER_LAYOUT);
    });

    it('falls back to defaults for malformed saved JSON', () => {
        expect(readDiscoverLayout({ getItem: () => '{not valid json' })).toEqual(DEFAULT_DISCOVER_LAYOUT);
        expect(hasSavedDiscoverLayout({ getItem: () => '{not valid json' })).toBe(false);
        expect(hasSavedDiscoverLayout({ getItem: () => 'null' })).toBe(false);
    });

    it('clamps persisted sizes and preserves collapsed state', () => {
        expect(normalizeDiscoverLayout({
            sidebarWidth: DISCOVER_SIDEBAR_MAX_WIDTH + 100,
            chartHeight: DISCOVER_CHART_MIN_HEIGHT - 100,
            sidebarCollapsed: true,
            chartCollapsed: true,
        })).toEqual({
            sidebarWidth: DISCOVER_SIDEBAR_MAX_WIDTH,
            chartHeight: DISCOVER_CHART_MIN_HEIGHT,
            sidebarCollapsed: true,
            chartCollapsed: true,
        });
        expect(normalizeDiscoverLayout({ sidebarWidth: 1 })).toMatchObject({ sidebarWidth: DISCOVER_SIDEBAR_MIN_WIDTH });
    });

    it('writes a normalized layout under the Discover-specific key', () => {
        const setItem = jest.fn();
        saveDiscoverLayout({ ...DEFAULT_DISCOVER_LAYOUT, sidebarWidth: 999 }, { setItem });
        expect(setItem).toHaveBeenCalledWith(DISCOVER_LAYOUT_STORAGE_KEY, expect.stringContaining(`"sidebarWidth":${DISCOVER_SIDEBAR_MAX_WIDTH}`));
    });
});
