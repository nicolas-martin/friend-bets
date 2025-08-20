# Get Devnet USDC Tokens - Manual Instructions

Since the automatic faucet didn't work properly, here are manual steps to get devnet USDC:

## Your Information
- **Wallet Address**: `HsSnLYqCmuNwzP35AMf8CURFDATUyWt5nsCY2ZwBq76G`
- **Private Key**: `4nrGwpxoatb9zEdKTyNPz5S1ytKu3ZJG6YBtgFXwzSrXhJKfPbzULVZ3F1mUs5bfXoZ1AAVze4wXkmSPURQZztsa`
- **USDC Token Account**: `8PDUzJbCSwrBVJsoMuyoevAu67Ak9f7JTw9EZYj36tsj`
- **Devnet USDC Mint**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

## Method 1: SPL Token Faucet (Recommended)

1. Visit: https://spl-token-faucet.com/?token-name=USDC-Dev
2. Enter your token account address: `8PDUzJbCSwrBVJsoMuyoevAu67Ak9f7JTw9EZYj36tsj`
3. Click "Airdrop USDC-Dev"

## Method 2: QuickNode Faucet

1. Visit: https://faucet.quicknode.com/
2. Select "Solana Devnet"
3. Enter your wallet address: `HsSnLYqCmuNwzP35AMf8CURFDATUyWt5nsCY2ZwBq76G`
4. Request tokens

## Method 3: Manual Mint (if you have access)

Use this command to mint USDC to your token account:
```bash
spl-token mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU 100 8PDUzJbCSwrBVJsoMuyoevAu67Ak9f7JTw9EZYj36tsj
```

## Check Balance After Getting Tokens

Run this to verify you received the tokens:
```bash
npx tsx scripts/check-usdc-balance.ts
```

## Then Run the Betting App

Once you have USDC tokens, you can use the betting application normally. The betting interface should show your USDC balance and allow you to place bets.

## Alternative: Use SOL Instead

If getting USDC is problematic, consider modifying the betting contract to accept SOL directly instead of USDC for testing purposes.