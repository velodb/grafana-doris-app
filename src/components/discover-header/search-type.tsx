import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import React from 'react';
import { currentIndexAtom, disabledOptionsAtom, indexesAtom, searchTypeAtom, searchValueAtom, selectedIndexesAtom } from 'store/discover';
import { useTheme2, ActionMeta, Icon, MultiSelect, RadioButtonGroup, Toggletip } from '@grafana/ui';
import { css } from '@emotion/css';
import { SelectableValue } from '@grafana/data';
import { useTranslation } from 'react-i18next';

export default function SearchType() {
    const { t } = useTranslation();
    const [searchType, setSearchType] = useAtom(searchTypeAtom);
    const setSearchValue = useSetAtom(searchValueAtom);
    const disabledOptions = useAtomValue(disabledOptionsAtom);
    const indexes = useAtomValue(indexesAtom);
    const setSelectedIndexes = useSetAtom(selectedIndexesAtom);
    const [currentIndex, setCurrentIndex] = useAtom(currentIndexAtom);
    const searchMode = searchType === 'Search';
    const theme = useTheme2();
       
    const options = [
        {
            label: t`Search`,
            value: 'Search',
            disabled: indexes.length === 0,
            tips: t`Discover.SearchType.Search.DisabledText`,
        },
        { label: 'SQL', value: 'SQL' },
        { label: 'Lucene', value: 'Lucene' },
    ];

    function DropdownQueryType() {
        return (
            <div className="w-[232px]">
                <RadioButtonGroup
                    options={options}
                    disabledOptions={disabledOptions}
                    value={searchType}
                    onChange={val => {
                        setSearchType(val as 'Search' | 'SQL' | 'Lucene');
                        setSearchValue('');
                    }}
                />
                {indexes && searchMode ? (
                    <div className="mt-4">
                        <MultiSelect
                            options={indexes.filter((item: any) => item.type === 'INVERTED')}
                            value={currentIndex}
                            onChange={(item: Array<SelectableValue<any>>, actionMeta: ActionMeta) => {
                                const selectedIndexes: any[] = [];
                                item.forEach(selectedValue => {
                                    indexes.forEach((item: any) => {
                                        if (item.value === selectedValue) {
                                            selectedIndexes.push(item);
                                        }
                                    });
                                });
                                setSelectedIndexes(selectedIndexes);
                                setCurrentIndex(item as any);
                            }}
                        />
                    </div>
                ) : (
                    <></>
                )}
            </div>
        );
    }
    return (
        <>
            <Toggletip closeButton={false} content={<DropdownQueryType />} placement="bottom">
                <div
                    className={css`
                        cursor: pointer;
                        border: 1px solid rgba(204, 204, 220, 0.2);
                        width: 80px;
                        height: 32px;
                        line-height: 32px;
                        background-color: ${theme.isDark ? 'rgb(17, 18, 23)' : '#FFF'};
                        padding-left: 8px;
                        border-radius: 2px;
                        display: flex;
                        justify-content: space-between;
                    `}
                >
                    <span >{searchType}</span>
                    <span style={{ marginRight: 6 }}>
                        <Icon name="angle-down" />
                    </span>
                </div>
            </Toggletip>
        </>
    );
}
