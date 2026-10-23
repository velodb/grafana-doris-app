import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { dataFilterAtom, tableTotalCountAtom, topDataAtom, topNConfigAtom, topNEnabledAtom, topNResultFieldsAtom, topNRowsAtom } from 'store/discover';
import { TopData } from './top-data';

jest.mock('@grafana/ui', () => ({
    ...jest.requireActual('@grafana/ui'),
    IconButton: ({ tooltip, name, ...props }: any) => <button aria-label={tooltip} {...props} />,
}));

const field = { Field: 'service_name', Type: 'VARCHAR' };

function setup(store = createStore(), props = {}) {
    return render(
        <Provider store={store}>
            <TopData field={field} canShowStatistics {...props} />
        </Provider>,
    );
}

it('separates the returned sample from all matches and uses the sample size for its percentages', () => {
    const store = createStore();
    store.set(topDataAtom, [...Array.from({ length: 300 }, () => ({ service_name: 'api' })), ...Array.from({ length: 200 }, () => ({ service_name: 'worker' }))]);
    store.set(tableTotalCountAtom, 20000);
    const onFieldStatistics = jest.fn();
    const onTopN = jest.fn();
    setup(store, { onFieldStatistics, onTopN });

    const sample = within(screen.getByRole('region', { name: 'Current query results' }));
    expect(sample.getByText('500 samples')).toBeInTheDocument();
    expect(sample.getByText('60%')).toBeInTheDocument();
    expect(sample.getByText('40%')).toBeInTheDocument();
    expect(sample.queryByRole('button', { name: 'Field statistics' })).not.toBeInTheDocument();

    const allMatches = within(screen.getByRole('region', { name: 'All matching data' }));
    expect(allMatches.getByText('20,000 matching records')).toBeInTheDocument();
    fireEvent.click(allMatches.getByRole('button', { name: 'Field statistics' }));
    expect(onFieldStatistics).toHaveBeenCalledWith(field);
    fireEvent.click(allMatches.getByRole('button', { name: 'Top N configuration' }));
    expect(onTopN).toHaveBeenCalledWith(field);
});

it('keeps the query sample visible without displaying sidebar aggregation results in the hover card', () => {
    const store = createStore();
    store.set(topDataAtom, [{ service_name: 'api' }]);
    store.set(tableTotalCountAtom, 1000);
    store.set(topNEnabledAtom, true);
    store.set(topNConfigAtom, { groupField: 'service_name', metric: 'COUNT', metricField: '', direction: 'DESC', limit: 5 });
    store.set(topNResultFieldsAtom, [{ Field: '__top_n_value', Type: 'BIGINT' }]);
    store.set(topNRowsAtom, [{ service_name: 'api', __top_n_value: 650 }]);
    setup(store);

    expect(within(screen.getByRole('region', { name: 'Current query results' })).getByText('100%')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'All matching data' })).queryByText('65%')).not.toBeInTheDocument();
});

it('counts nested values correctly, skips missing keys, and preserves the nested filter metadata', () => {
    const store = createStore();
    const nestedField = { Field: 'attributes.status', Type: 'BIGINT', variantPath: ['attributes', 'status'], variantRootType: 'VARIANT' };
    store.set(topDataAtom, [{ attributes: { status: 200 } }, { attributes: {} }, { attributes: { status: null } }]);
    setup(store, { field: nestedField, canRunTopN: false });

    const sample = within(screen.getByRole('region', { name: 'Current query results' }));
    expect(sample.getByText('3 samples')).toBeInTheDocument();
    expect(sample.getByText('33.3%')).toBeInTheDocument();
    expect(sample.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(sample.getByRole('button', { name: 'Include value' }));
    expect(store.get(dataFilterAtom)).toEqual([
        expect.objectContaining({ fieldName: 'attributes.status', variantPath: ['attributes', 'status'], variantRootType: 'VARIANT', operator: '=', value: [200] }),
    ]);
});

it('shows an empty sample without changing into an aggregation mode', () => {
    const store = createStore();
    store.set(topNEnabledAtom, true);
    setup(store);
    expect(within(screen.getByRole('region', { name: 'Current query results' })).getByText('No non-null field values')).toBeInTheDocument();
    expect(screen.queryByText('NaN%')).not.toBeInTheDocument();
});
