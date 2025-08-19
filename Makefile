NETWORK ?= https://api.testnet.solana.com
PROGRAM_NAME ?= friends_bets
IDL_OUT ?= packages/contracts/idl

.PHONY: help solana-testnet build deploy idl proto init-market place-bet resolve claim close-betting cancel-expired

help: ## Show available targets
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

solana-testnet: ## Set Solana CLI to testnet
	solana config set --url $(NETWORK)

build: ## Build Anchor program
	cd packages/contracts/anchor && anchor build

deploy: ## Deploy program to testnet
	cd packages/contracts/anchor && anchor deploy

idl: ## Export IDL JSON and TypeScript files
	cd packages/contracts/anchor && anchor idl parse --file target/idl/$(PROGRAM_NAME).json > ../../idl/$(PROGRAM_NAME).json
	@echo "IDL exported to $(IDL_OUT)/$(PROGRAM_NAME).json"

proto: ## Generate protobuf types for Go and TypeScript
	buf generate

init-market: ## Create a test market
	cd packages/clients/ts-sdk && npm run script -- scripts/init_market.ts

place-bet: ## Place a test bet
	cd packages/clients/ts-sdk && npm run script -- scripts/place_bet.ts

resolve: ## Resolve a test market
	cd packages/clients/ts-sdk && npm run script -- scripts/resolve.ts

claim: ## Claim winnings from resolved market
	cd packages/clients/ts-sdk && npm run script -- scripts/claim.ts

close-betting: ## Close betting period for market
	cd packages/clients/ts-sdk && npm run script -- scripts/close_betting.ts

cancel-expired: ## Cancel expired unresolved market
	cd packages/clients/ts-sdk && npm run script -- scripts/cancel_expired.ts
