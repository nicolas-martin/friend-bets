-- Initialize friend_bets database
-- This file is automatically run when PostgreSQL container starts

CREATE DATABASE friend_bets;

-- Create user with appropriate permissions
CREATE USER friend_bets_user WITH ENCRYPTED PASSWORD 'friend_bets_password';
GRANT ALL PRIVILEGES ON DATABASE friend_bets TO friend_bets_user;

-- Switch to the database
\c friend_bets;

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO friend_bets_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO friend_bets_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO friend_bets_user;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO friend_bets_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO friend_bets_user;