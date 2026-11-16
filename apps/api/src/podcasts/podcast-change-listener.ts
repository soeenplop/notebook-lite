import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Client } from 'pg';
import { type ApiEnv, ENV } from '../config/env.js';
import { type ListenClient, PodcastChangeHub } from './podcast-changes.js';

/** The process-wide podcast change feed, backed by a dedicated Postgres LISTEN connection. */
@Injectable()
export class PodcastChangeListener extends PodcastChangeHub implements OnApplicationShutdown {
  constructor(@Inject(ENV) env: ApiEnv) {
    super({
      connect: async (): Promise<ListenClient> => {
        const client = new Client({
          connectionString: env.DATABASE_URL,
          application_name: 'notebook-lite-api-listen',
          keepAlive: true,
        });
        try {
          await client.connect();
        } catch (error) {
          await client.end().catch(() => undefined);
          throw error;
        }
        return client;
      },
      logger: new Logger('PodcastChanges'),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}
