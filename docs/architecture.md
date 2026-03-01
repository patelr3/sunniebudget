# sunniebudget — Architecture

## Overview

Multi-tenant Actual Budget infrastructure that provides per-user self-hosted personal finance instances. Each user gets their own isolated Azure Container App running Actual Budget, with persistent storage via Azure File Shares and automated monthly backups.

This repo is the backend companion to [patelr3-site](https://github.com/patelr3/patelr3-site), which provides the frontend UI and auth layer.

---

## Architecture

```
patelr3-site (auth-api)
       │
       │ POST /deployments/:userId  (X-Api-Key auth)
       ▼
┌──────────────┐
│  Finance API │  ← Manages per-user Azure resources
│  (ACA)       │     via Managed Identity
└──────┬───────┘
       │ Azure ARM SDK
       ▼
┌──────────────────────────────────────────────┐
│              patelr3-finance-rg               │
│                                              │
│  ┌─────────────┐   ┌─────────────────────┐  │
│  │ finance-cae │   │ patelr3financedata  │  │
│  │ (ACA Env)   │   │ (Storage Account)   │  │
│  └──────┬──────┘   └──────────┬──────────┘  │
│         │                     │              │
│  ┌──────▼──────────────┐  ┌──▼────────────┐ │
│  │ ab-{user}-{hash}   │  │ File Shares   │ │
│  │ ab-{user}-{hash}   │  │ actual-{...}  │ │
│  │ ... (max 10)       │  │ actual-{...}  │ │
│  └─────────────────────┘  └───────────────┘ │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ Blob Container: backups/            │    │
│  │  raw/{date}/{share}/                │    │
│  │  exports/{date}/{share}/*.zip       │    │
│  └─────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

---

## Finance API

The finance-api is the middleman service that manages per-user Actual Budget deployments. It runs as an Azure Container App with a System-Assigned Managed Identity.

### Endpoints

| Method | Path                 | Description                    |
| ------ | -------------------- | ------------------------------ |
| GET    | `/health`            | Health check (no auth)         |
| GET    | `/deployments/:userId` | Get deployment status        |
| POST   | `/deployments/:userId` | Create new instance          |
| PUT    | `/deployments/:userId` | Update to latest image       |
| DELETE | `/deployments/:userId` | Delete instance              |

### Authentication

- Requests require `X-Api-Key` header matching the shared `FINANCE_API_KEY` secret.
- Finance-api uses Azure Managed Identity (no tokens/passwords to rotate) for all Azure operations.

### Resource Naming

Per-user resources use a deterministic naming scheme:

| Resource       | Format                          | Example              |
| -------------- | ------------------------------- | -------------------- |
| Container App  | `ab-{username}-{4hex}`          | `ab-16patelr-d4e5`  |
| File Share     | `actual-{username}-{4hex}`      | `actual-16patelr-d4e5` |
| Storage Link   | `actual{username}{4hex}`        | `actual16patelrd4e5` |

- Username: email prefix, lowercase alphanumeric only, max 20 chars.
- Hash: first 4 hex chars of SHA-256 of userId (deterministic).
- ACA names max 32 chars; all names stay well under limits.

### Instance Limit

Maximum **10 user instances** per resource group. The `create()` function counts existing `managedBy: "finance-api"` tagged apps before creating.

### Tag-Based Lookup

All user ACAs are tagged with `{ userId, username, managedBy: "finance-api" }`. The `getStatus()`, `update()`, and `remove()` functions find apps by scanning tags, which provides backward compatibility if the naming scheme changes.

---

## Data Strategy

### Runtime Architecture

```
┌─────────────────────────────────────────┐
│           Actual Budget ACA             │
│                                         │
│  /data (emptyDir)     /persistent       │
│  ├── server-files/    (Azure File Share)│
│  ├── user-files/      ← rsync sync ──┘ │
│  └── config.json                        │
│                                         │
│  entrypoint.sh:                         │
│    1. Restore: /persistent → /data      │
│    2. Start: node app.js                │
│    3. Sync: /data → /persistent (60s)   │
│    4. Shutdown: final sync              │
└─────────────────────────────────────────┘
```

- **emptyDir** (`/data`): Fast local storage with proper SQLite locking.
- **Azure File Share** (`/persistent`): Durable storage that survives restarts.
- **rsync**: Bidirectional sync — restore on startup, periodic sync while running, final sync on shutdown.

### Backup Strategy

**Monthly raw backup** (GitHub Actions cron):
1. Downloads all `actual-*` file shares from Azure.
2. Uploads to blob storage: `raw/{date}/{share}/`.

**Monthly export backup**:
1. Finds `server-files/*/db.sqlite` in each share.
2. Extracts budget name from SQLite metadata.
3. Creates zip: `metadata.json` + `db.sqlite` per budget.
4. Uploads to `exports/{date}/{share}/`.

**Pre-deploy backup** (before any ACA update):
1. Deploy workflow downloads each user's file share.
2. Uploads to blob storage before applying changes.

**Retention**: Blobs older than 6 months are automatically deleted.

---

## CI/CD

| Workflow                     | Trigger                | What it does                                     |
| ---------------------------- | ---------------------- | ------------------------------------------------ |
| **CI**                       | Push/PR to main        | Entrypoint tests, Docker build tests, Bicep lint |
| **Deploy**                   | Push to main           | Build images → backup → deploy Bicep → grant MI  |
| **Monthly Backup**           | 1st of month (cron)    | Raw + export backups, cleanup old backups        |
| **Dependabot Auto-Merge**    | Dependabot PRs         | Auto-approve + merge after CI passes             |

### Branch Protection (main)

Required status checks: Entrypoint Tests, Docker Build Tests, Validate Bicep.

---

## Environment Variables

### Finance API

| Variable                | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID                          |
| `AZURE_FINANCE_RG`      | Finance resource group name                    |
| `AZURE_FINANCE_CAE`     | Container Apps Environment name                |
| `AZURE_FINANCE_STORAGE` | Storage account name                           |
| `AZURE_ACR_SERVER`      | ACR server URL (e.g., myacr.azurecr.io)        |
| `AZURE_SITE_RG`         | Site resource group (for ACR access)           |
| `FINANCE_API_KEY`        | Shared secret for auth-api → finance-api auth  |
