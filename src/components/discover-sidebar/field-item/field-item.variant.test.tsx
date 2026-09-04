import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FieldItem from './field-item';

jest.mock('@grafana/ui', () => ({
    IconButton: ({ name, tooltip, ...props }: any) => <button aria-label={tooltip} data-icon={name} {...props} />,
    Tooltip: ({ children }: any) => <>{children}</>,
    useTheme2: () => ({ colors: { background: { secondary: '#222' }, text: { primary: '#fff', secondary: '#aaa' } } }),
}));

jest.mock('utils/icon', () => ({
    getFieldIcon: (type: string) => <span data-testid={`field-icon-${type}`} />,
}));

jest.mock('./top-data/top-data', () => ({
    TopData: () => <div />,
}));

describe('VARIANT sidebar field item', () => {
    const field = {
        Field: 'resource_attributes',
        Type: 'VARIANT',
        leafCount: 3,
        children: [
            { Field: 'resource_attributes.app', label: 'app', Type: 'VARCHAR', variantPath: ['resource_attributes', 'app'] },
            { Field: 'resource_attributes.k8s.namespace.name', label: 'k8s.namespace.name', Type: 'VARCHAR', variantPath: ['resource_attributes', 'k8s.namespace.name'] },
            { Field: 'resource_attributes.nested.retries', label: 'nested.retries', Type: 'DOUBLE', variantPath: ['resource_attributes', 'nested', 'retries'] },
        ],
    };

    it('keeps the parent collapsed by default and renders a single flat leaf list when expanded', () => {
        render(<FieldItem type="add" field={field} />);

        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.queryByText('k8s.namespace.name')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

        expect(screen.getByText('app')).toBeInTheDocument();
        expect(screen.getByText('k8s.namespace.name')).toBeInTheDocument();
        expect(screen.getByText('nested.retries')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    });

    it('automatically opens a matching VARIANT parent during sidebar search', () => {
        render(<FieldItem type="add" field={field} searchActive="namespace" />);

        expect(screen.getByText('k8s.namespace.name')).toBeInTheDocument();
        expect(screen.queryByText('app')).not.toBeInTheDocument();
    });
});
