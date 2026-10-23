import { t } from 'i18n';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert as GrafanaAlert,
    Button as GrafanaButton,
    Card,
    Drawer,
    EmptySearchResult,
    Field,
    Icon,
    IconButton,
    Input as GrafanaInput,
    LoadingPlaceholder,
    Modal as GrafanaModal,
    Pagination,
    RadioButtonGroup,
    Tag,
    TextArea,
    Tooltip,
    useStyles2,
    useTheme2,
} from '@grafana/ui';
import { css } from '@emotion/css';
import { config } from '@grafana/runtime';
import { useStore } from 'jotai';
import { SavedQuery, savedQueries } from 'services/saved-queries';
import { DiscoverShareState } from 'utils/discover-share-state';
import { snapshotKey, validateSavedQueryState } from 'utils/saved-query-state';
import { discoverSnapshotAtom } from 'store/discover-snapshot';
import { getSavedQueriesStyles } from './saved-queries.styles';

type Props = { snapshot: DiscoverShareState; ready: boolean; restore: (state: DiscoverShareState) => Promise<boolean> };
type Editor = {
    kind: 'create' | 'update' | 'rename';
    name: string;
    description: string;
    target?: SavedQuery;
    source?: SavedQuery;
    snapshot?: DiscoverShareState;
    snapshotChanged?: boolean;
};
type Confirmation = { kind: 'load' | 'delete'; target: SavedQuery };

export default function SavedQueries({ snapshot, ready, restore }: Props) {
    const store = useStore();
    const theme = useTheme2();
    const styles = useStyles2(getSavedQueriesStyles);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<SavedQuery[]>([]);
    const [total, setTotal] = useState(0);
    const [canCreate, setCanCreate] = useState(['Editor', 'Admin'].includes(config.bootData?.user?.orgRole || ''));
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [editorError, setEditorError] = useState('');
    const [editor, setEditor] = useState<Editor>();
    const [confirmation, setConfirmation] = useState<Confirmation>();
    const nameInput = useRef<HTMLInputElement>(null);
    const searchInput = useRef<HTMLInputElement>(null);
    const confirmationCancel = useRef<HTMLButtonElement>(null);
    const editorTrigger = useRef<HTMLElement | null>(null);
    const isEditing = Boolean(editor);
    const isDialogOpen = isEditing || Boolean(confirmation);
    const [active, setActive] = useState<SavedQuery>();
    const [baseline, setBaseline] = useState('');
    const [reload, setReload] = useState(0);
    const initial = useRef<string | undefined>(undefined);
    useEffect(() => {
        // Let the modal capture the trigger before moving focus into the form.
        if (isEditing) {
            nameInput.current?.focus();
        } else if (isDialogOpen) {
            confirmationCancel.current?.focus();
        } else if (editorTrigger.current) {
            // Restore focus after the tooltip/drawer and modal finish updating.
            const frame = window.requestAnimationFrame(() => {
                if (editorTrigger.current?.isConnected) {
                    editorTrigger.current.focus();
                } else {
                    searchInput.current?.focus();
                }
            });
            return () => window.cancelAnimationFrame(frame);
        }
        return undefined;
    }, [isEditing, isDialogOpen]);
    useEffect(() => {
        if (open) {
            searchInput.current?.focus();
        }
    }, [open]);
    if (ready && initial.current === undefined) {
        initial.current = snapshotKey(snapshot);
    }
    const dirty = initial.current !== undefined && snapshotKey(snapshot) !== (active ? baseline : initial.current);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        // The server is authoritative; the boot role only avoids a disabled
        // button while loading capabilities on the first render.
        let cancelled = false;
        void savedQueries
            .list('', 1)
            .then(result => {
                if (!cancelled) {
                    setCanCreate(result.canCreate);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        const timer = window.setTimeout(() => {
            void savedQueries
                .list(search, page)
                .then(result => {
                    if (cancelled) {
                        return;
                    }
                    setItems(result.items);
                    setTotal(result.total);
                    setCanCreate(result.canCreate);
                    setError('');
                    if (page > 1 && !result.items.length) {
                        setPage(Math.max(1, Math.ceil(result.total / 20)));
                    }
                })
                .catch(error => {
                    if (!cancelled) {
                        setError(error.message);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setLoading(false);
                    }
                });
        }, 200);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [open, search, page, reload]);

    const beginSave = (kind: 'create' | 'update') => {
        try {
            validateSavedQueryState(snapshot);
        } catch (error) {
            setError((error as Error).message);
            setOpen(true);
            return;
        }
        setEditorError('');
        setEditor({
            kind,
            name: active?.name || '',
            description: active?.description || '',
            target: kind === 'update' ? active : undefined,
            source: active,
            snapshot,
            snapshotChanged: dirty,
        });
    };

    const unchanged =
        editor?.kind === 'update' && !editor.snapshotChanged && editor.name.trim() === editor.target?.name && editor.description.trim() === editor.target?.description;
    const save = async () => {
        if (!editor || busy || unchanged || !editor.name.trim()) {
            return;
        }
        setBusy(true);
        setEditorError('');
        try {
            const input = { name: editor.name.trim(), description: editor.description.trim(), state: editor.kind === 'rename' ? undefined : editor.snapshot };
            const result = editor.target ? await savedQueries.update(editor.target.id, { ...input, revision: editor.target.revision }) : await savedQueries.create(input);
            if (!mounted.current) {
                return;
            }
            if (editor.kind !== 'rename') {
                setActive(result);
                setBaseline(snapshotKey(result.state));
            } else {
                setActive(previous =>
                    previous?.id === result.id
                        ? {
                              ...previous,
                              name: result.name,
                              description: result.description,
                              // Renaming a newer list revision must not authorize
                              // overwriting a state change this editor never loaded.
                              revision: previous.revision === editor.target?.revision ? result.revision : previous.revision,
                              updatedAt: result.updatedAt,
                          }
                        : previous,
                );
            }
            setEditor(undefined);
            setReload(n => n + 1);
        } catch (error) {
            if (mounted.current) {
                setEditorError((error as Error).message);
            }
        } finally {
            if (mounted.current) {
                setBusy(false);
            }
        }
    };

    const load = async (item: SavedQuery) => {
        setBusy(true);
        setError('');
        try {
            const latest = await savedQueries.get(item.id);
            if (!mounted.current) {
                return;
            }
            validateSavedQueryState(latest.state);
            if (await restore(latest.state)) {
                if (!mounted.current) {
                    return;
                }
                setActive(latest);
                setBaseline(snapshotKey(store.get(discoverSnapshotAtom)));
                setOpen(false);
            } else if (mounted.current) {
                setError(t('The query could not be restored. See the details in Discover.'));
            }
        } catch (error) {
            if (mounted.current) {
                setError((error as Error).message);
            }
        } finally {
            if (mounted.current) {
                setBusy(false);
            }
        }
    };

    const confirmLoad = (item: SavedQuery) => {
        if (dirty) {
            setConfirmation({ kind: 'load', target: item });
        } else {
            void load(item);
        }
    };

    const remove = async (item: SavedQuery) => {
        setBusy(true);
        try {
            await savedQueries.delete(item.id, item.revision);
            if (!mounted.current) {
                return;
            }
            if (active?.id === item.id) {
                setActive(undefined);
                setBaseline('');
                initial.current = snapshotKey(snapshot);
            }
            setReload(n => n + 1);
        } catch (error) {
            if (mounted.current) {
                setError((error as Error).message);
            }
        } finally {
            if (mounted.current) {
                setBusy(false);
            }
        }
    };

    const confirm = async () => {
        if (!confirmation || busy) {
            return;
        }
        if (confirmation.kind === 'load') {
            await load(confirmation.target);
        } else {
            await remove(confirmation.target);
        }
        if (mounted.current) {
            setConfirmation(undefined);
        }
    };

    return (
        <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <Tooltip content={active ? t('Save query: {{name}}{{modified}}', { name: active.name, modified: dirty ? t(' (Modified)') : '' }) : t('Save query')} show={isDialogOpen ? false : undefined}>
                    <span style={{ display: 'inline-flex', position: 'relative' }}>
                        <GrafanaButton
                            aria-label={t('Save query')}
                            variant="secondary"
                            icon="save"
                            onClick={event => {
                                editorTrigger.current = event.currentTarget;
                                beginSave(active?.canEdit ? 'update' : 'create');
                            }}
                            disabled={(!canCreate && !active?.canEdit) || !ready || busy}
                        />
                        {dirty && (
                            <span
                                role="status"
                                aria-label={t('Unsaved query changes')}
                                style={{
                                    position: 'absolute',
                                    top: 3,
                                    right: 3,
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: theme.colors.warning.main,
                                    pointerEvents: 'none',
                                }}
                            />
                        )}
                    </span>
                </Tooltip>
                <Tooltip content={t('Saved queries')} show={open ? false : undefined}>
                    <GrafanaButton aria-label={t('Saved queries')} variant="secondary" icon="folder-open" onClick={() => setOpen(true)} />
                </Tooltip>
            </div>
            {open && (
                <Drawer
                    title={t('Saved queries')}
                    subtitle="Shared with members of this Grafana organization. Data access uses your own permissions."
                    size="md"
                    onClose={() => {
                        if (!isDialogOpen) {
                            setOpen(false);
                        }
                    }}
                >
                    <div className={styles.drawerBody}>
                        <GrafanaInput
                            ref={searchInput}
                            type="search"
                            aria-label={t('Search saved queries')}
                            placeholder={t('Search by name')}
                            prefix={<Icon name="search" />}
                            suffix={
                                search ? (
                                    <IconButton
                                        name="times"
                                        aria-label={t('Clear search')}
                                        onClick={() => {
                                            setSearch('');
                                            setPage(1);
                                            searchInput.current?.focus();
                                        }}
                                    />
                                ) : undefined
                            }
                            value={search}
                            onChange={event => {
                                setSearch(event.currentTarget.value);
                                setPage(1);
                            }}
                        />
                        {error && (
                            <GrafanaAlert severity="error" title={error} bottomSpacing={0}>
                                <GrafanaButton variant="secondary" size="sm" onClick={() => setReload(n => n + 1)}>
                                    {t('Retry')}
                                </GrafanaButton>
                            </GrafanaAlert>
                        )}
                        {loading ? (
                            <div role="status">
                                <LoadingPlaceholder text={t('Loading saved queries…')} />
                            </div>
                        ) : (
                            <>
                                {!error && items.length === 0 && (
                                    <div className={styles.empty}>
                                        <EmptySearchResult>
                                            {search ? t('No saved queries match your search.') : t('No saved queries yet. Use Save query to save your current query.')}
                                        </EmptySearchResult>
                                    </div>
                                )}
                                {items.length > 0 && (
                                    <>
                                        <div className={styles.listSummary}>
                                            <span>
                                                {t('{{count}} saved queries', { count: total })}
                                            </span>
                                            <span>{t('Updated most recently')}</span>
                                        </div>
                                        <ul aria-label={t('Saved queries results')} className={styles.list}>
                                            {items.map(item => (
                                                <li key={item.id}>
                                                    <Card
                                                        className={styles.card}
                                                        disabled={busy}
                                                        onClick={event => {
                                                            editorTrigger.current = event.currentTarget;
                                                            confirmLoad(item);
                                                        }}
                                                    >
                                                        <Card.Heading className={styles.heading}>{item.name}</Card.Heading>
                                                        <Card.Tags className={styles.tags}>
                                                            <Tag name={item.state?.mode || t('Unknown mode')} />
                                                        </Card.Tags>
                                                        {item.description && <Card.Description className={styles.description}>{item.description}</Card.Description>}
                                                        <Card.Meta className={styles.metadata}>
                                                            <span>
                                                                {item.state?.database}.{item.state?.table}
                                                            </span>
                                                            <span>{item.author}</span>
                                                            <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
                                                        </Card.Meta>
                                                        {(item.canEdit || item.canDelete) && (
                                                            <Card.Actions className={styles.actions}>
                                                                {item.canEdit && (
                                                                    <GrafanaButton
                                                                        variant="secondary"
                                                                        size="sm"
                                                                        icon="pen"
                                                                        disabled={busy}
                                                                        onClick={event => {
                                                                            editorTrigger.current = event.currentTarget;
                                                                            setEditorError('');
                                                                            setEditor({ kind: 'rename', name: item.name, description: item.description, target: item });
                                                                        }}
                                                                    >
                                                                        {t('Rename')}
                                                                    </GrafanaButton>
                                                                )}
                                                                {item.canDelete && (
                                                                    <GrafanaButton
                                                                        variant="destructive"
                                                                        fill="outline"
                                                                        size="sm"
                                                                        icon="trash-alt"
                                                                        disabled={busy}
                                                                        onClick={event => {
                                                                            editorTrigger.current = event.currentTarget;
                                                                            setConfirmation({ kind: 'delete', target: item });
                                                                        }}
                                                                    >
                                                                        {t('Delete')}
                                                                    </GrafanaButton>
                                                                )}
                                                            </Card.Actions>
                                                        )}
                                                    </Card>
                                                </li>
                                            ))}
                                        </ul>
                                        <nav aria-label={t('Saved queries pagination')}>
                                            <Pagination
                                                currentPage={page}
                                                numberOfPages={Math.max(1, Math.ceil(total / 20))}
                                                onNavigate={setPage}
                                                hideWhenSinglePage
                                                showSmallVersion
                                            />
                                        </nav>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </Drawer>
            )}
            {confirmation && (
                <GrafanaModal
                    title={confirmation.kind === 'delete' ? t('Delete “{{name}}”?', { name: confirmation.target.name }) : t('Discard unsaved query changes?')}
                    isOpen
                    trapFocus
                    className={styles.modal}
                    closeOnEscape={!busy}
                    closeOnBackdropClick={!busy}
                    onDismiss={() => {
                        if (!busy) {
                            setConfirmation(undefined);
                        }
                    }}
                >
                    <p>
                        {confirmation.kind === 'delete'
                            ? t('This removes the saved query for everyone in this organization.')
                            : t('Loading this query replaces the current query and display settings.')}
                    </p>
                    <GrafanaModal.ButtonRow>
                        <GrafanaButton ref={confirmationCancel} variant="secondary" disabled={busy} onClick={() => setConfirmation(undefined)}>
                            {t('Cancel')}
                        </GrafanaButton>
                        <GrafanaButton
                            variant={confirmation.kind === 'delete' ? 'destructive' : 'primary'}
                            disabled={busy}
                            icon={busy ? 'spinner' : undefined}
                            onClick={() => void confirm()}
                        >
                            {confirmation.kind === 'delete' ? (busy ? t('Deleting…') : t('Delete')) : busy ? t('Loading…') : t('Discard and load')}
                        </GrafanaButton>
                    </GrafanaModal.ButtonRow>
                </GrafanaModal>
            )}
            {editor && (
                <GrafanaModal
                    title={editor.kind === 'rename' ? t('Rename saved query') : t('Save query')}
                    isOpen
                    trapFocus
                    className={styles.modal}
                    closeOnEscape={!busy}
                    closeOnBackdropClick={!busy}
                    onDismiss={() => {
                        if (!busy) {
                            setEditor(undefined);
                        }
                    }}
                >
                    <form
                        aria-label={t('Saved query details')}
                        aria-busy={busy}
                        onSubmit={event => {
                            event.preventDefault();
                            void save();
                        }}
                    >
                        <p className={css({ color: theme.colors.text.secondary, marginBottom: theme.spacing(3) })}>
                            {t('Shared with members of this Grafana organization. Data access uses your own permissions.')}
                        </p>
                        {editor.kind !== 'rename' && editor.source?.canEdit && canCreate && (
                            <Field label={t('Save action')} disabled={busy}>
                                <RadioButtonGroup<'update' | 'create'>
                                    aria-label={t('Save query action')}
                                    value={editor.kind}
                                    options={[
                                        { label: t('Update current query'), value: 'update' },
                                        { label: t('Save as new query'), value: 'create' },
                                    ]}
                                    className={css({ flexWrap: 'wrap' })}
                                    onChange={kind => setEditor(previous => previous && { ...previous, kind, target: kind === 'update' ? previous.source : undefined })}
                                />
                            </Field>
                        )}
                        <Field label={t('Name')} required disabled={busy}>
                            <GrafanaInput
                                ref={nameInput}
                                id="saved-query-name"
                                aria-label={t('Saved query name')}
                                required
                                value={editor.name}
                                placeholder={t('Name your query')}
                                maxLength={120}
                                onChange={({ currentTarget: { value } }) => setEditor(previous => previous && { ...previous, name: value })}
                            />
                        </Field>
                        <Field label={t('Description (optional)')} disabled={busy}>
                            <TextArea
                                id="saved-query-description"
                                aria-label={t('Saved query description')}
                                value={editor.description}
                                placeholder={t('Describe when to use this query')}
                                rows={4}
                                maxLength={2000}
                                onChange={({ currentTarget: { value } }) => setEditor(previous => previous && { ...previous, description: value })}
                            />
                        </Field>
                        {editorError && <GrafanaAlert severity="error" title={editorError} />}
                        <GrafanaModal.ButtonRow>
                            <GrafanaButton type="button" variant="secondary" disabled={busy} onClick={() => setEditor(undefined)}>
                                {t('Cancel')}
                            </GrafanaButton>
                            <GrafanaButton type="submit" disabled={busy || !editor.name.trim() || unchanged} icon={busy ? 'spinner' : undefined}>
                                {busy ? t('Saving…') : t('Save')}
                            </GrafanaButton>
                        </GrafanaModal.ButtonRow>
                    </form>
                </GrafanaModal>
            )}
        </>
    );
}
