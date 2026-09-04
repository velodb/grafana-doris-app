import { get } from 'lodash-es';
import { isVariantType } from './data';

export type VariantPath = string[];

export type VariantField = {
    Field: string;
    value: string;
    label: string;
    Type: string;
    variantPath?: VariantPath;
    variantParent?: string;
    children?: VariantField[];
    leafCount?: number;
};

type Leaf = {
    path: VariantPath;
    values: unknown[];
};

function typeForValues(values: unknown[]): string {
    const concrete = values.filter(value => value !== null && value !== undefined);
    if (concrete.length === 0) {
        return 'VARIANT';
    }
    if (concrete.every(value => typeof value === 'string')) {
        return 'VARCHAR';
    }
    if (concrete.every(value => typeof value === 'number')) {
        return 'DOUBLE';
    }
    if (concrete.every(value => typeof value === 'boolean')) {
        return 'BOOLEAN';
    }
    if (concrete.every(value => Array.isArray(value))) {
        return 'ARRAY';
    }
    return 'VARIANT';
}

function buildLeafField(leaf: Leaf, root: string): VariantField {
    const fieldName = leaf.path.join('.');
    return {
        Field: fieldName,
        value: fieldName,
        // Sidebar has a single expansion level: show the full path under the
        // VARIANT root instead of exposing intermediate object nodes.
        label: leaf.path.slice(1).join('.'),
        Type: typeForValues(leaf.values),
        variantPath: leaf.path,
        variantParent: root,
    };
}

/**
 * Derives one parent node per VARIANT and a flat list of leaves below it. Paths
 * remain arrays because telemetry attribute names commonly contain literal dots.
 */
export function deriveVariantFields(tableFields: any[], rows: Array<Record<string, unknown>>): VariantField[] {
    return tableFields
        .filter(field => isVariantType(field?.Type || ''))
        .map(field => {
            const root = String(field.Field);
            const leaves = new Map<string, Leaf>();

            rows.forEach(row => {
                const value = row[root];
                collectLeaves(value, [root], leaves);
            });

            const children = Array.from(leaves.values()).map(leaf => buildLeafField(leaf, root));

            return {
                ...field,
                Field: root,
                value: root,
                label: root,
                children,
                leafCount: children.length,
            } as VariantField;
        });
}

function collectLeaves(value: unknown, path: VariantPath, leaves: Map<string, Leaf>) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.entries(value as Record<string, unknown>).forEach(([key, childValue]) => collectLeaves(childValue, [...path, key], leaves));
        return;
    }
    if (path.length === 1) return;
    const key = JSON.stringify(path);
    const leaf = leaves.get(key) || { path, values: [] };
    leaf.values.push(value);
    leaves.set(key, leaf);
}

export function getVariantFieldValue(row: Record<string, unknown>, field: Pick<VariantField, 'Field' | 'variantPath'>) {
    return get(row, field.variantPath || field.Field);
}

export function flattenVariantLeaves(fields: VariantField[]): VariantField[] {
    const leaves: VariantField[] = [];
    const visit = (field: VariantField) => {
        if (field.children?.length) {
            field.children.forEach(visit);
        } else if (field.variantPath) {
            leaves.push(field);
        }
    };
    fields.forEach(field => field.children?.forEach(visit));
    return leaves;
}
