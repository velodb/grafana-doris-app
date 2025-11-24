package plugin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-logfmt/logfmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

var logfmtRegexp = regexp.MustCompile(`(\w+)=(".*?"|\S+)`)

// JSONResponse 封装标准的 JSON 响应
// 参数:
// - w: http.ResponseWriter
// - statusCode: HTTP 状态码，比如 200, 400, 500 等
// - data: 需要返回给客户端的数据（会被编码成 JSON）
func JSONResponse(w http.ResponseWriter, statusCode int, respBody []byte) {
	var raw map[string]interface{}
	if err := json.Unmarshal(respBody, &raw); err != nil {
		http.Error(w, "Failed to decode response JSON", http.StatusInternalServerError)
		return
	}

	// 提取 frames
	frames := []interface{}{}
	if results, ok := raw["results"].(map[string]interface{}); ok {
		if resultA, ok := results["A"].(map[string]interface{}); ok {
			if f, ok := resultA["frames"].([]interface{}); ok {
				frames = f
			}
		}
	}

	// 构造新结构
	filtered := map[string]interface{}{
		"results": frames,
	}

	// 返回新的 JSON
	filteredBody, err := json.Marshal(filtered)
	if err != nil {
		http.Error(w, "Failed to encode filtered response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	w.Write(filteredBody)
}

func AddSqlFilter(sql string, filter DataFilter) string {
	result := sql
	upperSQL := strings.ToUpper(sql)

	if !strings.Contains(upperSQL, "WHERE") {
		result += " WHERE"
	} else {
		result += " AND"
	}

	result += fmt.Sprintf(" (%s)", GetFilterSQL(filter))

	return result
}

func GetQueryTableChartsSQL(params QueryTableDataParams) string {
	statement := fmt.Sprintf(
		`SELECT %s_FLOOR(table_per_time.T,%d) as TT, sum(table_per_time.cnt) FROM (SELECT %s_FLOOR(%s) as T, count(*) as cnt FROM %s WHERE`,
		params.Interval, params.IntervalValue, params.Interval, params.TimeField, params.Table,
	)

	if params.Indexes != "" && params.SearchType == "Search" {
		statement += fmt.Sprintf(" (%s) AND", params.Indexes)
	}

	statement += fmt.Sprintf(" (%s between '%s' AND '%s')", params.TimeField, params.StartDate, params.EndDate)

	// 添加 data_filters
	if len(params.DataFilters) > 0 {
		for _, filter := range params.DataFilters {
			statement = AddSqlFilter(statement, filter)
		}
	}

	// 添加 search_value（仅当为 SQL 模式）
	if params.SearchType == "SQL" && params.SearchValue != "" {
		statement += " AND " + params.SearchValue
	}

	statement += " GROUP BY T ORDER BY T) as table_per_time GROUP BY TT ORDER BY TT"

	return statement
}

func GetQueryTableCountSQL(params QueryTableDataParams) string {
	statement := fmt.Sprintf(
		`SELECT SUM(table_per_time.cnt) AS total_count FROM (
			SELECT %s_FLOOR(%s) AS T, COUNT(*) AS cnt
			FROM %s
			WHERE`,
		params.Interval, params.TimeField, params.Table,
	)

	if params.Indexes != "" && params.SearchType == "Search" {
		statement += fmt.Sprintf(" (%s) AND", params.Indexes)
	}

	statement += fmt.Sprintf(" (%s BETWEEN '%s' AND '%s')",
		params.TimeField, params.StartDate, params.EndDate,
	)

	// 添加 data_filters
	if len(params.DataFilters) > 0 {
		for _, filter := range params.DataFilters {
			statement = AddSqlFilter(statement, filter)
		}
	}

	// SQL 方式的自定义搜索条件
	if params.SearchType == "SQL" && params.SearchValue != "" {
		statement += " AND " + params.SearchValue
	}

	statement += " GROUP BY T) AS table_per_time;"
	return statement
}

func GetQueryTableDataSQL(params QueryTableDataParams) string {
	statement := fmt.Sprintf("SELECT * FROM %s WHERE", params.Table)

	log.DefaultLogger.Info("IndexesStatement: %v", params.IndexesStatement)

	if params.IndexesStatement != "" && params.SearchType == "Search" {
		statement += fmt.Sprintf(" (%s) AND", params.IndexesStatement)
	}

	statement += fmt.Sprintf(" (%s BETWEEN '%s' AND '%s')",
		params.TimeField, params.StartDate, params.EndDate,
	)

	// 添加 data_filters
	for _, filter := range params.DataFilters {
		statement = AddSqlFilter(statement, filter)
	}

	// 如果是 SQL 模式，自定义 SQL 条件
	if params.SearchType == "SQL" && params.SearchValue != "" {
		statement += " AND " + params.SearchValue
	}

	// 分页：按时间字段降序排序 + limit offset
	offset := (params.Page - 1) * params.PageSize
	statement += fmt.Sprintf(" ORDER BY %s DESC LIMIT %d OFFSET %d",
		params.TimeField, params.PageSize, offset,
	)

	return statement
}

func GetQueryTableTraceSQL(params QueryTraceDetailParams) string {
	statement := fmt.Sprintf(
		`SELECT trace_id AS traceID, 
		span_id AS spanID,
		parent_span_id AS parentSpanID,
		span_name AS operationName,
		service_name AS serviceName,
		CONCAT(
			'[',
			array_join(
				array_map(
					(x, y) -> json_object('key', x, 'value', y),
					map_keys(CAST(CAST(resource_attributes AS TEXT) AS MAP<STRING, STRING>)),
					map_values(CAST(CAST(resource_attributes AS TEXT) AS MAP<STRING, STRING>))
				),
				','
			),
			']'
		) AS serviceTags,
		UNIX_TIMESTAMP(timestamp) * 1000 AS startTime,
		duration / 1000 AS duration,
		CONCAT(
			'[',
			array_join(
				array_map(
					(x, y) -> json_object('key', x, 'value', y),
					map_keys(CAST(CAST(span_attributes AS TEXT) AS MAP<STRING, STRING>)),
					map_values(CAST(CAST(span_attributes AS TEXT) AS MAP<STRING, STRING>))
				),
				','
			),
			']'
		) AS tags,
		span_kind AS kind,
		CASE status_code
			WHEN 'STATUS_CODE_OK' THEN 1
			WHEN 'STATUS_CODE_ERROR' THEN 2
			ELSE 0
		END AS statusCode,
		status_message AS statusMessage,
		scope_name AS instrumentationLibraryName,
		scope_version AS instrumentationLibraryVersion,
		trace_state AS traceState
		FROM %s WHERE trace_id = '%s'`,
		params.Table, params.TraceId,
	)
	return statement
}

// 构造聚合 trace 列表的 SQL 查询语句
func BuildTraceAggSQLFromParams(params QueryTracesParams) string {
	timeFilter := fmt.Sprintf(
		"%s >= '%s' AND %s < '%s'",
		params.TimeField, params.StartDate,
		params.TimeField, params.EndDate,
	)

	serviceFilter := "1=1"
	if params.ServiceName != "" && params.ServiceName != "all" {
		serviceFilter = fmt.Sprintf("service_name = '%s'", params.ServiceName)
	}

	operationFilter := "1=1"
	if params.Operation != "" && params.Operation != "all" {
		operationFilter = fmt.Sprintf("span_name = '%s'", params.Operation)
	}

	statusFilter := "1=1"
	if params.StatusCode != "" && params.StatusCode != "all" {
		statusFilter = fmt.Sprintf("status_code = '%s'", params.StatusCode)
	}

	durationFilter := "1=1"
	parseDuration := func(input string) int64 {
		if strings.HasSuffix(input, "ms") {
			value, err := time.ParseDuration(input)
			if err == nil {
				return value.Milliseconds()
			}
		} else if strings.HasSuffix(input, "us") {
			value, err := time.ParseDuration(strings.Replace(input, "us", "µs", 1))
			if err == nil {
				return value.Microseconds()
			}
		} else if strings.HasSuffix(input, "s") {
			value, err := time.ParseDuration(input)
			if err == nil {
				return value.Milliseconds() * 1000
			}
		}
		return 0
	}

	minDuration := parseDuration(params.MinDurationStr)
	maxDuration := parseDuration(params.MaxDurationStr)

	if minDuration > 0 && maxDuration > 0 {
		durationFilter = fmt.Sprintf("trace_duration BETWEEN %d AND %d", minDuration, maxDuration)
	} else if minDuration > 0 {
		durationFilter = fmt.Sprintf("trace_duration >= %d", minDuration)
	} else if maxDuration > 0 {
		durationFilter = fmt.Sprintf("trace_duration <= %d", maxDuration)
	}

	tagsFilter := "1=1"
	if params.Tags != "" {
		var err error
		tagsFilter, err = TagsToDorisSQLConditions(params.Tags)
		if err != nil {
			log.DefaultLogger.Error("Failed to parse tags to Doris SQL conditions", "error", err)
			tagsFilter = "1=1"
		}
	}

	rootSpansFilter := "1=1"
	if params.ServiceName != "" && params.ServiceName != "all" {
		rootSpansFilter = fmt.Sprintf("service_name = '%s'", params.ServiceName)
	}

	if params.Operation != "" && params.Operation != "all" {
		rootSpansFilter += fmt.Sprintf(" AND span_name = '%s'", params.Operation)
	}

	limit := params.PageSize
	if limit <= 0 {
		limit = 1000
	}
	offset := (params.Page - 1) * params.PageSize
	if offset < 0 {
		offset = 0
	}

	// 构造排序子句，用于ROW_NUMBER()
	var rowNumberOrderBy string
	switch params.SortBy {
	case "longest-duration":
		rowNumberOrderBy = "trace_duration_ms DESC"
	case "shortest-duration":
		rowNumberOrderBy = "trace_duration_ms ASC"
	case "most-spans":
		rowNumberOrderBy = "spans DESC"
	case "least-spans":
		rowNumberOrderBy = "spans ASC"
	case "most-recent":
		rowNumberOrderBy = "time DESC"
	default:
		rowNumberOrderBy = "time DESC"
	}

	query := fmt.Sprintf(`
USE %s;

WITH
	trace_durations AS (
		SELECT
			trace_id,
			(UNIX_TIMESTAMP(MAX(end_time)) - UNIX_TIMESTAMP(MIN(timestamp))) * 1000 AS trace_duration
		FROM %s
		WHERE %s
		GROUP BY trace_id
	),
	all_trace_ids AS (
		SELECT
			t.trace_id,
			MIN(t.%s) AS time,
			d.trace_duration
		FROM %s t
		JOIN trace_durations d ON t.trace_id = d.trace_id
		WHERE
			%s
			AND %s
			AND %s
			AND %s
			AND %s
			AND %s
		GROUP BY t.trace_id, d.trace_duration
		HAVING %s
	),
	root_spans AS (
		SELECT
			trace_id,
			span_name AS operation,
			service_name AS root_service
		FROM %s
		WHERE (parent_span_id IS NULL OR parent_span_id = '') AND %s
	),
	aggregated AS (
		SELECT
			UNIX_TIMESTAMP(MIN(t.%s)) AS time,
			t.trace_id,
			r.operation,
			r.root_service,
			COLLECT_SET(t.service_name) AS services,
			COUNT(*) AS spans,
			SUM(IF(status_code = 'STATUS_CODE_ERROR', 1, 0)) AS error_spans,
			MAX(duration) / 1000 AS max_span_duration_ms,
			MAX(UNIX_TIMESTAMP(t.timestamp) * 1000 + duration / 1000) - MIN(UNIX_TIMESTAMP(t.timestamp) * 1000) AS trace_duration_ms,
			MAX(IF(t.parent_span_id IS NULL OR t.parent_span_id = '', duration, 0)) / 1000 AS root_span_duration_ms
		FROM %s t
		JOIN all_trace_ids a ON t.trace_id = a.trace_id
		JOIN root_spans r ON t.trace_id = r.trace_id
		GROUP BY t.trace_id, r.operation, r.root_service
	),
	numbered AS (
		SELECT
			a.*,
			COUNT(*) OVER() AS total_count,
			ROW_NUMBER() OVER(ORDER BY %s) AS rn
		FROM aggregated a
	)

SELECT
	*,
	total_count AS total
FROM numbered
WHERE rn > %d AND rn <= %d
ORDER BY %s;
	`,
		params.Database,
		params.Table,
		timeFilter,
		params.TimeField,
		params.Table,
		timeFilter,
		serviceFilter,
		operationFilter,
		statusFilter,
		tagsFilter,
		"1=1",
		durationFilter,
		params.Table,
		rootSpansFilter,
		params.TimeField,
		params.Table,
		rowNumberOrderBy,
		offset,
		offset+limit,
		rowNumberOrderBy,
	)

	return query
}

// BuildSpanAttributeConditions 解析 logfmt 样式 tags 字符串为 SQL LIKE 条件
func BuildSpanAttributeConditions(tags string) ([]string, error) {
	// 第一步：如果是 JSON 字符串，尝试反转义
	unquoted, err := strconv.Unquote(tags)
	if err != nil {
		// 如果不是合法的 JSON 字符串格式，fallback 用原始值
		unquoted = tags
	}

	// 第二步：正则提取 key=value 或 key="value"
	re := regexp.MustCompile(`([\w\.\-/]+)=("(.*?)"|([^"\s]+))`)
	matches := re.FindAllStringSubmatch(unquoted, -1)

	conditions := make([]string, 0, len(matches))

	for _, match := range matches {
		key := match[1]
		val := match[3]
		if val == "" {
			val = match[4]
		}

		if key != "" && val != "" {
			cond := fmt.Sprintf(`span_attributes LIKE '%%"%s":"%s"%%'`, key, val)
			conditions = append(conditions, cond)
		}
	}

	return conditions, nil
}

func TransformFieldPath(fieldPath string) string {
	parts := strings.Split(fieldPath, ".")
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, part := range parts[1:] {
		result += fmt.Sprintf("['%s']", part)
	}
	return result
}

func TagsToDorisSQLConditions(tags string) (string, error) {
	var conditions []string
	d := logfmt.NewDecoder(strings.NewReader(tags))

	for d.ScanRecord() {
		for d.ScanKeyval() {
			key := string(d.Key())
			val := string(d.Value())
			// Doris VARIANT 字段查询格式
			cond := fmt.Sprintf("span_attributes['%s'] = '%s'", key, val)
			conditions = append(conditions, cond)
		}
	}
	if err := d.Err(); err != nil {
		return "", err
	}
	return strings.Join(conditions, " AND "), nil
}

func GetFilterSQL(filter DataFilter) string {
	transformedField := TransformFieldPath(filter.FieldName)

	// 转换 value 为 SQL 安全字符串
	valueStrings := make([]string, len(filter.Value))
	for i, v := range filter.Value {
		switch val := v.(type) {
		case string:
			valueStrings[i] = fmt.Sprintf("'%s'", val)
		default:
			valueStrings[i] = fmt.Sprintf("%v", val)
		}
	}

	operator := strings.ToLower(filter.Operator)

	switch operator {
	case "=", "!=", "like", "not like", "match_all", "match_any", "match_phrase", "match_phrase_prefix":
		return fmt.Sprintf("%s %s %s", transformedField, operator, valueStrings[0])
	case "is null", "is not null":
		return fmt.Sprintf("%s %s", transformedField, operator)
	case "between", "not between":
		if len(valueStrings) >= 2 {
			return fmt.Sprintf("%s %s %s AND %s", transformedField, operator, valueStrings[0], valueStrings[1])
		}
	case "in", "not in":
		return fmt.Sprintf("%s %s (%s)", transformedField, operator, strings.Join(valueStrings, ", "))
	}

	return ""
}

func getSurroundingDataSQL(params SurroundingParams) string {
	statement := fmt.Sprintf("SELECT * FROM %s WHERE (%s %s '%s')",
		params.Table, params.TimeField, params.Operator, params.Time)

	for _, filter := range params.DataFilters {
		statement = AddSqlFilter(statement, filter)
	}

	orderSymbol := "ASC"
	if params.Operator == "<" {
		orderSymbol = "DESC"
	}

	statement += fmt.Sprintf(" ORDER BY %s %s LIMIT %d", params.TimeField, orderSymbol, params.PageSize)
	return statement
}

func GetServiceListSQL(params TracesServicesParams) string {
	return fmt.Sprintf(`
		SELECT DISTINCT service_name 
		FROM %s 
		WHERE %s BETWEEN '%s' AND '%s' 
		ORDER BY service_name ASC
	`,
		params.Table,
		params.TimeField, params.StartDate, params.EndDate,
	)
}

func GetOperationListSQL(params TracesOperationsParams) string {
	return fmt.Sprintf(`
		SELECT DISTINCT span_name 
		FROM %s 
		WHERE %s BETWEEN '%s' AND '%s' 
		AND service_name = '%s'
		ORDER BY span_name ASC
	`,
		params.Table,
		params.TimeField, params.StartDate, params.EndDate,
		params.ServiceName,
	)
}

type QueryResult struct {
	Results map[string]struct {
		Status int `json:"status"`
		Frames []struct {
			Fields []struct {
				Name string `json:"name"`
			} `json:"fields"`
			Data struct {
				Values [][]interface{} `json:"values"`
			} `json:"data"`
		} `json:"frames"`
	} `json:"results"`
}

func AggregateTraces(rawRows []RawTraceRow) []AggregatedTrace {
	traceMap := make(map[string]*AggregatedTrace)

	for _, row := range rawRows {
		agg, exists := traceMap[row.TraceID]
		if !exists {
			agg = &AggregatedTrace{
				TraceID:         row.TraceID,
				RootServiceName: row.RootServiceName,
				RootSpanName:    row.RootSpanName,
				RootSpanKind:    row.RootSpanKind,
				RootStatusCode:  row.RootStatusCode,
				Operation:       row.Operation,
				StartTime:       row.StartTime,
				EndTime:         row.EndTime,
				DurationUs:      row.DurationUs,
				SpanCount:       row.SpanCount,
				ServiceTags:     row.ResourceAttrs, // 直接赋值，不做处理
			}
			traceMap[row.TraceID] = agg
		}
		// 如果后续还有同一 traceID 的行，不做合并 ServiceTags
	}

	// 转成切片返回
	results := make([]AggregatedTrace, 0, len(traceMap))
	for _, v := range traceMap {
		results = append(results, *v)
	}

	// 按 StartTime 降序排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].StartTime > results[j].StartTime
	})

	return results
}
