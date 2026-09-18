import { get } from 'lodash-es';
import { isStructuredJsonType } from './data';

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
        .filter(field => isStructuredJsonType(field?.Type || ''))
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

export function deriveVariantFieldsFromMetadata(tableFields: any[], metadataFields: any[]): VariantField[] {
    return tableFields.filter(field => isStructuredJsonType(field?.Type || '')).map(rootField => {
        const root = String(rootField.Field);
        const children = metadataFields.map(field => metadataFieldToLeaf(root, field)).filter((field): field is VariantField => Boolean(field));
        return { ...rootField, Field: root, value: root, label: root, children, leafCount: children.length } as VariantField;
    });
}

function metadataFieldToLeaf(root: string, field: any): VariantField | undefined {
    const name = String(field?.Field ?? field?.field ?? field?.name ?? '');
    if (!name || name === root || !name.startsWith(root)) return undefined;
    const suffix = name.slice(root.length);
    if (!suffix.startsWith('.') && !suffix.startsWith('[')) return undefined;
    const path = [root, ...parseMetadataPath(suffix)];
    if (path.length === 1) return undefined;
    return { Field: path.join('.'), value: path.join('.'), label: path.slice(1).join('.'), Type: String(field?.Type ?? field?.type ?? 'VARIANT'), variantPath: path, variantParent: root };
}

function parseMetadataPath(suffix: string): string[] {
    const path: string[] = [];
    const segment = /(?:\.([^.[\]]+)|\[['"]([^'"]+)['"]\])/g;
    let match: RegExpExecArray | null;
    while ((match = segment.exec(suffix))) path.push(match[1] ?? match[2]);
    return path;
}

export function mergeVariantFields(metadata: VariantField[], sampled: VariantField[]): VariantField[] {
    const sampledByRoot = new Map(sampled.map(field => [field.Field, field]));
    const metadataByRoot = new Map(metadata.map(field => [field.Field, field]));
    const roots = new Set([...metadataByRoot.keys(), ...sampledByRoot.keys()]);
    return Array.from(roots).map(root => {
        const metadataRoot = metadataByRoot.get(root);
        const sampleRoot = sampledByRoot.get(root);
        const base = metadataRoot || sampleRoot!;
        const childrenByPath = new Map<string, VariantField>();
        (metadataRoot?.children || []).forEach(child => childrenByPath.set(JSON.stringify(child.variantPath || [child.Field]), child));
        (sampleRoot?.children || []).forEach(child => {
            const path = JSON.stringify(child.variantPath || [child.Field]);
            if (!childrenByPath.has(path)) {
                childrenByPath.set(path, child);
            }
        });
        const children = Array.from(childrenByPath.values());
        return { ...base, children, leafCount: children.length };
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
