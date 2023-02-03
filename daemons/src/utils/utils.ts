import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { RPSGameType } from './types';
import { BN } from '@coral-xyz/anchor';
const AWS = require('aws-sdk');

export async function getSecret(secretName: string): Promise<string> {
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

export function getExpirySlot(gameState: { expiry_slot: BN }): number {
  return (gameState as any).expirySlot.toNumber();
}

export function getGameAuthority(
  game: anchor.ProgramAccount<RPSGameType>,
  program: any,
): PublicKey {
  const [gameAuthority, _gameAuthorityBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('authority')),
      game.publicKey.toBuffer(),
    ],
    program.programId,
  );
  return gameAuthority;
}

export function getEscrowAccount(
  game: anchor.ProgramAccount<RPSGameType>,
  program: any,
): PublicKey {
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

export function getErrorCode(
  e: string,
): { errorNumber: number; errorCode: string } | null {
  try {
    if (e.includes('Error Number: ') || e.includes('Error Code: ')) {
      const errorNumber = parseInt(e.split('Error Number: ')[1].split('.')[0]);
      const errorCode = e.split('Error Code: ')[1].split('.')[0];
      return {
        errorNumber,
        errorCode,
      };
    }
    if (e.includes('custom program error')) {
      const errorNumber = parseInt(e.split('custom program error: ')[1]);
      const errorCode = 'custom program error';
      return {
        errorNumber,
        errorCode,
      };
    }
  } catch (e: any) {}
  return null;
}
