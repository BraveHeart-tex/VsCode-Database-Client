import type { ConnectionConfig, Row } from 'shared';
import * as vscode from 'vscode';
import type { ConnectionManager } from '../db/ConnectionManager';
import type { ConnectionStore } from '../db/ConnectionStore';

const LOAD_SCHEMA_SQL = `
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name
`;

type TreeNode = ConnectionNode | SchemaNode | TableNode | MessageNode;

interface ConnectionNode {
  kind: 'connection';
  connection: ConnectionConfig;
}

interface SchemaNode {
  kind: 'schema';
  connectionId: string;
  schema: string;
  tables: string[];
}

interface TableNode {
  kind: 'table';
  connectionId: string;
  schema: string;
  table: string;
}

interface MessageNode {
  kind: 'message';
  label: string;
}

export class SchemaTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    TreeNode | undefined
  >();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly connectionStore: ConnectionStore,
    private readonly connectionManager: ConnectionManager
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'connection': {
        const item = new vscode.TreeItem(
          element.connection.name,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${element.connection.host}:${element.connection.port}/${element.connection.database}`;
        item.tooltip = `${element.connection.name}\n${item.description}`;
        item.contextValue = 'db-client.connection';
        item.iconPath = new vscode.ThemeIcon('database');
        return item;
      }
      case 'schema': {
        const item = new vscode.TreeItem(
          element.schema,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${element.tables.length} tables`;
        item.contextValue = 'db-client.schema';
        item.iconPath = vscode.ThemeIcon.Folder;
        return item;
      }
      case 'table': {
        const item = new vscode.TreeItem(
          element.table,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = element.schema;
        item.contextValue = 'db-client.table';
        item.iconPath = new vscode.ThemeIcon('table');
        return item;
      }
      case 'message':
        return new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.None
        );
    }
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      const connections = await this.connectionStore.getAll();
      return connections.map((connection) => ({
        kind: 'connection',
        connection,
      }));
    }

    if (element.kind === 'connection') {
      return this.getSchemaChildren(element.connection);
    }

    if (element.kind === 'schema') {
      return element.tables.map((table) => ({
        kind: 'table',
        connectionId: element.connectionId,
        schema: element.schema,
        table,
      }));
    }

    return [];
  }

  private async getSchemaChildren(
    connection: ConnectionConfig
  ): Promise<TreeNode[]> {
    try {
      await this.ensureConnected(connection);

      const result = await this.connectionManager.query(
        connection.id,
        LOAD_SCHEMA_SQL
      );

      const schemaMap = new Map<string, string[]>();

      for (const row of result.rows) {
        const schema = this.readString(row, 'table_schema');
        const table = this.readString(row, 'table_name');

        if (!schema || !table) {
          continue;
        }

        const tables = schemaMap.get(schema) ?? [];
        tables.push(table);
        schemaMap.set(schema, tables);
      }

      if (schemaMap.size === 0) {
        return [{ kind: 'message', label: 'No tables found' }];
      }

      return Array.from(schemaMap.entries()).map(([schema, tables]) => ({
        kind: 'schema',
        connectionId: connection.id,
        schema,
        tables,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to load schema for ${connection.name}: ${message}`
      );
      return [{ kind: 'message', label: `Error: ${message}` }];
    }
  }

  private async ensureConnected(connection: ConnectionConfig): Promise<void> {
    if (this.connectionManager.isConnected(connection.id)) {
      return;
    }

    await this.connectionManager.connect(connection);
  }

  private readString(row: Row, key: string): string | undefined {
    const value = row[key];
    return typeof value === 'string' ? value : undefined;
  }
}
