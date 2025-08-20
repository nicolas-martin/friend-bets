# SOL to USDC Swap Script

This script swaps SOL to USDC on Solana devnet using Jupiter API.

## Usage

```bash
npx tsx scripts/swap-sol-to-usdc.ts <PRIVATE_KEY_BASE58> <SOL_AMOUNT>
```

### Parameters

- `PRIVATE_KEY_BASE58`: Your wallet's private key in base58 format
- `SOL_AMOUNT`: Amount of SOL to swap (e.g., 0.1 for 0.1 SOL)

### Example

```bash
npx tsx scripts/swap-sol-to-usdc.ts "your_private_key_here" 0.1
```

## What the script does

1. **Get Quote**: Calls Jupiter API to get swap quote for SOL → USDC
2. **Get Swap Transaction**: Gets the unsigned transaction from Jupiter
3. **Sign Transaction**: Signs the transaction with your wallet
4. **Send Transaction**: Submits the signed transaction to Solana devnet

## Requirements

- SOL balance in your devnet wallet
- Private key access to your wallet
- Internet connection for API calls

## Output

The script will show:
- Quote details (expected USDC output, price impact)
- Transaction signature
- Explorer link to view the transaction

## Notes

- Uses devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Slippage tolerance: 0.5% (50 bps)
- Automatically wraps/unwraps SOL as needed