/**
 * Integration test setup for workspace-service.
 *
 * Uses a real Postgres DB (spawned by docker-compose.test.yml).
 * All tables are wiped between test suites to keep tests isolated.
 *
 * DATABASE_URL must be set to the test DB before running:
 *   DATABASE_URL=postgresql://wstest:wstest@localhost:5433/workspace_service_test
 *
 * Managed via `npm run test:integration`.
 */

import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

// Point Prisma at the integration test DB
process.env.DATABASE_URL = 'postgresql://wstest:wstest@localhost:5433/workspace_service_test'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'integration-test-secret-at-least-32-chars-long'

const prisma = new PrismaClient()

// Run migrations once before the full suite
beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
        env: {
            ...process.env,
            DATABASE_URL: 'postgresql://wstest:wstest@localhost:5433/workspace_service_test',
        },
        stdio: 'inherit',
    })
    await prisma.$connect()
})

// Truncate all tables between suites to ensure isolation
afterEach(async () => {
    const tables = [
        'AuditLog', 'Invitation', 'Membership',
        'RefreshToken', 'MagicLinkToken', 'Workspace', 'User',
    ]
    for (const table of tables) {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)
    }
})

afterAll(async () => {
    await prisma.$disconnect()
})
