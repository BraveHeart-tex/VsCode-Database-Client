import type { SchemaMetadata, SchemaMetadataTable } from 'shared';

const schemas = new Map<string, SchemaMetadata>();
const documentConnections = new Map<string, string>();

export function update(connectionId: string, metadata: SchemaMetadata): void {
  schemas.set(connectionId, metadata);
}

export function clear(connectionId: string): void {
  schemas.delete(connectionId);

  for (const [documentUri, documentConnectionId] of documentConnections) {
    if (documentConnectionId === connectionId) {
      documentConnections.delete(documentUri);
    }
  }
}

export function bindDocument(
  documentUri: string,
  connectionId: string | null
): void {
  if (connectionId === null) {
    documentConnections.delete(documentUri);
    return;
  }

  documentConnections.set(documentUri, connectionId);
}

export function get(documentUri: string): SchemaMetadata | undefined {
  const connectionId = getDocumentConnection(documentUri);
  return connectionId ? schemas.get(connectionId) : undefined;
}

export function getTables(connectionId: string): SchemaMetadataTable[] {
  return (
    schemas.get(connectionId)?.schemas.flatMap((schema) => schema.tables) ?? []
  );
}

export function getDocumentConnection(documentUri: string): string | undefined {
  return documentConnections.get(documentUri);
}
