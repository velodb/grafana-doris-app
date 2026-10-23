import { enrichStructuredFilterTypes, getFilterSQL, transformFieldPath } from '../sql-filter';

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

    it('extracts and casts JSON child fields before comparison', () => {
        expect(getFilterSQL({
            id: 'cached',
            fieldName: 'log_attributes.cached',
            variantPath: ['log_attributes', 'cached'],
            variantRootType: 'JSON',
            fieldType: 'BOOLEAN',
            operator: '=',
            value: [false],
        })).toBe("CAST(JSON_EXTRACT(`log_attributes`, '$.\"cached\"') AS BOOLEAN) = false");
    });

    it('keeps dotted JSON keys as one JSON-path member', () => {
        expect(getFilterSQL({
            id: 'route',
            fieldName: 'log_attributes.http.route',
            variantPath: ['log_attributes', 'http.route'],
            variantRootType: 'JSON',
            fieldType: 'VARCHAR',
            operator: '=',
            value: ['/checkout'],
        })).toBe("CAST(JSON_EXTRACT(`log_attributes`, '$.\"http.route\"') AS STRING) = '/checkout'");
    });

    it('enriches legacy stored JSON filters with their root type', () => {
        const [filter] = enrichStructuredFilterTypes([{
            id: 'cached',
            fieldName: 'log_attributes.cached',
            variantPath: ['log_attributes', 'cached'],
            operator: '=',
            value: [true],
        }], [
            { Field: 'log_attributes', Type: 'JSON' },
            { Field: 'log_attributes.cached', Type: 'BOOLEAN' },
        ]);

        expect(getFilterSQL(filter)).toBe("CAST(JSON_EXTRACT(`log_attributes`, '$.\"cached\"') AS BOOLEAN) = true");
    });
});
