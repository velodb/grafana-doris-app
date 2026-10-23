import { t } from 'i18n';
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
        return t('Location: The backend did not report an error position.');
    }
    if (location.inputLine && location.inputColumn) {
        return location.inputPosition ? t('Input location: line {{line}}, column {{column}} (character {{position}}).', { line: location.inputLine, column: location.inputColumn, position: location.inputPosition }) : t('Input location: line {{line}}, column {{column}}.', { line: location.inputLine, column: location.inputColumn });
    }
    if (location.line && location.column) {
        return t('Generated SQL location: line {{line}}, column {{column}}.', { line: location.line, column: location.column });
    }
    if (location.position) {
        return t('Generated SQL position: character {{position}}.', { position: location.position });
    }
    if (location.near) {
        return t('Reported near: {{near}}', { near: location.near });
    }
    return t('Location: The backend did not report an error position.');
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
            <div>
                <strong>{t('Backend message')}</strong>
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
            <div>{getLocationText(error)}</div>
            {error.location?.near ? <div>{t('Near:')}<code>{error.location.near}</code></div> : null}
            <div><strong>{t('Possible cause:')}</strong> {error.likelyCause}</div>
            {error.generatedSql ? (
                <details>
                    <summary
                        className={css`
                            width: fit-content;
                            cursor: pointer;
                            font-weight: 500;
                        `}
                    >
                        {t('Generated SQL')}
                    </summary>
                    <div className={css`margin-top: 8px;`}>
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
                </details>
            ) : null}
        </div>
    );
}

export default function DiscoverQueryFeedback({ queryState, searchType, database, table }: DiscoverQueryFeedbackProps) {
    const tableContext = database && table ? `${database}.${table}` : t('No table selected');

    return (
        <div
            className={css`
                display: grid;
                gap: 8px;
                margin-top: 8px;
            `}
        >
            {queryState.status === 'error' && queryState.error ? (
                <Alert title={t('Query failed')} severity="error">
                    <div>{t('{{mode}} query on {{table}} did not complete.', { mode: searchType === 'Search' ? t('Search') : searchType, table: tableContext })}</div>
                    <QueryErrorDetails error={queryState.error} />
                </Alert>
            ) : null}
            {queryState.status !== 'error' && queryState.auxiliaryErrors.length > 0 ? (
                <Alert title={t('Partial query failure')} severity="warning">
                    <div>{t('The result query completed, but some supporting queries failed.')}</div>
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
