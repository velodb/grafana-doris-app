// Package savedqueries stores organization-scoped Discover snapshots.
package savedqueries

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	_ "modernc.org/sqlite"
)

const MaxBody = 1 << 20

type App struct {
	mu   sync.Mutex
	db   *sql.DB
	path string
}

type Query struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	State       json.RawMessage `json:"state"`
	Author      string          `json:"author"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
	Revision    int64           `json:"revision"`
	CanEdit     bool            `json:"canEdit"`
	CanDelete   bool            `json:"canDelete"`
}

type mutation struct {
	Name        *string         `json:"name,omitempty"`
	Description *string         `json:"description,omitempty"`
	State       json.RawMessage `json:"state,omitempty"`
	Revision    int64           `json:"revision,omitempty"`
}

func New() *App {
	path := os.Getenv("DORIS_APP_STORAGE_PATH")
	if path == "" {
		path = "/var/lib/grafana/doris-app/saved-queries.db"
	}
	return &App{path: path}
}

func (a *App) Close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.db != nil {
		_ = a.db.Close()
		a.db = nil
	}
}

// Open lazily and retry failures: an unwritable directory must not prevent
// Discover from loading, and fixing its permissions should not require a restart.
func (a *App) database(ctx context.Context) (*sql.DB, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.db != nil {
		return a.db, nil
	}
	if err := os.MkdirAll(filepath.Dir(a.path), 0o700); err != nil {
		return nil, err
	}
	dsn := (&url.URL{Scheme: "file", Path: a.path}).String() + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	// A versioned, transactional migration keeps subsequent upgrades explicit.
	tx, err := db.BeginTx(ctx, nil)
	if err == nil {
		var version int
		if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
			_ = tx.Rollback()
			_ = db.Close()
			return nil, err
		}
		if version > 1 {
			_ = tx.Rollback()
			_ = db.Close()
			return nil, fmt.Errorf("unsupported saved queries database version: %d", version)
		}
		_, err = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS saved_queries (
			org_id INTEGER NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
			description TEXT NOT NULL, state TEXT NOT NULL, author TEXT NOT NULL,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
			PRIMARY KEY (org_id, id));
			CREATE INDEX IF NOT EXISTS saved_queries_updated ON saved_queries(org_id, updated_at DESC, id);
			PRAGMA user_version = 1;`)
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
	}
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	a.db = db
	return db, nil
}

func respond(sender backend.CallResourceResponseSender, status int, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"message":"Saved query data is corrupt"}`)
	}
	return sender.Send(&backend.CallResourceResponse{Status: status, Headers: map[string][]string{"Content-Type": {"application/json"}, "Cache-Control": {"no-store"}}, Body: body})
}

func failure(sender backend.CallResourceResponseSender, status int, message string) error {
	return respond(sender, status, map[string]string{"message": message})
}

func editable(user *backend.User, author string) bool {
	return user.Role == "Admin" || (user.Role == "Editor" && user.Login == author)
}

type scanner interface{ Scan(...any) error }

const columns = "id, name, description, state, author, created_at, updated_at, revision"

func scan(row scanner, user *backend.User) (Query, error) {
	var q Query
	var state string
	err := row.Scan(&q.ID, &q.Name, &q.Description, &state, &q.Author, &q.CreatedAt, &q.UpdatedAt, &q.Revision)
	q.State = json.RawMessage(state)
	q.CanEdit = editable(user, q.Author)
	q.CanDelete = q.CanEdit
	return q, err
}

func decode(body []byte, value any) error {
	if len(body) > MaxBody {
		return fmt.Errorf("request exceeds 1 MiB")
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("expected one JSON object")
	}
	return nil
}

func (a *App) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	user, org := req.PluginContext.User, req.PluginContext.OrgID
	if user == nil || user.Login == "" || org <= 0 || (user.Role != "Viewer" && user.Role != "Editor" && user.Role != "Admin") {
		return failure(sender, 401, "An authenticated organization member is required")
	}
	parsed, err := url.Parse(req.URL)
	if err != nil {
		return failure(sender, 400, "Invalid URL")
	}
	path := strings.Trim(req.Path, "/")
	parts := strings.Split(path, "/")
	if len(parts) > 2 || parts[0] != "saved-queries" {
		return failure(sender, 404, "Resource not found")
	}
	id := ""
	if len(parts) == 2 {
		id = parts[1]
		if id == "" {
			return failure(sender, 404, "Query not found")
		}
	}
	write := req.Method == http.MethodPost || req.Method == http.MethodPut || req.Method == http.MethodDelete
	if write && user.Role == "Viewer" {
		return failure(sender, 403, "Viewer cannot modify saved queries")
	}
	if len(req.Body) > MaxBody {
		return failure(sender, 413, "Request exceeds 1 MiB")
	}
	db, err := a.database(ctx)
	if err != nil {
		backend.Logger.Error("Saved queries storage unavailable", "error", err)
		return failure(sender, 503, "Saved queries storage is unavailable")
	}
	if id == "" && req.Method == http.MethodGet {
		params := parsed.Query()
		page, _ := strconv.Atoi(params.Get("page"))
		if page < 1 {
			page = 1
		}
		size, _ := strconv.Atoi(params.Get("pageSize"))
		if size < 1 || size > 100 {
			size = 20
		}
		if page > 1000000 {
			return failure(sender, 400, "Page is out of range")
		}
		search := strings.TrimSpace(params.Get("search"))
		var total int
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM saved_queries WHERE org_id=? AND instr(lower(name),lower(?)) > 0", org, search).Scan(&total)
		if err != nil {
			return storageFailure(sender, err)
		}
		rows, err := db.QueryContext(ctx, "SELECT "+columns+" FROM saved_queries WHERE org_id=? AND instr(lower(name),lower(?)) > 0 ORDER BY updated_at DESC, id LIMIT ? OFFSET ?", org, search, size, (page-1)*size)
		if err != nil {
			return storageFailure(sender, err)
		}
		defer rows.Close()
		items := []Query{}
		for rows.Next() {
			q, err := scan(rows, user)
			if err != nil {
				return storageFailure(sender, err)
			}
			items = append(items, q)
		}
		if err := rows.Err(); err != nil {
			return storageFailure(sender, err)
		}
		return respond(sender, 200, map[string]any{"items": items, "total": total, "canCreate": user.Role == "Editor" || user.Role == "Admin"})
	}
	if id == "" && req.Method == http.MethodPost {
		var input mutation
		if err := decode(req.Body, &input); err != nil {
			return failure(sender, 400, "Invalid request: "+err.Error())
		}
		if input.Name == nil || input.Revision != 0 {
			return failure(sender, 400, "A name is required; revision must be omitted when creating")
		}
		name := strings.TrimSpace(*input.Name)
		description := ""
		if input.Description != nil {
			description = strings.TrimSpace(*input.Description)
		}
		if err := validateInput(name, description, input.State); err != nil {
			return failure(sender, 400, err.Error())
		}
		now := time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z")
		q := Query{ID: uuid.NewString(), Name: name, Description: description, State: input.State, Author: user.Login, CreatedAt: now, UpdatedAt: now, Revision: 1, CanEdit: true, CanDelete: true}
		_, err := db.ExecContext(ctx, "INSERT INTO saved_queries (org_id,"+columns+") VALUES (?,?,?,?,?,?,?,?,?)", org, q.ID, q.Name, q.Description, string(q.State), q.Author, now, now, q.Revision)
		if err != nil {
			return storageFailure(sender, err)
		}
		return respond(sender, 201, q)
	}
	if id == "" {
		return failure(sender, 405, "Method not allowed")
	}
	q, err := scan(db.QueryRowContext(ctx, "SELECT "+columns+" FROM saved_queries WHERE org_id=? AND id=?", org, id), user)
	if errors.Is(err, sql.ErrNoRows) {
		return failure(sender, 404, "Query not found")
	}
	if err != nil {
		return storageFailure(sender, err)
	}
	if req.Method == http.MethodGet {
		return respond(sender, 200, q)
	}
	if req.Method != http.MethodPut && req.Method != http.MethodDelete {
		return failure(sender, 405, "Method not allowed")
	}
	if !q.CanEdit {
		return failure(sender, 403, "Only the author or an organization Admin can modify this query")
	}
	var input mutation
	if err := decode(req.Body, &input); err != nil {
		return failure(sender, 400, "Invalid request: "+err.Error())
	}
	if input.Revision <= 0 {
		return failure(sender, 400, "Revision is required")
	}
	var result sql.Result
	if req.Method == http.MethodDelete {
		result, err = db.ExecContext(ctx, "DELETE FROM saved_queries WHERE org_id=? AND id=? AND revision=?", org, id, input.Revision)
	} else {
		if input.Name != nil {
			q.Name = strings.TrimSpace(*input.Name)
		}
		if input.Description != nil {
			q.Description = strings.TrimSpace(*input.Description)
		}
		if input.State != nil {
			q.State = input.State
		}
		if err := validateInput(q.Name, q.Description, q.State); err != nil {
			return failure(sender, 400, err.Error())
		}
		q.UpdatedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z")
		q.Revision = input.Revision + 1
		result, err = db.ExecContext(ctx, "UPDATE saved_queries SET name=?, description=?, state=?, updated_at=?, revision=? WHERE org_id=? AND id=? AND revision=?", q.Name, q.Description, string(q.State), q.UpdatedAt, q.Revision, org, id, input.Revision)
	}
	if err != nil {
		return storageFailure(sender, err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return storageFailure(sender, err)
	}
	if count == 0 {
		return failure(sender, 409, "This query changed. Reload it before trying again; your changes have not been saved.")
	}
	if req.Method == http.MethodDelete {
		return respond(sender, 200, map[string]bool{"deleted": true})
	}
	return respond(sender, 200, q)
}

func storageFailure(sender backend.CallResourceResponseSender, err error) error {
	backend.Logger.Error("Saved queries storage error", "error", err)
	return failure(sender, 503, "Saved queries storage is unavailable")
}
