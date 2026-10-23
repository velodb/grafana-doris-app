import { t } from 'i18n';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { css } from '@emotion/css';
import { CodeEditor, CodeEditorSuggestionItemKind, useTheme2 } from '@grafana/ui';
import { searchValueAtom, tableDataAtom, tableFieldsAtom, variantFieldsAtom } from 'store/discover';
import { flattenVariantLeaves } from 'utils/variant-fields';
import { DiscoverQueryMode, getQuerySuggestions, QuerySuggestion } from './query-completion';

type Props = {
    mode: DiscoverQueryMode;
    onQuerying: () => void;
};

const SUGGESTION_KIND: Record<NonNullable<QuerySuggestion['kind']>, CodeEditorSuggestionItemKind> = {
    field: CodeEditorSuggestionItemKind.Field,
    operator: CodeEditorSuggestionItemKind.Method,
    value: CodeEditorSuggestionItemKind.Constant,
    keyword: CodeEditorSuggestionItemKind.Text,
};

// Keep the query compact while retaining the editor's input border.
const singleLineEditorStyle = css`
    width: 100%;
    min-width: 0;

    .monaco-editor,
    .monaco-editor .overflow-guard,
    .monaco-editor .margin {
        border: 0 !important;
        outline: 0 !important;
    }
`;

function getCompletionRange(model: any, position: any) {
    const offset = model.getOffsetAt(position);
    const value = model.getValue();
    let start = offset;
    while (start > 0 && !/[\s()]/.test(value[start - 1])) {
        start -= 1;
    }
    return {
        startLineNumber: model.getPositionAt(start).lineNumber,
        startColumn: model.getPositionAt(start).column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
    };
}

function isSuggestionVisible(editor: any): boolean {
    // fixedOverflowWidgets places the popup outside the editor DOM, so check
    // the document first. The controller state covers the short interval
    // before Monaco adds the `visible` CSS class.
    if (typeof document !== 'undefined' && document.querySelector('.suggest-widget.visible')) {
        return true;
    }
    const controller = editor.getContribution?.('editor.contrib.suggestController');
    const widget = controller?.widget?.value;
    return Boolean(widget && widget._state !== 0);
}

export default function DiscoverQueryEditor({ mode, onQuerying }: Props) {
    const theme = useTheme2();
    const [searchValue, setSearchValue] = useAtom(searchValueAtom);
    const tableFields = useAtomValue(tableFieldsAtom);
    const variantFields = useAtomValue(variantFieldsAtom);
    const tableData = useAtomValue(tableDataAtom);
    const providerRef = useRef<any>(undefined);
    const keyListenerRef = useRef<any>(undefined);
    const latestRef = useRef({ mode, fields: [] as any[], rows: [] as Array<Record<string, unknown>> });

    const fields = useMemo(() => {
        const all = [...tableFields, ...flattenVariantLeaves(variantFields)];
        const byPath = new Map<string, any>();
        all.forEach(field => {
            const key = JSON.stringify(field.variantPath || [field.Field]);
            if (!byPath.has(key)) {
                byPath.set(key, field);
            }
        });
        return Array.from(byPath.values()).map(field => ({
            Field: String(field.Field),
            Type: field.Type,
            variantPath: field.variantPath,
            variantRootType: field.variantPath?.length ? tableFields.find((root: any) => root.Field === field.variantPath[0])?.Type : undefined,
        }));
    }, [tableFields, variantFields]);

    latestRef.current = { mode, fields, rows: tableData as Array<Record<string, unknown>> };

    const disposeEditorResources = useCallback(() => {
        providerRef.current?.dispose();
        keyListenerRef.current?.dispose();
        providerRef.current = undefined;
        keyListenerRef.current = undefined;
    }, []);

    const onEditorDidMount = useCallback((editor: any, monaco: any) => {
        disposeEditorResources();
        const language = mode === 'sql' ? 'sql' : 'plaintext';
        const modelId = editor.getModel()?.id;
        providerRef.current = monaco.languages.registerCompletionItemProvider(language, {
            triggerCharacters: mode === 'sql' ? [' ', '`', '(', '='] : [':', ' ', '(', '['],
            provideCompletionItems: (model: any, position: any) => {
                if (model.id !== modelId) {
                    return undefined;
                }
                const offset = model.getOffsetAt(position);
                const current = latestRef.current;
                const suggestions = getQuerySuggestions({
                    mode: current.mode,
                    query: model.getValue().slice(0, offset),
                    fields: current.fields,
                    rows: current.rows,
                }).map((suggestion: QuerySuggestion) => ({
                    ...suggestion,
                    kind: SUGGESTION_KIND[suggestion.kind || 'keyword'],
                    range: getCompletionRange(model, position),
                }));
                return { suggestions };
            },
        });
        keyListenerRef.current = editor.onKeyDown((event: any) => {
            const browserEvent = event.browserEvent;
            const suggestionIsVisible = isSuggestionVisible(editor);
            if (event.keyCode === monaco.KeyCode.Enter && !browserEvent?.isComposing && !suggestionIsVisible) {
                event.preventDefault();
                event.stopPropagation();
                onQuerying();
            }
        });
    }, [disposeEditorResources, mode, onQuerying]);

    useEffect(() => disposeEditorResources, [disposeEditorResources]);

    return (
        <div
            style={{ minWidth: 0, width: '100%' }}
            title={mode === 'lucene' ? t('VARIANT properties use exact value matching; searchable paths come from sampled data.') : undefined}
        >
            <CodeEditor
                language={mode === 'sql' ? 'sql' : 'plaintext'}
                value={searchValue}
                width="100%"
                height="30px"
                showMiniMap={false}
                showLineNumbers={false}
                containerStyles={css(singleLineEditorStyle, {
                    border: `1px solid ${theme.components.input.borderColor}`,
                    borderRadius: theme.shape.radius.default,
                    '&:focus-within': { borderColor: theme.colors.primary.border },
                })}
                monacoOptions={{
                    lineNumbers: 'off',
                    renderLineHighlight: 'none',
                    renderValidationDecorations: 'off',
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    lineHeight: 30,
                    padding: { top: 0, bottom: 0 },
                    scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
                }}
                onChange={setSearchValue}
                onEditorDidMount={onEditorDidMount}
                onEditorWillUnmount={disposeEditorResources}
            />
        </div>
    );
}
