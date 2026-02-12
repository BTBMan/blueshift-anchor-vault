import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { BlueshiftAnchorVault } from '../target/types/blueshift_anchor_vault';
import { assert } from 'chai';

describe('blueshift-anchor-vault', async () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  const wallet = provider.wallet;
  const connection = provider.connection;
  anchor.setProvider(provider);

  const program = anchor.workspace
    .blueshiftAnchorVault as Program<BlueshiftAnchorVault>;

  const [vaultPDA] = await anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), wallet.publicKey.toBuffer()],
    program.programId,
  );

  async function logMsg(tx: string) {
    // 获取交易详情以查看程序日志
    const txDetails = await connection.getTransaction(tx, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    // 打印程序日志
    if (txDetails?.meta?.logMessages) {
      console.log('\n=== Program Logs ===');
      txDetails.meta.logMessages.forEach((log) => console.log(log));
      console.log('===================\n');
    } else {
      console.log('⚠️  No logs found in transaction');
    }

    return txDetails;
  }

  it('Should deposit successful', async function () {
    const balanceBefore = await connection.getBalance(wallet.publicKey);
    // console.log(
    //   'Balance before:',
    //   (await connection.getBalance(wallet.publicKey)) /
    //     anchor.web3.LAMPORTS_PER_SOL,
    //   'SOL',
    // );

    // 存入 1 SOL (= 1,000,000,000 lamports)
    // 注意：Solana 链上所有金额都以 lamports 为单位
    const depositAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    // console.log('Depositing:', depositAmount.toNumber(), 'lamports (1 SOL)');

    const tx = await program.methods
      .deposit(depositAmount)
      .rpc({ commitment: 'confirmed' });

    const txDetails = await logMsg(tx);
    const fee = new anchor.BN(txDetails.meta.fee);
    const balanceAfter = await connection.getBalance(wallet.publicKey);
    const vaultBalance = await connection.getBalance(vaultPDA);

    assert(balanceAfter + depositAmount.add(fee).toNumber() === balanceBefore);
    assert(vaultBalance === depositAmount.toNumber());

    // console.log({
    //   balanceBefore,
    //   depositAmount: depositAmount.toNumber(),
    //   fee: txDetails.meta.fee,
    //   feeAndAmount: depositAmount
    //     .add(new anchor.BN(txDetails.meta.fee))
    //     .toNumber(),
    //   balanceAfter,
    //   finally:
    //     balanceAfter +
    //     depositAmount.add(new anchor.BN(txDetails.meta.fee)).toNumber(),
    // });

    // console.log(
    //   'Balance after:',
    //   (await connection.getBalance(wallet.publicKey)) /
    //     anchor.web3.LAMPORTS_PER_SOL,
    //   'SOL',
    // );
  });

  it('Should withdraw successful', async function () {
    const balanceBefore = await connection.getBalance(wallet.publicKey);
    const depositAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    const withdrawTx = await program.methods
      .withdraw()
      .rpc({ commitment: 'confirmed' });
    const withdrawTxDetails = await logMsg(withdrawTx);
    const withdrawFee = new anchor.BN(withdrawTxDetails.meta.fee);
    const balanceAfter = await connection.getBalance(wallet.publicKey);
    const vaultBalance = await connection.getBalance(vaultPDA);

    assert(
      balanceAfter - depositAmount.sub(withdrawFee).toNumber() ===
        balanceBefore,
    );
    assert(vaultBalance === 0);
  });

  describe('Error handling tests', () => {
    it('Should fail when depositing amount less than minimum rent', async function () {
      // 清空 vault（如果有余额）
      try {
        await program.methods.withdraw().rpc({ commitment: 'confirmed' });
      } catch (e) {
        // 忽略错误，vault 可能本来就是空的
      }

      // 尝试存入小于最低租金的金额
      const tooSmallAmount = new anchor.BN(100); // 只有 100 lamports

      try {
        await program.methods
          .deposit(tooSmallAmount)
          .rpc({ commitment: 'confirmed' });

        // 如果没有抛出错误，测试应该失败
        assert.fail('Expected an error but transaction succeeded');
      } catch (error) {
        // 验证是 Anchor 错误
        assert(error instanceof anchor.AnchorError);

        // 验证错误代码
        assert.equal(error.error.errorCode.code, 'InvalidAmount');

        // 验证错误消息
        assert.equal(error.error.errorMessage, 'Invalid amount');
      }
    });

    it('Should fail when vault already exists (duplicate deposit)', async function () {
      // 清空 vault
      try {
        await program.methods.withdraw().rpc({ commitment: 'confirmed' });
      } catch (e) {
        // 忽略
      }

      const depositAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

      // 第一次存款应该成功
      await program.methods
        .deposit(depositAmount)
        .rpc({ commitment: 'confirmed' });

      console.log('First deposit succeeded');

      // 第二次存款应该失败
      try {
        await program.methods
          .deposit(depositAmount)
          .rpc({ commitment: 'confirmed' });

        assert.fail('Expected VaultAlreadyExists error');
      } catch (error) {
        assert(error instanceof anchor.AnchorError);
        assert.equal(error.error.errorCode.code, 'VaultAlreadyExists');
        assert.equal(error.error.errorMessage, 'Vault already exists');
      }

      // 清理：取出资金
      await program.methods.withdraw().rpc({ commitment: 'confirmed' });
    });

    it('Should fail when withdrawing from empty vault', async function () {
      // 确保 vault 是空的
      try {
        await program.methods.withdraw().rpc({ commitment: 'confirmed' });
      } catch (e) {
        // 已经是空的
      }

      // 尝试从空 vault 取款
      try {
        await program.methods.withdraw().rpc({ commitment: 'confirmed' });

        assert.fail('Expected InvalidAmount error');
      } catch (error) {
        assert(error instanceof anchor.AnchorError);
        assert.equal(error.error.errorCode.code, 'InvalidAmount');
      }
    });
  });
});
