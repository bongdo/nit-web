package gate

import (
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const healthTTL = 20 * time.Second

type serverHealth struct {
	Load      string
	LoadPct   int
	Memory    string
	MemoryPct int
	Disk      string
	DiskPct   int
	Cores     int
	CoresText string
	Uptime    string
	ok        bool
}

type healthCache struct {
	mu       sync.Mutex
	at       time.Time
	snapshot serverHealth
}

func (h *healthCache) get(now time.Time) serverHealth {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.at.IsZero() && now.Sub(h.at) < healthTTL {
		return h.snapshot
	}
	h.snapshot = readServerHealth()
	h.at = now
	return h.snapshot
}

func readServerHealth() serverHealth {
	var health serverHealth
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			if load, err := strconv.ParseFloat(fields[0], 64); err == nil {
				health.Cores = runtime.NumCPU()
				health.CoresText = plural(health.Cores, "ядро", "ядра", "ядер")
				health.Load = fmt.Sprintf("%.2f / %d", load, health.Cores)
				health.LoadPct = clampPct(int(load / float64(health.Cores) * 100))
				health.ok = true
			}
		}
	}
	if total, available, ok := readMemory(); ok {
		health.Memory = fmt.Sprintf("%.1f / %.1f ГБ", gigabytes(total-available), gigabytes(total))
		health.MemoryPct = clampPct(int(float64(total-available) / float64(total) * 100))
		health.ok = true
	}
	if total, free, ok := readDisk("/"); ok {
		health.Disk = fmt.Sprintf("%.0f / %.0f ГБ", gigabytes(total-free), gigabytes(total))
		health.DiskPct = clampPct(int(float64(total-free) / float64(total) * 100))
		health.ok = true
	}
	if data, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			if seconds, err := strconv.ParseFloat(fields[0], 64); err == nil {
				health.Uptime = humanUptime(time.Duration(seconds) * time.Second)
				health.ok = true
			}
		}
	}
	return health
}

func readMemory() (total, available float64, ok bool) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, false
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseFloat(fields[1], 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = value * 1024
		case "MemAvailable:":
			available = value * 1024
		}
	}
	return total, available, total > 0
}

func readDisk(path string) (total, free float64, ok bool) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, false
	}
	blockSize := float64(stat.Bsize)
	total = float64(stat.Blocks) * blockSize
	free = float64(stat.Bavail) * blockSize
	return total, free, total > 0
}

func gigabytes(bytes float64) float64 {
	return bytes / 1024 / 1024 / 1024
}

func clampPct(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func humanUptime(d time.Duration) string {
	hours := int(d.Hours())
	days := hours / 24
	hours -= days * 24
	if days > 0 {
		return fmt.Sprintf("%dд %dч", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%dч %dм", hours, int(d.Minutes())%60)
	}
	return fmt.Sprintf("%dм", int(d.Minutes()))
}
