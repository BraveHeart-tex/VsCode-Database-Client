import type {
  Row,
  SchemaMetadata,
  SchemaMetadataColumn,
  SchemaMetadataTable,
} from 'shared';

export const LOAD_SCHEMA_METADATA_SQL = `
SELECT
  tables.table_schema,
  tables.table_name,
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
FROM information_schema.tables AS tables
LEFT JOIN information_schema.columns AS columns
  ON columns.table_schema = tables.table_schema
  AND columns.table_name = tables.table_name
WHERE tables.table_type = 'BASE TABLE'
  AND tables.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY tables.table_schema, tables.table_name, columns.ordinal_position
`;

interface MutableSchema {
  name: string;
  tables: Map<string, SchemaMetadataTable>;
}

export function createSchemaMetadata(
  connectionId: string,
  rows: Row[]
): SchemaMetadata {
  const schemas = new Map<string, MutableSchema>();

  for (const row of rows) {
    const table = readTable(row);

    if (!table) {
      continue;
    }

    const schema = getOrCreateSchema(schemas, table.schema);
    const metadataTable = getOrCreateTable(schema, table.schema, table.name);
    const column = readColumn(row);

    if (column) {
      metadataTable.columns.push(column);
    }
  }

  return {
    connectionId,
    schemas: Array.from(schemas.values()).map((schema) => ({
      name: schema.name,
      tables: Array.from(schema.tables.values()).map((table) => ({
        ...table,
        columns: [...table.columns].sort(
          (left: SchemaMetadataColumn, right: SchemaMetadataColumn) =>
            left.ordinalPosition - right.ordinalPosition
        ),
      })),
    })),
  };
}

function getOrCreateSchema(
  schemas: Map<string, MutableSchema>,
  schemaName: string
): MutableSchema {
  const existing = schemas.get(schemaName);

  if (existing) {
    return existing;
  }

  const schema = { name: schemaName, tables: new Map() };
  schemas.set(schemaName, schema);
  return schema;
}

function getOrCreateTable(
  schema: MutableSchema,
  schemaName: string,
  tableName: string
): SchemaMetadataTable {
  const existing = schema.tables.get(tableName);

  if (existing) {
    return existing;
  }

  const table = { schema: schemaName, name: tableName, columns: [] };
  schema.tables.set(tableName, table);
  return table;
}

function readTable(row: Row): { schema: string; name: string } | undefined {
  const schema = readString(row, 'table_schema');
  const name = readString(row, 'table_name');

  if (!schema || !name) {
    return undefined;
  }

  return { schema, name };
}

function readColumn(row: Row): SchemaMetadataColumn | undefined {
  const name = readString(row, 'column_name');
  const dataType = readString(row, 'data_type');
  const udtName = readString(row, 'udt_name');
  const isNullable = readString(row, 'is_nullable');
  const defaultValue = readNullableString(row, 'column_default');
  const ordinalPosition = readNumber(row, 'ordinal_position');
  const isPrimaryKey = readBoolean(row, 'is_primary_key');
  const isForeignKey = readBoolean(row, 'is_foreign_key');

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

function readString(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(row: Row, key: string): number | undefined {
  const value = row[key];
  return typeof value === 'number' ? value : undefined;
}

function readBoolean(row: Row, key: string): boolean | undefined {
  const value = row[key];
  return typeof value === 'boolean' ? value : undefined;
}
