import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { PluginPage } from '@grafana/runtime';
import { IconButton, LoadingBar, useTheme2 } from '@grafana/ui';

import DiscoverFilter from 'components/discover-filter';
import DiscoverSidebar from 'components/discover-sidebar';
import { DiscoverHistogram } from 'components/discover-histogram';
import DiscoverContent from 'components/discover-content';
import DiscoverHeader from '../components/discover-header';
import { testIds } from '../components/testIds';
import { useDiscoverData } from './PageDiscover/useDiscoverData';
import DiscoverQueryFeedback from 'components/discover-query-feedback';
import { useAtomValue } from 'jotai';
import { currentDatabaseAtom, currentTableAtom, searchTypeAtom } from 'store/discover';
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
    const { loading, queryState, sort, onSortChange, onQuerying, getTraceData } = useDiscoverData();
    const searchType = useAtomValue(searchTypeAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const currentTable = useAtomValue(currentTableAtom);
    const sectionRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const hasSavedLayoutRef = useRef(hasSavedDiscoverLayout());
    const [layout, setLayout] = useState(readDiscoverLayout);
    const [contentHeight, setContentHeight] = useState(0);
    const chartMaxHeight = Math.max(DISCOVER_CHART_MIN_HEIGHT, Math.floor((contentHeight || 600) / 2));
    const chartHeight = Math.min(layout.chartHeight, chartMaxHeight);

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

    const beginResize = useCallback((direction: 'sidebar' | 'chart', event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
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
        };
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp, { once: true });
    }, [chartHeight, chartMaxHeight, layout.sidebarWidth, updateLayout]);

    const handleResizeKeyDown = useCallback((direction: 'sidebar' | 'chart', event: React.KeyboardEvent<HTMLDivElement>) => {
        const decrease = direction === 'sidebar' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
        const increase = direction === 'sidebar' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
        if (!decrease && !increase) {
            return;
        }
        event.preventDefault();
        const delta = increase ? 16 : -16;
        updateLayout(current => direction === 'sidebar'
            ? { ...current, sidebarWidth: Math.min(DISCOVER_SIDEBAR_MAX_WIDTH, Math.max(DISCOVER_SIDEBAR_MIN_WIDTH, current.sidebarWidth + delta)) }
            : { ...current, chartHeight: Math.min(chartMaxHeight, Math.max(DISCOVER_CHART_MIN_HEIGHT, current.chartHeight + delta)) });
    }, [chartMaxHeight, updateLayout]);

    return (
        <div
            className={css`
                & > div > div {
                    background-color: ${theme.isDark ? '#111217' : '#F4F5F5'};
                    padding: 0 1rem;
                }
            `}
        >
            <PluginPage pageNav={{ text: '' }}>
                <div data-testid={testIds.pageTwo.container}>
                    <DiscoverHeader onQuerying={onQuerying} loading={loading.getTableData || loading.getTableDataCharts} />
                    <DiscoverFilter />
                    <DiscoverQueryFeedback
                        queryState={queryState}
                        searchType={searchType}
                        database={currentDatabase}
                        table={currentTable}
                    />
                </div>
                <section
                    ref={sectionRef}
                    className={css`
                        display: grid;
                        grid-template-columns: minmax(0, 1fr);
                        grid-template-rows: 1fr;
                        padding-top: 0.5rem;
                        height: calc(100vh - 210px);
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
                            `}
                        >
                            <IconButton name="angle-right" tooltip="Expand Column Panel" aria-label="Expand Column Panel" onClick={() => updateLayout(current => ({ ...current, sidebarCollapsed: false }))} />
                            <span className={css`writing-mode: vertical-rl; margin-top: 8px; font-size: 12px;`}>Column Panel</span>
                        </div>
                    ) : (
                        <div className={css`min-width: 0; height: 100%; position: relative;`}>
                            <div className={css`height: 100%;`}><DiscoverSidebar /></div>
                            <IconButton
                                name="angle-left"
                                tooltip="Collapse Column Panel"
                                aria-label="Collapse Column Panel"
                                data-testid="discover-sidebar-toggle"
                                onClick={() => updateLayout(current => ({ ...current, sidebarCollapsed: true }))}
                                className={css`position: absolute; top: 8px; right: 4px; z-index: 1;`}
                            />
                        </div>
                    )}
                    {!layout.sidebarCollapsed && (
                        <div
                            role="separator"
                            tabIndex={0}
                            aria-label="Resize Column Panel"
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
                                &:hover::after, &:focus::after { background: ${theme.colors.primary.main}; }
                                &::after { content: ''; position: absolute; inset: 0 3px; background: transparent; }
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
                        `}
                    >
                        <div style={{ position: 'absolute', top: 0, width: '100%' }}>{loading.getTableDataCharts && <LoadingBar width={100} />}</div>
                        <DiscoverHistogram height={chartHeight} collapsed={layout.chartCollapsed} onToggleCollapsed={() => updateLayout(current => ({ ...current, chartCollapsed: !current.chartCollapsed }))} />
                        {!layout.chartCollapsed && (
                            <div
                                role="separator"
                                tabIndex={0}
                                aria-label="Resize chart"
                                aria-orientation="horizontal"
                                aria-valuemin={DISCOVER_CHART_MIN_HEIGHT}
                                aria-valuemax={chartMaxHeight}
                                aria-valuenow={chartHeight}
                                onPointerDown={event => beginResize('chart', event)}
                                onKeyDown={event => handleResizeKeyDown('chart', event)}
                                className={css`
                                    height: 8px;
                                    cursor: row-resize;
                                    flex: none;
                                    outline: none;
                                    position: relative;
                                    &:hover::after, &:focus::after { background: ${theme.colors.primary.main}; }
                                    &::after { content: ''; position: absolute; inset: 3px 16px; background: transparent; }
                                `}
                            />
                        )}
                        <div
                            className={css`
                                margin-top: 16px;
                                min-height: 0;
                                flex: 1;
                                overflow: auto;
                            `}
                        >
                            <DiscoverContent
                                getTraceData={getTraceData}
                                fetchNextPage={() => {}}
                                queryState={queryState}
                                sort={sort}
                                onSortChange={onSortChange}
                            />
                        </div>
                    </div>
                </section>
            </PluginPage>
        </div>
    );
}
