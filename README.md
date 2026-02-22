# actual-server-setup

Multi-tenant Actual Budget infrastructure for [patelr3-site](https://github.com/patelr3/patelr3-site). Manages per-user [Actual Budget](https://actualbudget.org/) instances deployed as Azure Container Apps.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design.

### Components

| Component       | Tech                    | Description                                         |
| --------------- | ----------------------- | --------------------------------------------------- |
| finance-api     | Node.js 20 Express      | Middleman service for managing per-user ACA deployments |
| actualbudget    | Actual Budget (Docker)  | Self-hosted personal finance app (one per user)     |
| finance-infra   | Bicep                   | Azure infrastructure (CAE, storage, finance-api ACA) |

### How It Works

1. Users request an Actual Budget instance through the patelr3-site UI.
2. The auth-api in patelr3-site proxies the request to the **finance-api**.
3. Finance-api uses Azure Managed Identity to create per-user resources:
   - Azure File Share (`actual-{username}-{hash}`) for persistent data
   - CAE storage link for volume mounting
   - Container App (`ab-{username}-{hash}`) running Actual Budget
4. Each user's ACA gets automatic HTTPS via Azure's default domain.
5. Maximum **10 user instances** per resource group.

## Deployment

Production runs on **Azure Container Apps** in the `patelr3-finance-rg` resource group.

- **Deploy** (`.github/workflows/deploy.yml`) — Builds images, backs up data, deploys via Bicep.
- **Backup** (`.github/workflows/backup.yml`) — Monthly raw + export-format backups of all user data.
- **CI** (`.github/workflows/ci.yml`) — Entrypoint tests, Docker build tests, Bicep validation.
- **Dependabot** — Automated dependency updates with auto-merge on CI pass.

## Data Strategy

- **Runtime**: Actual Budget writes to `/data` (emptyDir for proper SQLite locking).
- **Persistence**: Background sync copies `/data` → `/persistent` (Azure File Share) every 60s.
- **Startup**: Restores from Azure File Share → emptyDir on container start.
- **Backups**: Monthly workflow downloads file shares and creates export zips (metadata.json + db.sqlite per budget), stored in blob container `backups/`.
- **Retention**: Backups older than 6 months are automatically cleaned up.

## Testing

```bash
# Entrypoint tests
bash tests/entrypoint.test.sh

# Docker build tests
bash tests/docker-build.test.sh
```

## Project Structure

```
actual-server-setup/
├── .github/
│   ├── workflows/          ← Deploy, Backup, CI, Dependabot auto-merge
│   ├── dependabot.yml
│   └── copilot-instructions.md
├── actual-server/          ← Git submodule (upstream Actual Budget server)
├── finance-api/            ← Per-user ACA management service
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js        ← Express app (CRUD endpoints)
│       ├── deploy.js       ← Azure ARM operations (create/update/delete ACAs)
│       └── config.js       ← Environment config
├── deployments/
│   └── finance-infra.bicep ← Shared infrastructure (CAE, storage, finance-api)
├── tests/                  ← Entrypoint and Docker build tests
├── Dockerfile              ← Custom Actual Budget image (adds rsync + entrypoint)
├── entrypoint.sh           ← Startup restore + background sync + graceful shutdown
└── start.sh                ← Local dev startup script
```
