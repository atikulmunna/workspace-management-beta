import 'express-async-errors'
import express, { Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import { config } from './config'
import { prisma } from './lib/prisma'
import { errorHandler } from './middleware/errorHandler'

import authRoutes from './modules/auth/auth.routes'
import workspaceRoutes from './modules/workspaces/workspace.routes'
import memberRoutes from './modules/members/member.routes'
import {
  workspaceInvitationRouter,
  invitationRouter,
} from './modules/invitations/invitation.routes'

const app = express()

// ── Global Middleware ─────────────────────────────────────────────────────────
app.use(helmet())
app.use(cors())
app.use(morgan(config.isDev ? 'dev' : 'combined'))
app.use(express.json())

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' })
  }
})

// ── API Docs  (/docs  +  /docs/openapi.json) ──────────────────────────────────
// Skipped in test environment to keep tests fast and side-effect-free.
if (process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const swaggerUi = require('swagger-ui-express') as typeof import('swagger-ui-express')
  const { generateSpec } = require('./lib/openapi') as typeof import('./lib/openapi')

  const spec = generateSpec()

  // Relax Helmet's CSP only for the /docs route (Swagger UI needs inline scripts)
  app.use('/docs', helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  }))

  app.get('/docs/openapi.json', (_req, res) => res.json(spec))
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customSiteTitle: 'Workspace API Docs',
    swaggerOptions: { persistAuthorization: true },
  }))
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes)
app.use('/workspaces', workspaceRoutes)
app.use('/workspaces/:slug/members', memberRoutes)
app.use('/workspaces/:slug/invitations', workspaceInvitationRouter)
app.use('/invitations', invitationRouter)

// ── Error Handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler)

export default app
