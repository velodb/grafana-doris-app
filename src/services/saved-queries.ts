import { t } from 'i18n';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { DiscoverShareState } from 'utils/discover-share-state';
import { validateSavedQueryState } from 'utils/saved-query-state';

export type SavedQuery = {
    id: string;
    name: string;
    description: string;
    state: DiscoverShareState;
    author: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    canEdit: boolean;
    canDelete: boolean;
};
export type SavedQueryList = { items: SavedQuery[]; total: number; canCreate: boolean };
export type SavedQueryInput = { name?: string; description?: string; state?: DiscoverShareState; revision?: number };
const base = '/api/plugins/velodb-doris-app/resources/saved-queries';

async function request<T>(method: string, path = '', data?: SavedQueryInput): Promise<T> {
    if (data?.state) {
        validateSavedQueryState(data.state);
    }
    if (data?.name !== undefined && (!data.name.trim() || Array.from(data.name.trim()).length > 120)) {
        throw new Error(t('Name must contain 1–120 characters'));
    }
    if (data?.description && Array.from(data.description.trim()).length > 2000) {
        throw new Error(t('Description exceeds 2000 characters'));
    }
    if (data && new Blob([JSON.stringify(data)]).size > 1024 * 1024) {
        throw new Error(t('Saved query exceeds 1 MiB'));
    }
    try {
        const response = await lastValueFrom(
            getBackendSrv().fetch<T>({
                url: base + path,
                method,
                data,
                // Grafana does not default DELETE bodies to JSON.
                headers: data ? { 'Content-Type': 'application/json' } : undefined,
                showErrorAlert: false,
            }),
        );
        return response.data;
    } catch (error: any) {
        throw new Error(
            error?.status === 409
                ? t('This query changed. Reload it before trying again; your changes have not been saved.')
                : error?.data?.message || error?.message || t('Saved queries are unavailable'),
        );
    }
}

export const savedQueries = {
    list: (search = '', page = 1) => request<SavedQueryList>('GET', `?${new URLSearchParams({ search, page: String(page), pageSize: '20' })}`),
    get: (id: string) => request<SavedQuery>('GET', `/${encodeURIComponent(id)}`),
    create: (input: SavedQueryInput) => request<SavedQuery>('POST', '', input),
    update: (id: string, input: SavedQueryInput) => request<SavedQuery>('PUT', `/${encodeURIComponent(id)}`, input),
    delete: (id: string, revision: number) => request<{ deleted: boolean }>('DELETE', `/${encodeURIComponent(id)}`, { revision }),
};
