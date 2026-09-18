import { getFilterSQL, transformFieldPath } from '../sql-filter';

describe('SQL filters', () => {
    it('filters a simple resource attribute', () => {
        expect(
            getFilterSQL({
                id: 'app',
                fieldName: 'resource_attributes',
                variantKey: 'app',
                operator: '=',
                value: ['app1'],
            }),
        ).toBe("`resource_attributes`['app'] = 'app1'");
    });

    it('keeps dotted resource attribute keys intact', () => {
        expect(
            getFilterSQL({
                id: 'app',
                fieldName: 'resource_attributes',
                variantKey: 'k8s.pod.label.app',
                operator: '=',
                value: ['app1'],
            }),
        ).toBe("`resource_attributes`['k8s.pod.label.app'] = 'app1'");
    });

    it('escapes attribute keys, values, and identifiers', () => {
        expect(
            getFilterSQL({
                id: 'app',
                fieldName: 'resource`attributes',
                variantKey: "team'app",
                operator: '=',
                value: ["app\\'one"],
            }),
        ).toBe("`resource``attributes`['team''app'] = 'app\\\\''one'");
    });

    it('preserves existing dotted field-path behavior', () => {
        expect(transformFieldPath('resource_attributes.app')).toBe("`resource_attributes`['app']");
    });

    it('uses explicit path segments for literal dotted keys', () => {
        expect(transformFieldPath('resource_attributes.k8s.namespace.name', ['resource_attributes', 'k8s.namespace.name']))
            .toBe("`resource_attributes`['k8s.namespace.name']");
        expect(getFilterSQL({
            id: 'route',
            fieldName: 'resource_attributes.k8s.namespace.name',
            variantPath: ['resource_attributes', 'k8s.namespace.name'],
            operator: '=',
            value: ['shop'],
        })).toBe("`resource_attributes`['k8s.namespace.name'] = 'shop'");
    });
});
