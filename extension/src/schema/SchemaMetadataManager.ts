import type { ConnectionConfig, SchemaMetadata } from 'shared';
import type { ConnectionManager } from '../db/ConnectionManager';
import { createSchemaMetadata, LOAD_SCHEMA_METADATA_SQL } from './metadata';

export class SchemaMetadataManager {
  private readonly metadata = new Map<string, SchemaMetadata>();
  private readonly refreshes = new Map<string, Promise<SchemaMetadata>>();
  private readonly refreshListeners = new Set<
    (metadata: SchemaMetadata) => void
  >();

  constructor(private readonly connectionManager: ConnectionManager) {}

  async refresh(connection: ConnectionConfig): Promise<SchemaMetadata> {
    const existingRefresh = this.refreshes.get(connection.id);

    if (existingRefresh) {
      return existingRefresh;
    }

    const refresh = this.load(connection);
    this.refreshes.set(connection.id, refresh);

    try {
      return await refresh;
    } finally {
      this.refreshes.delete(connection.id);
    }
  }

  get(connectionId: string): SchemaMetadata | undefined {
    return this.metadata.get(connectionId);
  }

  clear(connectionId: string): void {
    this.metadata.delete(connectionId);
    this.refreshes.delete(connectionId);
  }

  isRefreshing(connectionId: string): boolean {
    return this.refreshes.has(connectionId);
  }

  onDidRefresh(listener: (metadata: SchemaMetadata) => void): {
    dispose(): void;
  } {
    this.refreshListeners.add(listener);

    return {
      dispose: () => {
        this.refreshListeners.delete(listener);
      },
    };
  }

  private async load(connection: ConnectionConfig): Promise<SchemaMetadata> {
    const result = await this.connectionManager.query(
      connection.id,
      LOAD_SCHEMA_METADATA_SQL
    );
    const metadata = createSchemaMetadata(connection.id, result.rows);
    this.metadata.set(connection.id, metadata);
    this.refreshListeners.forEach((listener) => {
      listener(metadata);
    });
    return metadata;
  }
}
