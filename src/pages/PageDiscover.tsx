import { t } from 'i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { PluginPage } from '@grafana/runtime';
import { Alert, IconButton, LoadingBar, Tooltip, useTheme2 } from '@grafana/ui';

import DiscoverFilter from 'components/discover-filter';
import DiscoverSidebar from 'components/discover-sidebar';
import { DiscoverHistogram } from 'components/discover-histogram';
import DiscoverContent from 'components/discover-content';
import DiscoverHeader from '../components/discover-header';
import { testIds } from '../components/testIds';
import { useDiscoverData } from './PageDiscover/useDiscoverData';
import DiscoverQueryFeedback from 'components/discover-query-feedback';
import FieldStatistics from 'components/field-statistics';
import TopNConfiguration from 'components/top-n-configuration';
import { useAtom, useAtomValue } from 'jotai';
import { currentDatabaseAtom, currentTableAtom, discoverShareReadyAtom, locationAtom, searchTypeAtom, selectedDatasourceAtom, variantSamplingWarningAtom } from 'store/discover';
import { DISCOVER_SHARE_STATE_PARAM, encodeDiscoverShareState } from 'utils/discover-share-state';
import { discoverSnapshotAtom } from 'store/discover-snapshot';
import {
    DISCOVER_CHART_MIN_HEIGHT,
    DISCOVER_SIDEBAR_MAX_WIDTH,
    DISCOVER_SIDEBAR_MIN_WIDTH,
    hasSavedDiscoverLayout,
    readDiscoverLayout,
    saveDiscoverLayout,
} from './PageDiscover/discover-layout';

export default function PageDiscover() {
    const theme = useTheme2();
    const { loading, queryState, sort, onSortChange, onQuerying, onRefresh, getTraceData } = useDiscoverData();
    const searchType = useAtomValue(searchTypeAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const currentTable = useAtomValue(currentTableAtom);
    const [, setLoc] = useAtom(locationAtom);
    const shareReady = useAtomValue(discoverShareReadyAtom);
    const selectedDatasource = useAtomValue(selectedDatasourceAtom);
    const samplingWarnings = useAtomValue(variantSamplingWarningAtom);
    const samplingWarning = samplingWarnings[JSON.stringify([selectedDatasource?.uid, currentDatabase, currentTable])];
    const snapshot = useAtomValue(discoverSnapshotAtom);
    const sectionRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const hasSavedLayoutRef = useRef(hasSavedDiscoverLayout());
    const [layout, setLayout] = useState(readDiscoverLayout);
    const [contentHeight, setContentHeight] = useState(0);
    const chartMaxHeight = Math.max(DISCOVER_CHART_MIN_HEIGHT, Math.floor((contentHeight || 600) / 2));
    const chartHeight = Math.min(layout.chartHeight, chartMaxHeight);

    useEffect(() => {
        if (!shareReady) {
            return;
        }
        const state = encodeDiscoverShareState(snapshot);
        setLoc((previous: any) => {
            const searchParams = new URLSearchParams(previous?.searchParams?.toString() ?? '');
            if (searchParams.get(DISCOVER_SHARE_STATE_PARAM) === state) {
                return previous;
            }
            searchParams.set(DISCOVER_SHARE_STATE_PARAM, state);
            return { ...previous, searchParams };
        });
    }, [snapshot, shareReady, setLoc]);

    useEffect(() => {
        saveDiscoverLayout(layout);
    }, [layout]);

    useEffect(() => {
        if (hasSavedLayoutRef.current || !sectionRef.current) {
            return;
        }
        const sidebarWidth = Math.min(DISCOVER_SIDEBAR_MAX_WIDTH, Math.max(DISCOVER_SIDEBAR_MIN_WIDTH, Math.round(sectionRef.current.clientWidth * 0.2)));
        setLayout(current => ({ ...current, sidebarWidth }));
    }, []);

    useEffect(() => {
        const element = contentRef.current;
        if (!element) {
            return undefined;
        }
        const updateHeight = () => setContentHeight(element.clientHeight);
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const updateLayout = useCallback((update: (current: typeof layout) => typeof layout) => {
        setLayout(current => update(current));
    }, []);

    const beginResize = useCallback(
        (direction: 'sidebar' | 'chart', event: React.PointerEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const startPosition = direction === 'sidebar' ? event.clientX : event.clientY;
            const startSize = direction === 'sidebar' ? layout.sidebarWidth : chartHeight;
            const sectionLeft = sectionRef.current?.getBoundingClientRect().left || 0;
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';

            const onPointerMove = (moveEvent: PointerEvent) => {
                if (direction === 'sidebar') {
                    const width = Math.min(DISCOVER_SIDEBAR_MAX_WIDTH, Math.max(DISCOVER_SIDEBAR_MIN_WIDTH, moveEvent.clientX - sectionLeft));
                    updateLayout(current => ({ ...current, sidebarWidth: width }));
                } else {
                    const height = Math.min(chartMaxHeight, Math.max(DISCOVER_CHART_MIN_HEIGHT, startSize + moveEvent.clientY - startPosition));
                    updateLayout(current => ({ ...current, chartHeight: height }));
                }
            };
            const onPointerUp = () => {
                document.body.style.userSelect = previousUserSelect;
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.removeEventListener('pointercancel', onPointerUp);
            };
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp, { once: true });
            document.addEventListener('pointercancel', onPointerUp, { once: true });
        },
        [chartHeight, chartMaxHeight, layout.sidebarWidth, updateLayout],
    );

    const handleResizeKeyDown = useCallback(
        (direction: 'sidebar' | 'chart', event: React.KeyboardEvent<HTMLDivElement>) => {
            const decrease = direction === 'sidebar' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
            const increase = direction === 'sidebar' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
            if (!decrease && !increase) {
                return;
            }
            event.preventDefault();
            const delta = increase ? 16 : -16;
            updateLayout(current =>
                direction === 'sidebar'
                    ? { ...current, sidebarWidth: Math.min(DISCOVER_SIDEBAR_MAX_WIDTH, Math.max(DISCOVER_SIDEBAR_MIN_WIDTH, current.sidebarWidth + delta)) }
                    : { ...current, chartHeight: Math.min(chartMaxHeight, Math.max(DISCOVER_CHART_MIN_HEIGHT, current.chartHeight + delta)) },
            );
        },
        [chartMaxHeight, updateLayout],
    );

    return (
        <div
            className={css`
                display: flex;
                flex: 1 1 0;
                flex-direction: column;
                min-height: 0;
                height: calc(100vh - 48px);
                max-height: calc(100vh - 48px);
                overflow: hidden;

                & > div > div {
                    background-color: ${theme.isDark ? '#111217' : '#F4F5F5'};
                    padding: 0 1rem;
                }
            `}
        >
            <PluginPage pageNav={{ text: '' }}>
                <div
                    className={css`
                        display: flex;
                        flex-direction: column;
                        flex: 1 1 auto;
                        width: 100%;
                        min-height: 0;
                        height: calc(100vh - 64px);
                        max-height: calc(100vh - 64px);
                        overflow: hidden;
                    `}
                >
                    <div data-testid={testIds.pageTwo.container} style={{ flex: 'none' }}>
                        <DiscoverHeader onRefresh={onRefresh} onQuerying={onQuerying} loading={loading.getTableData || loading.getTableDataCharts} />
                        {searchType === 'Lucene' && samplingWarning && (
                            <Alert title={t('Attribute search coverage')} severity="warning">
                                {samplingWarning}
                            </Alert>
                        )}
                        <DiscoverFilter />
                        <DiscoverQueryFeedback queryState={queryState} searchType={searchType} database={currentDatabase} table={currentTable} />
                    </div>
                    <section
                        ref={sectionRef}
                        className={css`
                            display: grid;
                            flex: 1;
                            min-height: 0;
                            grid-template-columns: minmax(0, 1fr);
                            grid-template-rows: minmax(0, 1fr);
                            padding-top: 0.5rem;
                        `}
                        style={{ gridTemplateColumns: layout.sidebarCollapsed ? '36px minmax(0, 1fr)' : `${layout.sidebarWidth}px 8px minmax(0, 1fr)` }}
                    >
                        {layout.sidebarCollapsed ? (
                            <div
                                data-testid="discover-sidebar-collapsed"
                                className={css`
                                    background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                                    display: flex;
                                    align-items: center;
                                    flex-direction: column;
                                    padding-top: 8px;
                                    position: sticky;
                                    top: 0;
                                    align-self: stretch;
                                    min-height: 0;
                                `}
                            >
                                <IconButton
                                    name="angle-right"
                                    tooltip={t('Expand Column Panel')}
                                    aria-label={t('Expand Column Panel')}
                                    onClick={() => updateLayout(current => ({ ...current, sidebarCollapsed: false }))}
                                />
                                <span
                                    className={css`
                                        writing-mode: vertical-rl;
                                        margin-top: 8px;
                                        font-size: 12px;
                                    `}
                                >
                                    {t('Column Panel')}
                                </span>
                            </div>
                        ) : (
                            <div
                                className={css`
                                    min-width: 0;
                                    position: sticky;
                                    top: 0;
                                    align-self: stretch;
                                    min-height: 0;
                                `}
                            >
                                <div
                                    className={css`
                                        height: 100%;
                                    `}
                                >
                                    <DiscoverSidebar />
                                </div>
                                <IconButton
                                    name="angle-left"
                                    tooltip={t('Collapse Column Panel')}
                                    aria-label={t('Collapse Column Panel')}
                                    data-testid="discover-sidebar-toggle"
                                    onClick={() => updateLayout(current => ({ ...current, sidebarCollapsed: true }))}
                                    className={css`
                                        position: absolute;
                                        top: 8px;
                                        right: 4px;
                                        z-index: 1;
                                    `}
                                />
                            </div>
                        )}
                        {!layout.sidebarCollapsed && (
                            <div
                                role="separator"
                                tabIndex={0}
                                aria-label={t('Resize Column Panel')}
                                aria-orientation="vertical"
                                aria-valuemin={DISCOVER_SIDEBAR_MIN_WIDTH}
                                aria-valuemax={DISCOVER_SIDEBAR_MAX_WIDTH}
                                aria-valuenow={layout.sidebarWidth}
                                onPointerDown={event => beginResize('sidebar', event)}
                                onKeyDown={event => handleResizeKeyDown('sidebar', event)}
                                className={css`
                                    cursor: col-resize;
                                    position: relative;
                                    outline: none;
                                    &:hover::after,
                                    &:focus::after {
                                        background: ${theme.colors.primary.main};
                                    }
                                    &::after {
                                        content: '';
                                        position: absolute;
                                        inset: 0 3px;
                                        background: transparent;
                                    }
                                `}
                            />
                        )}
                        <div
                            ref={contentRef}
                            className={css`
                                display: flex;
                                flex-direction: column;
                                min-width: 0;
                                min-height: 0;
                                background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                                position: relative;
                                padding: 16px 0;
                                overflow-y: auto;
                                overflow-x: hidden;
                                overscroll-behavior: contain;
                            `}
                        >
                            <div style={{ position: 'absolute', top: 0, width: '100%' }}>{loading.getTableDataCharts && <LoadingBar width={100} />}</div>
                            <div
                                data-testid="discover-chart-panel"
                                className={css`
                                    flex: none;
                                `}
                            >
                                <DiscoverHistogram
                                    height={chartHeight}
                                    collapsed={layout.chartCollapsed}
                                    onToggleCollapsed={() => updateLayout(current => ({ ...current, chartCollapsed: !current.chartCollapsed }))}
                                />
                                {!layout.chartCollapsed && (
                                    <Tooltip content={t('Drag to resize chart and table · Chart height: {{height}} px · ↑ / ↓ to adjust', { height: Math.round(chartHeight) })} placement="top">
                                        <div
                                            role="separator"
                                            tabIndex={0}
                                            data-testid="discover-chart-resizer"
                                            aria-label={t('Resize chart')}
                                            aria-orientation="horizontal"
                                            aria-valuemin={DISCOVER_CHART_MIN_HEIGHT}
                                            aria-valuemax={chartMaxHeight}
                                            aria-valuenow={chartHeight}
                                            aria-valuetext={t('Chart height: {{height}} pixels', { height: Math.round(chartHeight) })}
                                            onPointerDownCapture={event => beginResize('chart', event)}
                                            onKeyDownCapture={event => handleResizeKeyDown('chart', event)}
                                            className={css`
                                                height: ${theme.spacing(2)};
                                                cursor: row-resize;
                                                touch-action: none;
                                                flex: none;
                                                position: relative;
                                                outline: none;
                                                &::before,
                                                &::after {
                                                    content: '';
                                                    position: absolute;
                                                    top: 50%;
                                                    transition: ${theme.transitions.create('background-color')};
                                                }
                                                &::before {
                                                    height: 1px;
                                                    left: 16px;
                                                    right: 16px;
                                                    background: ${theme.colors.border.weak};
                                                }
                                                &::after {
                                                    left: 50%;
                                                    transform: translate(-50%, -50%);
                                                    height: 4px;
                                                    width: min(200px, 40%);
                                                    border-radius: ${theme.shape.radius.pill};
                                                    background: ${theme.colors.emphasize(theme.colors.background.secondary, 0.15)};
                                                }
                                                &:hover::before,
                                                &:hover::after,
                                                &:active::before,
                                                &:active::after,
                                                &:focus-visible::before,
                                                &:focus-visible::after {
                                                    background: ${theme.colors.primary.border};
                                                }
                                                &:focus-visible {
                                                    outline: 2px solid ${theme.colors.primary.border};
                                                    outline-offset: -2px;
                                                }
                                            `}
                                        />
                                    </Tooltip>
                                )}
                            </div>
                            <div
                                data-testid="discover-table-panel"
                                className={css`
                                    margin-top: ${layout.chartCollapsed ? 16 : 0}px;
                                    flex: none;
                                `}
                            >
                                <DiscoverContent getTraceData={getTraceData} fetchNextPage={() => {}} queryState={queryState} sort={sort} onSortChange={onSortChange} />
                                <FieldStatistics />
                                <TopNConfiguration />
                            </div>
                        </div>
                    </section>
                </div>
            </PluginPage>
        </div>
    );
}
