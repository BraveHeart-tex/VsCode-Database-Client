import { astVisitor, parseFirst } from 'pgsql-ast-parser';
import type { SchemaMetadata, SchemaMetadataTable } from 'shared';

export type CompletionContext =
  | { kind: 'table' }
  | { kind: 'qualifiedColumn'; qualifier: string }
  | { kind: 'selectList'; relations: RelationReference[] }
  | { kind: 'fallback' };

export interface RelationReference {
  tableName: string;
  schemaName?: string;
  alias?: string;
}

interface TableRefLike {
  name?: unknown;
  schema?: unknown;
  alias?: unknown;
}

interface CurrentStatement {
  text: string;
  cursorOffset: number;
}

export function getCompletionContext(
  text: string,
  cursorOffset: number
): CompletionContext {
  const statement = getCurrentStatement(text, cursorOffset);
  const qualifier = readQualifiedColumnQualifier(
    statement.text,
    statement.cursorOffset
  );

  if (qualifier) {
    return { kind: 'qualifiedColumn', qualifier };
  }

  if (isTablePosition(statement.text, statement.cursorOffset)) {
    return { kind: 'table' };
  }

  if (isSelectListPosition(statement.text, statement.cursorOffset)) {
    const relations = getRelationReferences(statement.text);

    if (relations.length > 0) {
      return { kind: 'selectList', relations };
    }
  }

  return { kind: 'fallback' };
}

export function resolveRelationTables(
  metadata: SchemaMetadata,
  relations: RelationReference[]
): SchemaMetadataTable[] {
  return relations
    .map((relation) => findTable(metadata, relation))
    .filter((table): table is SchemaMetadataTable => table !== undefined);
}

export function getRelationsForStatement(
  text: string,
  cursorOffset: number
): RelationReference[] {
  return getRelationReferences(getCurrentStatement(text, cursorOffset).text);
}

function getCurrentStatement(
  text: string,
  cursorOffset: number
): CurrentStatement {
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

function readQualifiedColumnQualifier(
  statement: string,
  cursorOffset: number
): string | undefined {
  const beforeCursor = statement.slice(0, cursorOffset);
  const match = /((?:"[^"]+"|[a-zA-Z_][\w$]*))\.$/.exec(beforeCursor);
  return match ? normalizeIdentifier(match[1]) : undefined;
}

function isTablePosition(statement: string, cursorOffset: number): boolean {
  const beforeCursor = statement.slice(0, cursorOffset);
  return /\b(?:from|join)\s+(?:(?:"[^"]*"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]*"|[a-zA-Z_][\w$]*))?)?$/i.test(
    beforeCursor
  );
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

  return /\bfrom\b/i.test(statement.slice(selectIndex));
}

function getRelationReferences(statement: string): RelationReference[] {
  return mergeRelationReferences(
    getParserRelationReferences(statement),
    getFallbackRelationReferences(statement)
  );
}

function getParserRelationReferences(statement: string): RelationReference[] {
  try {
    const parsed = parseFirst(statement);
    const relations: RelationReference[] = [];
    const visitor = astVisitor((map) => ({
      tableRef(tableRef) {
        const relation = readTableRef(tableRef as unknown as TableRefLike);

        if (relation) {
          relations.push(relation);
        }

        map.super().tableRef(tableRef);
      },
    }));

    visitor.statement(parsed);
    return relations;
  } catch {
    return [];
  }
}

function getFallbackRelationReferences(statement: string): RelationReference[] {
  const relations: RelationReference[] = [];
  const pattern =
    /\b(?:from|join)\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)(?:\s+(?:as\s+)?((?:"[^"]+"|[a-zA-Z_][\w$]*)))?/gi;

  for (const match of statement.matchAll(pattern)) {
    const tableReference = normalizeIdentifier(match[1]);
    const alias = normalizeAlias(match[2]);
    const [schemaName, tableName] = splitTableReference(tableReference);

    if (tableName) {
      relations.push({ schemaName, tableName, alias });
    }
  }

  return relations;
}

function mergeRelationReferences(
  parsed: RelationReference[],
  fallback: RelationReference[]
): RelationReference[] {
  const merged = new Map<string, RelationReference>();

  for (const relation of [...fallback, ...parsed]) {
    merged.set(relationKey(relation), {
      ...relation,
      alias:
        relation.alias ??
        fallback.find(
          (candidate) => relationKey(candidate) === relationKey(relation)
        )?.alias,
    });
  }

  return Array.from(merged.values());
}

function readTableRef(tableRef: TableRefLike): RelationReference | undefined {
  if (typeof tableRef.name !== 'string') {
    return undefined;
  }

  return {
    tableName: tableRef.name,
    schemaName:
      typeof tableRef.schema === 'string' ? tableRef.schema : undefined,
    alias: typeof tableRef.alias === 'string' ? tableRef.alias : undefined,
  };
}

function findTable(
  metadata: SchemaMetadata,
  relation: RelationReference
): SchemaMetadataTable | undefined {
  const tableName = relation.tableName.toLowerCase();
  const schemaName = relation.schemaName?.toLowerCase();

  return metadata.schemas
    .flatMap((schema) => schema.tables)
    .find((table) => {
      if (schemaName && table.schema.toLowerCase() !== schemaName) {
        return false;
      }

      return table.name.toLowerCase() === tableName;
    });
}

function splitTableReference(
  tableReference: string
): [schemaName: string | undefined, tableName: string | undefined] {
  const parts = tableReference.split('.');

  if (parts.length === 1) {
    return [undefined, parts[0]];
  }

  return [parts[0], parts[1]];
}

function relationKey(relation: RelationReference): string {
  return `${relation.schemaName ?? ''}.${relation.tableName}`.toLowerCase();
}

function normalizeIdentifier(identifier: string): string {
  return identifier
    .replace(/\s*\.\s*/g, '.')
    .split('.')
    .map((part) => part.replace(/^"|"$/g, ''))
    .join('.');
}

function normalizeAlias(alias: string | undefined): string | undefined {
  if (!alias) {
    return undefined;
  }

  const normalized = normalizeIdentifier(alias);

  if (isSqlClauseKeyword(normalized)) {
    return undefined;
  }

  return normalized;
}

function isSqlClauseKeyword(value: string): boolean {
  return [
    'where',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'full',
    'cross',
    'on',
    'group',
    'order',
    'having',
    'limit',
    'offset',
    'union',
  ].includes(value.toLowerCase());
}
