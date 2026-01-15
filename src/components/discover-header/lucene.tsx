import React from 'react';
import { useAtom } from 'jotai';
import { searchValueAtom } from 'store/discover';
import { Input } from '@grafana/ui';

export default function Lucene({ onQuerying }: { onQuerying?: () => void }) {
    const [searchValue, setSearchValue] = useAtom(searchValueAtom);
    if (process.env.NODE_ENV !== 'production') {
        searchValueAtom.debugLabel = 'searchValue';
    }

    return (
        <Input
            value={searchValue}
            onChange={(e: any) => {
                console.log(e);
                setSearchValue(e.target?.value);
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                const native = (e as any).nativeEvent;
                if (e.key === 'Enter' && !(native && native.isComposing)) {
                    try {
                        onQuerying?.();
                    } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error('onQuerying handler error:', err);
                    }
                }
            }}
            placeholder="usage: field:value AND field2:value2"
        />
    );
}
