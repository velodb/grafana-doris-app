export const DISCOVER_LAYOUT_STORAGE_KEY = 'doris-app.discover-layout.v1';

export const DISCOVER_SIDEBAR_MIN_WIDTH = 240;
export const DISCOVER_SIDEBAR_MAX_WIDTH = 480;
export const DISCOVER_CHART_MIN_HEIGHT = 160;
export const DISCOVER_CHART_DEFAULT_HEIGHT = 300;

export type DiscoverLayout = {
    sidebarWidth: number;
    chartHeight: number;
    sidebarCollapsed: boolean;
    chartCollapsed: boolean;
};

export const DEFAULT_DISCOVER_LAYOUT: DiscoverLayout = {
    sidebarWidth: 320,
    chartHeight: DISCOVER_CHART_DEFAULT_HEIGHT,
    sidebarCollapsed: false,
    chartCollapsed: false,
};

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeDiscoverLayout(value: unknown): DiscoverLayout {
    const layout = value && typeof value === 'object' ? (value as Partial<DiscoverLayout>) : {};
    return {
        sidebarWidth: clamp(layout.sidebarWidth, DISCOVER_SIDEBAR_MIN_WIDTH, DISCOVER_SIDEBAR_MAX_WIDTH, DEFAULT_DISCOVER_LAYOUT.sidebarWidth),
        chartHeight: clamp(layout.chartHeight, DISCOVER_CHART_MIN_HEIGHT, Number.MAX_SAFE_INTEGER, DEFAULT_DISCOVER_LAYOUT.chartHeight),
        sidebarCollapsed: layout.sidebarCollapsed === true,
        chartCollapsed: layout.chartCollapsed === true,
    };
}

export function readDiscoverLayout(storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage): DiscoverLayout {
    if (!storage) {
        return DEFAULT_DISCOVER_LAYOUT;
    }
    try {
        const raw = storage.getItem(DISCOVER_LAYOUT_STORAGE_KEY);
        return raw ? normalizeDiscoverLayout(JSON.parse(raw)) : DEFAULT_DISCOVER_LAYOUT;
    } catch {
        return DEFAULT_DISCOVER_LAYOUT;
    }
}

export function hasSavedDiscoverLayout(storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage) {
    if (!storage) {
        return false;
    }
    try {
        const raw = storage.getItem(DISCOVER_LAYOUT_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : undefined;
        return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
        return false;
    }
}

export function saveDiscoverLayout(layout: DiscoverLayout, storage: Pick<Storage, 'setItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage) {
    if (!storage) {
        return;
    }
    try {
        storage.setItem(DISCOVER_LAYOUT_STORAGE_KEY, JSON.stringify(normalizeDiscoverLayout(layout)));
    } catch {
        // A blocked or full localStorage must never prevent Discover from rendering.
    }
}
