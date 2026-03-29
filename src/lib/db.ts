import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined
}

// Get database URL from environment
function getDatabaseUrl(): string {
  const url = process.env.PRISMA_DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!url) {
    throw new Error('No database URL found. Set PRISMA_DATABASE_URL, POSTGRES_URL, or DATABASE_URL')
  }
  return url
}

// Create PostgreSQL pool (reused in development)
function getPool(): Pool {
  if (!global.pgPool) {
    global.pgPool = new Pool({
      connectionString: getDatabaseUrl(),
    })
  }
  return global.pgPool
}

// Create Prisma client with pg driver adapter (required for Prisma 7)
function getPrismaClient(): PrismaClient {
  if (!global.prisma) {
    const pool = getPool()
    const adapter = new PrismaPg(pool)
    
    global.prisma = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  }
  return global.prisma
}

// Export a proxy that lazily initializes the client
export const db = new Proxy({} as PrismaClient, {
  get(_, prop) {
    const client = getPrismaClient()
    const value = client[prop as keyof PrismaClient]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
