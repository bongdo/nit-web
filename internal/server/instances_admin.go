package server

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"nitgui/internal/opencode"
)

type instanceInput struct {
	Original     string  `json:"original"`
	Name         string  `json:"name"`
	Transport    string  `json:"transport"`
	URL          string  `json:"url"`
	SSH          string  `json:"ssh"`
	Dir          string  `json:"dir"`
	Password     string  `json:"password"`
	PasswordFile string  `json:"passwordFile"`
	PeroURL      *string `json:"peroURL"`
	TermURL      *string `json:"termURL"`
}

func (s *Server) saveInstance(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[instanceInput](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	in.Original = strings.TrimSpace(in.Original)
	in.Name = strings.TrimSpace(in.Name)
	in.Transport = strings.ToLower(strings.TrimSpace(in.Transport))
	in.URL = strings.TrimSpace(in.URL)
	in.SSH = strings.TrimSpace(in.SSH)
	in.Dir = strings.TrimSpace(in.Dir)
	in.Password = strings.TrimSpace(in.Password)
	in.PasswordFile = strings.TrimSpace(in.PasswordFile)
	if !opencode.ValidInstanceName(in.Name) {
		writeError(w, http.StatusBadRequest, "invalid instance name")
		return
	}
	specs := s.multi.Instances()
	index := -1
	if in.Original != "" {
		for i, spec := range specs {
			if spec.Name == in.Original {
				index = i
				break
			}
		}
		if index < 0 {
			writeError(w, http.StatusNotFound, "instance not found")
			return
		}
	}
	for i, spec := range specs {
		if spec.Name == in.Name && i != index {
			writeError(w, http.StatusConflict, "instance name already exists")
			return
		}
	}
	if in.Original != "" && in.Original != in.Name && s.ui != nil && s.ui.Has(in.Name) {
		writeError(w, http.StatusConflict, "instance name already has saved UI state")
		return
	}
	if in.Dir != "" && !filepath.IsAbs(in.Dir) {
		writeError(w, http.StatusBadRequest, "directory must be absolute")
		return
	}

	spec := opencode.InstanceSpec{Name: in.Name, Dir: in.Dir}
	switch in.Transport {
	case "local":
	case "url":
		parsed, err := url.Parse(in.URL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			writeError(w, http.StatusBadRequest, "invalid url")
			return
		}
		if parsed.User != nil {
			writeError(w, http.StatusBadRequest, "url must not contain credentials")
			return
		}
		spec.URL = in.URL
	case "ssh":
		if in.SSH == "" {
			writeError(w, http.StatusBadRequest, "ssh host is required")
			return
		}
		if !opencode.ValidSSHHost(in.SSH) {
			writeError(w, http.StatusBadRequest, "invalid ssh host")
			return
		}
		spec.SSH = in.SSH
	default:
		writeError(w, http.StatusBadRequest, "invalid transport")
		return
	}

	if index >= 0 {
		spec.Password = specs[index].Password
		spec.PasswordFile = specs[index].PasswordFile
		spec.PeroURL = specs[index].PeroURL
		spec.TermURL = specs[index].TermURL
	}
	if in.PeroURL != nil {
		spec.PeroURL = strings.TrimSpace(*in.PeroURL)
	}
	if in.TermURL != nil {
		spec.TermURL = strings.TrimSpace(*in.TermURL)
	}
	if !opencode.ValidAppURL(spec.PeroURL) {
		writeError(w, http.StatusBadRequest, "pero url must be an http(s) url or a path starting with /")
		return
	}
	if !opencode.ValidAppURL(spec.TermURL) {
		writeError(w, http.StatusBadRequest, "term url must be an http(s) url or a path starting with /")
		return
	}
	if in.PasswordFile != "" {
		path, err := s.confinedPasswordPath(in.PasswordFile)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		spec.PasswordFile = path
		spec.Password = ""
	}
	if in.Password != "" {
		path := spec.PasswordFile
		if path == "" {
			path, err = s.defaultPasswordPath(in.Name)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		if err := writePasswordFile(path, in.Password); err != nil {
			s.log.Error("instance password write failed", "error", err)
			writeError(w, http.StatusInternalServerError, "could not write password file")
			return
		}
		spec.PasswordFile = path
		spec.Password = ""
	}
	if in.Transport == "url" && spec.Password == "" && spec.PasswordFile == "" &&
		!isLoopbackURL(spec.URL) {
		writeError(w, http.StatusBadRequest, "a remote url needs a password or password file")
		return
	}

	if index >= 0 {
		specs[index] = spec
	} else {
		specs = append(specs, spec)
	}
	if err := s.multi.Replace(specs); err != nil {
		s.log.Error("instance config save failed", "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if in.Original != "" && in.Original != in.Name && s.ui != nil {
		if err := s.ui.Rename(in.Original, in.Name); err != nil {
			s.log.Error("instance ui state rename failed", "error", err)
			writeError(w, http.StatusInternalServerError, "instance saved, but its UI state could not be moved")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) deleteInstance(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	specs := s.multi.Instances()
	index := -1
	for i, spec := range specs {
		if spec.Name == id {
			index = i
			break
		}
	}
	if index < 0 {
		writeError(w, http.StatusNotFound, "instance not found")
		return
	}
	if len(specs) <= 1 {
		writeError(w, http.StatusBadRequest, "cannot delete the last instance")
		return
	}
	specs = append(specs[:index], specs[index+1:]...)
	if err := s.multi.Replace(specs); err != nil {
		s.log.Error("instance config delete failed", "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) defaultPasswordPath(name string) (string, error) {
	path := s.multi.ConfigPath()
	if path == "" {
		return "", os.ErrNotExist
	}
	return filepath.Join(filepath.Dir(path), name+".password"), nil
}

func (s *Server) confinedPasswordPath(raw string) (string, error) {
	path := expandUser(strings.TrimSpace(raw))
	if path == "" || !filepath.IsAbs(path) {
		return "", errors.New("password file must be an absolute path")
	}
	configPath := s.multi.ConfigPath()
	if configPath == "" {
		return "", errors.New("instance config path is empty")
	}
	base, err := filepath.Abs(filepath.Dir(configPath))
	if err != nil {
		return "", errors.New("could not resolve the instance config directory")
	}
	target, err := filepath.Abs(path)
	if err != nil {
		return "", errors.New("could not resolve the password file path")
	}
	if target != base && !strings.HasPrefix(target, base+string(os.PathSeparator)) {
		return "", errors.New("password file must be inside the nit-gui config directory")
	}
	if info, err := os.Lstat(target); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", errors.New("password file must be a regular file, not a link")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", errors.New("could not inspect the password file")
	}
	return target, nil
}

func writePasswordFile(path, password string) error {
	path = expandUser(path)
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("password file must be a regular file, not a link")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".password-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(password + "\n"); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func expandUser(path string) string {
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

func isLoopbackURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "localhost" || host == "0.0.0.0" || host == "::" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
