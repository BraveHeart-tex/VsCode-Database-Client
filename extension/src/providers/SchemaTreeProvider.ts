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
  udtName: string;
  isNullable: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
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
SELECT
  columns.column_name,
  columns.data_type,
  columns.udt_name,
  columns.is_nullable,
  columns.column_default,
  columns.ordinal_position,
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints AS constraints
    INNER JOIN information_schema.key_column_usage AS key_usage
      ON constraints.constraint_name = key_usage.constraint_name
      AND constraints.table_schema = key_usage.table_schema
      AND constraints.table_name = key_usage.table_name
    WHERE constraints.constraint_type = 'PRIMARY KEY'
      AND key_usage.table_schema = columns.table_schema
      AND key_usage.table_name = columns.table_name
      AND key_usage.column_name = columns.column_name
  ) AS is_primary_key,
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints AS constraints
    INNER JOIN information_schema.key_column_usage AS key_usage
      ON constraints.constraint_name = key_usage.constraint_name
      AND constraints.table_schema = key_usage.table_schema
      AND constraints.table_name = key_usage.table_name
    WHERE constraints.constraint_type = 'FOREIGN KEY'
      AND key_usage.table_schema = columns.table_schema
      AND key_usage.table_name = columns.table_name
      AND key_usage.column_name = columns.column_name
  ) AS is_foreign_key
FROM information_schema.columns AS columns
WHERE columns.table_schema = '${this.escapeSqlLiteral(schema)}'
  AND columns.table_name = '${this.escapeSqlLiteral(table)}'
ORDER BY columns.ordinal_position
`;
  }

  private escapeSqlLiteral(value: string): string {
    return value.replaceAll("'", "''");
  }

  private readColumnMetadata(row: Row): ColumnMetadata | undefined {
    const name = this.readString(row, 'column_name');
    const dataType = this.readString(row, 'data_type');
    const udtName = this.readString(row, 'udt_name');
    const isNullable = this.readString(row, 'is_nullable');
    const defaultValue = this.readNullableString(row, 'column_default');
    const ordinalPosition = this.readNumber(row, 'ordinal_position');
    const isPrimaryKey = this.readBoolean(row, 'is_primary_key');
    const isForeignKey = this.readBoolean(row, 'is_foreign_key');

    if (
      !name ||
      !dataType ||
      !udtName ||
      !isNullable ||
      ordinalPosition === undefined ||
      isPrimaryKey === undefined ||
      isForeignKey === undefined
    ) {
      return undefined;
    }

    return {
      name,
      dataType,
      udtName,
      isNullable: isNullable === 'YES',
      defaultValue,
      ordinalPosition,
      isPrimaryKey,
      isForeignKey,
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

  private readBoolean(row: Row, key: string): boolean | undefined {
    const value = row[key];
    return typeof value === 'boolean' ? value : undefined;
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

  private getColumnIconId(column: ColumnMetadata): string {
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

  private isArrayType(column: ColumnMetadata): boolean {
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
