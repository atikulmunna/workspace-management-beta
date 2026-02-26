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

// ── Global Middleware ────────────────────────────────────────────────────────
app.use(helmet())
app.use(cors())
app.use(morgan(config.isDev ? 'dev' : 'combined'))
app.use(express.json())

// ── Health Check (REL-05) ─────────────────────────────────────────────────────
// Verifies active DB connectivity so load balancers can route around unhealthy
// instances. Returns 503 if the database is unreachable.
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' })
  }
})

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes)
app.use('/workspaces', workspaceRoutes)
app.use('/workspaces/:slug/members', memberRoutes)
app.use('/workspaces/:slug/invitations', workspaceInvitationRouter)
app.use('/invitations', invitationRouter)

// ── Error Handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler)

export default app
