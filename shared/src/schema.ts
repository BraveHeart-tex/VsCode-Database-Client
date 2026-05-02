export interface SchemaMetadata {
  connectionId: string;
  schemas: SchemaMetadataSchema[];
}

export interface SchemaMetadataSchema {
  name: string;
  tables: SchemaMetadataTable[];
}

export interface SchemaMetadataTable {
  schema: string;
  name: string;
  columns: SchemaMetadataColumn[];
}

export interface SchemaMetadataColumn {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface SchemaUpdateNotification {
  connectionId: string;
  metadata: SchemaMetadata;
}

export interface SchemaClearNotification {
  connectionId: string;
}

export interface DocumentConnectionNotification {
  documentUri: string;
  connectionId: string | null;
}
