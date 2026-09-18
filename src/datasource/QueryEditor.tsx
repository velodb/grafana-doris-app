import React from 'react';
import type { QueryEditorProps } from '@grafana/data';
import { CodeEditor, Field, Select } from '@grafana/ui';
import type { DataSource } from './datasource';
import type { DorisQuery, DorisSSOJsonData } from './types';

export function QueryEditor({ query, onChange, onRunQuery }: QueryEditorProps<DataSource, DorisQuery, DorisSSOJsonData>) {
  return <>
    <Field label="SQL">
      <CodeEditor
        language="sql"
        height="180px"
        value={query.rawSql ?? ''}
        onBlur={value => { onChange({ ...query, rawSql: value }); onRunQuery(); }}
      />
    </Field>
    <Field label="Format">
      <Select
        width={20}
        options={[{ label: 'Table', value: 'table' }, { label: 'Time series', value: 'time_series' }]}
        value={query.format ?? 'table'}
        onChange={option => { onChange({ ...query, format: option.value as DorisQuery['format'] }); onRunQuery(); }}
      />
    </Field>
  </>;
}
