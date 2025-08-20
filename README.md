  - make dev - Runs both backend and frontend simultaneously
  - make backend - Runs only the Go backend server
  - make frontend - Runs only the React Native web frontend
  - make build - Builds the Anchor smart contract
  - make deploy - Deploys the smart contract to testnet
  - make proto - Generates protobuf types for Go and TypeScript

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH" && solana --version && anchor build

