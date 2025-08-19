package config

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Environment string         `yaml:"environment"`
	Server      ServerConfig   `yaml:"server"`
	Database    DatabaseConfig `yaml:"database"`
	Solana      SolanaConfig   `yaml:"solana"`
	Worker      WorkerConfig   `yaml:"worker"`
	Notify      NotifyConfig   `yaml:"notify"`
	Rate        RateConfig     `yaml:"rate"`
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
	CORS struct {
		AllowedOrigins []string `yaml:"allowed_origins"`
		AllowedHeaders []string `yaml:"allowed_headers"`
	} `yaml:"cors"`
}

type DatabaseConfig struct {
	URL         string `yaml:"url"`
	MaxConns    int    `yaml:"max_conns"`
	MaxIdleTime string `yaml:"max_idle_time"`
}

type SolanaConfig struct {
	RPCURL           string `yaml:"rpc_url"`
	ProgramID        string `yaml:"program_id"`
	MaintenanceKey   string `yaml:"maintenance_key_path"`
	ConfirmationMode string `yaml:"confirmation_mode"`
}

type WorkerConfig struct {
	Enabled             bool   `yaml:"enabled"`
	CheckIntervalSec    int    `yaml:"check_interval_sec"`
	AutoCloseEnabled    bool   `yaml:"auto_close_enabled"`
	AutoCancelEnabled   bool   `yaml:"auto_cancel_enabled"`
	IndexerEnabled      bool   `yaml:"indexer_enabled"`
	IndexerStartSlot    uint64 `yaml:"indexer_start_slot"`
}

type NotifyConfig struct {
	SMTP struct {
		Host     string `yaml:"host"`
		Port     int    `yaml:"port"`
		Username string `yaml:"username"`
		Password string `yaml:"password"`
		From     string `yaml:"from"`
	} `yaml:"smtp"`
	WebPush struct {
		Enabled    bool   `yaml:"enabled"`
		VapidKey   string `yaml:"vapid_key"`
		VapidEmail string `yaml:"vapid_email"`
	} `yaml:"web_push"`
}

type RateConfig struct {
	CreateMarketPerHour int `yaml:"create_market_per_hour"`
	PlaceBetPerMinute   int `yaml:"place_bet_per_minute"`
	IPRatePerMinute     int `yaml:"ip_rate_per_minute"`
}

// Load loads configuration from file with environment variable overrides
func Load(path string) (*Config, error) {
	cfg := &Config{}

	// Load from YAML file
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}

		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to unmarshal config: %w", err)
		}
	}

	// Apply defaults
	applyDefaults(cfg)

	// Override with environment variables
	applyEnvOverrides(cfg)

	return cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg.Environment == "" {
		cfg.Environment = "development"
	}
	if cfg.Server.Host == "" {
		cfg.Server.Host = "localhost"
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if len(cfg.Server.CORS.AllowedOrigins) == 0 {
		cfg.Server.CORS.AllowedOrigins = []string{"*"}
	}
	if len(cfg.Server.CORS.AllowedHeaders) == 0 {
		cfg.Server.CORS.AllowedHeaders = []string{"*"}
	}

	if cfg.Database.MaxConns == 0 {
		cfg.Database.MaxConns = 10
	}
	if cfg.Database.MaxIdleTime == "" {
		cfg.Database.MaxIdleTime = "30m"
	}

	if cfg.Solana.ConfirmationMode == "" {
		cfg.Solana.ConfirmationMode = "confirmed"
	}

	if cfg.Worker.CheckIntervalSec == 0 {
		cfg.Worker.CheckIntervalSec = 60
	}

	if cfg.Rate.CreateMarketPerHour == 0 {
		cfg.Rate.CreateMarketPerHour = 10
	}
	if cfg.Rate.PlaceBetPerMinute == 0 {
		cfg.Rate.PlaceBetPerMinute = 20
	}
	if cfg.Rate.IPRatePerMinute == 0 {
		cfg.Rate.IPRatePerMinute = 100
	}

	cfg.Notify.SMTP.Port = getIntOrDefault(cfg.Notify.SMTP.Port, 587)
}

func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("ENV"); v != "" {
		cfg.Environment = v
	}
	if v := os.Getenv("DATABASE_URL"); v != "" {
		cfg.Database.URL = v
	}
	if v := os.Getenv("SOLANA_RPC_URL"); v != "" {
		cfg.Solana.RPCURL = v
	}
	if v := os.Getenv("PROGRAM_ID"); v != "" {
		cfg.Solana.ProgramID = v
	}
	if v := os.Getenv("MAINTENANCE_KEYPAIR_PATH"); v != "" {
		cfg.Solana.MaintenanceKey = v
	}
	if v := os.Getenv("BACKEND_ADDR"); v != "" {
		// Parse host:port
		// Simple parsing for now
		cfg.Server.Host = "localhost"
		if port, err := strconv.Atoi(v[len("localhost:"):]); err == nil {
			cfg.Server.Port = port
		}
	}
}

func getIntOrDefault(value, defaultValue int) int {
	if value == 0 {
		return defaultValue
	}
	return value
}