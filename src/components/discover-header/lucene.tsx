import React from 'react';
import { useAtom } from 'jotai';
import { searchValueAtom } from 'store/discover';
import { Input } from '@grafana/ui';
import { logError } from '@grafana/runtime';
import { toError } from 'utils/errors';

export default function Lucene({ onQuerying }: { onQuerying?: () => void }) {
    const [searchValue, setSearchValue] = useAtom(searchValueAtom);
    if (process.env.NODE_ENV !== 'production') {
        searchValueAtom.debugLabel = 'searchValue';
    }

    return (
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
    );
}
