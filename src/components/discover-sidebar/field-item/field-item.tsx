import { t } from 'i18n';
import React, { useEffect, useRef, useState } from 'react';
import { getFieldIcon } from 'utils/icon';
import { IconButton, Tooltip, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { cn } from 'utils/tailwind';
import { isStructuredJsonType } from 'utils/data';
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
    onFieldStatistics?: (field: any) => void;
    onTopN?: (field: any) => void;
}

function matches(field: any, query: string): boolean {
    if (!query) {
        return true;
    }
    const needle = query.toLowerCase();
    return String(field.Field || '').toLowerCase().includes(needle) || field.children?.some((child: any) => matches(child, query));
}

export default function FieldItem({ depth = 0, searchActive = '', showChildren = true, ...props }: FieldItemProps) {
    const theme = useTheme2();
    const { field } = props;
    const [expanded, setExpanded] = useState(false);
    const [topDataVisible, setTopDataVisible] = useState(false);
    const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hasChildren = showChildren && (Boolean(field.children?.length) || (depth === 0 && isStructuredJsonType(field.Type)));
    const isExpanded = searchActive || expanded;
    const selected = props.isSelected?.(field) || false;
    const canShowStatistics = props.type === 'add' && !hasChildren && !isStructuredJsonType(field.Type);
    const showTopData = !hasChildren && props.type === 'add';
    const canRunTopN = showTopData && !isStructuredJsonType(field.Type) && !field.variantPath?.length;

    const clearTimer = (timer: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>) => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = undefined;
        }
    };
    const scheduleHide = () => {
        clearTimer(showTimer);
        clearTimer(hideTimer);
        hideTimer.current = setTimeout(() => {
            setTopDataVisible(false);
            hideTimer.current = undefined;
        }, 250);
    };
    const enterTopDataRegion = () => {
        clearTimer(hideTimer);
        if (!topDataVisible && !showTimer.current) {
            showTimer.current = setTimeout(() => {
                setTopDataVisible(true);
                showTimer.current = undefined;
            }, 200);
        }
    };

    useEffect(() => () => {
        clearTimer(showTimer);
        clearTimer(hideTimer);
    }, []);

    if (searchActive && !matches(field, searchActive)) {
        return null;
    }

    const item = (
        <div>
            <div
                data-testid="field-item-row"
                onPointerEnter={showTopData ? enterTopDataRegion : undefined}
                onPointerLeave={showTopData ? scheduleHide : undefined}
                className={css`
                    width: 100%; text-align: left; display: flex; align-items: center;
                    justify-content: space-between; height: 32px;
                    padding: 0 8px 0 ${8 + depth * 16}px;
                    &:hover { background-color: ${theme.colors.background.secondary}; }
                `}
            >
                <div className="flex min-w-0 items-center">
                    {hasChildren ? <IconButton name={isExpanded ? 'angle-down' : 'angle-right'} size="sm" tooltip={isExpanded ? t('Collapse') : t('Expand')} onClick={() => setExpanded(value => !value)} /> : depth > 0 ? <span className="w-6" /> : null}
                    <div>{getFieldIcon(field.Type)}</div>
                    <div className={css`display:flex; margin-left:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:${depth ? 170 : 150}px;`}>
                        {depth ? field.label || field.Field : field.Field}
                    </div>
                </div>
                {hasChildren ? <span className={css`margin-left:8px; color:${theme.colors.text.secondary}; font-size:12px;`}>{field.leafCount || 0}</span> : null}
                {!selected && <div className={cn('icon-wrapper', css`margin-left:auto; display:flex; align-items:center; color:${theme.colors.text.secondary}; &:hover { color:${theme.colors.text.primary}; }`)}>
                    {props.type === 'add' ? <>
                        <IconButton name="plus" tooltip={t('Add to table')} onClick={e => { props.onAdd?.(field); e.stopPropagation(); }} />
                    </> : <IconButton name="minus" tooltip={t('Delete from table')} onClick={e => { props.onRemove?.(field); e.stopPropagation(); }} />}
                </div>
                }
            </div>
        </div>
    );

    return (
        <div>
            {showTopData ? (
                <Tooltip
                    show={topDataVisible}
                    placement="right"
                    interactive
                    content={<TopData
                        field={field}
                        onTopN={(selectedField: any) => {
                            clearTimer(showTimer);
                            clearTimer(hideTimer);
                            setTopDataVisible(false);
                            props.onTopN?.(selectedField);
                        }}
                        canRunTopN={canRunTopN}
                        canShowStatistics={canShowStatistics}
                        onFieldStatistics={(selectedField: any) => {
                            clearTimer(showTimer);
                            clearTimer(hideTimer);
                            setTopDataVisible(false);
                            props.onFieldStatistics?.(selectedField);
                        }}
                        onPointerEnter={enterTopDataRegion}
                        onPointerLeave={scheduleHide}
                    />}
                >
                    {item}
                </Tooltip>
            ) : item}
            {hasChildren && isExpanded && (field.children?.length ? field.children.map((child: any) => (
                <FieldItem
                    key={child.variantPath?.join('\u0000') || child.Field}
                    {...props}
                    field={child}
                    depth={depth + 1}
                    searchActive={searchActive}
                />
            )) : (
                <div
                    className={css`
                        padding: 4px 8px 8px 48px;
                        color: ${theme.colors.text.secondary};
                        font-size: 12px;
                    `}
                >
                    {t('No discoverable nested fields')}
                </div>
            ))}
        </div>
    );
}
