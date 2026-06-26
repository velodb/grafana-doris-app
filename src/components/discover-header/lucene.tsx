import React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { indexesAtom, searchValueAtom, tableFieldsAtom } from 'store/discover';
import { Icon, Input, useTheme2 } from '@grafana/ui';
import { logError } from '@grafana/runtime';
import { toError } from 'utils/errors';
import { getLuceneFieldsWithoutInvertedIndex } from 'utils/query-parser/lucene-index-warning';

export default function Lucene({ onQuerying }: { onQuerying?: () => void }) {
    const [searchValue, setSearchValue] = useAtom(searchValueAtom);
    const indexes = useAtomValue(indexesAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const theme = useTheme2();
    const fieldsWithoutInvertedIndex = React.useMemo(
        () => getLuceneFieldsWithoutInvertedIndex(searchValue, indexes, tableFields),
        [searchValue, indexes, tableFields],
    );
    const warningFields = fieldsWithoutInvertedIndex.slice(0, 3).join(', ');
    const remainingWarningFieldCount = fieldsWithoutInvertedIndex.length - 3;
    if (process.env.NODE_ENV !== 'production') {
        searchValueAtom.debugLabel = 'searchValue';
    }

    return (
        <div style={{ width: '100%' }}>
            <Input
                value={searchValue}
                onChange={(e: any) => {
                    setSearchValue(e.target?.value);
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    const native = (e as any).nativeEvent;
                    if (e.key === 'Enter' && !(native && native.isComposing)) {
                        try {
                            onQuerying?.();
                        } catch (err) {
                            logError(toError(err), { source: 'Lucene', action: 'onQuerying' });
                        }
                    }
                }}
                placeholder="usage: field:value AND field2:value2"
            />
            {fieldsWithoutInvertedIndex.length > 0 ? (
                <div
                    style={{
                        alignItems: 'center',
                        color: theme.colors.warning.text,
                        display: 'flex',
                        fontSize: theme.typography.bodySmall.fontSize,
                        gap: theme.spacing(0.5),
                        lineHeight: theme.typography.bodySmall.lineHeight,
                        marginTop: theme.spacing(0.5),
                    }}
                >
                    <Icon name="exclamation-triangle" size="sm" />
                    <span>
                        {warningFields}
                        {remainingWarningFieldCount > 0 ? ` 等 ${fieldsWithoutInvertedIndex.length} 个字段` : ''}{' '}
                        未配置倒排索引，Lucene 查询可能较慢。
                    </span>
                </div>
            ) : null}
        </div>
    );
}
