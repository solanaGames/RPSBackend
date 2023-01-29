import { CronConfig } from '../main';

type HandleGamesConfig = CronConfig & {
  rpcURL: string;
};

export async function handleGames(config: HandleGamesConfig) {
  console.log('Handling Game');
}
