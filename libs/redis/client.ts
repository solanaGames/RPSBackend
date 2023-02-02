import * as Redis from 'ioredis';

export class RedisClient {
  private redisClient: Redis.Cluster;

  constructor(host: string, port: number) {
    this.redisClient = new Redis.Cluster(
      [
        {
          host: host,
          port: port,
        },
      ],
      {
        slotsRefreshTimeout: 5000,
        dnsLookup: (address, callback) => callback(null, address),
      },
    );
  }
}
