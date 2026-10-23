import dayjs, { Dayjs, ManipulateType } from "dayjs";

export interface QueryTableDataParams {
    catalog: string;
    database: string;
    table: string;
    cluster: string;
    startDate: string;
    endDate: string;
    sort: 'ASC' | 'DESC';
    sortField?: string;
    sortFieldPath?: string[];
    sortFieldType?: string;
    timeField: string;
    data_filters: any[];
    interval?: IntervalEnum;
    interval_value?: number;
    timeZone?: string;
    search_type: string;
    search_value: string;
    indexes?: string;
    indexes_statement?: string;
    page: string;
    page_size: number;
    lucene_where?: string;
}

export type TopNAggregation = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
export type TopNConfig = {
    groupField: string;
    metric: TopNAggregation;
    metricField: string;
    direction: 'DESC' | 'ASC';
    limit: number;
};
export type FieldStatisticsField = {
    Field: string;
    Type?: string;
    variantPath?: string[];
    variantRootType?: string;
};

export type FieldStatisticsParams = Pick<QueryTableDataParams, 'catalog' | 'database' | 'table' | 'timeField' | 'startDate' | 'endDate' | 'data_filters' | 'search_type' | 'search_value' | 'indexes_statement' | 'lucene_where'> & {
    field: FieldStatisticsField;
};
export interface TopNQueryParams extends Pick<QueryTableDataParams, 'catalog' | 'database' | 'table' | 'timeField' | 'startDate' | 'endDate' | 'data_filters' | 'search_type' | 'search_value' | 'indexes_statement' | 'lucene_where'> {
    groupField: string;
    metric: TopNAggregation;
    metricField?: string;
    direction: 'DESC' | 'ASC';
    limit: number;
}


export interface SurroundingParams {
    catalog: string;
    database: string;
    table: string;
    cluster: string;
    timeField: string;
    time: string;
    windowHours?: number;
    data_filters: any;
    pageSize: string;
    operator: '>' | '<';
    theme: string | undefined;
}

export interface DataFilterType {
    fieldName: string;
    variantKey?: string;
    variantPath?: string[];
    /** Physical type of the structured root column, used to query JSON paths. */
    variantRootType?: string;
    /** Scalar type inferred for the selected JSON/VARIANT leaf. */
    fieldType?: string;
    operator: Operator;
    value: Array<string | number | boolean>;
    label?: string;
    id: string;
}

export type Operator =
    | '='
    | '!='
    | 'in'
    | 'not in'
    | 'is null'
    | 'is not null'
    | 'between'
    | 'not between'
    | 'like'
    | 'not like'
    | 'match_all'
    | 'match_any'
    | 'match_phrase'
    | 'match_phrase_prefix';

export interface DiscoverCurrent {
    catalog: string;
    database: string;
    table: string;
    cluster: string;
    timeField: string;
    date: [Dayjs, Dayjs] | [];
}

export enum IntervalEnum {
    Auto = 'auto',
    Day = 'day',
    Week = 'week',
    Month = 'month',
    Year = 'year',
    Hour = 'hour',
    Minute = 'minute',
    Second = 'second',
}


export type ShortcutItem = {
    key: string;
    text: string;
    label: string;
    range: (now?: dayjs.Dayjs) => dayjs.Dayjs[];
    format: string;
    type: string;
    number: number;
}

export interface QueryTableFieldsParams {
    catalog: string;
    database: string;
    table: string;
    describe_extend_variant_column?: string;
}

export type FieldNode = {
    name: string;
    type: string;
    children?: FieldNode[];
    Null?: string;
    Key?: string;
    Default?: string | null;
    Extra?: string;
    Comment?: string;
    Visible?: string;
};


export interface RequestParams {
    catalog: string;
    database: string;
    table: string;
    describe_extend_variant_column?: boolean;
}

export interface QueryTableIndexesParams {
    catalog: string;
    database: string;
    table: string
}

export interface QueryTableParams {
    catalog: string;
    database: string;
}

export type AutoInterval = {
    current_date_range: number;
    current_type: ManipulateType;
    interval_unit: ManipulateType;
    interval_value: number;
};


export type Frame = {
    schema: {
        fields: Array<{ name: string }>;
    };
    data: {
        values: any[][];
    };
};

export type Result = {
    frames: Frame[];
};

export type Root = {
    results: Record<string, Result>;
};

export type QueryTracesParams = {
    database: string;
    table: string;
    timeField: string;
    startDate: string;
    endDate: string;
    service_name?: string;
    operation?: string;
    statusCode?: string;
    minDuration?: string;
    maxDuration?: string;
    tags?: string;
    page?: number;
    page_size?: number;
    sortBy?: string;
};

export type TracesServicesParams = {
  database?: string;
  table: string;
  timeField: string;
  startDate: string;
  endDate: string;
};

export type TracesOperationsParams = {
  database?: string;
  table: string;
  timeField: string;
  startDate: string;
  endDate: string;
  service_name: string;
};
