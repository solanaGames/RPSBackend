import { Connection } from '@solana/web3.js';
import { CronConfig } from '../main';

type HandleGamesConfig = CronConfig & {
  rpcURL: string;
};

export async function handleGames(config: HandleGamesConfig) {
  console.log('Handling Game');
  const connection = new Connection(config.rpcURL);
}
