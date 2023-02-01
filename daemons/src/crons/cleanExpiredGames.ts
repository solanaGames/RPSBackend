import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { CronConfig } from '../main';
import {
  getEscrowAccount,
  getExpirySlot,
  getGameAuthority,
  getSecret,
} from '../utils/utils';
import { IDL, Rps } from '../idl/types/rps';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { RPSGameType } from '../utils/types';

type CleanExpiredGamesConfig = CronConfig & {
  rpcURL: string;
  programAddress: string;
  walletSecretKey: string;
};

export async function cleanExpiredGames(config: CleanExpiredGamesConfig) {
  const connection = new Connection(config.rpcURL);
  const secret = await getSecret(config.walletSecretKey);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    {
      commitment: 'confirmed',
    },
  );
  anchor.setProvider(provider);
  const rpsProgram = new anchor.Program(
    IDL,
    new PublicKey(config.programAddress),
    provider,
  );
  const games = await rpsProgram.account.game.all();
  const slot = await connection.getSlot();
  for (const game of games) {
    const rpsGame = game.account.state;
    if (rpsGame.acceptingReveal) {
      const expirySlot = getExpirySlot(rpsGame.acceptingReveal);
      if (
        (rpsGame.acceptingReveal as any).player2.revealed?.pubkey.toBase58() ==
          payer.publicKey.toBase58() &&
        expirySlot < slot
      ) {
        try {
          const signature = await expireAndSettle(game, rpsProgram, payer);
          console.log(
            `Cleaned up game ${game.publicKey.toBase58()} ${signature}}`,
          );
        } catch (e: any) {
          console.log('expireAndSettle failed:', e);
        }
      }
    } else if (
      rpsGame.acceptingSettle &&
      (rpsGame.acceptingSettle as any).player2.revealed?.pubkey.toBase58() ==
        payer.publicKey.toBase58()
    ) {
      try {
        const signature = await settle(game, rpsProgram);
        console.log(`Settled game ${game.publicKey.toBase58()} ${signature}}`);
      } catch (e: any) {
        console.log('settle failed:', e);
      }
    }
  }
}

async function expireAndSettle(
  game: anchor.ProgramAccount<RPSGameType>,
  rpsProgram: anchor.Program<Rps>,
  payer: Keypair,
): Promise<string> {
  const rpsGame = game.account.state;
  const expireIx = await rpsProgram.methods
    .expireGame()
    .accounts({
      game: game.publicKey,
      player: payer.publicKey,
    })
    .instruction();
  const settleIx = await rpsProgram.methods
    .settleGame()
    .accounts({
      game: game.publicKey,
      player1TokenAccount: await getAssociatedTokenAddress(
        rpsGame.acceptingReveal!.config.mint,
        (rpsGame.acceptingReveal as any).player1.committed?.pubkey,
      ),
      player2TokenAccount: await getAssociatedTokenAddress(
        rpsGame.acceptingReveal!.config.mint,
        (rpsGame.acceptingReveal as any).player2.revealed?.pubkey,
      ),
      gameAuthority: getGameAuthority(game, rpsProgram),
      escrowTokenAccount: getEscrowAccount(game, rpsProgram),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const tx = new Transaction();
  tx.add(expireIx);
  tx.add(settleIx);
  return await rpsProgram.provider.sendAndConfirm!(tx, [payer]);
}

async function settle(
  game: anchor.ProgramAccount<RPSGameType>,
  rpsProgram: anchor.Program<Rps>,
): Promise<string> {
  const rpsGame = game.account.state;
  const player1Pubkey =
    (rpsGame.acceptingSettle as any).player1.revealed?.pubkey ||
    (rpsGame.acceptingSettle as any).player1.committed?.pubkey;

  return await rpsProgram.methods
    .settleGame()
    .accounts({
      game: game.publicKey,
      player1TokenAccount: await getAssociatedTokenAddress(
        rpsGame.acceptingSettle!.config.mint,
        player1Pubkey,
      ),
      player2TokenAccount: await getAssociatedTokenAddress(
        rpsGame.acceptingSettle!.config.mint,
        (rpsGame.acceptingSettle as any).player2.revealed?.pubkey,
      ),
      gameAuthority: getGameAuthority(game, rpsProgram),
      escrowTokenAccount: getEscrowAccount(game, rpsProgram),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
