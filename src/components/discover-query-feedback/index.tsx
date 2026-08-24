import React from 'react';
import { Alert, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { DiscoverQueryError, DiscoverQueryState } from 'types/discover';

type DiscoverQueryFeedbackProps = {
    queryState: DiscoverQueryState;
    searchType: 'SQL' | 'Search' | 'Lucene';
    database: string;
    table: string;
};

function getLocationText(error: DiscoverQueryError) {
    const location = error.location;
    if (!location) {
        return 'Location: The backend did not report an error position.';
    }
    if (location.inputLine && location.inputColumn) {
        return `Input location: line ${location.inputLine}, column ${location.inputColumn}${location.inputPosition ? ` (character ${location.inputPosition})` : ''}.`;
    }
    if (location.line && location.column) {
        return `Generated SQL location: line ${location.line}, column ${location.column}.`;
    }
    if (location.position) {
        return `Generated SQL position: character ${location.position}.`;
    }
    if (location.near) {
        return `Reported near: ${location.near}`;
    }
    return 'Location: The backend did not report an error position.';
}

function QueryErrorDetails({ error }: { error: DiscoverQueryError }) {
    const theme = useTheme2();
    return (
        <div
            className={css`
                display: grid;
                gap: 6px;
                margin-top: 4px;
                overflow-wrap: anywhere;
            `}
        >
            <div>{getLocationText(error)}</div>
            {error.location?.near ? <div>Near: <code>{error.location.near}</code></div> : null}
            <div><strong>Possible cause:</strong> {error.likelyCause}</div>
            <details>
                <summary
                    className={css`
                        width: fit-content;
                        cursor: pointer;
                        font-weight: 500;
                    `}
                >
                    Backend details and generated SQL
                </summary>
                <div className={css`margin-top: 8px;`}>
                    <strong>Backend message</strong>
                    <pre
                        className={css`
                            max-height: 180px;
                            margin: 4px 0 0;
                            padding: 8px;
                            overflow: auto;
                            border-radius: 4px;
                            background: ${theme.colors.background.canvas};
                            color: ${theme.colors.text.primary};
                            white-space: pre-wrap;
                        `}
                    >
                        {error.message}
                    </pre>
                </div>
                {error.generatedSql ? (
                    <div className={css`margin-top: 8px;`}>
                        <strong>Generated SQL</strong>
                        <pre
                            className={css`
                                max-height: 260px;
                                margin: 4px 0 0;
                                padding: 8px;
                                overflow: auto;
                                border-radius: 4px;
                                background: ${theme.colors.background.canvas};
                                color: ${theme.colors.text.primary};
                                white-space: pre-wrap;
                            `}
                        >
                            {error.generatedSql}
                        </pre>
                    </div>
                ) : null}
            </details>
        </div>
    );
}

export default function DiscoverQueryFeedback({ queryState, searchType, database, table }: DiscoverQueryFeedbackProps) {
    const tableContext = database && table ? `${database}.${table}` : 'No table selected';

    return (
        <div
            className={css`
                display: grid;
                gap: 8px;
                margin-top: 8px;
            `}
        >
            {queryState.status === 'error' && queryState.error ? (
                <Alert title="Query failed" severity="error">
                    <div><strong>{searchType}</strong> query on <strong>{tableContext}</strong> did not complete.</div>
                    <QueryErrorDetails error={queryState.error} />
                </Alert>
            ) : null}
            {queryState.status !== 'error' && queryState.auxiliaryErrors.length > 0 ? (
                <Alert title="Partial query failure" severity="warning">
                    <div>The result query completed, but some supporting queries failed.</div>
                    {queryState.auxiliaryErrors.map(error => (
                        <div key={error.source} className={css`margin-top: 8px;`}>
                            <strong>{error.summary}</strong>
                            <QueryErrorDetails error={error} />
                        </div>
                    ))}
                </Alert>
            ) : null}
        </div>
    );
}
