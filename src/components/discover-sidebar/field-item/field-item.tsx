import React from 'react';
import { getFieldIcon } from 'utils/icon';
import { IconButton, Toggletip, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { cn } from 'utils/tailwind';
import { TopData } from './top-data/top-data';

interface FieldItemProps {
    field: any;
    onAdd?: (field: any) => void;
    onRemove?: (field: any) => void;
    type: 'add' | 'remove';
}

export default function FieldItem(props: FieldItemProps) {
    const theme = useTheme2();
    const { field } = props;
    field.key = field.Field;
    if (field.children) {
        field.icon = <div className="w-4 text-sm leading-8 text-n4">{}</div>;
        return (
            <div className="-ml-3 flex">
                Tree
                {/* <Tree showIcon className={`${TreeStyle} ${DiscoverTreeStyle}`} treeData={[field]} switcherIcon={<SDIcon type="icon-arrow-down" className="dark:text-n6" />} /> */}
            </div>
        );
    }
    return (
        <div>
            <Toggletip placement='right' content={<TopData field={field} />}>
                <div
                    className={css`
                        width: 100%;
                        text-align: left;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        height: 32px;
                        padding: 0 8px;
                        cursor: pointer;
                        &:hover .icon-wrapper {
                            opacity: 1;
                        }
                        &:hover {
                            background-color: ${theme.colors.background.secondary};
                        }
                    `}
                >
                    <div className="flex">
                        <div>{getFieldIcon(field['Type'])}</div>
                        <div
                            className={css`
                                display: flex;
                                margin-left: 4px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                                max-width: 130px;
                            `}
                        >
                            {field['Field']}
                        </div>
                    </div>
                    <div
                        className={cn(
                            'icon-wrapper',
                            css`
                                opacity: 0;
                                transition: opacity 0.2s;
                                margin-left: auto;
                                display: flex;
                                align-items: center;
                                color: ${theme.colors.text.secondary};
                                &:hover {
                                    color: ${theme.colors.text.primary};
                                }
                            `,
                        )}
                    >
                        {props.type === 'add' ? (
                            <IconButton
                                name="plus"
                                tooltip="Add to table"
                                onClick={e => {
                                    props?.onAdd?.(field);
                                    e.stopPropagation();
                                }}
                            />
                        ) : (
                            <IconButton
                                name="minus"
                                tooltip="Delete from table"
                                onClick={(e: any) => {
                                    props?.onRemove?.(field);
                                    e.stopPropagation();
                                }}
                            />
                        )}
                    </div>
                </div>
            </Toggletip>
        </div>
    );
}
