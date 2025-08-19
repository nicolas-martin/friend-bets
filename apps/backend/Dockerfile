# Friend Bets Backend Dockerfile
# Multi-stage build for efficient production images

# Stage 1: Build stage
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the applications
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o worker ./cmd/worker

# Stage 2: Production API image
FROM alpine:3.18 AS api

# Install runtime dependencies
RUN apk --no-cache add ca-certificates tzdata

# Create app user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /app/api ./api

# Copy configuration template
COPY --from=builder /app/config.example.yaml ./config.example.yaml

# Create directories for keys and logs
RUN mkdir -p /app/keys /app/logs && \
    chown -R appuser:appgroup /app

# Switch to app user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ./api -version || exit 1

# Default command
CMD ["./api", "-config", "config.yaml"]

# Stage 3: Production Worker image  
FROM alpine:3.18 AS worker

# Install runtime dependencies
RUN apk --no-cache add ca-certificates tzdata

# Create app user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /app/worker ./worker

# Copy configuration template
COPY --from=builder /app/config.example.yaml ./config.example.yaml

# Create directories for keys and logs
RUN mkdir -p /app/keys /app/logs && \
    chown -R appuser:appgroup /app

# Switch to app user
USER appuser

# Health check
HEALTHCHECK --interval=60s --timeout=15s --start-period=10s --retries=3 \
  CMD ./worker -version || exit 1

# Default command
CMD ["./worker", "-config", "config.yaml"]

# Stage 4: Development image (includes both binaries and dev tools)
FROM golang:1.22-alpine AS development

# Install development dependencies
RUN apk add --no-cache git ca-certificates tzdata make bash curl

# Install air for hot reloading
RUN go install github.com/cosmtrek/air@latest

# Install database migration tool
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build binaries
RUN go build -o api ./cmd/api && \
    go build -o worker ./cmd/worker

# Create development user
RUN addgroup -g 1000 -S devgroup && \
    adduser -u 1000 -S devuser -G devgroup -s /bin/bash

# Create directories and set permissions
RUN mkdir -p /app/keys /app/logs && \
    chown -R devuser:devgroup /app

# Switch to dev user
USER devuser

# Expose ports (API and debug)
EXPOSE 8080 2345

# Default command for development
CMD ["air", "-c", ".air.toml"]

# Build arguments for customization
ARG BUILD_VERSION="dev"
ARG BUILD_TIME=""
ARG GIT_COMMIT=""

# Set build-time labels
LABEL org.opencontainers.image.title="Friend Bets Backend"
LABEL org.opencontainers.image.description="Decentralized prediction market backend"
LABEL org.opencontainers.image.version="${BUILD_VERSION}"
LABEL org.opencontainers.image.created="${BUILD_TIME}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.vendor="Friend Bets"
LABEL org.opencontainers.image.source="https://github.com/friend-bets/backend"
