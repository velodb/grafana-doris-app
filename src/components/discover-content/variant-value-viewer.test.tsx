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

        expect(screen.getByRole('button', { name: '展开全部 VARIANT 字段' })).toHaveAttribute('title', '展开全部');
        expect(screen.getByRole('button', { name: /VARIANT: Object \(2\)/ })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('service:')).toBeInTheDocument();
        expect(screen.queryByText('name:')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '展开全部 VARIANT 字段' }));
        expect(screen.getByText('name:')).toBeInTheDocument();

        expect(screen.getByRole('button', { name: '收起全部 VARIANT 字段' })).toHaveAttribute('title', '收起全部');
        fireEvent.click(screen.getByRole('button', { name: '收起全部 VARIANT 字段' }));
        expect(screen.queryByText('name:')).not.toBeInTheDocument();
    });

    it('falls back to safe compact text for scalar and invalid JSON values', () => {
        const { rerender } = render(<VariantValueViewer value="not json" />);
        expect(screen.getByText('not json')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '格式化 VARIANT 字段' })).not.toBeInTheDocument();

        rerender(<VariantValueViewer value={null} />);
        expect(screen.getByText('-')).toBeInTheDocument();
    });
});
