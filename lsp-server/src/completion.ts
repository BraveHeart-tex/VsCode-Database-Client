import type {
  SchemaMetadata,
  SchemaMetadataColumn,
  SchemaMetadataTable,
} from 'shared';
import {
  type CompletionItem,
  CompletionItemKind,
  type CompletionParams,
  MarkupKind,
  type TextDocuments,
} from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { get as getSchema } from './schemaCache';
import {
  getCompletionContext,
  getRelationsForStatement,
  resolveRelationTables,
} from './sqlContext';

export function onCompletion(
  documents: TextDocuments<TextDocument>,
  params: CompletionParams
): CompletionItem[] {
  const document = documents.get(params.textDocument.uri);

  if (!document) {
    return [];
  }

  const metadata = getSchema(params.textDocument.uri);

  if (!metadata) {
    return [];
  }

  return createCompletionItems(
    metadata,
    document.getText(),
    document.offsetAt(params.position)
  );
}

export function createCompletionItems(
  metadata: SchemaMetadata,
  text: string,
  cursorOffset: number
): CompletionItem[] {
  const context = getCompletionContext(text, cursorOffset);

  if (context.kind === 'table') {
    return createTableCompletionItems(metadata);
  }

  if (context.kind === 'qualifiedColumn') {
    const table = resolveQualifiedTableFromText(
      metadata,
      text,
      cursorOffset,
      context.qualifier
    );
    return table ? createColumnCompletionItems([table]) : [];
  }

  if (context.kind === 'selectList') {
    const tables = resolveRelationTables(metadata, context.relations);
    return createColumnCompletionItems(tables);
  }

  return [
    ...createTableCompletionItems(metadata),
    ...createColumnCompletionItems(
      metadata.schemas.flatMap((schema) => schema.tables)
    ),
  ];
}

function resolveQualifiedTableFromText(
  metadata: SchemaMetadata,
  text: string,
  cursorOffset: number,
  qualifier: string
): SchemaMetadataTable | undefined {
  const relation = getRelationsForStatement(text, cursorOffset).find(
    (candidate) =>
      candidate.alias?.toLowerCase() === qualifier.toLowerCase() ||
      candidate.tableName.toLowerCase() === qualifier.toLowerCase()
  );

  if (!relation) {
    return metadata.schemas
      .flatMap((schema) => schema.tables)
      .find((table) => table.name.toLowerCase() === qualifier.toLowerCase());
  }

  return resolveRelationTables(metadata, [relation])[0];
}

function createTableCompletionItems(
  metadata: SchemaMetadata
): CompletionItem[] {
  return metadata.schemas.flatMap((schema) =>
    schema.tables.map((table) => ({
      label: `${table.schema}.${table.name}`,
      kind: CompletionItemKind.Class,
      insertText: table.name,
      detail: `${table.columns.length} columns`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `Table \`${table.schema}.${table.name}\``,
      },
    }))
  );
}

function createColumnCompletionItems(
  tables: SchemaMetadataTable[]
): CompletionItem[] {
  return tables.flatMap((table) =>
    table.columns.map((column) => createColumnCompletionItem(table, column))
  );
}

function createColumnCompletionItem(
  table: SchemaMetadataTable,
  column: SchemaMetadataColumn
): CompletionItem {
  return {
    label: column.name,
    kind: CompletionItemKind.Field,
    detail: `${table.schema}.${table.name} ${column.dataType}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: [
        `Column \`${table.schema}.${table.name}.${column.name}\``,
        `Type: \`${column.dataType}\``,
        `Nullable: \`${column.isNullable ? 'YES' : 'NO'}\``,
        `Default: \`${column.defaultValue ?? 'none'}\``,
        `Key: \`${formatKeyRole(column)}\``,
      ].join('\n\n'),
    },
  };
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
