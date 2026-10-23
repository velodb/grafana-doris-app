package savedqueries

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type capture struct{ response *backend.CallResourceResponse }

func (c *capture) Send(r *backend.CallResourceResponse) error { c.response = r; return nil }

const validState = `{"version":1,"datasource":"doris","database":"otel","table":"logs","timeField":"timestamp","timeZone":"UTC","mode":"Lucene","query":"level:ERROR","timeRawFrom":"now-1h","timeRawTo":"now","filters":[],"selectedFields":[],"columnOrder":[],"sort":{"field":"timestamp","direction":"DESC"}}`

func call(t *testing.T, a *App, org int64, login, role, method, path, body string) *backend.CallResourceResponse {
	t.Helper()
	c := &capture{}
	url := "http://localhost/" + path
	if err := a.CallResource(context.Background(), &backend.CallResourceRequest{
		PluginContext: backend.PluginContext{OrgID: org, User: &backend.User{Login: login, Role: role}},
		Method:        method, Path: strings.Split(path, "?")[0], URL: url, Body: []byte(body),
	}, c); err != nil {
		t.Fatal(err)
	}
	if c.response == nil {
		t.Fatal("no response")
	}
	return c.response
}

func requireStatus(t *testing.T, response *backend.CallResourceResponse, status int) {
	t.Helper()
	if response.Status != status {
		t.Fatalf("got %d, want %d: %s", response.Status, status, response.Body)
	}
}

func create(t *testing.T, a *App) Query {
	t.Helper()
	r := call(t, a, 1, "alice", "Editor", "POST", "saved-queries", `{"name":" Errors ","state":`+validState+`}`)
	requireStatus(t, r, 201)
	var q Query
	if err := json.Unmarshal(r.Body, &q); err != nil {
		t.Fatal(err)
	}
	return q
}

func TestCRUDIsolationAndPermissions(t *testing.T) {
	a := &App{path: filepath.Join(t.TempDir(), "queries.db")}
	defer a.Close()
	q := create(t, a)
	if q.Name != "Errors" || q.Revision != 1 || q.Author != "alice" {
		t.Fatalf("unexpected query: %+v", q)
	}
	path := "saved-queries/" + q.ID
	for _, tc := range []struct {
		org                       int64
		login, role, method, body string
		status                    int
	}{
		{1, "bob", "Viewer", "GET", "", 200}, {2, "alice", "Admin", "GET", "", 404},
		{1, "bob", "Viewer", "POST", `{}`, 403}, {1, "bob", "Viewer", "PUT", `{"revision":1,"name":"x"}`, 403},
		{1, "bob", "Editor", "PUT", `{"revision":1,"name":"x"}`, 403}, {1, "bob", "Editor", "DELETE", `{"revision":1}`, 403},
		{1, "alice", "Editor", "PUT", `{"revision":1,"name":"renamed"}`, 200},
		{1, "alice", "Editor", "PUT", `{"revision":1,"name":"stale"}`, 409},
		{1, "admin", "Admin", "DELETE", `{"revision":1}`, 409},
		{1, "admin", "Admin", "PUT", `{"revision":2,"description":"triage"}`, 200},
		{1, "admin", "Admin", "DELETE", `{"revision":3}`, 200},
		{1, "alice", "Editor", "GET", "", 404},
	} {
		t.Run(fmt.Sprintf("%d-%s-%s-%d", tc.org, tc.login, tc.method, tc.status), func(t *testing.T) {
			target := path
			if tc.method == "POST" {
				target = "saved-queries"
			}
			requireStatus(t, call(t, a, tc.org, tc.login, tc.role, tc.method, target, tc.body), tc.status)
		})
	}
}

func TestListAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "queries.db")
	a := &App{path: path}
	q := create(t, a)
	a.Close()
	a = &App{path: path}
	defer a.Close()
	r := call(t, a, 1, "bob", "Viewer", "GET", "saved-queries?search=error&page=1&pageSize=1", "")
	requireStatus(t, r, 200)
	var list struct {
		Items     []Query `json:"items"`
		Total     int     `json:"total"`
		CanCreate bool    `json:"canCreate"`
	}
	if err := json.Unmarshal(r.Body, &list); err != nil {
		t.Fatal(err)
	}
	if list.Total != 1 || len(list.Items) != 1 || list.Items[0].ID != q.ID || list.CanCreate || list.Items[0].CanEdit {
		t.Fatalf("unexpected list: %s", r.Body)
	}
	r = call(t, a, 2, "admin", "Admin", "GET", "saved-queries", "")
	requireStatus(t, r, 200)
	if !strings.Contains(string(r.Body), `"total":0`) {
		t.Fatal(string(r.Body))
	}
	r = call(t, a, 1, "bob", "Viewer", "GET", "saved-queries?search=%25", "")
	requireStatus(t, r, 200)
	if !strings.Contains(string(r.Body), `"total":0`) {
		t.Fatal("search wildcards must be literal")
	}
}

func TestValidationAndStorageFailure(t *testing.T) {
	a := &App{path: filepath.Join(t.TempDir(), "queries.db")}
	defer a.Close()
	for _, body := range []string{
		`{"name":"","state":` + validState + `}`, `{"name":"x","state":` + strings.Replace(validState, `"version":1`, `"version":2`, 1) + `}`,
		`{"name":"x","author":"admin","state":` + validState + `}`, `{"name":"x","orgId":2,"state":` + validState + `}`,
		`{"name":"x","state":` + strings.Replace(validState, `"filters":[]`, `"filters":[{}]`, 1) + `}`,
		`{"name":"x","state":` + strings.Replace(validState, `"selectedFields":[]`, `"selectedFields":null`, 1) + `}`,
		`{"name":"x","state":null}`, `{} {}`,
	} {
		requireStatus(t, call(t, a, 1, "alice", "Editor", "POST", "saved-queries", body), 400)
	}
	requireStatus(t, call(t, a, 1, "alice", "Editor", "POST", "saved-queries", strings.Repeat(" ", MaxBody+1)), 413)
	requireStatus(t, call(t, a, 0, "alice", "Admin", "GET", "saved-queries", ""), 401)
	requireStatus(t, call(t, a, 1, "", "Viewer", "GET", "saved-queries", ""), 401)
	blocked := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocked, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	b := &App{path: filepath.Join(blocked, "queries.db")}
	defer b.Close()
	requireStatus(t, call(t, b, 1, "alice", "Editor", "GET", "saved-queries", ""), 503)
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, call(t, b, 1, "alice", "Editor", "GET", "saved-queries", ""), 200)
}

func TestConcurrentUpdates(t *testing.T) {
	a := &App{path: filepath.Join(t.TempDir(), "queries.db")}
	defer a.Close()
	q := create(t, a)
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses <- call(t, a, 1, "alice", "Editor", "PUT", "saved-queries/"+q.ID, `{"revision":1,"name":"changed"}`).Status
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("lost update: %v", counts)
	}
}
