# Copilot Agent Instructions

## Documentation Maintenance

**When making changes to the codebase, always update relevant documentation:**

1. **Root README.md** — Keep the components table, project structure, and data strategy current.
2. **docs/architecture.md** — Update diagrams, naming conventions, endpoints, CI/CD, and data strategy when modifying finance-api, entrypoint, backups, or deployment pipeline.
3. **.github/copilot-instructions.md** — Update if workflows or development conventions change.

## Project Overview

This repo manages multi-tenant Actual Budget infrastructure on Azure. The **finance-api** is the middleman that creates/updates/deletes per-user ACA instances.

## Key Design Decisions

- **Managed Identity** — finance-api uses Azure System-Assigned MI. No tokens, passwords, or secrets to rotate.
- **API Key auth** — Shared FINANCE_API_KEY between auth-api and finance-api. Must fail fast if unset in production (no fallback values for secrets).
- **Tag-based lookup** — User ACAs are found by scanning `userId` + `managedBy` tags, not by name. This ensures backward compatibility if naming changes.
- **emptyDir + rsync** — SQLite requires proper filesystem locking. Azure File Share (SMB) doesn't support it. So we use emptyDir for runtime and rsync to Azure File Share for persistence.
- **Instance limit** — Max 10 per-user ACAs per resource group. Enforced in `deploy.js create()`.
- **File shares preserved on delete** — When a user deletes their instance, the ACA and storage link are removed but the file share is kept for backup/recovery.

## Service Visibility (patelr3-site)

The services table in patelr3-site uses `ON CONFLICT DO NOTHING` for seed data. Admin changes to `is_visible` and `is_restricted` persist across deployments. **Never** change the seed to `ON CONFLICT DO UPDATE`.

## ACA Naming Constraints

Azure Container App names: 2-32 chars, lowercase alphanumeric + hyphens, start with letter, end alphanumeric, no `--`.
- App: `ab-{username}-{hash}` (max 28 chars)
- Share: `actual-{username}-{hash}` (max 31 chars)
- Link: `actual{username}{hash}` (max 30 chars)

## Key Commands

| Task | Command |
|------|---------|
| Run entrypoint tests | `bash tests/entrypoint.test.sh` |
| Run Docker build tests | `bash tests/docker-build.test.sh` |
| Validate Bicep | `az bicep build --file deployments/finance-infra.bicep --stdout > /dev/null` |
| Local Actual Budget | `./start.sh` (uses docker-compose + git submodule) |

## Related Repos

- **[patelr3-site](https://github.com/patelr3/patelr3-site)** — Main website with auth, RBAC, frontend UI, and deployment proxy.
