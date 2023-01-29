import { program } from 'commander';
import { CronJob } from 'cron';
import { handleGames } from './crons/handleGames';

program.version('0.0.1');

program
  .command('cron <configFile>')
  .description('Starts a cron job')
  .action(async (configFile: string) => {
    await runCron(configFile);
  });

export type CronConfig = {
  schedule: string;
  name: string;
};

export type CronFunction = (config: any) => Promise<void>;

async function runCron(configFile: string) {
  const config: CronConfig = require(configFile);
  let func: CronFunction;
  switch (config.name) {
    case 'handleGames': {
      func = handleGames;
      break;
    }
    default: {
      throw 'Unrecognized cron name';
    }
  }
  const cronJob = new CronJob(config.schedule, async () => {
    try {
      console.log(`${nowString()}: Starting cron job ${config.name}`);
      await func(config);
      const end = new Date(Date.now()).toLocaleString();
      console.log(`${nowString()}: Finished running cron job ${config.name}`);
    } catch (e) {
      console.error(
        `${nowString()}: Cron job ${config.name} failed eith error:`,
      );
      console.error(e);
    }
  });

  // Start job
  if (!cronJob.running) {
    cronJob.start();
  }
}

function nowString() {
  return new Date(Date.now()).toLocaleString();
}

program.parse();
