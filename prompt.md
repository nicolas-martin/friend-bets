# Big Prompt for Claude — SPL Contract + Makefile + buf/proto + Go gRPC backend (GORM + Postgres) + RN Web App (mobile-first, chain-agnostic)

You will generate a complete **monorepo** for a friends-betting product that lets a creator open a two-sided pari-mutuel bet, share a link, accept deposits, resolve an outcome, and split the pool with a creator fee. Build it in four parts:

1) **SPL/Anchor program** (Rust)  
2) **Makefile** to publish and interact on **Solana testnet**  
3) **Protobuf + buf** with Go + TypeScript codegen and a **Go gRPC** backend (Connect-Go compatible), Postgres via **GORM**  
4) **React-Native TypeScript Web app** (Expo + RN Web), mobile-first, **chain-agnostic** UI

Keep code readable and small. Use typed DTOs. Add short comments. No secrets in code. Use multiple agents to implement this faster.

---

## Monorepo layout and output format

Output your answer as a set of **files** with clear path headers and code blocks. Use this layout (create all files):

friends-bets/
README.md
.env.example
Makefile
buf.yaml
buf.gen.yaml
packages/
contracts/
anchor/
Anchor.toml
programs/friends_bets/src/lib.rs
Cargo.toml
tsconfig.json
tests/friends_bets.spec.ts
idl/
friends_bets.json
friends_bets.ts
proto/
bets/v1/common.proto
bets/v1/market.proto
clients/
ts-sdk/
package.json
tsconfig.json
src/index.ts
src/pda.ts
src/anchor.ts
src/types.ts
scripts/init_market.ts
scripts/place_bet.ts
scripts/resolve.ts
scripts/claim.ts
scripts/close_betting.ts
scripts/cancel_expired.ts
apps/
backend/
go.mod
go.sum
cmd/api/main.go
cmd/worker/main.go
internal/config/config.go
internal/grpc/server.go
internal/grpc/interceptors.go
internal/grpc/bets_service.go
internal/core/domain.go
internal/core/usecases.go
internal/solana/anchor_client.go
internal/solana/events.go
internal/store/db.go
internal/store/models.go
internal/store/repository.go
internal/store/analytics.go
internal/notify/notify.go
internal/rate/limiter.go
internal/scheduler/scheduler.go
Dockerfile
config.example.yaml
web/
app.json
package.json
tsconfig.json
eslint.config.js
src/app/_layout.tsx
src/app/index.tsx
src/app/create.tsx
src/app/market/[market].tsx
src/app/resolve/[market].tsx
src/app/wallet.tsx
src/components/*
src/hooks/*
src/lib/anchor.ts
src/lib/grpc.ts
src/lib/chains/adapter.ts
src/lib/chains/solana.ts
src/idl/friends_bets.json
src/styles/theme.ts


For each file, start a block with:


path: <relative path from repo root>
<code here> ```
1) SPL/Anchor program (Rust)

Goal: a pari-mutuel pool with two sides (A/B). Odds are stake ratios. Creator sets a fee in bps, a betting end time, and a resolution deadline. At resolution, winners split (stakedA+stakedB - fee) pro-rata; creator withdraws the fee. If deadline passes without resolution, market becomes Cancelled and bettors can refund.

Accounts

Market (PDA):

creator: Pubkey

mint: Pubkey (SPL mint)

vault: Pubkey (ATA owned by Market PDA)

fee_bps: u16 (cap at 2000)

end_ts: i64, resolve_deadline_ts: i64

staked_a: u64, staked_b: u64

status: Open|PendingResolve|Resolved|Cancelled

outcome?: A|B

creator_fee_withdrawn: bool

bump: u8, vault_bump: u8

title: String (≤64)

Position (PDA per (market, owner)):

owner: Pubkey, side: A|B, amount: u64, claimed: bool, bump: u8

Instructions

initialize_market(fee_bps, end_ts, resolve_deadline_ts, title)

place_bet(side, amount)

close_betting() (anyone after end_ts)

resolve(outcome) (creator before resolve_deadline_ts)

cancel_expired() (anyone after deadline)

claim()

withdraw_creator_fee()

Events (for indexer)

MarketInitialized

BetPlaced

BettingClosed

Resolved

Cancelled

Claimed

CreatorFeeWithdrawn

Math (use u128 intermediate)
total = staked_a + staked_b
fee   = total * fee_bps / 10_000
distributable = total - fee
payout = distributable * user_amount / side_total

Tests

Happy path and cancel path

Mixed-side prevention

Time checks, fee cap, rounding

Emit a valid Anchor IDL to packages/contracts/idl/friends_bets.json and a small TS type wrapper friends_bets.ts.

2) Makefile (testnet build/deploy + simple interactions)

Targets:

help (print targets)

solana-testnet (set CLI URL)

build (anchor build)

deploy (anchor deploy)

idl (export IDL JSON + TS)

proto (buf generate)

init-market, place-bet, resolve, claim, close-betting, cancel-expired (call TS scripts under packages/clients/ts-sdk/scripts)

Use variables:

NETWORK ?= https://api.testnet.solana.com
PROGRAM_NAME ?= friends_bets
IDL_OUT ?= packages/contracts/idl

3) Protobuf + buf + gRPC
Proto

Create bets.v1 with:

common.proto: Side, MarketStatus

market.proto:

Messages: Market, Position, ListMarketsRequest/Response, CreateMarketRequest/Response, PlaceBetRequest/Response, ResolveRequest/Response, ClaimRequest/Response, WatchEventsRequest/Response (stream)

Service BetsService with RPCs:

ListMarkets

CreateMarket (backend returns prepared unsigned tx base64 or a signature in dev mode)

PlaceBet

Resolve

Claim

WatchEvents (server stream)

buf

buf.yaml with DEFAULT lint and FILE breaking

buf.gen.yaml:

Go: protocolbuffers/go + connectrpc/go → apps/backend/gen/proto

TS: bufbuild/es + connectrpc/es → packages/clients/ts-sdk/gen

Add Make target proto: buf generate.

4) Go backend (gRPC using Connect-Go), Postgres (GORM)
Stack

Go 1.22

Server: Connect-Go (gRPC + gRPC-web over HTTP/2 and HTTP/1.1)

DB: Postgres with GORM (use AutoMigrate for this scaffold)

Config: YAML + env override

Indexer: Solana RPC websockets for program logs; decode Anchor events

Scheduler worker:

scan markets near end_ts → call on-chain close_betting

scan unresolved after resolve_deadline_ts → call cancel_expired

Notify: Web Push (placeholder), SMTP (Mailhog) for dev

Rate limits: token bucket per IP + wallet (store counters in Postgres for now)

Features

Market list/search/create

ListMarkets returns DB-backed, cached list (title filter, status filter, paging)

CreateMarket path:

Mode A (prod): build unsigned transaction (Anchor), return base64; client signs and sends

Mode B (dev/worker): sign with maintenance key for bots only

Notify

Store subscriptions (email, web push)

Send events: “bet created”, “closing soon”, “resolved”, “claimable”

Auto-close/auto-cancel

Worker job runs on schedule; sends tx with maintenance key

Analytics & funnel

Track events in events table

Roll up daily stats

Anti-spam & rate limits

Sliding window per (IP, wallet) on CreateMarket and PlaceBet API calls

Dispute / oracle workflow

Tables for disputes, evidence URL

Admin gRPC to resolve disputes

Oracle adapter interface (Pyth/Switchboard stub)

GORM Models (minimal)

MarketView (shadow of on-chain state + derived fields)

PositionView (optional)

EventLog

Dispute

NotificationSubscription

AnalyticsDaily

RateCounter

Add repositories, use cases, and gRPC handlers (BetsService).

5) React-Native Web App (Expo + RN Web, TS, mobile-first, chain-agnostic)
Stack

Expo SDK (web)

TypeScript, React Query, Zustand, React Native Paper, Reanimated

Wallet (Solana): @solana/wallet-adapter-react, @solana/wallet-adapter-wallets, @solana/web3.js, @coral-xyz/anchor

gRPC client: @connectrpc/connect-web with generated TS

Chain adapter interface in src/lib/chains/adapter.ts

Implement solana.ts with functions to load program, derive PDAs, build/submit txs

Keep a placeholder for EVM adapter (viem/wagmi) for future

Screens

Home: markets feed (from backend), filters, search

Create: form → call backend CreateMarket to get unsigned tx → sign via wallet → submit; then refresh

Market Detail: odds, bet form with payout preview, claim button, share link

Resolve (creator): set outcome, then withdraw creator fee

Wallet: connect/disconnect, balances, network badge

Components

MarketCard, StatusChip, OddsPill, TokenAmountInput, SideSelector, Countdown, TxButton, Toast, CopyField

Hooks

useMarkets, useMarket, usePosition

useTx for prepared tx flow

useOddsPreview(amount, side)

Style

Mobile-first layout, large tap targets, simple theme in styles/theme.ts

6) Linting

Create eslint.config.js (flat config) for the web app with TypeScript, React, React Hooks, unused imports, and React Refresh rules. Keep it strict but practical.

7) Env and dev tooling

Top-level .env.example:

SOLANA_RPC_URL=https://api.testnet.solana.com

PROGRAM_ID=...

MINT=...

BACKEND_ADDR=localhost:8080

DATABASE_URL=postgres://...

MAINTENANCE_KEYPAIR_PATH=~/.config/solana/id.json

apps/backend/config.example.yaml with the same fields

README.md: quick start, testnet deploy, proto gen, backend, web app run

8) Acceptance

Program deploys to testnet with Makefile

IDL exported and used by TS SDK

buf generate produces Go + TS stubs

Go backend compiles, starts, exposes gRPC (and gRPC-web with Connect)

Worker closes/cancels markets on schedule in dev mode

Web app runs in browser, connects wallet, creates markets, places bets, resolves, claims

9) Risks, limits, next steps

Single-creator resolution; add arbitrators, bonds, or oracles next

No web push in prod yet; stubs only

Rate limit in Postgres; swap to Redis later for higher load

EVM adapter stub; add real chain next

Now generate all files

Produce all files listed in the layout, with real code. Use short comments. For long files, still print full content. Use safe defaults. No secrets.

Below are the files to output.

path: README.md

<write a concise repo README with setup, Make targets, proto gen, backend run, and web run>

path: .env.example
<keys listed above>
path: Makefile
<targets and recipes as described>
path: buf.yaml
<buf v2 module with DEFAULT lint and FILE breaking>
path: buf.gen.yaml

<Go + Connect-Go + TS + Connect-Web plugins>

path: packages/proto/bets/v1/common.proto

<Side, MarketStatus enums>

path: packages/proto/bets/v1/market.proto

<messages + service as described>

path: packages/contracts/anchor/Anchor.toml
<anchor config for testnet>
path: packages/contracts/anchor/Cargo.toml
<cargo config for workspace and program>
path: packages/contracts/anchor/programs/friends_bets/src/lib.rs
<full Anchor program implementing the spec>
path: packages/contracts/anchor/tests/friends_bets.spec.ts
<anchor mocha tests for both happy and cancel paths>
path: packages/contracts/idl/friends_bets.json

<exported IDL placeholder; the real file comes from build>

path: packages/contracts/idl/friends_bets.ts
<small TS helper to import IDL>
path: packages/clients/ts-sdk/package.json

<name, scripts, deps>

path: packages/clients/ts-sdk/tsconfig.json
<strict TS config>
path: packages/clients/ts-sdk/src/types.ts
<shared DTOs>
path: packages/clients/ts-sdk/src/pda.ts
<PDA derivations>
path: packages/clients/ts-sdk/src/anchor.ts
<Anchor program loader>
path: packages/clients/ts-sdk/src/index.ts
<exports>
path: packages/clients/ts-sdk/scripts/init_market.ts
<CLI script using wallet to init market>
path: packages/clients/ts-sdk/scripts/place_bet.ts
path: packages/clients/ts-sdk/scripts/resolve.ts
path: packages/clients/ts-sdk/scripts/claim.ts
path: packages/clients/ts-sdk/scripts/close_betting.ts
path: packages/clients/ts-sdk/scripts/cancel_expired.ts
<each script builds and sends a tx>
path: apps/backend/go.mod
<go module>
path: apps/backend/cmd/api/main.go

<bootstrap gRPC server with Connect-Go handlers, config, DB, migrations, rate limiter>

path: apps/backend/cmd/worker/main.go

<bootstrap scheduler + indexer>

path: apps/backend/internal/config/config.go
path: apps/backend/internal/grpc/server.go
path: apps/backend/internal/grpc/interceptors.go
path: apps/backend/internal/grpc/bets_service.go
path: apps/backend/internal/core/domain.go
path: apps/backend/internal/core/usecases.go
path: apps/backend/internal/solana/anchor_client.go
path: apps/backend/internal/solana/events.go
path: apps/backend/internal/store/db.go
path: apps/backend/internal/store/models.go
path: apps/backend/internal/store/repository.go
path: apps/backend/internal/store/analytics.go
path: apps/backend/internal/notify/notify.go
path: apps/backend/internal/rate/limiter.go
path: apps/backend/internal/scheduler/scheduler.go
path: apps/backend/config.example.yaml

<implement all, using GORM AutoMigrate and prepared tx flow>

path: apps/web/app.json
<Expo config>
path: apps/web/package.json

<scripts, deps>

path: apps/web/tsconfig.json
<strict TS config>
path: apps/web/eslint.config.js
<flat config rules>
path: apps/web/src/app/_layout.tsx
path: apps/web/src/app/index.tsx
path: apps/web/src/app/create.tsx
path: apps/web/src/app/market/[market].tsx
path: apps/web/src/app/resolve/[market].tsx
path: apps/web/src/app/wallet.tsx
path: apps/web/src/components/... (MarketCard, StatusChip, OddsPill, TokenAmountInput, SideSelector, Countdown, TxButton, Toast, CopyField)
path: apps/web/src/hooks/... (useMarkets, useMarket, usePosition, useTx, useOddsPreview)
path: apps/web/src/lib/anchor.ts
path: apps/web/src/lib/grpc.ts
path: apps/web/src/lib/chains/adapter.ts
path: apps/web/src/lib/chains/solana.ts
path: apps/web/src/idl/friends_bets.json
path: apps/web/src/styles/theme.ts

<implement UI and gRPC calls; prepared tx signing in browser wallet>
