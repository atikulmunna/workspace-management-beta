import app from './app'
import { config } from './config'
import { prisma } from './lib/prisma'
import { startTokenCleanup } from './lib/cleanup'

async function main() {
  await prisma.$connect()
  console.log('✅ Database connected')

  // Purge expired/used magic link tokens every hour
  startTokenCleanup()

  app.listen(config.port, () => {
    console.log(`🚀 Workspace service running on http://localhost:${config.port}`)
    console.log(`   Environment: ${config.nodeEnv}`)
  })
}

main().catch(async (err) => {
  console.error('❌ Failed to start server:', err)
  await prisma.$disconnect()
  process.exit(1)
})
