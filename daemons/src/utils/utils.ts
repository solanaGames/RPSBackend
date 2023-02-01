import * as anchor from '@project-serum/anchor';
import { PublicKey } from '@solana/web3.js';

const AWS = require('aws-sdk');

export function getSecret(secretName: string): Promise<string> {
  var client = new AWS.SecretsManager({
    region: 'us-west-1',
  });
  return new Promise(function (resolve, reject) {
    client.getSecretValue(
      { SecretId: secretName },
      function (err: any, data: any) {
        if (err) {
          reject(err);
        } else {
          // Decrypts secret using the associated KMS CMK.
          // Depending on whether the secret is a string or binary, one of these fields will be populated.
          if ('SecretString' in data) {
            resolve(data.SecretString);
          } else {
            let buf = new Buffer(data.SecretBinary, 'base64');
            resolve(buf.toString('ascii'));
          }
        }
      },
    );
  });
}

export function getExpirySlot(gameState: any): number {
  return (gameState as any).expirySlot.toNumber();
}

export function getGameAuthority(game: any, program: any): PublicKey {
  const [gameAuthority, _gameAuthorityBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('authority')),
      game.publicKey.toBuffer(),
    ],
    program.programId,
  );
  return gameAuthority;
}

export function getEscrowAccount(game: any, program: any): PublicKey {
  const [escrowTokenAccount, _escrowTokenAccountBump] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode('escrow')),
        game.publicKey.toBuffer(),
      ],
      program.programId,
    );
  return escrowTokenAccount;
}
