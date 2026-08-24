import React from 'react';
import { css } from '@emotion/css';
import { PluginPage } from '@grafana/runtime';
import { LoadingBar, useTheme2 } from '@grafana/ui';

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

export default function PageDiscover() {
    const theme = useTheme2();
    const { loading, queryState, sort, onSortChange, onQuerying, getTraceData } = useDiscoverData();
    const searchType = useAtomValue(searchTypeAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const currentTable = useAtomValue(currentTableAtom);

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
                    className={css`
                        display: grid;
                        grid-template-columns: 2fr 8fr;
                        grid-template-rows: 1fr;
                        grid-template-areas: 'sidebar content';
                        padding-top: 0.5rem;
                        gap: 0.5rem;
                    `}
                >
                    <div
                        style={{
                            height: 'calc(100vh - 210px)',
                        }}
                    >
                        <DiscoverSidebar />
                    </div>
                    <div
                        className={css`
                            grid-area: content;
                            display: flex;
                            flex-direction: column;
                            overflow: auto;
                            height: calc(100vh - 210px);
                            background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                            position: relative;
                            padding: 16px 0;
                        `}
                    >
                        <div style={{ position: 'absolute', top: 0, width: '100%' }}>{loading.getTableDataCharts && <LoadingBar width={100} />}</div>
                        <DiscoverHistogram />
                        <div
                            className={css`
                                margin-top: 24px;
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
