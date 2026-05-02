import { Pool } from 'pg'
import type { ConnectionConfig, QueryResult, Column } from 'shared'

interface ActiveConnection {
  config: ConnectionConfig
  pool:   Pool
}

export class ConnectionManager {
  private connections = new Map<string, ActiveConnection>()

  async connect(config: ConnectionConfig): Promise<void> {
    // If already connected, disconnect first
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id)
    }

    const pool = new Pool({
      host:     config.host,
      port:     config.port,
      database: config.database,
      user:     config.username,
      password: config.password,
      ssl:      config.ssl ? { rejectUnauthorized: false } : false,
      max:      5,   // max pool size
      idleTimeoutMillis:    30000,
      connectionTimeoutMillis: 5000,
    })

    // Test the connection immediately
    const client = await pool.connect()
    client.release()

    this.connections.set(config.id, { config, pool })
    console.log(`[ConnectionManager] Connected: ${config.id}`)
  }

  async disconnect(connectionId: string): Promise<void> {
    const conn = this.connections.get(connectionId)
    if (!conn) return

    await conn.pool.end()
    this.connections.delete(connectionId)
    console.log(`[ConnectionManager] Disconnected: ${connectionId}`)
  }

  async query(connectionId: string, sql: string): Promise<QueryResult> {
    const conn = this.connections.get(connectionId)
    if (!conn) {
      throw new Error(`No active connection for id: ${connectionId}`)
    }

    const start = Date.now()
    const result = await conn.pool.query(sql)
    const duration = Date.now() - start

    const columns: Column[] = (result.fields ?? []).map(f => ({
      name:     f.name,
      dataType: this.resolveDataType(f.dataTypeID),
    }))

    return {
      queryId:  crypto.randomUUID(),
      rows:     result.rows,
      columns,
      rowCount: result.rowCount ?? result.rows.length,
      duration,
    }
  }

  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId)
  }

  getConnections(): ConnectionConfig[] {
    return Array.from(this.connections.values()).map(c => c.config)
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    await Promise.all(ids.map(id => this.disconnect(id)))
  }

  // Basic OID → type name mapping for common Postgres types
  private resolveDataType(oid: number): string {
    const types: Record<number, string> = {
      16:   'boolean',
      20:   'bigint',
      21:   'smallint',
      23:   'integer',
      25:   'text',
      700:  'real',
      701:  'float8',
      1043: 'varchar',
      1082: 'date',
      1114: 'timestamp',
      1184: 'timestamptz',
      114:  'json',
      3802: 'jsonb',
      2950: 'uuid',
    }
    return types[oid] ?? `oid:${oid}`
  }
}
