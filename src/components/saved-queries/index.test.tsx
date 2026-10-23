import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import SavedQueries from './index';
import { SavedQuery, savedQueries } from 'services/saved-queries';
import { DiscoverShareState } from 'utils/discover-share-state';

jest.mock('@grafana/ui', () => ({ ...jest.requireActual('@grafana/ui'), Tooltip: ({ children }: any) => <>{children}</> }));
// Grafana's Drawer uses useId; the test harness runs React 17 while Grafana
// provides a newer React at runtime.
jest.mock('react', () => {
    const actual = jest.requireActual('react');
    let nextId = 0;
    return { ...actual, useId: () => actual.useRef(`saved-queries-test-${nextId++}`).current };
});
jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Editor' } } } }));
jest.mock('services/saved-queries', () => ({ savedQueries: { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() } }));
const state: DiscoverShareState = {
    version: 1,
    datasource: 'ds',
    database: 'otel',
    table: 'logs',
    timeField: 'timestamp',
    timeZone: 'UTC',
    mode: 'SQL',
    query: 'level = 1',
    timeRawFrom: 'now-1h',
    timeRawTo: 'now',
    filters: [],
    selectedFields: [],
    columnOrder: [],
    sort: { field: 'timestamp', direction: 'DESC' },
};
const query: SavedQuery = {
    id: 'q1',
    name: 'Errors',
    description: 'Triage',
    state,
    revision: 1,
    author: 'alice',
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
    canEdit: true,
    canDelete: true,
};
beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest
            .fn()
            .mockImplementation(() => ({ matches: false, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() })),
    });
});
afterEach(async () => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});
beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    (savedQueries.list as jest.Mock).mockResolvedValue({ items: [query], total: 1, canCreate: true });
    (savedQueries.get as jest.Mock).mockResolvedValue(query);
    (savedQueries.create as jest.Mock).mockResolvedValue(query);
    (savedQueries.update as jest.Mock).mockResolvedValue({ ...query, revision: 2 });
    (savedQueries.delete as jest.Mock).mockResolvedValue({ deleted: true });
});
function setup(snapshot = state) {
    const restore = jest.fn().mockResolvedValue(true),
        store = createStore();
    const container = document.createElement('div');
    container.className = 'main-view';
    document.body.appendChild(container);
    const view = render(
        <Provider store={store}>
            <SavedQueries snapshot={snapshot} ready restore={restore} />
        </Provider>,
        { container },
    );
    return {
        ...view,
        restore,
        store,
        change: (next: DiscoverShareState) =>
            view.rerender(
                <Provider store={store}>
                    <SavedQueries snapshot={next} ready restore={restore} />
                </Provider>,
            ),
    };
}

it('saves the current snapshot without executing a query', async () => {
    const { restore } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: ' Errors ' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savedQueries.create).toHaveBeenCalledWith({ name: 'Errors', description: '', state }));
    expect(restore).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save query' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update query' })).not.toBeInTheDocument();
});

it('keeps the name and description after a network failure', async () => {
    (savedQueries.create as jest.Mock).mockRejectedValue(new Error('Storage is unavailable'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'My query' } });
    fireEvent.change(screen.getByLabelText('Saved query description'), { target: { value: 'Keep this draft' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await screen.findByText('Storage is unavailable');
    expect(screen.getByLabelText('Saved query name')).toHaveValue('My query');
    expect(screen.getByLabelText('Saved query description')).toHaveValue('Keep this draft');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
});

it('searches and loads the latest revision through the restore pipeline', async () => {
    const { restore } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.change(screen.getByLabelText('Search saved queries'), { target: { value: 'Err' } });
    await waitFor(() => expect(savedQueries.list).toHaveBeenCalledWith('Err', 1));
    fireEvent.click(await screen.findByRole('button', { name: 'Errors' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(state));
    expect(savedQueries.get).toHaveBeenCalledWith('q1');
});

it('asks before replacing unsaved changes and does not load on cancel', async () => {
    const { restore, change } = setup();
    change({ ...state, query: 'changed' });
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Errors' }));
    await screen.findAllByText('Discard unsaved query changes?');
    expect(restore).not.toHaveBeenCalled();
    const dialogs = screen.getAllByRole('dialog');
    fireEvent.click(within(dialogs[dialogs.length - 1]).getByRole('button', { name: 'Cancel' }));
    expect(savedQueries.get).not.toHaveBeenCalled();
});

it('renames with revision and preserves input on a conflict', async () => {
    (savedQueries.update as jest.Mock).mockRejectedValue(new Error('This query changed. Reload it before trying again.'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savedQueries.update).toHaveBeenCalledWith('q1', expect.objectContaining({ name: 'New name', revision: 1 })));
    await screen.findByText('This query changed. Reload it before trying again.');
    expect(screen.getByLabelText('Saved query name')).toHaveValue('New name');
});

it('requires confirmation before deleting for the organization', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(savedQueries.delete).not.toHaveBeenCalled();
    await screen.findAllByText('Delete “Errors”?');
    const dialogs = screen.getAllByRole('dialog');
    fireEvent.click(within(dialogs[dialogs.length - 1]).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(savedQueries.delete).toHaveBeenCalledWith('q1', 1));
    await act(async () => {
        await Promise.resolve();
    });
});

it('uses server capabilities for Viewer and other authors', async () => {
    (savedQueries.list as jest.Mock).mockResolvedValue({ items: [{ ...query, canEdit: false, canDelete: false }], total: 1, canCreate: false });
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save query' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    await screen.findByRole('button', { name: 'Errors' });
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
});

it('does not let a rename overwrite another user’s newer query state', async () => {
    const { change } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'Errors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    change({ ...state, query: 'my unsaved changes' });
    (savedQueries.list as jest.Mock).mockResolvedValue({ items: [{ ...query, revision: 2, state: { ...state, query: 'another author’s changes' } }], total: 1, canCreate: true });
    (savedQueries.update as jest.Mock).mockResolvedValueOnce({ ...query, name: 'Renamed', revision: 3, state: { ...state, query: 'another author’s changes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savedQueries.update).toHaveBeenCalledWith('q1', expect.objectContaining({ revision: 2, name: 'Renamed' })));
    await waitFor(() => expect(screen.queryByLabelText('Saved query name')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
        expect(savedQueries.update).toHaveBeenLastCalledWith('q1', expect.objectContaining({ revision: 1, state: expect.objectContaining({ query: 'my unsaved changes' }) })),
    );
});

async function saveInitialQuery() {
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'Errors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

it('defaults to update and enables submission for metadata changes without changing the query', async () => {
    setup();
    await saveInitialQuery();
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    expect(screen.getByRole('radio', { name: 'Update current query' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'Renamed errors' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savedQueries.update).toHaveBeenCalledWith('q1', expect.objectContaining({ name: 'Renamed errors', revision: 1, state })));
    expect(savedQueries.create).toHaveBeenCalledTimes(1);
});

it('can save an unchanged query as new using the same save icon', async () => {
    setup();
    await saveInitialQuery();
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Save as new query' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savedQueries.create).toHaveBeenCalledTimes(2));
    expect(savedQueries.update).not.toHaveBeenCalled();
});

it('only offers save as new for a query owned by another Editor', async () => {
    (savedQueries.get as jest.Mock).mockResolvedValue({ ...query, canEdit: false, canDelete: false });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Errors' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    expect(screen.queryByRole('radio', { name: 'Update current query' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savedQueries.create).toHaveBeenCalledTimes(1));
    expect(savedQueries.update).not.toHaveBeenCalled();
});

it('submits the dialog form and prevents dismissal or editing while saving', async () => {
    let finishSave!: (value: SavedQuery) => void;
    (savedQueries.create as jest.Mock).mockReturnValue(new Promise<SavedQuery>(resolve => (finishSave = resolve)));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save query' }));
    const dialog = screen.getByRole('dialog', { name: 'Save query' });
    fireEvent.change(within(dialog).getByLabelText('Saved query name'), { target: { value: 'My query' } });
    fireEvent.submit(within(dialog).getByRole('form', { name: 'Saved query details' }));

    expect(savedQueries.create).toHaveBeenCalledWith({ name: 'My query', description: '', state });
    expect(within(dialog).getByLabelText('Saved query name')).toBeDisabled();
    expect(within(dialog).getByLabelText('Saved query description')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(dialog).toBeInTheDocument();

    await act(async () => finishSave(query));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('dismisses with Escape without saving the draft', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Save query' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Save query' });
    expect(within(dialog).getByLabelText('Saved query name')).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText('Saved query name'), { target: { value: 'Unsaved draft' } });
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(savedQueries.create).not.toHaveBeenCalled();
});

it('navigates pages and resets pagination when searching or clearing the search', async () => {
    (savedQueries.list as jest.Mock).mockImplementation(async (_search: string, page: number) => ({
        items: [{ ...query, id: `q${page}`, name: `Page ${page}` }],
        total: 41,
        canCreate: true,
    }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    await screen.findByRole('button', { name: 'Page 1' });
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await screen.findByRole('button', { name: 'Page 2' });
    expect(savedQueries.list).toHaveBeenLastCalledWith('', 2);

    fireEvent.change(screen.getByLabelText('Search saved queries'), { target: { value: 'Errors' } });
    await screen.findByRole('button', { name: 'Page 1' });
    expect(savedQueries.list).toHaveBeenLastCalledWith('Errors', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(savedQueries.list).toHaveBeenLastCalledWith('', 1));
    expect(screen.getByLabelText('Search saved queries')).toHaveValue('');
});

it('keeps search input on a list failure and can retry into the empty state', async () => {
    (savedQueries.list as jest.Mock).mockRejectedValue(new Error('Storage is unavailable'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.change(screen.getByLabelText('Search saved queries'), { target: { value: 'Missing query' } });
    await screen.findByText('Storage is unavailable');
    expect(screen.queryByText('No saved queries match your search.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search saved queries')).toHaveValue('Missing query');

    (savedQueries.list as jest.Mock).mockResolvedValue({ items: [], total: 0, canCreate: true });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No saved queries match your search.');
    expect(screen.queryByText('Storage is unavailable')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await screen.findByText('No saved queries yet. Use Save query to save your current query.');
});

it('keeps the saved query in the list when a confirmed delete conflicts', async () => {
    (savedQueries.delete as jest.Mock).mockRejectedValue(new Error('This query changed. Reload it before trying again.'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Saved queries' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “Errors”?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await screen.findByText('This query changed. Reload it before trying again.');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Errors' })).toBeInTheDocument();
    expect(savedQueries.delete).toHaveBeenCalledWith('q1', 1);
});
