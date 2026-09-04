import React, { useState } from 'react';
import { getFieldIcon } from 'utils/icon';
import { IconButton, useTheme2, Tooltip } from '@grafana/ui';
import { css } from '@emotion/css';
import { cn } from 'utils/tailwind';
import { TopData } from './top-data/top-data';

interface FieldItemProps {
    field: any;
    onAdd?: (field: any) => void;
    onRemove?: (field: any) => void;
    type: 'add' | 'remove';
    depth?: number;
    searchActive?: string;
    isSelected?: (field: any) => boolean;
    showChildren?: boolean;
}

function matches(field: any, query: string): boolean {
    if (!query) return true;
    const needle = query.toLowerCase();
    return String(field.Field || '').toLowerCase().includes(needle) || field.children?.some((child: any) => matches(child, query));
}

export default function FieldItem({ depth = 0, searchActive = '', showChildren = true, ...props }: FieldItemProps) {
    const theme = useTheme2();
    const { field } = props;
    const [expanded, setExpanded] = useState(false);
    const hasChildren = showChildren && Boolean(field.children?.length);
    const isExpanded = searchActive || expanded;
    const selected = props.isSelected?.(field) || false;

    if (searchActive && !matches(field, searchActive)) {
        return null;
    }

    const item = (
        <div>
            <div
                className={css`
                    width: 100%; text-align: left; display: flex; align-items: center;
                    justify-content: space-between; height: 32px;
                    padding: 0 8px 0 ${8 + depth * 16}px;
                    &:hover .icon-wrapper { opacity: 1; }
                    &:hover { background-color: ${theme.colors.background.secondary}; }
                `}
            >
                <div className="flex min-w-0 items-center">
                    {hasChildren ? <IconButton name={isExpanded ? 'angle-down' : 'angle-right'} size="sm" tooltip={isExpanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded(value => !value)} /> : depth > 0 ? <span className="w-6" /> : null}
                    <div>{getFieldIcon(field.Type)}</div>
                    <div className={css`display:flex; margin-left:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:${depth ? 170 : 150}px;`}>
                        {depth ? field.label || field.Field : field.Field}
                    </div>
                </div>
                {hasChildren ? <span className={css`margin-left:8px; color:${theme.colors.text.secondary}; font-size:12px;`}>{field.leafCount || 0}</span> : null}
                {!selected && <div className={cn('icon-wrapper', css`opacity:0; transition:opacity .2s; margin-left:auto; display:flex; align-items:center; color:${theme.colors.text.secondary}; &:hover { color:${theme.colors.text.primary}; }`)}>
                    {props.type === 'add' ? <IconButton name="plus" tooltip="Add to table" onClick={e => { props.onAdd?.(field); e.stopPropagation(); }} /> : <IconButton name="minus" tooltip="Delete from table" onClick={e => { props.onRemove?.(field); e.stopPropagation(); }} />}
                </div>
                }
            </div>
        </div>
    );

    return (
        <div>
            {hasChildren || props.type === 'remove' ? item : <Tooltip placement="right" interactive content={<TopData field={field} />}>{item}</Tooltip>}
            {hasChildren && isExpanded && field.children.map((child: any) => (
                <FieldItem
                    key={child.variantPath?.join('\u0000') || child.Field}
                    {...props}
                    field={child}
                    depth={depth + 1}
                    searchActive={searchActive}
                />
            ))}
        </div>
    );
}
