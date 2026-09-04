import { css } from '@emotion/css';
import { IconButton, useTheme2 } from '@grafana/ui';
import React, { useMemo, useState } from 'react';
import { formatFieldDisplayValue, parseJsonLikeValue } from 'utils/data';

type VariantValueViewerProps = {
    value: unknown;
    className?: string;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isStructuredJsonValue(value: unknown): value is JsonValue[] | { [key: string]: JsonValue } {
    return Array.isArray(value) || (typeof value === 'object' && value !== null);
}

function getNodeSummary(value: JsonValue[] | { [key: string]: JsonValue }) {
    return Array.isArray(value) ? `Array (${value.length})` : `Object (${Object.keys(value).length})`;
}

function VariantTreeNode({
    value,
    name,
    initiallyExpanded,
    initiallyExpandChildren,
    depth = 0,
}: {
    value: JsonValue;
    name?: string;
    initiallyExpanded?: boolean;
    initiallyExpandChildren?: boolean;
    depth?: number;
}) {
    const theme = useTheme2();
    const [expanded, setExpanded] = useState(initiallyExpanded ?? false);
    const structured = isStructuredJsonValue(value);
    const textColor = theme.isDark ? '#9cdcfe' : 'hsla(223, 98%, 58%, 1)';
    const keyColor = theme.isDark ? 'rgb(123, 225, 136)' : 'hsla(134, 100%, 35%, 1)';

    if (!structured) {
        return (
            <div
                className={css`
                    padding-left: ${depth * 16}px;
                    line-height: 1.6;
                    font-family: monospace;
                    font-size: 12px;
                    word-break: break-word;
                `}
            >
                {name !== undefined && <span style={{ color: keyColor }}>{name}: </span>}
                <span style={{ color: textColor }}>{formatFieldDisplayValue(value, 'compact')}</span>
            </div>
        );
    }

    const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
    return (
        <div
            className={css`
                font-family: monospace;
                font-size: 12px;
                line-height: 1.6;
            `}
        >
            <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(current => !current)}
                className={css`
                    padding-left: ${depth * 16}px;
                    border: 0;
                    background: transparent;
                    color: inherit;
                    cursor: pointer;
                    font: inherit;
                    line-height: 1.6;
                `}
            >
                <span aria-hidden="true">{expanded ? '▾' : '▸'} </span>
                {name !== undefined && <span style={{ color: keyColor }}>{name}: </span>}
                <span style={{ color: textColor }}>{getNodeSummary(value)}</span>
            </button>
            {expanded ? (
                <div
                    className={css`
                        margin-top: 6px;
                    `}
                >
                    {entries.map(([key, item]) => (
                        <VariantTreeNode
                            key={key}
                            name={key}
                            value={item}
                            initiallyExpanded={initiallyExpandChildren}
                            initiallyExpandChildren={initiallyExpandChildren}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** Displays parsed Doris VARIANT values without adding a second React runtime to Grafana. */
export function VariantValueViewer({ value, className }: VariantValueViewerProps) {
    const theme = useTheme2();
    const [allExpanded, setAllExpanded] = useState(false);
    const parsedValue = useMemo(() => parseJsonLikeValue(value), [value]);

    if (!isStructuredJsonValue(parsedValue)) {
        return <span className={className}>{formatFieldDisplayValue(parsedValue, 'compact')}</span>;
    }

    return (
        <div
            className={className}
            data-testid="variant-value-viewer"
            style={{ position: 'relative', minHeight: 40 }}
        >
            <div
                className={css`
                    position: absolute;
                    top: 4px;
                    right: 12px;
                    z-index: 1;
                `}
            >
                <IconButton
                    name={allExpanded ? 'angle-double-up' : 'angle-double-down'}
                    size="md"
                    tooltip={allExpanded ? '收起全部' : '展开全部'}
                    aria-label={allExpanded ? '收起全部 VARIANT 字段' : '展开全部 VARIANT 字段'}
                    onClick={() => setAllExpanded(current => !current)}
                />
            </div>
            <div
                className={css`
                    width: 100%;
                    max-height: 320px;
                    overflow: auto;
                    word-break: break-word;
                    color: ${theme.isDark ? '#d4d4d4' : 'hsla(240, 5%, 26%, 1)'};
                    background: ${theme.isDark ? '#1e1e1e' : 'hsla(215, 100%, 95%, 0.2)'};
                    border-radius: 4px;
                    padding: 8px;
                    padding-right: 44px;
                `}
            >
                <VariantTreeNode
                    key={allExpanded ? 'all-expanded' : 'root-expanded'}
                    name="VARIANT"
                    value={parsedValue}
                    initiallyExpanded
                    initiallyExpandChildren={allExpanded}
                />
            </div>
        </div>
    );
}
