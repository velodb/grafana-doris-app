jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { language: 'en-US' } } } }));
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import FieldItem from './field-item';

jest.mock('@grafana/ui', () => ({
    IconButton: ({ name, tooltip, ...props }: any) => <button aria-label={tooltip} data-icon={name} {...props} />,
    Tooltip: ({ children, content, show }: any) => <>{children}{show ? content : null}</>,
    useTheme2: () => ({ colors: { background: { secondary: '#222' }, text: { primary: '#fff', secondary: '#aaa' } } }),
}));

jest.mock('./top-data/top-data', () => ({
    TopData: ({ field, onFieldStatistics, canShowStatistics }: any) => <div data-testid="field-top-data">
        {field.Field}
        {canShowStatistics && <button onClick={() => onFieldStatistics(field)}>Field statistics</button>}
    </div>,
}));

jest.mock('utils/icon', () => ({
    getFieldIcon: (type: string) => <span data-testid={`field-icon-${type}`} />,
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

    it('keeps a zero-leaf VARIANT parent expandable and explains the empty state', () => {
        render(<FieldItem type="add" field={{ Field: 'log_attributes', Type: 'VARIANT', children: [], leafCount: 0 }} />);

        expect(screen.getByText('0')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(screen.getByText('No discoverable nested fields')).toBeInTheDocument();
    });
});

describe('Discover field statistics entry point', () => {
    const leafField = { Field: 'service_name', Type: 'VARCHAR' };

    it('opens field statistics from the hover card, closes the card, and does not add the field', () => {
        jest.useFakeTimers();
        const onFieldStatistics = jest.fn();
        const onAdd = jest.fn();
        render(<FieldItem type="add" field={leafField} onFieldStatistics={onFieldStatistics} onAdd={onAdd} />);
        expect(screen.queryByRole('button', { name: 'Field statistics' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Field statistics' })).not.toBeInTheDocument();
        fireEvent.pointerEnter(screen.getByTestId('field-item-row'));
        act(() => { jest.advanceTimersByTime(200); });
        fireEvent.click(screen.getByRole('button', { name: 'Field statistics' }));
        expect(onFieldStatistics).toHaveBeenCalledWith(leafField);
        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.queryByTestId('field-top-data')).not.toBeInTheDocument();
        jest.useRealTimers();
    });

    it('shows the field distribution popover after a short hover', () => {
        jest.useFakeTimers();
        render(<FieldItem type="add" field={leafField} />);
        fireEvent.pointerEnter(screen.getByTestId('field-item-row'));
        act(() => { jest.advanceTimersByTime(200); });
        expect(screen.getByTestId('field-top-data')).toHaveTextContent('service_name');
        jest.useRealTimers();
    });
});
