import type {
  SchemaMetadata,
  SchemaMetadataColumn,
  SchemaMetadataTable,
} from 'shared';
import * as vscode from 'vscode';

export function createSchemaCompletionItems(
  metadata: SchemaMetadata,
  context?: SqlCompletionContext
): vscode.CompletionItem[] {
  const scopedTables = context ? getScopedTables(metadata, context) : [];

  if (scopedTables.length > 0) {
    return scopedTables.flatMap((table) =>
      table.columns.map((column) => createColumnCompletionItem(table, column))
    );
  }

  const items: vscode.CompletionItem[] = [];

  for (const schema of metadata.schemas) {
    const schemaItem = new vscode.CompletionItem(
      schema.name,
      vscode.CompletionItemKind.Module
    );
    schemaItem.detail = `${schema.tables.length} tables`;
    items.push(schemaItem);

    for (const table of schema.tables) {
      items.push(createTableCompletionItem(table));

      for (const column of table.columns) {
        items.push(createColumnCompletionItem(table, column));
      }
    }
  }

  return items;
}

export interface SqlCompletionContext {
  text: string;
  cursorOffset: number;
}

export function getReferencedTables(
  metadata: SchemaMetadata,
  text: string,
  cursorOffset: number
): SchemaMetadataTable[] {
  const statement = getCurrentStatement(text, cursorOffset);
  const tableNames = extractTableReferences(statement.text);

  return tableNames
    .map((tableName) => findTable(metadata, tableName))
    .filter((table): table is SchemaMetadataTable => table !== undefined);
}

function getScopedTables(
  metadata: SchemaMetadata,
  context: SqlCompletionContext
): SchemaMetadataTable[] {
  const statement = getCurrentStatement(context.text, context.cursorOffset);

  if (!isSelectListPosition(statement.text, statement.cursorOffset)) {
    return [];
  }

  const tableNames = extractTableReferences(statement.text);

  if (tableNames.length === 0) {
    return [];
  }

  return tableNames
    .map((tableName) => findTable(metadata, tableName))
    .filter((table): table is SchemaMetadataTable => table !== undefined);
}

function getCurrentStatement(
  text: string,
  cursorOffset: number
): { text: string; cursorOffset: number } {
  const safeOffset = Math.min(Math.max(cursorOffset, 0), text.length);
  const previousTerminator = text.lastIndexOf(';', safeOffset - 1);
  const nextTerminator = text.indexOf(';', safeOffset);
  const startOffset = previousTerminator >= 0 ? previousTerminator + 1 : 0;
  const endOffset = nextTerminator >= 0 ? nextTerminator : text.length;

  return {
    text: text.slice(startOffset, endOffset),
    cursorOffset: safeOffset - startOffset,
  };
}

function isSelectListPosition(
  statement: string,
  cursorOffset: number
): boolean {
  const beforeCursor = statement.slice(0, cursorOffset).toLowerCase();
  const selectIndex = beforeCursor.lastIndexOf('select');

  if (selectIndex < 0) {
    return false;
  }

  const fromBeforeCursor = beforeCursor.lastIndexOf('from');

  if (fromBeforeCursor > selectIndex) {
    return false;
  }

  const afterSelect = statement.slice(selectIndex).toLowerCase();
  return /\bfrom\b/.test(afterSelect);
}

function extractTableReferences(statement: string): string[] {
  const tableNames: string[] = [];
  const pattern =
    /\b(?:from|join)\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)/gi;

  for (const match of statement.matchAll(pattern)) {
    const tableName = normalizeIdentifier(match[1]);

    if (tableName) {
      tableNames.push(tableName);
    }
  }

  return tableNames;
}

function findTable(
  metadata: SchemaMetadata,
  tableReference: string
): SchemaMetadataTable | undefined {
  const normalizedReference = tableReference.toLowerCase();
  const allTables = metadata.schemas.flatMap((schema) => schema.tables);

  return allTables.find((table) => {
    const qualifiedName = `${table.schema}.${table.name}`.toLowerCase();
    return (
      table.name.toLowerCase() === normalizedReference ||
      qualifiedName === normalizedReference
    );
  });
}

function normalizeIdentifier(identifier: string): string {
  return identifier
    .replace(/\s*\.\s*/g, '.')
    .split('.')
    .map((part) => part.replace(/^"|"$/g, ''))
    .join('.');
}

function createTableCompletionItem(
  table: SchemaMetadataTable
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    `${table.schema}.${table.name}`,
    vscode.CompletionItemKind.Class
  );
  item.insertText = table.name;
  item.detail = `${table.columns.length} columns`;
  item.documentation = new vscode.MarkdownString(
    `Table \`${table.schema}.${table.name}\``
  );
  return item;
}

function createColumnCompletionItem(
  table: SchemaMetadataTable,
  column: SchemaMetadataColumn
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    column.name,
    vscode.CompletionItemKind.Field
  );
  item.detail = `${table.schema}.${table.name} ${column.dataType}`;
  item.documentation = new vscode.MarkdownString(
    [
      `Column \`${table.schema}.${table.name}.${column.name}\``,
      `Type: \`${column.dataType}\``,
      `Nullable: \`${column.isNullable ? 'YES' : 'NO'}\``,
      `Default: \`${column.defaultValue ?? 'none'}\``,
      `Key: \`${formatKeyRole(column)}\``,
    ].join('\n\n')
  );
  return item;
}

function formatKeyRole(column: SchemaMetadataColumn): string {
  if (column.isPrimaryKey) {
    return 'primary';
  }

  if (column.isForeignKey) {
    return 'foreign';
  }

  return 'none';
}
