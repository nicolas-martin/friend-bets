package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"runtime"
	"strings"
)

// DevHandler is a custom slog handler for development that provides cleaner output
type DevHandler struct {
	w    io.Writer
	opts *slog.HandlerOptions
}

// NewDevHandler creates a new development handler
func NewDevHandler(w io.Writer, opts *slog.HandlerOptions) *DevHandler {
	if opts == nil {
		opts = &slog.HandlerOptions{}
	}
	return &DevHandler{w: w, opts: opts}
}

// Enabled reports whether the handler handles records at the given level
func (h *DevHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.opts.Level.Level()
}

// Handle handles the Record
func (h *DevHandler) Handle(ctx context.Context, record slog.Record) error {
	// Format time as HH:MM:SS
	timeStr := record.Time.Format("15:04:05")
	
	// Get level with color
	levelStr := h.formatLevel(record.Level)
	
	// Format source to show only filename
	sourceStr := ""
	if h.opts.AddSource && record.PC != 0 {
		frame, _ := runtime.CallersFrames([]uintptr{record.PC}).Next()
		if frame.File != "" {
			sourceStr = fmt.Sprintf(" %s:%d", filepath.Base(frame.File), frame.Line)
		}
	}
	
	// Build the main message
	msg := fmt.Sprintf("%s %s %s%s", timeStr, levelStr, record.Message, sourceStr)
	
	// Add attributes
	attrs := make([]string, 0)
	record.Attrs(func(attr slog.Attr) bool {
		attrs = append(attrs, h.formatAttr(attr))
		return true
	})
	
	if len(attrs) > 0 {
		msg += " " + strings.Join(attrs, " ")
	}
	
	msg += "\n"
	
	_, err := h.w.Write([]byte(msg))
	return err
}

// WithAttrs returns a new Handler whose attributes consist of both the receiver's attributes and the arguments
func (h *DevHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	// For simplicity, we'll just return the same handler
	// In a full implementation, you'd want to store these attrs
	return h
}

// WithGroup returns a new Handler with the given group appended to the receiver's existing groups
func (h *DevHandler) WithGroup(name string) slog.Handler {
	// For simplicity, we'll just return the same handler
	// In a full implementation, you'd want to handle groups
	return h
}

// formatLevel formats the log level with color for terminal output
func (h *DevHandler) formatLevel(level slog.Level) string {
	switch level {
	case slog.LevelDebug:
		return "\033[36mDEBUG\033[0m" // Cyan
	case slog.LevelInfo:
		return "\033[32mINFO\033[0m"  // Green
	case slog.LevelWarn:
		return "\033[33mWARN\033[0m"  // Yellow
	case slog.LevelError:
		return "\033[31mERROR\033[0m" // Red
	default:
		return level.String()
	}
}

// formatAttr formats a single attribute
func (h *DevHandler) formatAttr(attr slog.Attr) string {
	if attr.Key == "" {
		return ""
	}
	
	value := attr.Value.String()
	
	// Special formatting for certain keys
	switch attr.Key {
	case "error":
		return fmt.Sprintf("\033[31m%s\033[0m=%s", attr.Key, value) // Red key for errors
	case "duration":
		return fmt.Sprintf("\033[36m%s\033[0m=%s", attr.Key, value) // Cyan for duration
	case "method":
		return fmt.Sprintf("\033[35m%s\033[0m=%s", attr.Key, value) // Magenta for method
	default:
		return fmt.Sprintf("%s=%s", attr.Key, value)
	}
}