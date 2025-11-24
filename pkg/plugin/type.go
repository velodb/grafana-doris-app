package plugin

type DataFilter struct {
	// 自定义结构体，你需要根据实际结构定义字段，比如：
	FieldName string
	Operator  string
	Value     []interface{}
}

type QueryTraceDetailParams struct {
	DS       string // 数据源标识
	Catalog  string `json:"catalog"`
	Database string `json:"database"`
	Table    string `json:"table"`
	Cluster  string `json:"cluster"`
	TraceId  string `json:"trace_id"`
}

type QueryTableDataParams struct {
	Catalog          string       `json:"catalog"`
	Database         string       `json:"database"`
	Table            string       `json:"table"`
	Cluster          string       `json:"cluster"`
	StartDate        string       `json:"startDate"`
	EndDate          string       `json:"endDate"`
	Sort             string       `json:"sort"`
	TimeField        string       `json:"timeField"`
	Interval         string       `json:"interval"`       // 可用枚举限制
	IntervalValue    int          `json:"interval_value"` // 数值，需转为 int
	DataFilters      []DataFilter `json:"data_filters"`   // 自定义类型数组，需提前定义
	SearchType       string       `json:"search_type"`    // 'Search' | 'SQL'
	SearchValue      string       `json:"search_value"`
	Indexes          string       `json:"indexes"`
	IndexesStatement string       `json:"indexes_statement"` // 用于 Search 模式的索引查询
	DS               string       // 数据源标识
	PageSize         int          `json:"page_size"` // 分页大小
	Page             int          `json:"page"`      // 当前页码
	TraceId          string       `json:"trace_id"`
}

// type QueryTracesParams struct {
// 	Catalog   string `json:"catalog"`
// 	Database  string `json:"database"`
// 	Table     string `json:"table"`
// 	Cluster   string `json:"cluster"`
// 	StartDate string `json:"startDate"`
// 	EndDate   string `json:"endDate"`
// 	TimeField string `json:"timeField"`
// 	DS        string // 数据源标识
// 	PageSize  int    `json:"page_size"` // 分页大小
// 	Page      int    `json:"page"`      // 当前页码
// }

type SurroundingParams struct {
	Table       string
	Database    string
	TimeField   string
	Operator    string // "<" or ">"
	Time        string
	DataFilters []DataFilter `json:"data_filters"`
	PageSize    int
	DS          string // 数据源标识
}

type TracesServicesParams struct {
	Table     string
	Database  string
	TimeField string
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	DS        string // 数据源标识
}

type TracesOperationsParams struct {
	Table       string
	Database    string
	TimeField   string
	ServiceName string `json:"serviceName"`
	StartDate   string `json:"startDate"`
	EndDate     string `json:"endDate"`
	DS          string // 数据源标识
}

type RawTraceRow struct {
	TraceID         string `json:"trace_id"`
	RootServiceName string `json:"root_service_name"`
	RootSpanName    string `json:"root_span_name"`
	RootSpanKind    string `json:"root_span_kind"`
	RootStatusCode  string `json:"root_status_code"`
	Operation       string `json:"operation"`
	ResourceAttrs   string `json:"resource_attributes"`
	StartTime       string `json:"start_time"` // 改成 string
	EndTime         string `json:"end_time"`   // 改成 string
	DurationUs      int64  `json:"duration_us"`
	SpanCount       int64  `json:"span_count"`
}

type QueryTracesParams struct {
	Catalog        string `json:"catalog"`
	Database       string `json:"database"`
	Table          string `json:"table"`
	Cluster        string `json:"cluster"`
	StartDate      string `json:"startDate"`
	EndDate        string `json:"endDate"`
	TimeField      string `json:"timeField"`
	DS             string // 数据源标识
	PageSize       int    `json:"page_size"` // 分页大小
	Page           int    `json:"page"`      // 当前页码
	ServiceName    string `json:"service_name"`
	Operation      string `json:"operation"`
	StatusCode     string `json:"status_code"`
	MinDurationStr string `json:"minDuration"` // 单位微秒
	// 例如：1000us, 1s, 500ms
	MaxDurationStr string `json:"maxDuration"`
	Tags           string // logfmt 格式：error=true http.url="http://abc.com"
	SortBy         string `json:"sort_by"` // 'most-recent' | 'longest-duration'
}

type AggregatedTrace struct {
	TraceID         string
	RootServiceName string
	RootSpanName    string
	RootSpanKind    string
	RootStatusCode  string
	Operation       string
	ServiceTags     string // 经过聚合转换后的字符串
	StartTime       string
	EndTime         string
	DurationUs      int64
	SpanCount       int64
}
