import app from './app'
import { config } from './config'
import { prisma } from './lib/prisma'
import { startTokenCleanup } from './lib/cleanup'

async function main() {
  await prisma.$connect()
  console.log('✅ Database connected')

  // Purge expired/used magic link + expired/revoked refresh tokens every hour
  const cleanupHandle = startTokenCleanup()

  const server = app.listen(config.port, () => {
    console.log(`🚀 Workspace service running on http://localhost:${config.port}`)
    console.log(`   Environment: ${config.nodeEnv}`)
  })

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // Containers (Railway, K8s, Docker) send SIGTERM on redeploy/stop. Stop
  // accepting new connections, let in-flight requests drain, then release
  // the DB pool and cleanup timer before exiting.
  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n${signal} received — shutting down gracefully...`)

    clearInterval(cleanupHandle)

    // Force-exit if draining hangs (e.g. a stuck keep-alive connection).
    const forceTimer = setTimeout(() => {
      console.error('⏱  Shutdown timed out — forcing exit')
      process.exit(1)
    }, 10_000)
    forceTimer.unref()

    server.close(async (err) => {
      try {
        await prisma.$disconnect()
      } catch (disconnectErr) {
        console.error('Error disconnecting Prisma:', disconnectErr)
      }
      if (err) {
        console.error('Error during server close:', err)
        process.exit(1)
      }
      console.log('✅ Shutdown complete')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch(async (err) => {
  console.error('❌ Failed to start server:', err)
  await prisma.$disconnect()
  process.exit(1)
})
