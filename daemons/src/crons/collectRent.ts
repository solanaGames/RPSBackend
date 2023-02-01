import * as anchor from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CronConfig } from '../main';
import { getEscrowAccount, getGameAuthority, getSecret } from '../utils/utils';
import { IDL } from '../idl/types/rps';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

type CollectRentConfig = CronConfig & {
  rpcURL: string;
  programAddress: string;
  walletSecretKey: string;
};

export async function collectRent(config: CollectRentConfig) {
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
  for (const game of games) {
    const rpsGame = game.account.state;
    if (rpsGame.settled) {
      const signature = await rpsProgram.methods
        .cleanGame()
        .accounts({
          game: game.publicKey,
          gameAuthority: getGameAuthority(game, rpsProgram),
          escrowTokenAccount: getEscrowAccount(game, rpsProgram),
          cleaner: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log(`Cleaned game: ${game.publicKey}, ${signature}`);
    }
  }
}