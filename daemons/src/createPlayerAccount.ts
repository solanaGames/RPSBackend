import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';
import { IDL } from './idl/types/rps';

const main = async () => {
  const payer = Keypair.fromSecretKey(Uint8Array.from([]));
  const player = new anchor.Wallet(payer);
  const connection = new Connection('https://api.devnet.solana.com');
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    {
      commitment: 'confirmed',
    },
  );
  anchor.setProvider(provider);

  const program = new anchor.Program(
    IDL,
    new PublicKey('rpsVN2ZC1K9hoGPs83xahjWo46cDNP49Tk7rQb56ipE'),
    provider,
  );

  const [playerInfo, _playerInfoBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('player_info')),
      player.publicKey.toBuffer(),
    ],
    program.programId,
  );
  const tx0 = await program.methods
    .createPlayerInfo()
    .accounts({
      playerInfo,
      systemProgram: anchor.web3.SystemProgram.programId,
      owner: player.publicKey,
    })
    .signers([payer])
    .rpc({ skipPreflight: true });
  console.log(tx0);
};
main();
