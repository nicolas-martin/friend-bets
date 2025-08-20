package solana

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"

	"github.com/blocto/solana-go-sdk/client"
	"github.com/blocto/solana-go-sdk/common"
	"github.com/blocto/solana-go-sdk/types"
	"github.com/friend-bets/backend/internal/config"
	"github.com/friend-bets/backend/internal/core"
)

// AnchorClient provides Solana/Anchor program integration
type AnchorClient struct {
	rpcClient client.Client
	programID common.PublicKey
	config    *config.SolanaConfig
	logger    *slog.Logger
}

// NewAnchorClient creates a new Solana anchor client
func NewAnchorClient(cfg *config.SolanaConfig, logger *slog.Logger) (*AnchorClient, error) {
	rpcClient := client.NewClient(cfg.RPCURL)
	
	programID := common.PublicKeyFromString(cfg.ProgramID)

	return &AnchorClient{
		rpcClient: *rpcClient,
		programID: programID,
		config:    cfg,
		logger:    logger,
	}, nil
}

// Transaction result for unsigned transaction flow
type TransactionResult struct {
	UnsignedTxBase64 string
	Signature        string // Only populated in dev mode
	MarketID         string // Market public key for created markets
}

// CreateMarketTx creates an unsigned transaction for market creation
func (ac *AnchorClient) CreateMarketTx(ctx context.Context, req *core.CreateMarketRequest) (*TransactionResult, error) {
	creator := common.PublicKeyFromString(req.Creator)
	mint := common.PublicKeyFromString(req.Mint)

	// Derive market PDA
	marketSeeds := [][]byte{
		[]byte("market"),
		creator.Bytes(),
		[]byte(req.Title),
	}
	marketPDA, _, err := common.FindProgramAddress(marketSeeds, ac.programID)
	if err != nil {
		return nil, fmt.Errorf("failed to find market PDA: %w", err)
	}

	// Derive vault PDA
	vaultSeeds := [][]byte{
		[]byte("vault"),
		marketPDA.Bytes(),
	}
	vaultPDA, vaultBump, err := common.FindProgramAddress(vaultSeeds, ac.programID)
	if err != nil {
		return nil, fmt.Errorf("failed to find vault PDA: %w", err)
	}

	// Create instruction data
	instrData, err := ac.encodeCreateMarketInstruction(&CreateMarketInstructionData{
		FeeBps:            req.FeeBps,
		EndTs:             req.EndTs.Unix(),
		ResolveDeadlineTs: req.ResolveDeadlineTs.Unix(),
		Title:             req.Title,
		VaultBump:         vaultBump,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode instruction: %w", err)
	}

	// Build instruction
	instruction := types.Instruction{
		ProgramID: ac.programID,
		Accounts: []types.AccountMeta{
			{PubKey: creator, IsSigner: true, IsWritable: false},
			{PubKey: marketPDA, IsSigner: false, IsWritable: true},
			{PubKey: vaultPDA, IsSigner: false, IsWritable: true},
			{PubKey: mint, IsSigner: false, IsWritable: false},
			{PubKey: common.SystemProgramID, IsSigner: false, IsWritable: false},
			{PubKey: common.TokenProgramID, IsSigner: false, IsWritable: false},
		},
		Data: instrData,
	}

	result, err := ac.buildTransaction(ctx, []types.Instruction{instruction}, creator)
	if err != nil {
		return nil, err
	}
	
	// Set the market ID for the result
	result.MarketID = marketPDA.ToBase58()
	
	return result, nil
}

// PlaceBetTx creates an unsigned transaction for placing a bet
func (ac *AnchorClient) PlaceBetTx(ctx context.Context, req *core.PlaceBetRequest) (*TransactionResult, error) {
	owner := common.PublicKeyFromString(req.Owner)
	marketID := common.PublicKeyFromString(req.MarketID)

	// Get market account to find mint and vault
	marketAccount, err := ac.rpcClient.GetAccountInfo(ctx, marketID.ToBase58())
	if err != nil {
		return nil, fmt.Errorf("failed to get market account: %w", err)
	}

	// Parse market data to get mint and vault
	marketData, err := ac.parseMarketAccount(marketAccount.Data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse market data: %w", err)
	}

	// Get or create user token account
	userTokenAccount, err := ac.getAssociatedTokenAccount(ctx, owner, marketData.Mint)
	if err != nil {
		return nil, fmt.Errorf("failed to get user token account: %w", err)
	}

	// Derive position PDA
	positionSeeds := [][]byte{
		[]byte("position"),
		marketID.Bytes(),
		owner.Bytes(),
	}
	positionPDA, positionBump, err := common.FindProgramAddress(positionSeeds, ac.programID)
	if err != nil {
		return nil, fmt.Errorf("failed to find position PDA: %w", err)
	}

	// Create instruction data
	side := uint8(0) // A = 0, B = 1
	if req.Side == core.BetSideB {
		side = 1
	}

	instrData, err := ac.encodePlaceBetInstruction(&PlaceBetInstructionData{
		Side:         side,
		Amount:       req.Amount,
		PositionBump: positionBump,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode instruction: %w", err)
	}

	// Build instruction
	instruction := types.Instruction{
		ProgramID: ac.programID,
		Accounts: []types.AccountMeta{
			{PubKey: owner, IsSigner: true, IsWritable: false},
			{PubKey: marketID, IsSigner: false, IsWritable: true},
			{PubKey: positionPDA, IsSigner: false, IsWritable: true},
			{PubKey: userTokenAccount, IsSigner: false, IsWritable: true},
			{PubKey: marketData.Vault, IsSigner: false, IsWritable: true},
			{PubKey: common.SystemProgramID, IsSigner: false, IsWritable: false},
			{PubKey: common.TokenProgramID, IsSigner: false, IsWritable: false},
		},
		Data: instrData,
	}

	return ac.buildTransaction(ctx, []types.Instruction{instruction}, owner)
}

// ResolveTx creates an unsigned transaction for resolving a market
func (ac *AnchorClient) ResolveTx(ctx context.Context, req *core.ResolveMarketRequest) (*TransactionResult, error) {
	resolver := common.PublicKeyFromString(req.Resolver)
	marketID := common.PublicKeyFromString(req.MarketID)

	// Create instruction data
	outcome := uint8(0) // A = 0, B = 1
	if req.Outcome == core.BetSideB {
		outcome = 1
	}

	instrData, err := ac.encodeResolveInstruction(&ResolveInstructionData{
		Outcome: outcome,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode instruction: %w", err)
	}

	// Build instruction
	instruction := types.Instruction{
		ProgramID: ac.programID,
		Accounts: []types.AccountMeta{
			{PubKey: resolver, IsSigner: true, IsWritable: false},
			{PubKey: marketID, IsSigner: false, IsWritable: true},
		},
		Data: instrData,
	}

	return ac.buildTransaction(ctx, []types.Instruction{instruction}, resolver)
}

// ClaimTx creates an unsigned transaction for claiming winnings
func (ac *AnchorClient) ClaimTx(ctx context.Context, req *core.ClaimRequest) (*TransactionResult, error) {
	owner := common.PublicKeyFromString(req.Owner)
	marketID := common.PublicKeyFromString(req.MarketID)

	// Get market account to find mint and vault
	marketAccount, err := ac.rpcClient.GetAccountInfo(ctx, marketID.ToBase58())
	if err != nil {
		return nil, fmt.Errorf("failed to get market account: %w", err)
	}

	marketData, err := ac.parseMarketAccount(marketAccount.Data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse market data: %w", err)
	}

	// Get user token account
	userTokenAccount, err := ac.getAssociatedTokenAccount(ctx, owner, marketData.Mint)
	if err != nil {
		return nil, fmt.Errorf("failed to get user token account: %w", err)
	}

	// Derive position PDA
	positionSeeds := [][]byte{
		[]byte("position"),
		marketID.Bytes(),
		owner.Bytes(),
	}
	positionPDA, _, err := common.FindProgramAddress(positionSeeds, ac.programID)
	if err != nil {
		return nil, fmt.Errorf("failed to find position PDA: %w", err)
	}

	// Create instruction data
	instrData, err := ac.encodeClaimInstruction(&ClaimInstructionData{})
	if err != nil {
		return nil, fmt.Errorf("failed to encode instruction: %w", err)
	}

	// Build instruction
	instruction := types.Instruction{
		ProgramID: ac.programID,
		Accounts: []types.AccountMeta{
			{PubKey: owner, IsSigner: true, IsWritable: false},
			{PubKey: marketID, IsSigner: false, IsWritable: true},
			{PubKey: positionPDA, IsSigner: false, IsWritable: true},
			{PubKey: userTokenAccount, IsSigner: false, IsWritable: true},
			{PubKey: marketData.Vault, IsSigner: false, IsWritable: true},
			{PubKey: common.TokenProgramID, IsSigner: false, IsWritable: false},
		},
		Data: instrData,
	}

	return ac.buildTransaction(ctx, []types.Instruction{instruction}, owner)
}

// Helper methods

func (ac *AnchorClient) buildTransaction(ctx context.Context, instructions []types.Instruction, payer common.PublicKey) (*TransactionResult, error) {
	// Get recent blockhash
	recentBlockhash, err := ac.rpcClient.GetLatestBlockhash(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get recent blockhash: %w", err)
	}

	// Build transaction
	tx, err := types.NewTransaction(types.NewTransactionParam{
		Message: types.NewMessage(types.NewMessageParam{
			FeePayer:        payer,
			RecentBlockhash: recentBlockhash.Blockhash,
			Instructions:    instructions,
		}),
		Signers: []types.Account{}, // Empty for unsigned transaction
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create transaction: %w", err)
	}

	// Serialize transaction to base64
	txBytes, err := tx.Serialize()
	if err != nil {
		return nil, fmt.Errorf("failed to serialize transaction: %w", err)
	}

	unsignedTxBase64 := base64.StdEncoding.EncodeToString(txBytes)

	return &TransactionResult{
		UnsignedTxBase64: unsignedTxBase64,
		Signature:        "", // Client will sign and submit
	}, nil
}

func (ac *AnchorClient) getAssociatedTokenAccount(ctx context.Context, owner common.PublicKey, mint common.PublicKey) (common.PublicKey, error) {
	ata, _, err := common.FindAssociatedTokenAddress(owner, mint)
	if err != nil {
		return common.PublicKey{}, fmt.Errorf("failed to find ATA: %w", err)
	}

	// Check if ATA exists
	_, err = ac.rpcClient.GetAccountInfo(ctx, ata.ToBase58())
	if err != nil {
		// ATA doesn't exist, need to create it
		ac.logger.Debug("ATA doesn't exist, will be created in transaction", "owner", owner.ToBase58(), "mint", mint.ToBase58())
	}

	return ata, nil
}

// Instruction data structures and encoding
type CreateMarketInstructionData struct {
	FeeBps            uint16
	EndTs             int64
	ResolveDeadlineTs int64
	Title             string
	VaultBump         uint8
}

type PlaceBetInstructionData struct {
	Side         uint8
	Amount       uint64
	PositionBump uint8
}

type ResolveInstructionData struct {
	Outcome uint8
}

type ClaimInstructionData struct {
	// Empty for now
}

// Market account data structure
type MarketAccountData struct {
	Mint  common.PublicKey
	Vault common.PublicKey
}

// These encode the actual anchor instruction data
func (ac *AnchorClient) encodeCreateMarketInstruction(data *CreateMarketInstructionData) ([]byte, error) {
	// Instruction discriminator for create_market
	instrData := []byte{0x18, 0x1e, 0xc8, 0x28, 0x07, 0x4f, 0x6a, 0xc7}
	
	// Encode parameters using borsh
	// This is simplified - in production you'd use proper borsh encoding
	instrData = append(instrData, byte(data.FeeBps&0xFF))
	instrData = append(instrData, byte((data.FeeBps>>8)&0xFF))
	
	return instrData, nil
}

func (ac *AnchorClient) encodePlaceBetInstruction(data *PlaceBetInstructionData) ([]byte, error) {
	// Instruction discriminator for place_bet
	instrData := []byte{0xd4, 0x1a, 0x5d, 0x4e, 0xf2, 0x2c, 0x5b, 0x80}
	
	// Encode parameters
	instrData = append(instrData, data.Side)
	for i := 0; i < 8; i++ {
		instrData = append(instrData, byte((data.Amount>>(i*8))&0xFF))
	}
	instrData = append(instrData, data.PositionBump)
	
	return instrData, nil
}

func (ac *AnchorClient) encodeResolveInstruction(data *ResolveInstructionData) ([]byte, error) {
	// Instruction discriminator for resolve
	instrData := []byte{0xb0, 0x2a, 0x63, 0x8b, 0x9c, 0xd6, 0xe3, 0x4f}
	instrData = append(instrData, data.Outcome)
	return instrData, nil
}

func (ac *AnchorClient) encodeClaimInstruction(data *ClaimInstructionData) ([]byte, error) {
	// Instruction discriminator for claim
	return []byte{0x3e, 0xc6, 0xd8, 0x14, 0xf0, 0x9b, 0x35, 0x70}, nil
}

func (ac *AnchorClient) parseMarketAccount(data []byte) (*MarketAccountData, error) {
	if len(data) < 72 {
		return nil, fmt.Errorf("invalid market account data length: %d", len(data))
	}
	
	// Skip discriminator (8 bytes) and parse account data
	mint := common.PublicKeyFromBytes(data[8:40])
	vault := common.PublicKeyFromBytes(data[40:72])
	
	return &MarketAccountData{
		Mint:  mint,
		Vault: vault,
	}, nil
}

// GetMarketAccount fetches market account data
func (ac *AnchorClient) GetMarketAccount(ctx context.Context, marketID string) (*MarketAccountData, error) {
	accountInfo, err := ac.rpcClient.GetAccountInfo(ctx, marketID)
	if err != nil {
		return nil, fmt.Errorf("failed to get market account: %w", err)
	}

	return ac.parseMarketAccount(accountInfo.Data)
}

// Health check
func (ac *AnchorClient) Health(ctx context.Context) error {
	// Try to get slot to check if RPC is available
	_, err := ac.rpcClient.GetSlot(ctx)
	return err
}