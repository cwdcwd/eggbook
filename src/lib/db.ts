import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

// Lazy getter for Prisma client
function getPrismaClient(): PrismaClient {
  if (!process.env.PRISMA_DATABASE_URL) {
    throw new Error('PRISMA_DATABASE_URL is not set')
  }
  
  if (!global.prisma) {
    global.prisma = new PrismaClient({
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
