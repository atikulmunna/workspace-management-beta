# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Prisma needs OpenSSL to generate the query engine binary
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client (compiles engine binary for this Alpine environment)
RUN npx prisma generate
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:22-alpine AS production

# Same OpenSSL version as builder so the engine binary matches at runtime
RUN apk add --no-cache openssl

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output and Prisma artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

# Create non-root user and chown BEFORE switching — so the user can write
# to node_modules at runtime (Prisma needs to write engine metadata)
RUN addgroup -S appgroup \
    && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Use the locally-pinned prisma binary (never npx which would pull latest)
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/index.js"]
