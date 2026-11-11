package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type note struct {
	ID      int64  `json:"id"`
	Text    string `json:"text"`
	Created string `json:"created"`
}

func main() {
	dbPath := env("DB", "/data/app.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		log.Fatalf("create data directory: %v", err)
	}
	db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		text TEXT NOT NULL,
		created TEXT NOT NULL
	)`); err != nil {
		log.Fatalf("create table: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/notes", func(w http.ResponseWriter, _ *http.Request) {
		list, err := notes(db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read notes"})
			return
		}
		writeJSON(w, http.StatusOK, list)
	})
	mux.HandleFunc("POST /api/notes", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}
		text := strings.TrimSpace(body.Text)
		if text == "" || len(text) > 500 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "text must be 1-500 characters"})
			return
		}
		created := time.Now().UTC().Format(time.RFC3339)
		result, err := db.Exec(`INSERT INTO notes (text, created) VALUES (?, ?)`, text, created)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save note"})
			return
		}
		id, _ := result.LastInsertId()
		writeJSON(w, http.StatusCreated, note{ID: id, Text: text, Created: created})
	})
	mux.HandleFunc("DELETE /api/notes/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
			return
		}
		result, err := db.Exec(`DELETE FROM notes WHERE id = ?`, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete note"})
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "note not found"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle("/", spa("web"))

	addr := ":" + env("PORT", "3000")
	log.Printf("notes listening on %s, database %s", addr, dbPath)
	if err := http.ListenAndServe(addr, mux); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func notes(db *sql.DB) ([]note, error) {
	rows, err := db.Query(`SELECT id, text, created FROM notes ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]note, 0)
	for rows.Next() {
		var item note
		if err := rows.Scan(&item.ID, &item.Text, &item.Created); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func spa(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
