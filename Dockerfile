# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# Install only production dependencies and generate the Prisma client.
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

# ── Stage 2: build ────────────────────────────────────────────────────────────
# Compile TypeScript using all dependencies (including devDependencies).
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
RUN npm run build

# ── Stage 3: production image ─────────────────────────────────────────────────
# Copy only compiled output + production node_modules. No source, no devDeps.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Production dependencies + generated Prisma client
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules

# Compiled JS
COPY --from=build --chown=appuser:appgroup /app/dist ./dist

# Prisma schema (needed at runtime for migrations)
COPY --chown=appuser:appgroup prisma ./prisma

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
