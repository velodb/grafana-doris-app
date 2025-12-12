package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// handlePing is an example HTTP GET resource that returns a {"message": "ok"} JSON response.
func (a *App) handlePing(w http.ResponseWriter, req *http.Request) {
	w.Header().Add("Content-Type", "application/json")
	if _, err := w.Write([]byte(`{"message": "ok"}`)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// 获取表
func (a *App) handleTable(w http.ResponseWriter, req *http.Request) {
	q := req.URL.Query()
	ds := q.Get("ds")
	database := q.Get("database")

	sql := fmt.Sprintf("USE `%s`; SHOW TABLES;", database)

	log.DefaultLogger.Info("Exec SQL: %d", sql)
	data, err := handleProxyQuery(sql, ds)
	if err != nil {
		fmt.Println("Query error:", err)
	} else {
		fmt.Println("Query result:", string(data))
	}
	JSONResponse(w, http.StatusOK, data)
}

// 获取数据库
func (a *App) handleDatabase(w http.ResponseWriter, req *http.Request) {
	q := req.URL.Query()
	ds := q.Get("ds")

	sql := `SWITCH internal; SHOW DATABASES;`

	log.DefaultLogger.Info("Exec SQL: %d", sql)
	data, err := handleProxyQuery(sql, ds)
	if err != nil {
		fmt.Println("Query error:", err)
	} else {
		fmt.Println("Query result:", string(data))
	}
	JSONResponse(w, http.StatusOK, data)

}

// 获取字段
func (a *App) handleFields(w http.ResponseWriter, req *http.Request) {
	q := req.URL.Query()
	ds := q.Get("ds")
	database := q.Get("database")
	table := q.Get("table")

	sql := fmt.Sprintf("USE `%s`; set describe_extend_variant_column = true; DESC `%s`;", database, table)

	data, err := handleProxyQuery(sql, ds)
	if err != nil {
		fmt.Println("Query error:", err)
	} else {
		fmt.Println("Query result:", string(data))
	}
	JSONResponse(w, http.StatusOK, data)
}

// 获取索引
func (a *App) handleIndexes(w http.ResponseWriter, req *http.Request) {
	q := req.URL.Query()
	ds := q.Get("ds")
	table := q.Get("table")
	database := q.Get("database")

	showIndexesSQL := fmt.Sprintf(`SHOW INDEX FROM %s;`, table)

	sql := "USE `" + database + "`;" + showIndexesSQL

	log.DefaultLogger.Info("Exec SQL: %d", sql)
	data, err := handleProxyQuery(sql, ds)
	if err != nil {
		fmt.Println("Query error:", err)
	} else {
		fmt.Println("Query result:", string(data))
	}
	JSONResponse(w, http.StatusOK, data)
}

// 查询charts数据
func (a *App) handleTableDataCharts(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Step 1: 解析请求 JSON
	var params QueryTableDataParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	queryTableChartsSQL := GetQueryTableChartsSQL(params)
	sql := "USE `" + params.Database + "`;" + queryTableChartsSQL

	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Step 4: 返回 JSON 响应
	JSONResponse(w, http.StatusOK, result)
}

func (a *App) handleTableDataCount(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Step 1: 解析请求 JSON
	var params QueryTableDataParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	queryTableChartsSQL := GetQueryTableCountSQL(params)
	sql := "USE `" + params.Database + "`;" + queryTableChartsSQL

	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Step 4: 返回 JSON 响应
	JSONResponse(w, http.StatusOK, result)
}

func (a *App) handleTableData(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Step 1: 解析请求 JSON
	var params QueryTableDataParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		log.DefaultLogger.Error("Invalid JSON body:", err)
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	queryTableChartsSQL := GetQueryTableDataSQL(params)
	// sql := `USE ` + params.Database + `;` + queryTableChartsSQL
	sql := "USE `" + params.Database + "`;" + queryTableChartsSQL
	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	JSONResponse(w, http.StatusOK, result)
}

func (a *App) handleTopData(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Step 1: 解析请求 JSON
	var params QueryTableDataParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		log.DefaultLogger.Error("Invalid JSON body:", err)
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	queryTableChartsSQL := GetQueryTableDataSQL(params)
	// sql := `USE ` + params.Database + `;` + queryTableChartsSQL
	sql := "USE `" + params.Database + "`;" + queryTableChartsSQL
	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	JSONResponse(w, http.StatusOK, result)
}

func (a *App) handleTraces(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Step 1: 解析请求 JSON
	var params QueryTracesParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		log.DefaultLogger.Error("Invalid JSON body:", err)
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	queryTableChartsSQL := BuildTraceAggSQLFromParams(params)
	// sql := `USE ` + params.Database + `;` + queryTableChartsSQL
	sql := queryTableChartsSQL
	log.DefaultLogger.Info(fmt.Sprintf("Exec SQL: %s", sql))

	// Step 3: 执行查询
	ds := params.DS
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}

	// rawTraces, err := parseRawTracesFromGrafanaResult(result)
	// if err != nil {
	// 	log.DefaultLogger.Error("Failed to parse raw traces:", err)
	// 	http.Error(w, fmt.Sprintf("Failed to parse raw traces: %v", err), http.StatusInternalServerError)
	// 	return
	// }

	// aggregated := AggregateTraces(rawTraces)
	// if err != nil {
	// 	log.DefaultLogger.Error("Failed to marshal aggregated traces:", err)
	// 	http.Error(w, fmt.Sprintf("Failed to marshal aggregated traces: %v", err), http.StatusInternalServerError)
	// 	return
	// }

	// framesPayload := map[string]interface{}{
	// 	"results": map[string]interface{}{
	// 		"A": map[string]interface{}{
	// 			"frames": aggregated,
	// 		},
	// 	},
	// }

	// payloadBytes, err := json.Marshal(framesPayload)
	// if err != nil {
	// 	http.Error(w, "Failed to marshal response", http.StatusInternalServerError)
	// 	return
	// }

	JSONResponse(w, http.StatusOK, result)

}

func (a *App) handleTableDataTrace(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Step 1: 解析请求 JSON
	var params QueryTraceDetailParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		log.DefaultLogger.Error("Invalid JSON body:", err)
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	queryTableChartsSQL := GetQueryTableTraceSQL(params)
	// sql := `USE ` + params.Database + `;` + queryTableChartsSQL
	sql := "USE `" + params.Database + "`;" + queryTableChartsSQL
	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	JSONResponse(w, http.StatusOK, result)
}

func (a *App) handleSurroundingData(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Step 1: 解析请求 JSON
	var params SurroundingParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		log.DefaultLogger.Error("Invalid JSON body:", err)
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	surroundingDataSQL := getSurroundingDataSQL(params)
	// sql := `USE ` + params.Database + `;` + queryTableChartsSQL
	sql := "USE `" + params.Database + "`;" + surroundingDataSQL
	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	// shanghai, _ := time.LoadLocation("Asia/Shanghai")
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	JSONResponse(w, http.StatusOK, result)
}

// handleEcho is an example HTTP POST resource that accepts a JSON with a "message" key and
// returns to the client whatever it is sent.
func (a *App) handleEcho(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Add("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (a *App) handleTracesServices(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var params TracesServicesParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		log.DefaultLogger.Error("Invalid JSON body:", err)
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	tracesServicesSQL := GetServiceListSQL(params)
	// sql := `USE ` + params.Database + `;` + queryTableChartsSQL
	sql := "USE `" + params.Database + "`;" + tracesServicesSQL
	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	// shanghai, _ := time.LoadLocation("Asia/Shanghai")
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	JSONResponse(w, http.StatusOK, result)
}

func (a *App) handleTracesOperations(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var params TracesOperationsParams
	err := json.NewDecoder(req.Body).Decode(&params)
	if err != nil {
		log.DefaultLogger.Error("Invalid JSON body:", err)
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	paramsJSON, _ := json.Marshal(params)
	log.DefaultLogger.Info(fmt.Sprintf("params: %s", paramsJSON))

	// Step 2: 构建 SQL
	tracesServicesSQL := GetOperationListSQL(params)
	// sql := `USE ` + params.Database + `;` + queryTableChartsSQL
	sql := "USE `" + params.Database + "`;" + tracesServicesSQL
	log.DefaultLogger.Info("Exec SQL: %s", sql)

	// Step 3: 执行查询
	ds := params.DS
	// shanghai, _ := time.LoadLocation("Asia/Shanghai")
	result, err := handleProxyQuery(sql, ds)
	if err != nil {
		log.DefaultLogger.Error("Query failed error:", err)
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	JSONResponse(w, http.StatusOK, result)
}

// registerRoutes takes a *http.ServeMux and registers some HTTP handlers.
func (a *App) registerRoutes(mux *http.ServeMux) {
	log.DefaultLogger.Info("registerRoutes")
	mux.HandleFunc("/ping", a.handlePing)
	mux.HandleFunc("/table_data", a.handleTableData)
	mux.HandleFunc("/database", a.handleDatabase)
	mux.HandleFunc("/table", a.handleTable)
	mux.HandleFunc("/fields", a.handleFields)
	mux.HandleFunc("/indexes", a.handleIndexes)
	mux.HandleFunc("/echo", a.handleEcho)
	mux.HandleFunc("/table_data_charts", a.handleTableDataCharts)
	mux.HandleFunc("/table_data_count", a.handleTableDataCount)
	mux.HandleFunc("/top_data", a.handleTopData)
	mux.HandleFunc("/table_data_trace", a.handleTableDataTrace)
	mux.HandleFunc("/surrounding_data", a.handleSurroundingData)
	mux.HandleFunc("/traces", a.handleTraces)
	mux.HandleFunc("/traces_services", a.handleTracesServices)
	mux.HandleFunc("/traces_operations", a.handleTracesOperations)

	// mux.HandleFunc("/query", a.handleProxyQuery)
}

func handleProxyQuery(sql string, dsUID string) ([]byte, error) {
	if sql == "" || dsUID == "" {
		return nil, fmt.Errorf("missing sql or dsUID")
	}

	// 构造查询体，符合 Grafana /api/ds/query 格式
	bodyData := map[string]interface{}{
		"queries": []map[string]interface{}{
			{
				"refId": "A",
				"datasource": map[string]string{
					"uid": dsUID,
				},
				"rawSql": sql,
				"format": "table",
			},
		},
	}

	jsonBody, err := json.Marshal(bodyData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal JSON: %w", err)
	}

	req, err := http.NewRequest("POST", "http://localhost:3000/api/ds/query", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Datasource-Uid", dsUID)

	// ⚠️ 如 Grafana 启用了鉴权，添加 Authorization 头（可选）
	// token := os.Getenv("GF_API_TOKEN")
	// if token != "" {
	//     req.Header.Set("Authorization", "Bearer "+token)
	// }

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("query failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}
