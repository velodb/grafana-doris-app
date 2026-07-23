import { DataFilterType } from 'types/type';
import {
    APPLICATION_FILTER_ID,
    applyApplicationFilter,
    getCommittedApplication,
    getConfiguredApplicationAttributeKey,
} from './application-filter';

const existingFilter: DataFilterType = {
    id: 'severity-filter',
    fieldName: 'severity_text',
    operator: '=',
    value: ['ERROR'],
};

describe('application filter', () => {
    it('is disabled when the application attribute key is not explicitly configured', () => {
        expect(getConfiguredApplicationAttributeKey()).toBe('');
        expect(getConfiguredApplicationAttributeKey('   ')).toBe('');
    });

    it('uses the trimmed explicitly configured application attribute key', () => {
        expect(getConfiguredApplicationAttributeKey('  k8s.pod.label.app  ')).toBe('k8s.pod.label.app');
    });

    it('adds an application filter without changing existing filters', () => {
        const result = applyApplicationFilter([existingFilter], 'app1', 'app');

        expect(result.changed).toBe(true);
        expect(result.filters).toEqual([
            existingFilter,
            {
                id: APPLICATION_FILTER_ID,
                fieldName: 'resource_attributes',
                variantKey: 'app',
                operator: '=',
                value: ['app1'],
                label: 'Application: app1',
            },
        ]);
    });

    it('does not change filters when the draft is already committed', () => {
        const first = applyApplicationFilter([], 'app1', 'k8s.pod.label.app');
        const second = applyApplicationFilter(first.filters, 'app1', 'k8s.pod.label.app');

        expect(second.changed).toBe(false);
        expect(second.filters).toBe(first.filters);
        expect(getCommittedApplication(second.filters, 'k8s.pod.label.app')).toBe('app1');
    });

    it('clears only the application filter', () => {
        const withApplication = applyApplicationFilter([existingFilter], 'app1', 'app').filters;
        const result = applyApplicationFilter(withApplication, '', 'app');

        expect(result.changed).toBe(true);
        expect(result.filters).toEqual([existingFilter]);
    });
});
