# GhostClaw Terminal Command Sheet

---

## Daily Startup Checklist

```bash
# 1. Connect to server
ssh user@your-server-ip

# 2. Navigate to project
cd ~/ghostclaw-buildable-system

# 3. Pull latest
git pull origin main

# 4. Install deps (if needed)
npm install

# 5. Start GhostClaw
npm start

# 6. Verify running
curl http://localhost:3000/api/health

# 7. Check runtime status
curl http://localhost:3000/api/runtime/status
```

## End of Day Checklist

```bash
# 1. Check for pending jobs
curl http://localhost:3000/api/runtime/queue

# 2. Review today's events
curl http://localhost:3000/api/runtime-events?limit=50

# 3. Stop the server
kill $(lsof -t -i:3000)

# 4. Confirm stopped
lsof -i :3000

# 5. Commit any work
cd ~/ghostclaw-buildable-system
git add -A && git commit -m "end of day $(date +%Y-%m-%d)"
git push origin main
```

---

## 1. SSH + Access

```bash
# Connect to server
ssh user@your-server-ip

# Connect with specific key
ssh -i ~/.ssh/your_key user@your-server-ip

# First-time connection: you'll see a fingerprint prompt — type "yes"
# To avoid repeated password prompts, set up key-based auth:
#   ssh-copy-id user@your-server-ip
```

---

## 2. Navigation

```bash
# Go to GhostClaw
cd ~/ghostclaw-buildable-system

# Go to Eighteen Core
cd ~/eighteen-app-eighteen-core

# List files
ls -la

# Check key directories
ls apps/api/src/
ls packages/core/src/
ls docs/ghostclaw-system/
```

---

## 3. System Health Checks

```bash
# Health endpoint
curl http://localhost:3000/api/health

# Runtime status
curl http://localhost:3000/api/runtime/status

# Job queue
curl http://localhost:3000/api/runtime/queue

# Agent availability
curl http://localhost:3000/api/runtime/agents

# Artifact inventory
curl http://localhost:3000/api/runtime/artifacts

# Planner strategies
curl http://localhost:3000/api/runtime/planner-strategies

# Recent runtime events (audit trail)
curl http://localhost:3000/api/runtime-events?limit=20

# Events for a specific job
curl http://localhost:3000/api/runtime-events?job_id=JOB_ID

# Trace full execution chain
curl http://localhost:3000/api/runtime-events/by-correlation/CORRELATION_ID

# Eighteen Core health (if running on port 3000)
curl http://localhost:3000/health
```

---

## 4. Process Control

```bash
# Start server
cd ~/ghostclaw-buildable-system
npm start

# Start in background
nohup npm start > ghostclaw.log 2>&1 &

# Start with custom port
PORT=4000 npm start

# Stop server (by port)
kill $(lsof -t -i:3000)

# Force stop
kill -9 $(lsof -t -i:3000)

# Restart
kill $(lsof -t -i:3000) && npm start

# Check running processes
lsof -i :3000
ps aux | grep node
ps aux | grep ts-node
```

---

## 5. Batch Operations (Signals → Jobs)

```bash
# Submit a signal (triggers plan → jobs → artifacts)
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{"name": "generate_content_cluster", "payload": {"topic": "your-topic"}}'

# Optimize existing page
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{"name": "optimize_existing_page", "payload": {"pageId": "page-123"}}'

# Create new skill
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{"name": "create_new_skill", "payload": {"skillName": "my-skill"}}'

# Run diagnostics
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{"name": "handle_runtime_error", "payload": {"error": "description"}}'

# Check job queue
curl http://localhost:3000/api/runtime/queue

# List skill invocations (all)
curl http://localhost:3000/api/skill-invocations

# Filter by status
curl "http://localhost:3000/api/skill-invocations?status=completed"
curl "http://localhost:3000/api/skill-invocations?status=failed"
curl "http://localhost:3000/api/skill-invocations?status=running"

# Get specific invocation
curl http://localhost:3000/api/skill-invocations/INVOCATION_ID

# Invocations for a specific job
curl http://localhost:3000/api/jobs/JOB_ID/skill-invocations
```

---

## 6. Approval & Publish Flow

```bash
# Check runtime events for publish status
curl "http://localhost:3000/api/runtime-events?event_type=publish.initiated"

# Check pending approvals
curl "http://localhost:3000/api/runtime-events?event_type=publish.initiated&limit=50"

# Check approved items
curl "http://localhost:3000/api/runtime-events?event_type=publish.approved"

# Check published items
curl "http://localhost:3000/api/runtime-events?event_type=publish.published"

# Check rejected items
curl "http://localhost:3000/api/runtime-events?event_type=publish.rejected"

# Check failed publishes
curl "http://localhost:3000/api/runtime-events?event_type=publish.failed"

# Trace full approval chain for an item
curl http://localhost:3000/api/runtime-events/by-correlation/CORRELATION_ID
# Returns: events array + chain_complete flag + has_failures flag
```

---

## 7. Debugging

```bash
# Check logs (if started with nohup)
tail -f ghostclaw.log
tail -100 ghostclaw.log

# Check Eighteen Core audit log
cat ~/eighteen-app-eighteen-core/PROJECT-LOG.md

# Check what's on port 3000
lsof -i :3000

# Check all node processes
ps aux | grep node

# Check if port is in use
ss -tlnp | grep 3000

# Kill stuck process on port
kill $(lsof -t -i:3000)

# Check disk space
df -h

# Check memory
free -h

# Check node version
node -v

# Check npm packages installed
npm ls --depth=0

# Common fix: port already in use
kill $(lsof -t -i:3000) && npm start

# Common fix: dependency issues
rm -rf node_modules && npm install

# Common fix: TypeScript compilation issues
npm run build

# Check recent failed events
curl "http://localhost:3000/api/runtime-events?event_type=skill.invocation.failed&limit=10"

# Get single event details (includes replayability classification)
curl http://localhost:3000/api/runtime-events/EVENT_ID
```

---

## 8. File Outputs

```bash
# Check artifacts via API
curl http://localhost:3000/api/runtime/artifacts

# List output directories (if generated locally)
ls -la ~/ghostclaw-buildable-system/sites/ 2>/dev/null
ls -la ~/ghostclaw-buildable-system/output/ 2>/dev/null
ls -la ~/ghostclaw-buildable-system/dist/ 2>/dev/null

# Find recently modified files
find ~/ghostclaw-buildable-system -name "*.html" -mtime -1 2>/dev/null
find ~/ghostclaw-buildable-system -name "*.json" -mtime -1 -not -path "*/node_modules/*" 2>/dev/null

# Open generated site (if local)
# On Mac: open sites/index.html
# On Linux: xdg-open sites/index.html
```

---

## 9. SQLite Mode

```bash
# Start with SQLite persistence
STORAGE_MODE=sqlite SQLITE_PATH=./data/ghostclaw.sqlite npm start

# Start with SQLite + custom port
STORAGE_MODE=sqlite SQLITE_PATH=./data/ghostclaw.sqlite PORT=4000 npm start

# Default (no SQLite) — everything in memory, lost on restart
npm start

# Where DB is stored
# Whatever path you set in SQLITE_PATH
# Recommended: ./data/ghostclaw.sqlite

# Confirm SQLite file exists
ls -la ./data/ghostclaw.sqlite

# Check DB file size (confirms data is being written)
du -h ./data/ghostclaw.sqlite

# Inspect SQLite tables directly
sqlite3 ./data/ghostclaw.sqlite ".tables"

# Check row counts
sqlite3 ./data/ghostclaw.sqlite "SELECT COUNT(*) FROM jobs;"
sqlite3 ./data/ghostclaw.sqlite "SELECT COUNT(*) FROM skill_invocations;"
sqlite3 ./data/ghostclaw.sqlite "SELECT COUNT(*) FROM artifacts;"
sqlite3 ./data/ghostclaw.sqlite "SELECT COUNT(*) FROM audit_logs;"

# View recent jobs
sqlite3 ./data/ghostclaw.sqlite "SELECT id, jobType, status FROM jobs ORDER BY createdAt DESC LIMIT 10;"

# View recent skill invocations
sqlite3 ./data/ghostclaw.sqlite "SELECT id, skillId, status FROM skill_invocations ORDER BY startedAt DESC LIMIT 10;"

# Backup the database
cp ./data/ghostclaw.sqlite ./data/ghostclaw-backup-$(date +%Y%m%d).sqlite

# SQLite tables created automatically:
#   skill_invocations — execution records
#   jobs              — queued/completed work
#   artifacts         — generated outputs
#   audit_logs        — append-only audit trail
# Signals, plans, assignments remain in-memory even in SQLite mode
```

---

## 10. Shortcuts — Most Used Commands

### Start & Verify

```bash
cd ~/ghostclaw-buildable-system && npm start
curl http://localhost:3000/api/health
curl http://localhost:3000/api/runtime/status
```

### Start with SQLite

```bash
cd ~/ghostclaw-buildable-system
STORAGE_MODE=sqlite SQLITE_PATH=./data/ghostclaw.sqlite npm start
```

### Submit Work

```bash
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{"name": "generate_content_cluster", "payload": {"topic": "your-topic"}}'
```

### Check Everything

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/runtime/queue
curl http://localhost:3000/api/skill-invocations
curl http://localhost:3000/api/runtime-events?limit=20
```

### Stop & Confirm

```bash
kill $(lsof -t -i:3000)
lsof -i :3000
```

---

## Ghost Mart (Package Management)

```bash
# List all packages
curl http://localhost:3000/api/ghost-mart/packages

# Filter by type
curl "http://localhost:3000/api/ghost-mart/packages?type=skill"
curl "http://localhost:3000/api/ghost-mart/packages?type=agent"
curl "http://localhost:3000/api/ghost-mart/packages?type=blueprint"

# Get package details
curl http://localhost:3000/api/ghost-mart/packages/PACKAGE_ID

# Discover packages from manifest
curl -X POST http://localhost:3000/api/ghost-mart/packages/discover

# Install package to workspace
curl -X POST http://localhost:3000/api/ghost-mart/install \
  -H "Content-Type: application/json" \
  -d '{"packageId": "PKG_ID", "workspaceId": "WS_ID"}'

# List installed packages for a workspace
curl http://localhost:3000/api/ghost-mart/workspaces/WORKSPACE_ID/packages

# Enable / Disable / Uninstall / Update
curl -X POST http://localhost:3000/api/ghost-mart/packages/PKG_ID/enable
curl -X POST http://localhost:3000/api/ghost-mart/packages/PKG_ID/disable
curl -X POST http://localhost:3000/api/ghost-mart/packages/PKG_ID/uninstall
curl -X POST http://localhost:3000/api/ghost-mart/packages/PKG_ID/update
```

---

## Eighteen Core (Gateway) Commands

```bash
# Navigate
cd ~/eighteen-app-eighteen-core

# Build
npm run build

# Start
npm start

# Dev mode (watch)
npm run dev

# Health check
curl http://localhost:3000/health

# Environment variables needed (.env)
#   EIGHTEEN_PORT=3000
#   EIGHTEEN_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=sk-...
#   TELEGRAM_BOT_TOKEN=...
#   GITHUB_PAT=ghp_...
#   POPE_CLAW_WEBHOOK_SECRET=...
#   BRAVE_SEARCH_API_KEY=...

# View audit log
cat PROJECT-LOG.md
tail -20 PROJECT-LOG.md
```

---

## Signal Types Reference

| Signal Name | Creates Job Type | What It Does |
|---|---|---|
| `generate_content_cluster` | `draft_cluster_outline` | Generate content cluster outline |
| `optimize_existing_page` | `refresh_page_sections` | Refresh/optimize page sections |
| `create_new_skill` | `scaffold_skill_package` | Scaffold a new skill package |
| `handle_runtime_error` | `run_diagnostics` | Run system diagnostics |

---

## Port Quick Reference

| Service | Default Port | Env Var |
|---|---|---|
| GhostClaw API | 3000 | `PORT` |
| Eighteen Core Gateway | 3000 | `EIGHTEEN_PORT` |

> If running both, set different ports:
> ```bash
> # Terminal 1 — GhostClaw
> PORT=3000 npm start
> # Terminal 2 — Eighteen Core
> EIGHTEEN_PORT=3001 npm start
> ```
