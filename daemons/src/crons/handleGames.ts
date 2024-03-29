import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CronConfig } from '../main';
import { getExpirySlot, getGameAuthority, getSecret } from '../utils/utils';
import { IDL } from '../idl/types/rps';
import { randomInt } from 'crypto';

type HandleGamesConfig = CronConfig & {
  rpcURL: string;
  programAddress: string;
  walletSecretKey: string;
};

let gamesToIgnore = new Set<string>();
const IGNORED_GAMES_MAX_SIZE = 10000;

const MAX_ACCEPTABLE_BET = 1 * 1000000000;

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
  const [playerInfo, _playerInfoBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('player_info')),
      payer.publicKey.toBuffer(),
    ],
    rpsProgram.programId,
  );
  const games = await rpsProgram.account.game.all();
  const slot = await connection.getSlot();
  for (const game of games) {
    const rpsGame = game.account.state;
    if (!rpsGame.acceptingChallenge) {
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
    if (game.account.wagerAmount > MAX_ACCEPTABLE_BET) {
      console.log(
        `Ignoring game because wager size is too large. ${game.publicKey.toBase58()}`,
      );
      continue;
    }
    console.log(`Accepting game: ${game.publicKey.toBase58()}`);
    const choice = [{ rock: {} }, { paper: {} }, { scissors: {} }][
      randomInt(0, 3)
    ];
    try {
      const tx = await rpsProgram.methods
        .joinGame(choice, null)
        .accounts({
          player: payer.publicKey,
          game: game.publicKey,
          gameAuthority: getGameAuthority(game, rpsProgram),
          playerInfo: playerInfo,
        })
        .signers([payer])
        .rpc({ skipPreflight: false });
      console.log('Accepted game', tx);
      gamesToIgnore.add(game.publicKey.toBase58());
      if (gamesToIgnore.size > IGNORED_GAMES_MAX_SIZE) {
        gamesToIgnore = new Set<string>();
      }
    } catch (e: any) {
      console.log(e);
    }
  }
}
