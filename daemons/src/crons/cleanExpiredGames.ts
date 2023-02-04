import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { CronConfig } from '../main';
import {
  getErrorCode,
  getExpirySlot,
  getGameAuthority,
  getSecret,
} from '../utils/utils';
import { IDL, Rps } from '../idl/types/rps';
import { RPSGameType } from '../utils/types';

type CleanExpiredGamesConfig = CronConfig & {
  rpcURL: string;
  programAddress: string;
  walletSecretKey: string;
};

const gamesToIgnore = new Set<string>();

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
    if (gamesToIgnore.has(game.publicKey.toBase58())) {
      continue;
    }
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
        if (parsedError.errorNumber === 3012) {
          //  Unitialized WSOL account
          gamesToIgnore.add(game.publicKey.toBase58());
        }
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
  let expirePlayer;
  if (game.account.state.acceptingChallenge) {
    player1Pubkey = (rpsGame.acceptingChallenge as any).player1.committed
      ?.pubkey;
    player2Pubkey = player1Pubkey;
    expirePlayer = player1Pubkey;
  } else {
    player1Pubkey = (rpsGame.acceptingReveal as any).player1.committed?.pubkey;
    player2Pubkey = (rpsGame.acceptingReveal as any).player2.revealed?.pubkey;
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
      player1: player1Pubkey!,
      player2: player2Pubkey!,
      systemProgram: SystemProgram.programId,
      gameAuthority: getGameAuthority(game, rpsProgram),
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
      player1: player1Pubkey,
      player2: player2Pubkey,
      systemProgram: SystemProgram.programId,
      gameAuthority: getGameAuthority(game, rpsProgram),
    })
    .rpc();
}
