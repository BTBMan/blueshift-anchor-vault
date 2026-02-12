use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("8PA81TztCiCbHPatnKw11VpebcLsS5GvmF3vaepQtQjj");

#[program]
pub mod blueshift_anchor_vault {
    use super::*;

    // 存款指令
    pub fn deposit(ctx: Context<VaultAction>, amount: u64) -> Result<()> {
        // 判断金库的余额为 0, 代表还未存过款
        require_eq!(
            ctx.accounts.vault.lamports(),
            0,
            VaultError::VaultAlreadyExists
        );

        let min_rent = Rent::get()?.minimum_balance(0);
        msg!(
            "The minimum rent is: {} lamports ({} SOL)",
            min_rent,
            min_rent as f64 / 1_000_000_000.0
        );

        // 判断存储的金额大于 SystemAccount 的免租金最低限额 (因为存储数据须要租金, 数据越大, 租金越贵)
        require_gt!(
            amount,
            Rent::get()?.minimum_balance(0),
            VaultError::InvalidAmount
        );

        // 利用 CPI 调用系统程序的转账指令
        // 因为调用者把自己钱包里的钱转到 PDA 保险柜中, 调用者已经进行了签名, 所以这里我们不需要签名
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );

        transfer(cpi_context, amount)?;

        Ok(())
    }

    // 取款指令
    pub fn withdraw(ctx: Context<VaultAction>) -> Result<()> {
        // 验证确保金库中有资金
        require_neq!(ctx.accounts.vault.lamports(), 0, VaultError::InvalidAmount);

        // 通过 CPI 转账
        // 这里因为是从 PDA 金库中取出 lamports 到调用者的钱包里, 所以须要创建 PDA 签名种子
        let signer_key = ctx.accounts.signer.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", signer_key.as_ref(), &[ctx.bumps.vault]]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.signer.to_account_info(),
            },
            signer_seeds,
        );

        transfer(cpi_context, ctx.accounts.vault.lamports())?;

        Ok(())
    }
}

// 涉及到的账户列表
#[derive(Accounts)]
pub struct VaultAction<'info> {
    // Writeable 签名账户, 金库的所有者
    #[account(mut)]
    pub signer: Signer<'info>,

    // Writeable 系统账户, 用来为 signer 存储 lamports
    // 因为不需要存储任何 data, 所以不用初始化它, 也减少租金
    // 不初始化它, 那么它就是一个系统账户
    #[account(
        mut,
        seeds = [b"vault", signer.key().as_ref() ],
        bump
    )]
    pub vault: SystemAccount<'info>,

    // 系统程序账户
    pub system_program: Program<'info, System>,
}

// 定义错误说明
#[error_code]
pub enum VaultError {
    #[msg("Vault already exists")]
    VaultAlreadyExists,
    #[msg("Invalid amount")]
    InvalidAmount,
}
