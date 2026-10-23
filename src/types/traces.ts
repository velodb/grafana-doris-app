export type TracesCapability = {
    hasSummary: boolean;
    /** EXPLAIN results for the actual query shape (including count). */
    rewrites: Record<string, boolean>;
};

export type TraceListResult = {
    rows: Array<Record<string, any>>;
    total: number;
};
