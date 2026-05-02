import type { ConnectionConfig } from 'shared';
import type * as vscode from 'vscode';

const CONNECTIONS_KEY = 'db-client.connections';

export class ConnectionStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getAll(): Promise<ConnectionConfig[]> {
    const raw = await this.secrets.get(CONNECTIONS_KEY);
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(raw) as ConnectionConfig[];
    } catch {
      return [];
    }
  }

  async save(config: ConnectionConfig): Promise<void> {
    const all = await this.getAll();
    const index = all.findIndex(
      (connectionConfig) => connectionConfig.id === config.id
    );

    if (index >= 0) {
      all[index] = config;
    } else {
      all.push(config);
    }

    await this.secrets.store(CONNECTIONS_KEY, JSON.stringify(all));
  }

  async delete(connectionId: string): Promise<void> {
    const all = await this.getAll();
    const filtered = all.filter(
      (connectionConfig) => connectionConfig.id !== connectionId
    );
    await this.secrets.store(CONNECTIONS_KEY, JSON.stringify(filtered));
  }
}
