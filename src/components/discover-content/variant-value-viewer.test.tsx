jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { language: 'en-US' } } } }));
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { VariantValueViewer } from './variant-value-viewer';

jest.mock('@grafana/ui', () => ({
    IconButton: ({ tooltip, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip: string }) => (
        <button title={tooltip} {...props} />
    ),
    useTheme2: () => ({ isDark: true }),
}));

describe('VariantValueViewer', () => {
    it('expands the JSON root by default while keeping nested VARIANT objects collapsed', () => {
        render(<VariantValueViewer value={'{"service":{"name":"api"},"ok":true}'} />);

        expect(screen.getByRole('button', { name: 'Expand all VARIANT fields' })).toHaveAttribute('title', 'Expand all');
        expect(screen.getByRole('button', { name: /VARIANT: Object \(2\)/ })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('service:')).toBeInTheDocument();
        expect(screen.queryByText('name:')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Expand all VARIANT fields' }));
        expect(screen.getByText('name:')).toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Collapse all VARIANT fields' })).toHaveAttribute('title', 'Collapse all');
        fireEvent.click(screen.getByRole('button', { name: 'Collapse all VARIANT fields' }));
        expect(screen.queryByText('name:')).not.toBeInTheDocument();
    });

    it('falls back to safe compact text for scalar and invalid JSON values', () => {
        const { rerender } = render(<VariantValueViewer value="not json" />);
        expect(screen.getByText('not json')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '格式化 VARIANT 字段' })).not.toBeInTheDocument();

        rerender(<VariantValueViewer value={null} />);
        expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('uses the supplied root label for a full log-record JSON view', () => {
        render(<VariantValueViewer value={{ log_attributes: { source: 'nginx' } }} rootName="JSON" />);

        expect(screen.getByRole('button', { name: /JSON: Object \(1\)/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Expand all JSON fields' })).toBeInTheDocument();
    });
});
