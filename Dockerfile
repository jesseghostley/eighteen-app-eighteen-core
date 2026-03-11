# Eighteen Core — Multi-arch Docker Image
# Supports: linux/amd64 (cloud VPS, x86 Linux/Mac)
#           linux/arm64 (Raspberry Pi 4/5, Apple Silicon)

FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# --- Production stage ---
FROM node:22-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy Soul identity files
COPY soul/ ./soul/

# Copy config template
COPY extensions/pope-claw/config.example.json ./config.example.json

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

EXPOSE 3000

# Environment variables (set at runtime, never baked in)
# TELEGRAM_BOT_TOKEN
# ANTHROPIC_API_KEY
# GITHUB_PAT
# POPE_CLAW_WEBHOOK_SECRET

CMD ["node", "dist/gateway/server.js"]
