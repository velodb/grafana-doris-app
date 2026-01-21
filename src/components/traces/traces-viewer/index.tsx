import React, { useMemo } from 'react';
import { Select, useTheme2, Pagination } from '@grafana/ui';
import { css } from '@emotion/css';
import { TraceItem } from './trace-item';
import ReactECharts from 'echarts-for-react';
import { useAtom, useAtomValue } from 'jotai';
import { pageAtom, pageSizeAtom } from 'store/discover';
import { currentSortAtom } from 'store/traces';
import TraceDetail from 'components/trace-detail';

export const TraceView: React.FC<any> = React.memo(({ traces: propTraces, onSortByChange }) => {
    const theme = useTheme2();
    const [page, setPage] = useAtom(pageAtom);
    const pageSize = useAtomValue(pageSizeAtom);
    const total = propTraces[0]?.total || 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const traces: any[] = propTraces || [];
    const [sort, setSort] = useAtom(currentSortAtom);
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const [traceId, setTraceId] = React.useState<string>('');
    
    // 预处理 series 数据，计算 symbolSize
    const seriesData = useMemo(() => {
        return traces.map(s => ({
            name: `${s.root_service}:${s.operation}`,
            spans: s.spans,
            value: s.trace_duration_ms,
            trace_id: s.trace_id,
            symbolSize: Math.max(12, Math.min(30, s.spans || 1)),
        }));
    }, [traces]);

    const option = useMemo(() => {
        return {
            tooltip: {
                trigger: 'item',
                padding: 0,
                borderWidth: 0,
                backgroundColor: theme.isLight ? '#ffffff' : 'rgba(63, 63, 69, 0.64)',
                formatter: function (params: any) {
                    const html = `<div
                       style="
                          padding: 8px;
                          min-width: 120px;
                          border-radius: 6px;
                          backdrop-filter: blur(12px);
                          color: ${theme.isLight ? '#1F1F26' : '#EFEFF0'};
                        ">
                      <div style="padding-bottom: 4px; border-bottom: 1px solid ${theme.isLight ? '#DFDFE0' : '#3F3F45'};">${[params.name]}</div>
                      <div style="padding-top:4px;display: flex;justify-content: space-between;"><span>Durations：</span><span style="font-family:DIN Alternate;font-size:14;font-weight:500;">${[
                          `${params.value} ms` || 'No Data',
                      ]}</span></div>
                      <div style="padding-top:4px;display: flex;justify-content: space-between;"><span>Spans：</span><span style="font-family:DIN Alternate;font-size:14;font-weight:500;">${[
                          params.data.spans || 'No Data',
                      ]}</span></div>
                  </div>`;
                    return html;
                },
            },
            xAxis: {
                type: 'category',
                name: 'Time',
                data: traces.map(s => s.time),
                axisLabel: { color: theme.colors.text.primary },
            },
            yAxis: {
                type: 'value',
                name: 'Duration (ms)',
                axisLabel: { color: theme.colors.text.primary },
                axisLine: { lineStyle: { color: theme.colors.text.secondary } },
            },
            series: [
                {
                    type: 'scatter',
                    data: seriesData,
                    symbolSize: (data: any) => data.symbolSize,
                },
            ],
        };
    }, [seriesData, traces, theme]);

    const onEvents = {
        click: (params: any) => {
            setTraceId(params.data.trace_id);
            setDrawerOpen(true);
        },
    };

    return (
        <div
            className={css`
                display: flex;
                flex-direction: column;
                gap: 16px;
                background: ${theme.colors.background.primary};
                color: ${theme.colors.text.primary};
            `}
        >
            {/* Scatter Plot */}
            <div
                className={css`
                    margin-top: -20px;
                    height: 300px;
                `}
            >
                <ReactECharts option={option} notMerge={false} lazyUpdate={true} style={{ height: '100%' }} onEvents={onEvents} />
            </div>

            {/* Header */}
            <div
                className={css`
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `}
            >
                <div
                    className={css`
                        display: flex;
                        gap: 8px;
                        align-items: center;
                    `}
                >
                    <span>Sort:</span>
                    <Select
                        options={[
                            { label: 'Most Recent', value: 'most-recent' },
                            { label: 'Longest Duration', value: 'longest-duration' },
                            { label: 'Shortest Duration', value: 'shortest-duration' },
                            { label: 'Most Spans', value: 'most-spans' },
                            { label: 'Least Spans', value: 'least-spans' },
                        ]}
                        value={sort}
                        onChange={option => {
                            setPage(1);
                            setSort(option.value);
                            onSortByChange(option.value);
                        }}
                    />
                </div>
            </div>

            {/* Trace List Header */}
            <div
                className={css`
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding-bottom: 20px;
                `}
            >
                <h3
                    className={css`
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        gap: 8px;
                    `}
                >
                    <div>{traces.length} Traces, </div>
                    <div>Total {total}</div>
                </h3>
                <Pagination currentPage={page} numberOfPages={Math.ceil(total / pageSize) || 1} onNavigate={toPage => setPage(toPage)} />
            </div>

            {/* Trace List */}
            <div
                className={css`
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                `}
            >
                {traces.map(trace => (
                    <TraceItem
                        key={trace.id}
                        trace={trace}
                        onClick={() => {
                            setTraceId(trace.trace_id);
                            setDrawerOpen(true);
                        }}
                    />
                ))}
            </div>

            <TraceDetail onClose={() => setDrawerOpen(false)} open={drawerOpen} traceId={traceId} />
        </div>
    );
}) ;
