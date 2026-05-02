import type { ConnectionConfig, SchemaMetadataColumn } from 'shared';
import * as vscode from 'vscode';
import type { ConnectionManager } from '../db/ConnectionManager';
import type { ConnectionStore } from '../db/ConnectionStore';
import type { SchemaMetadataManager } from '../schema/SchemaMetadataManager';

type TreeNode =
  | ConnectionNode
  | SchemaNode
  | TableNode
  | ColumnNode
  | MessageNode;

interface ConnectionNode {
  kind: 'connection';
  connection: ConnectionConfig;
}

interface SchemaNode {
  kind: 'schema';
  connectionId: string;
  schema: string;
  tableCount: number;
}

interface TableNode {
  kind: 'table';
  connectionId: string;
  schema: string;
  table: {
    name: string;
    columns: SchemaMetadataColumn[];
  };
}

interface ColumnNode {
  kind: 'column';
  connectionId: string;
  schema: string;
  table: string;
  column: SchemaMetadataColumn;
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
    private readonly connectionManager: ConnectionManager,
    private readonly schemaMetadataManager: SchemaMetadataManager
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
        item.description = `${element.tableCount} tables`;
        item.contextValue = 'dbClient.schema';
        item.iconPath = vscode.ThemeIcon.Folder;
        return item;
      }
      case 'table': {
        const item = new vscode.TreeItem(
          element.table.name,
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
        item.iconPath = new vscode.ThemeIcon(
          this.getColumnIconId(element.column)
        );
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
      const metadata = this.schemaMetadataManager.get(element.connectionId);
      const schema = metadata?.schemas.find(
        (metadataSchema) => metadataSchema.name === element.schema
      );

      if (!schema) {
        return [];
      }

      return schema.tables.map((table) => ({
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
      const metadata =
        this.schemaMetadataManager.get(connection.id) ??
        (await this.schemaMetadataManager.refresh(connection));

      if (metadata.schemas.length === 0) {
        return [{ kind: 'message', label: 'No tables found' }];
      }

      return metadata.schemas.map((schema) => ({
        kind: 'schema',
        connectionId: connection.id,
        schema: schema.name,
        tableCount: schema.tables.length,
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

  private getColumnChildren(table: TableNode): TreeNode[] {
    return table.table.columns.map((column) => ({
      kind: 'column',
      connectionId: table.connectionId,
      schema: table.schema,
      table: table.table.name,
      column,
    }));
  }

  private formatColumnLabel(column: SchemaMetadataColumn): string {
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

  private formatColumnDescription(column: SchemaMetadataColumn): string {
    const badges: string[] = [`#${column.ordinalPosition}`];

    if (column.isPrimaryKey) {
      badges.push('PK');
    } else if (column.isForeignKey) {
      badges.push('FK');
    }

    return badges.join(' ');
  }

  private formatColumnTooltip(node: ColumnNode): string {
    const nullableText = node.column.isNullable ? 'YES' : 'NO';
    const defaultText = node.column.defaultValue ?? 'none';
    const keyRole = node.column.isPrimaryKey
      ? 'Primary key'
      : node.column.isForeignKey
        ? 'Foreign key'
        : 'None';

    return [
      `${node.schema}.${node.table}.${node.column.name}`,
      `Type: ${node.column.dataType}`,
      `Storage type: ${node.column.udtName}`,
      `Key: ${keyRole}`,
      `Nullable: ${nullableText}`,
      `Default: ${defaultText}`,
      `Position: ${node.column.ordinalPosition}`,
    ].join('\n');
  }

  private getColumnIconId(column: SchemaMetadataColumn): string {
    if (column.isPrimaryKey) {
      return 'key';
    }

    if (column.isForeignKey) {
      return 'link';
    }

    if (this.isArrayType(column)) {
      return 'symbol-array';
    }

    const normalizedDataType = column.dataType.toLowerCase();
    const normalizedUdtName = column.udtName.toLowerCase();

    if (normalizedDataType === 'uuid' || normalizedUdtName === 'uuid') {
      return 'symbol-key';
    }

    if (normalizedDataType === 'json' || normalizedDataType === 'jsonb') {
      return 'json';
    }

    if (this.isBooleanType(normalizedDataType, normalizedUdtName)) {
      return 'symbol-boolean';
    }

    if (this.isNumericType(normalizedDataType, normalizedUdtName)) {
      return 'symbol-number';
    }

    if (this.isDateTimeType(normalizedDataType, normalizedUdtName)) {
      return 'calendar';
    }

    if (this.isBinaryType(normalizedDataType, normalizedUdtName)) {
      return 'file-binary';
    }

    if (this.isEnumOrUserDefinedType(normalizedDataType)) {
      return 'symbol-enum';
    }

    if (this.isStringType(normalizedDataType, normalizedUdtName)) {
      return 'symbol-string';
    }

    return 'symbol-field';
  }

  private isArrayType(column: SchemaMetadataColumn): boolean {
    return (
      column.dataType.toLowerCase() === 'array' ||
      column.udtName.startsWith('_')
    );
  }

  private isBooleanType(dataType: string, udtName: string): boolean {
    return dataType === 'boolean' || udtName === 'bool';
  }

  private isNumericType(dataType: string, udtName: string): boolean {
    return (
      [
        'smallint',
        'integer',
        'bigint',
        'decimal',
        'numeric',
        'real',
        'double precision',
        'smallserial',
        'serial',
        'bigserial',
      ].includes(dataType) ||
      ['int2', 'int4', 'int8', 'float4', 'float8', 'numeric'].includes(udtName)
    );
  }

  private isDateTimeType(dataType: string, udtName: string): boolean {
    return (
      [
        'date',
        'time without time zone',
        'time with time zone',
        'timestamp without time zone',
        'timestamp with time zone',
        'interval',
      ].includes(dataType) ||
      [
        'date',
        'time',
        'timetz',
        'timestamp',
        'timestamptz',
        'interval',
      ].includes(udtName)
    );
  }

  private isBinaryType(dataType: string, udtName: string): boolean {
    return (
      ['bytea', 'binary', 'varbinary', 'blob'].includes(dataType) ||
      udtName === 'bytea'
    );
  }

  private isEnumOrUserDefinedType(dataType: string): boolean {
    return dataType === 'user-defined';
  }

  private isStringType(dataType: string, udtName: string): boolean {
    return (
      ['character varying', 'character', 'text', 'citext', 'name'].includes(
        dataType
      ) || ['varchar', 'bpchar', 'text', 'citext', 'name'].includes(udtName)
    );
  }
}
