import React, { CSSProperties } from 'react';
import DiscoverQueryEditor from './discover-query-editor';

export default function SQLSearch({ style, onQuerying }: { style?: CSSProperties; onQuerying: () => void }) {
    return (
        <div style={style}>
            <DiscoverQueryEditor mode="sql" onQuerying={onQuerying} />
        </div>
    );
}
