import React from 'react';
import { render, screen } from '@testing-library/react';
import DiscoverQueryFeedback from './index';

describe('DiscoverQueryFeedback', () => {
    it('shows persistent structured query error details', () => {
        render(
            <DiscoverQueryFeedback
                searchType="SQL"
                database="observability"
                table="logs"
                queryState={{
                    status: 'error',
                    rowCount: 0,
                    auxiliaryErrors: [],
                    error: {
                        source: 'results',
                        summary: 'Query failed',
                        message: 'Syntax error at line 1, column 42',
                        likelyCause: 'Check SQL keywords.',
                        location: { line: 1, column: 42, inputLine: 1, inputColumn: 8 },
                        generatedSql: 'SELECT * FROM logs WHERE bad SQL',
                    },
                }}
            />,
        );

        expect(screen.getByText('Query failed')).toBeInTheDocument();
        expect(screen.getByText('observability.logs').parentElement).toHaveTextContent('SQL query on observability.logs did not complete.');
        expect(screen.getByText(/Input location: line 1, column 8/)).toBeInTheDocument();
        expect(screen.getByText('Backend details and generated SQL')).toBeInTheDocument();
    });

    it('shows auxiliary failures as a warning when the result query succeeded', () => {
        render(
            <DiscoverQueryFeedback
                searchType="Lucene"
                database="observability"
                table="logs"
                queryState={{
                    status: 'success',
                    rowCount: 3,
                    auxiliaryErrors: [{
                        source: 'histogram',
                        summary: 'histogram failed',
                        message: 'timeout',
                        likelyCause: 'Narrow the time range.',
                    }],
                }}
            />,
        );

        expect(screen.getByText('Partial query failure')).toBeInTheDocument();
        expect(screen.getByText('histogram failed')).toBeInTheDocument();
    });
});
