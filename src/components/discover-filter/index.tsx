import React, { useRef, useState } from 'react';
import { DiscoverFilterWrapper } from './discover-filter.style';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { FilterContent } from './filter-content';
import { dataFilterAtom, locationAtom } from 'store/discover';
import { getFilterSQL } from 'utils/data';
import { css } from '@emotion/css';
import { Badge, Icon, IconButton, Toggletip, useTheme2 } from '@grafana/ui';
// import { set } from 'lodash-es';

export default function DiscoverFilter() {
    const [dataFilter, setDataFilter] = useAtom(dataFilterAtom);
    const [open, setOpen] = useState<boolean>(false);
    const [dataFilterOpen, setDataFilterOpen] = useState<any>({});
    const discoverFilterRef = useRef(null);
    const { t } = useTranslation();
    const [_loc, setLoc] = useAtom(locationAtom);
    const theme = useTheme2();

    return (
        //  className="mt-px rounded-b-sm bg-n8 p-4 pb-6"
        <DiscoverFilterWrapper
            ref={discoverFilterRef}
            className={css`
                background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                padding: 1rem;
                padding-bottom: 1.5rem;
                margin-top: 1px;
                border-radius: 0 0 0.25rem 0.25rem;
            `}
        >
            <div className="text-xs font-medium">{t`Filter`}</div>
            <div className="filter-tag">
                {dataFilter.map((dataFilterValue, index) => {
                    return (
                        <div
                            key={index.toString()}
                            className={css`
                                margin: '0 4px';
                            `}
                        >
                            <Toggletip
                                show={dataFilterOpen[dataFilterValue.id]}
                                onOpen={() => {
                                    setDataFilterOpen({
                                        ...dataFilterOpen,
                                        [dataFilterValue.id]: true,
                                    });
                                }}
                                onClose={() => {
                                    setDataFilterOpen({
                                        ...dataFilterOpen,
                                        [dataFilterValue.id]: false,
                                    });
                                }}
                                closeButton={true}
                                content={
                                    <FilterContent
                                        onHide={() => {
                                            setDataFilterOpen({
                                                ...dataFilterOpen,
                                                [dataFilterValue.id]: false,
                                            });
                                        }}
                                        dataFilterValue={dataFilterValue}
                                    />
                                }
                                placement="bottom"
                            >
                                <div>
                                    <Badge
                                        // className="mx-1 rounded px-2 py-[2px] text-xs leading-[18px] text-n3 first:ml-2 hover:border-b7 group-data-[state=open]:border-b7 dark:hover:border-b3 dark:group-data-[state=open]:border-b3"
                                        key={index}
                                        text={
                                            <div
                                                className={css`
                                                    display: flex;
                                                    align-items: center;
                                                    justify-content: space-between;
                                                `}
                                            >
                                                <span>{dataFilterValue.label ? <span>{dataFilterValue.label}</span> : <span>{getFilterSQL(dataFilterValue)}</span>}</span>
                                                <div
                                                    className={css`
                                                        margin-left: 0.5rem;
                                                        cursor: pointer;
                                                    `}
                                                    onClick={() => {
                                                        const data_filters = dataFilter.filter(e => e !== dataFilterValue);
                                                        setDataFilter(data_filters);
                                                        setLoc(prev => {
                                                            const searchParams = prev.searchParams;
                                                            searchParams?.set('data_filters', JSON.stringify(data_filters));
                                                            return {
                                                                ...prev,
                                                                searchParams,
                                                            };
                                                        });
                                                    }}
                                                >
                                                    <Icon name="times" />
                                                </div>
                                            </div>
                                        }
                                        color="blue"
                                    ></Badge>
                                </div>
                            </Toggletip>
                        </div>
                    );
                })}
                <Toggletip
                    show={open}
                    closeButton={false}
                    onOpen={() => {
                        setOpen(true);
                    }}
                    content={
                        <FilterContent
                            onHide={() => {
                                console.log('onHide');
                                setOpen(false);
                            }}
                        />
                    }
                    placement="bottom"
                >
                    <IconButton name="plus" tooltip="Add filter" style={{marginLeft: 10}} />
                </Toggletip>
            </div>
        </DiscoverFilterWrapper>
    );
}
