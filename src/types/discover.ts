export type DiscoverQueryStatus = 'idle' | 'loading' | 'success' | 'error';

export type DiscoverQuerySource = 'results' | 'histogram' | 'count' | 'topData' | 'lucene';

export type DiscoverQueryLocation = {
    line?: number;
    column?: number;
    position?: number;
    inputLine?: number;
    inputColumn?: number;
    inputPosition?: number;
    near?: string;
};

export type DiscoverQueryError = {
    source: DiscoverQuerySource;
    summary: string;
    message: string;
    likelyCause: string;
    location?: DiscoverQueryLocation;
    generatedSql?: string;
};

export type DiscoverQueryState = {
    status: DiscoverQueryStatus;
    rowCount: number;
    error?: DiscoverQueryError;
    auxiliaryErrors: DiscoverQueryError[];
};

export type DiscoverSort = {
    field: string;
    direction: 'ASC' | 'DESC';
    variantPath?: string[];
    variantType?: string;
};

export type DiscoverColumnLayout = {
    columnOrder: string[];
    columnSizing: Record<string, number>;
};

export type DiscoverColumnLayouts = Record<string, DiscoverColumnLayout>;
