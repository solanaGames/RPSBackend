import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { IDL } from './idl/types/rps';
import { getSecret } from "./utils/utils";
const config = {
    rpcURL: 'https://api.devnet.solana.com/',
}
const main = async() => {

    const connection = new Connection(config.rpcURL);
    const secret = await getSecret('');
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
    const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(payer),
        {},
    );
    anchor.setProvider(provider);
    const rpsProgram = new anchor.Program(
        IDL,
        new PublicKey('rpsx2U29nY4LQmzw9kdvc7sgDBYK8N2UXpex3SJofuX'),
        provider,
    );
    const programID = new PublicKey('rpsx2U29nY4LQmzw9kdvc7sgDBYK8N2UXpex3SJofuX');

    const results = await connection.getProgramAccounts(programID)
    for (const result of results) {
        console.log(result.pubkey.toBase58())
        try {
            console.log(await rpsProgram.methods.cleanFuckIt().accounts({
                game: result.pubkey,
                systemProgram: SystemProgram.programId,
                cleaner: payer.publicKey,
                rpsProgram: programID,
            }).rpc())
        } catch(e: any) {console.log(e)}
    }
}

main();
