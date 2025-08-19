use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

const MAX_FEE_BPS: u16 = 2000; // 20%
const MAX_TITLE_LEN: usize = 64;

#[program]
pub mod friends_bets {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        fee_bps: u16,
        end_ts: i64,
        resolve_deadline_ts: i64,
        title: String,
    ) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, ErrorCode::FeeTooHigh);
        require!(title.len() <= MAX_TITLE_LEN, ErrorCode::TitleTooLong);
        require!(
            end_ts > Clock::get()?.unix_timestamp,
            ErrorCode::EndTimeInPast
        );
        require!(resolve_deadline_ts > end_ts, ErrorCode::InvalidDeadline);

        let market = &mut ctx.accounts.market;
        let vault = &ctx.accounts.vault;

        market.creator = ctx.accounts.creator.key();
        market.mint = ctx.accounts.mint.key();
        market.vault = vault.key();
        market.fee_bps = fee_bps;
        market.end_ts = end_ts;
        market.resolve_deadline_ts = resolve_deadline_ts;
        market.staked_a = 0;
        market.staked_b = 0;
        market.status = MarketStatus::Open;
        market.outcome = None;
        market.creator_fee_withdrawn = false;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;
        market.title = title.clone();

        emit!(MarketInitialized {
            market: market.key(),
            creator: market.creator,
            title,
            fee_bps,
            end_ts,
            resolve_deadline_ts,
        });

        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, side: BetSide, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        require!(
            market.status == MarketStatus::Open,
            ErrorCode::MarketNotOpen
        );
        require!(
            Clock::get()?.unix_timestamp < market.end_ts,
            ErrorCode::BettingClosed
        );
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Transfer tokens from user to vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        // Update market stakes
        match side {
            BetSide::A => {
                market.staked_a = market
                    .staked_a
                    .checked_add(amount)
                    .ok_or(ErrorCode::Overflow)?
            }
            BetSide::B => {
                market.staked_b = market
                    .staked_b
                    .checked_add(amount)
                    .ok_or(ErrorCode::Overflow)?
            }
        }

        // Update position
        position.owner = ctx.accounts.user.key();
        position.side = side;
        position.amount = position
            .amount
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;
        position.claimed = false;
        position.bump = ctx.bumps.position;

        emit!(BetPlaced {
            market: market.key(),
            user: ctx.accounts.user.key(),
            side,
            amount,
        });

        Ok(())
    }

    pub fn close_betting(ctx: Context<CloseBetting>) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(
            market.status == MarketStatus::Open,
            ErrorCode::MarketNotOpen
        );
        require!(
            Clock::get()?.unix_timestamp >= market.end_ts,
            ErrorCode::BettingNotEnded
        );

        market.status = MarketStatus::PendingResolve;

        emit!(BettingClosed {
            market: market.key(),
        });

        Ok(())
    }

    pub fn resolve(ctx: Context<Resolve>, outcome: BetSide) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(
            market.status == MarketStatus::PendingResolve,
            ErrorCode::MarketNotPendingResolve
        );
        require!(
            ctx.accounts.creator.key() == market.creator,
            ErrorCode::UnauthorizedResolver
        );
        require!(
            Clock::get()?.unix_timestamp < market.resolve_deadline_ts,
            ErrorCode::ResolutionDeadlinePassed
        );

        market.status = MarketStatus::Resolved;
        market.outcome = Some(outcome);

        emit!(Resolved {
            market: market.key(),
            outcome,
        });

        Ok(())
    }

    pub fn cancel_expired(ctx: Context<CancelExpired>) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(
            market.status == MarketStatus::PendingResolve,
            ErrorCode::MarketNotPendingResolve
        );
        require!(
            Clock::get()?.unix_timestamp >= market.resolve_deadline_ts,
            ErrorCode::ResolutionNotExpired
        );

        market.status = MarketStatus::Cancelled;

        emit!(Cancelled {
            market: market.key(),
        });

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        require!(
            market.status == MarketStatus::Resolved || market.status == MarketStatus::Cancelled,
            ErrorCode::MarketNotFinalized
        );
        require!(!position.claimed, ErrorCode::AlreadyClaimed);
        require!(
            position.owner == ctx.accounts.user.key(),
            ErrorCode::UnauthorizedClaim
        );

        let payout = if market.status == MarketStatus::Cancelled {
            // Refund original amount
            position.amount
        } else {
            // Calculate payout based on outcome
            let outcome = market.outcome.unwrap();
            if position.side != outcome {
                0 // Lost bet
            } else {
                // Won bet - calculate pro-rata share
                let total_staked = market
                    .staked_a
                    .checked_add(market.staked_b)
                    .ok_or(ErrorCode::Overflow)?;
                let fee_amount = (total_staked as u128)
                    .checked_mul(market.fee_bps as u128)
                    .ok_or(ErrorCode::Overflow)?
                    .checked_div(10_000)
                    .ok_or(ErrorCode::Overflow)? as u64;

                let distributable = total_staked
                    .checked_sub(fee_amount)
                    .ok_or(ErrorCode::Underflow)?;

                let winning_side_total = match outcome {
                    BetSide::A => market.staked_a,
                    BetSide::B => market.staked_b,
                };

                if winning_side_total == 0 {
                    0
                } else {
                    ((distributable as u128)
                        .checked_mul(position.amount as u128)
                        .ok_or(ErrorCode::Overflow)?
                        .checked_div(winning_side_total as u128)
                        .ok_or(ErrorCode::Overflow)?) as u64
                }
            }
        };

        if payout > 0 {
            // Transfer payout from vault to user
            let market_key = market.key();
            let seeds = &[
                b"market",
                market.creator.as_ref(),
                market.mint.as_ref(),
                &[market.bump],
            ];
            let signer = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi_ctx, payout)?;
        }

        position.claimed = true;

        emit!(Claimed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            amount: payout,
        });

        Ok(())
    }

    pub fn withdraw_creator_fee(ctx: Context<WithdrawCreatorFee>) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(
            market.status == MarketStatus::Resolved,
            ErrorCode::MarketNotResolved
        );
        require!(
            ctx.accounts.creator.key() == market.creator,
            ErrorCode::UnauthorizedWithdrawal
        );
        require!(
            !market.creator_fee_withdrawn,
            ErrorCode::FeeAlreadyWithdrawn
        );

        let total_staked = market
            .staked_a
            .checked_add(market.staked_b)
            .ok_or(ErrorCode::Overflow)?;
        let fee_amount = (total_staked as u128)
            .checked_mul(market.fee_bps as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::Overflow)? as u64;

        if fee_amount > 0 {
            // Transfer fee from vault to creator
            let market_key = market.key();
            let seeds = &[
                b"market",
                market.creator.as_ref(),
                market.mint.as_ref(),
                &[market.bump],
            ];
            let signer = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi_ctx, fee_amount)?;
        }

        market.creator_fee_withdrawn = true;

        emit!(CreatorFeeWithdrawn {
            market: market.key(),
            creator: ctx.accounts.creator.key(),
            amount: fee_amount,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(fee_bps: u16, end_ts: i64, resolve_deadline_ts: i64, title: String)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Market::LEN,
        seeds = [b"market", creator.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        token::mint = mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(side: BetSide, amount: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = user,
        space = Position::LEN,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = user_token_account.mint == market.mint,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault.key() == market.vault
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CloseBetting<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
#[instruction(outcome: BetSide)]
pub struct Resolve<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = market.creator == creator.key()
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct CancelExpired<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = user_token_account.mint == market.mint,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault.key() == market.vault
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawCreatorFee<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = market.creator == creator.key()
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = creator_token_account.mint == market.mint,
        constraint = creator_token_account.owner == creator.key()
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault.key() == market.vault
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub fee_bps: u16,
    pub end_ts: i64,
    pub resolve_deadline_ts: i64,
    pub staked_a: u64,
    pub staked_b: u64,
    pub status: MarketStatus,
    pub outcome: Option<BetSide>,
    pub creator_fee_withdrawn: bool,
    pub bump: u8,
    pub vault_bump: u8,
    pub title: String,
}

impl Market {
    const LEN: usize = 8 + // discriminator
        32 + // creator
        32 + // mint
        32 + // vault
        2 + // fee_bps
        8 + // end_ts
        8 + // resolve_deadline_ts
        8 + // staked_a
        8 + // staked_b
        1 + // status
        1 + 1 + // outcome (Option<BetSide>)
        1 + // creator_fee_withdrawn
        1 + // bump
        1 + // vault_bump
        4 + MAX_TITLE_LEN; // title
}

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub side: BetSide,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Position {
    const LEN: usize = 8 + // discriminator
        32 + // owner
        1 + // side
        8 + // amount
        1 + // claimed
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    PendingResolve,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BetSide {
    A,
    B,
}

// Events
#[event]
pub struct MarketInitialized {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub title: String,
    pub fee_bps: u16,
    pub end_ts: i64,
    pub resolve_deadline_ts: i64,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub user: Pubkey,
    pub side: BetSide,
    pub amount: u64,
}

#[event]
pub struct BettingClosed {
    pub market: Pubkey,
}

#[event]
pub struct Resolved {
    pub market: Pubkey,
    pub outcome: BetSide,
}

#[event]
pub struct Cancelled {
    pub market: Pubkey,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CreatorFeeWithdrawn {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Fee too high (max 20%)")]
    FeeTooHigh,
    #[msg("Title too long")]
    TitleTooLong,
    #[msg("End time must be in the future")]
    EndTimeInPast,
    #[msg("Resolve deadline must be after end time")]
    InvalidDeadline,
    #[msg("Market is not open for betting")]
    MarketNotOpen,
    #[msg("Betting period has ended")]
    BettingClosed,
    #[msg("Invalid bet amount")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Arithmetic underflow")]
    Underflow,
    #[msg("Betting period has not ended")]
    BettingNotEnded,
    #[msg("Market is not pending resolution")]
    MarketNotPendingResolve,
    #[msg("Unauthorized resolver")]
    UnauthorizedResolver,
    #[msg("Resolution deadline has passed")]
    ResolutionDeadlinePassed,
    #[msg("Resolution deadline has not been reached")]
    ResolutionNotExpired,
    #[msg("Market is not finalized")]
    MarketNotFinalized,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Unauthorized claim")]
    UnauthorizedClaim,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Unauthorized withdrawal")]
    UnauthorizedWithdrawal,
    #[msg("Creator fee already withdrawn")]
    FeeAlreadyWithdrawn,
}

