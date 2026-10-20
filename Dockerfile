# ==============================================================================
# Multi-Stage Production Dockerfile for Bangladeshi Courier Automation Shopify App
# Optimized for AWS App Runner, AWS ECS Fargate, and High-Concurrency Edge Caching
# ==============================================================================

# ----------------- Stage 1: Build & Assets Compilation -----------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies & OpenSSL for MongoDB/Shopify TLS handshakes
RUN apk add --no-cache openssl python3 make g++ libc6-compat

# Install package dependencies (including devDependencies needed for Vite/Remix build)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy all application code
COPY . .

# Run production build (Vite & Remix SSR/Client assets bundling)
ENV NODE_ENV=production
RUN npm run build

# Remove development dependencies to slim down node_modules
RUN npm prune --omit=dev --no-audit

# ----------------- Stage 2: Production Runtime -----------------
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime OpenSSL, curl and CA certificates for secure courier API network calls
RUN apk add --no-cache openssl ca-certificates curl

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Create and switch to non-root user for enterprise container security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 shopifyapp && \
    chown -R shopifyapp:nodejs /app

# Copy production dependencies from builder stage
COPY --from=builder --chown=shopifyapp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=shopifyapp:nodejs /app/package.json ./package.json

# Copy compiled build output (server and client assets)
COPY --from=builder --chown=shopifyapp:nodejs /app/build ./build
COPY --from=builder --chown=shopifyapp:nodejs /app/public ./public

# Copy server utilities and DNS helper
COPY --from=builder --chown=shopifyapp:nodejs /app/fix-dns.cjs ./fix-dns.cjs

# Switch to unprivileged user
USER shopifyapp

# Expose the default application port (3000)
EXPOSE 3000

# Container Healthcheck (replies in <50ms for AWS App Runner & ECS target group monitors)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/shipping-rates || exit 1

# Start the Remix server
CMD ["npm", "run", "start"]
