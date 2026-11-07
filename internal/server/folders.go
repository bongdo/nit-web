package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"

	"nitgui/internal/opencode"
)

const maxFolderEntries = 1000

type folderListing struct {
	Path      string   `json:"path"`
	Parent    string   `json:"parent"`
	Dirs      []string `json:"dirs"`
	Truncated bool     `json:"truncated,omitempty"`
}

func (s *Server) folders(w http.ResponseWriter, r *http.Request) {
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path != "" {
		if !filepath.IsAbs(path) {
			writeError(w, http.StatusBadRequest, "path must be absolute")
			return
		}
		path = filepath.Clean(path)
	} else {
		var loc struct {
			Directory string `json:"directory"`
		}
		if err := c.Do(r.Context(), http.MethodGet, "/api/location", nil, &loc); err != nil {
			s.upstreamError(w, r, err)
			return
		}
		path = filepath.Clean(loc.Directory)
		if !filepath.IsAbs(path) {
			writeError(w, http.StatusBadGateway, "OpenCode reported no working directory")
			return
		}
	}

	query := url.Values{}
	query.Set("location[directory]", path)
	query.Set("path", "")
	var raw struct {
		Data []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"data"`
	}
	if err := c.Do(r.Context(), http.MethodGet, "/api/fs/list?"+query.Encode(), nil, &raw); err != nil {
		var upstream *opencode.HTTPError
		if errors.As(err, &upstream) && upstream.Status == http.StatusNotFound {
			var body struct {
				Tag string `json:"_tag"`
			}
			if json.Unmarshal(upstream.Body, &body) == nil && strings.Contains(body.Tag, "LocationNotFound") {
				writeError(w, http.StatusNotFound, "no such folder")
				return
			}
			writeError(w, http.StatusBadGateway, "OpenCode cannot list folders")
			return
		}
		s.upstreamError(w, r, err)
		return
	}

	out := folderListing{Path: path, Parent: filepath.Dir(path), Dirs: []string{}}
	for _, entry := range raw.Data {
		if entry.Type != "directory" {
			continue
		}
		name := filepath.Base(strings.TrimSuffix(entry.Path, "/"))
		if name == "." || name == "/" || name == "" {
			continue
		}
		out.Dirs = append(out.Dirs, name)
	}
	sort.Slice(out.Dirs, func(i, j int) bool {
		hiddenI, hiddenJ := strings.HasPrefix(out.Dirs[i], "."), strings.HasPrefix(out.Dirs[j], ".")
		if hiddenI != hiddenJ {
			return !hiddenI
		}
		return strings.ToLower(out.Dirs[i]) < strings.ToLower(out.Dirs[j])
	})
	if len(out.Dirs) > maxFolderEntries {
		out.Dirs = out.Dirs[:maxFolderEntries]
		out.Truncated = true
	}
	writeJSON(w, http.StatusOK, out)
}
