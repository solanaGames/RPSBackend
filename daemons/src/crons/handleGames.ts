import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CronConfig } from '../main';
import {
  getEscrowAccount,
  getExpirySlot,
  getGameAuthority,
  getSecret,
} from '../utils/utils';
import { IDL } from '../idl/types/rps';
import { randomInt } from 'crypto';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';

type HandleGamesConfig = CronConfig & {
  rpcURL: string;
  programAddress: string;
  walletSecretKey: string;
};

const gamesToIgnore = new Set<string>();

const mintToMaxBet: { [key: string]: number } = {
  So11111111111111111111111111111111111111112: 1 * 1000000000,
};

export async function handleGames(config: HandleGamesConfig) {
  const connection = new Connection(config.rpcURL);
  const secret = await getSecret(config.walletSecretKey);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    {},
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
    if (!rpsGame.acceptingChallenge) {
      continue;
    }
    if (!mintToMaxBet[rpsGame.acceptingChallenge.config.mint.toBase58()]) {
      continue;
    }
    if (gamesToIgnore.has(game.publicKey.toBase58())) {
      continue;
    }
    const expirySlot = getExpirySlot(rpsGame.acceptingChallenge);
    if (expirySlot < slot) {
      console.log(
        `Ignoring expired game${game.publicKey.toBase58()}, ${expirySlot}, ${slot}`,
      );
      continue;
    }
    const maxAcceptableBet =
      mintToMaxBet[rpsGame.acceptingChallenge.config.mint.toBase58()];
    if (
      rpsGame.acceptingChallenge.config.wagerAmount.toNumber() >
      maxAcceptableBet
    ) {
      console.log(
        `Ignoring game because wager size is too large. ${game.publicKey.toBase58()}`,
      );
      continue;
    }
    console.log(`Accepting game: ${game.publicKey.toBase58()}`);
    const choice = [{ rock: {} }, { paper: {} }, { scissors: {} }][
      randomInt(0, 3)
    ];
    const ata = await getAssociatedTokenAddress(
      rpsGame.acceptingChallenge.config.mint,
      payer.publicKey,
    );
    const tx = await rpsProgram.methods
      .joinGame(choice, null)
      .accounts({
        player: payer.publicKey,
        game: game.publicKey,
        playerTokenAccount: ata,
        gameAuthority: getGameAuthority(game, rpsProgram),
        escrowTokenAccount: getEscrowAccount(game, rpsProgram),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payer])
      .rpc({ skipPreflight: false });
    console.log('Accepted game', tx);
  }
}
