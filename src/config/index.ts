import dotenv from 'dotenv'
dotenv.config()

function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var: ${key}`)
  return value
}

// Validate all required env vars at module-load time so the process
// fails fast with a clear message rather than throwing deep in a DB call.
required('DATABASE_URL')  // consumed directly by Prisma, validated here for fast-fail

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  magicLink: {
    expiresMinutes: parseInt(process.env.MAGIC_LINK_EXPIRES_MINUTES || '15', 10),
  },

  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@yourapp.com',
  },

  appUrl: process.env.APP_URL || 'http://localhost:3000',
}
