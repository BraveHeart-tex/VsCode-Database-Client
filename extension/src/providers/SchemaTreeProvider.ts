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

type TreeNode =
  | ConnectionNode
  | SchemaNode
  | TableNode
  | ColumnNode
  | MessageNode;

interface ColumnMetadata {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
}

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

interface ColumnNode {
  kind: 'column';
  connectionId: string;
  schema: string;
  table: string;
  column: ColumnMetadata;
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
        item.contextValue = 'dbClient.connection';
        item.iconPath = new vscode.ThemeIcon('database');
        return item;
      }
      case 'schema': {
        const item = new vscode.TreeItem(
          element.schema,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${element.tables.length} tables`;
        item.contextValue = 'dbClient.schema';
        item.iconPath = vscode.ThemeIcon.Folder;
        return item;
      }
      case 'table': {
        const item = new vscode.TreeItem(
          element.table,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = element.schema;
        item.contextValue = 'dbClient.table';
        item.iconPath = new vscode.ThemeIcon('table');
        return item;
      }
      case 'column': {
        const item = new vscode.TreeItem(
          this.formatColumnLabel(element.column),
          vscode.TreeItemCollapsibleState.None
        );
        item.description = this.formatColumnDescription(element.column);
        item.tooltip = this.formatColumnTooltip(element);
        item.contextValue = 'dbClient.column';
        item.iconPath = new vscode.ThemeIcon('symbol-field');
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

    if (element.kind === 'table') {
      return this.getColumnChildren(element);
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

  private async getColumnChildren(table: TableNode): Promise<TreeNode[]> {
    try {
      const result = await this.connectionManager.query(
        table.connectionId,
        this.createLoadColumnsSql(table.schema, table.table)
      );

      return result.rows
        .map((row) => this.readColumnMetadata(row))
        .filter((column): column is ColumnMetadata => column !== undefined)
        .map((column) => ({
          kind: 'column',
          connectionId: table.connectionId,
          schema: table.schema,
          table: table.table,
          column,
        }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to load columns for ${table.schema}.${table.table}: ${message}`
      );
      return [];
    }
  }

  private createLoadColumnsSql(schema: string, table: string): string {
    return `
SELECT column_name, data_type, is_nullable, column_default, ordinal_position
FROM information_schema.columns
WHERE table_schema = '${this.escapeSqlLiteral(schema)}'
  AND table_name = '${this.escapeSqlLiteral(table)}'
ORDER BY ordinal_position
`;
  }

  private escapeSqlLiteral(value: string): string {
    return value.replaceAll("'", "''");
  }

  private readColumnMetadata(row: Row): ColumnMetadata | undefined {
    const name = this.readString(row, 'column_name');
    const dataType = this.readString(row, 'data_type');
    const isNullable = this.readString(row, 'is_nullable');
    const defaultValue = this.readNullableString(row, 'column_default');
    const ordinalPosition = this.readNumber(row, 'ordinal_position');

    if (!name || !dataType || !isNullable || ordinalPosition === undefined) {
      return undefined;
    }

    return {
      name,
      dataType,
      isNullable: isNullable === 'YES',
      defaultValue,
      ordinalPosition,
    };
  }

  private readString(row: Row, key: string): string | undefined {
    const value = row[key];
    return typeof value === 'string' ? value : undefined;
  }

  private readNullableString(row: Row, key: string): string | null {
    const value = row[key];
    return typeof value === 'string' ? value : null;
  }

  private readNumber(row: Row, key: string): number | undefined {
    const value = row[key];
    return typeof value === 'number' ? value : undefined;
  }

  private formatColumnLabel(column: ColumnMetadata): string {
    const parts = [column.name, column.dataType];

    if (!column.isNullable) {
      parts.push('NOT NULL');
    } else if (column.defaultValue === null) {
      parts.push('NULL');
    }

    if (column.defaultValue !== null) {
      parts.push(`DEFAULT ${column.defaultValue}`);
    }

    return parts.join(' ');
  }

  private formatColumnDescription(column: ColumnMetadata): string {
    return `#${column.ordinalPosition}`;
  }

  private formatColumnTooltip(node: ColumnNode): string {
    const nullableText = node.column.isNullable ? 'YES' : 'NO';
    const defaultText = node.column.defaultValue ?? 'none';

    return [
      `${node.schema}.${node.table}.${node.column.name}`,
      `Type: ${node.column.dataType}`,
      `Nullable: ${nullableText}`,
      `Default: ${defaultText}`,
      `Position: ${node.column.ordinalPosition}`,
    ].join('\n');
  }
}
