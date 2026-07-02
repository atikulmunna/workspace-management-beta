import 'express-async-errors'
import express, { Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'

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

// Behind Railway/other proxies, trust the first hop so req.ip reflects the real
// client (X-Forwarded-For). Required for correct per-IP rate limiting.
app.set('trust proxy', 1)

// ── Global Middleware ─────────────────────────────────────────────────────────
app.use(helmet())
// Restrict to the configured origin allowlist; if none is set, reflect all (dev/demo).
app.use(cors(config.corsOrigins.length > 0 ? { origin: config.corsOrigins } : {}))
app.use(morgan(config.isDev ? 'dev' : 'combined'))
app.use(express.json())

// Global rate limit — a coarse backstop on top of the stricter per-route auth
// limiters. Uses in-memory state: fine for a single replica, but a shared store
// (e.g. rate-limit-redis) is required if this service is scaled horizontally.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again later.' } },
})

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
// Rate limit the API routes (health check and docs above are intentionally exempt).
app.use(globalLimiter)
app.use('/auth', authRoutes)
app.use('/workspaces', workspaceRoutes)
app.use('/workspaces/:slug/members', memberRoutes)
app.use('/workspaces/:slug/invitations', workspaceInvitationRouter)
app.use('/invitations', invitationRouter)

// ── Error Handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler)

export default app
