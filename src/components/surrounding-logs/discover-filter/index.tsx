import { getFilterDisplayLabel } from 'components/discover-header/application-filter';
import { t } from 'i18n';
import React from 'react';
import { DiscoverFilterWrapper } from 'components/discover-filter/discover-filter.style';
import { useAtomValue } from 'jotai';
import { dataFilterAtom, tableFieldsAtom, variantFieldsAtom } from 'store/discover';
import { getFilterSQL } from 'utils/data';
import { enrichStructuredFilterTypes } from 'utils/sql-filter';
import { flattenVariantLeaves } from 'utils/variant-fields';
import { css } from '@emotion/css';
import { Badge, Checkbox, useTheme2 } from '@grafana/ui';

/** Optional, read-only projection of the main Discover filters. */
export default function SurroundingDiscoverFilter({ enabled, onEnabledChange }: {
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
}) {
    const dataFilter = useAtomValue(dataFilterAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const variantFields = useAtomValue(variantFieldsAtom);
    const theme = useTheme2();

    return (
        <DiscoverFilterWrapper
            className={css`
                background-color: ${theme.isDark ? 'rgb(24, 27, 31)' : '#FFF'};
                padding: 1rem;
                padding-bottom: 1.5rem;
                margin-top: 1px;
                border-radius: 0 0 0.25rem 0.25rem;
            `}
        >
            <Checkbox
                label={t('Filter')}
                checked={enabled}
                onChange={event => onEnabledChange(event.currentTarget.checked)}
            />
            <div className="filter-tag" style={{ opacity: enabled ? 1 : 0.5 }}>
                {dataFilter.map((dataFilterValue, index) => {
                    const displayFilter = enrichStructuredFilterTypes(
                        [dataFilterValue],
                        [...tableFields, ...flattenVariantLeaves(variantFields)],
                    )[0];
                    return (
                        <div
                            key={index.toString()}
                            className={css`
                                margin-left: 8px;
                            `}
                        >
                            <Badge
                                key={index}
                                text={getFilterDisplayLabel(dataFilterValue) || getFilterSQL(displayFilter)}
                                color="blue"
                            />
                        </div>
                    );
                })}
            </div>
        </DiscoverFilterWrapper>
    );
}
