import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { CronConfig } from '../main';
import {
  getErrorCode,
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
    try {
      if (
        (rpsGame.acceptingReveal &&
          getExpirySlot(rpsGame.acceptingReveal) < slot) ||
        (rpsGame.acceptingChallenge &&
          getExpirySlot(rpsGame.acceptingChallenge) < slot)
      ) {
        console.log('Attempting expireAndSettle:', game.publicKey.toBase58());
        const signature = await expireAndSettle(game, rpsProgram, payer);
        console.log(
          `Cleaned up game ${game.publicKey.toBase58()} ${signature}}`,
        );
      } else if (rpsGame.acceptingSettle) {
        console.log('Attempting settle:', game.publicKey.toBase58());
        const signature = await settle(game, rpsProgram);
        console.log(`Settled game ${game.publicKey.toBase58()} ${signature}}`);
      }
    } catch (e: any) {
      const parsedError = getErrorCode(e.toString());
      if (parsedError === null) {
        console.log('Failed', e);
      } else {
        console.log(parsedError);
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
  let player1Pubkey;
  let player2Pubkey;
  let mint;
  let expirePlayer;
  if (game.account.state.acceptingChallenge) {
    player1Pubkey = (rpsGame.acceptingChallenge as any).player1.committed
      ?.pubkey;
    player2Pubkey = player1Pubkey;
    mint = rpsGame.acceptingChallenge?.config.mint;
    expirePlayer = player1Pubkey;
  } else {
    player1Pubkey = (rpsGame.acceptingReveal as any).player1.committed?.pubkey;
    player2Pubkey = (rpsGame.acceptingReveal as any).player2.revealed?.pubkey;
    mint = rpsGame.acceptingReveal!.config.mint;
    expirePlayer = payer.publicKey;
  }

  const expireIx = await rpsProgram.methods
    .expireGame()
    .accounts({
      game: game.publicKey,
      player: expirePlayer,
    })
    .instruction();
  const settleIx = await rpsProgram.methods
    .settleGame()
    .accounts({
      game: game.publicKey,
      player1TokenAccount: await getAssociatedTokenAddress(
        mint!,
        player1Pubkey,
      ),
      player2TokenAccount: await getAssociatedTokenAddress(
        mint!,
        player2Pubkey,
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
  const player2Pubkey =
    (rpsGame.acceptingSettle as any).player2.revealed?.pubkey ||
    (rpsGame.acceptingSettle as any).player2.committed?.pubkey;
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
        player2Pubkey,
      ),
      gameAuthority: getGameAuthority(game, rpsProgram),
      escrowTokenAccount: getEscrowAccount(game, rpsProgram),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
