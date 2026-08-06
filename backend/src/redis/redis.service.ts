import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private subscriber: Redis;
  private handlers = new Map<string, Array<(message: any) => void>>();

  async onModuleInit() {
    const options = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    };

    this.client = new Redis(options);

    // enableReadyCheck: false — o ready-check (INFO) numa conexão que já
    // recebeu SUBSCRIBE falha com "Connection in subscriber mode" e, sem
    // handler de error, derruba o processo inteiro (crash real em 31/07).
    this.subscriber = new Redis({ ...options, enableReadyCheck: false });

    this.client.on('error', (error) =>
      console.error(`Redis client error: ${error.message}`),
    );
    this.subscriber.on('error', (error) =>
      console.error(`Redis subscriber error: ${error.message}`),
    );

    // Listener único: subscribe() registrava um listener 'message' novo por
    // chamada, multiplicando callbacks a cada assinatura.
    this.subscriber.on('message', (channel: string, message: string) => {
      const callbacks = this.handlers.get(channel);
      if (!callbacks || callbacks.length === 0) return;
      let parsed: any;
      try {
        parsed = JSON.parse(message);
      } catch {
        parsed = message;
      }
      for (const callback of callbacks) {
        try {
          callback(parsed);
        } catch (error) {
          console.error(`Redis handler error on ${channel}:`, error);
        }
      }
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  async publish(channel: string, message: any): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    const callbacks = this.handlers.get(channel) || [];
    callbacks.push(callback);
    this.handlers.set(channel, callbacks);
    await this.subscriber.subscribe(channel);
  }

  async unsubscribe(channel: string, callback: (message: any) => void): Promise<void> {
    const callbacks = this.handlers.get(channel) || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
      this.handlers.set(channel, callbacks);
    }
    if (callbacks.length === 0) {
      await this.subscriber.unsubscribe(channel);
    }
  }
}
