# ActualBudget MCP Server

A Model Context Protocol (MCP) server that provides AI agents with full access to [Actual Budget](https://actualbudget.com/) instances. Designed for integration with Azure AI Foundry Agent Service.

## Features

- **21 tools** for full budget management (accounts, transactions, categories, payees, schedules, rules)
- **Session token auth** via `@actual-app/api` — works alongside OpenID-configured instances
- **JWT-based user isolation** — each user only accesses their own AB instance
- **HTTP streamable transport** — compatible with Azure AI Foundry Agent Service

## Architecture

```
Azure AI Foundry → (Authorization: Bearer JWT) → MCP Server
  → validates JWT via auth-api
  → gets instance URL + service token via finance-api
  → connects via @actual-app/api init({ serverURL, sessionToken })
  → executes tool, returns result
```

## Tools

| Tool | Description |
|------|-------------|
| `list_budgets` | List all budgets |
| `load_budget` | Load a specific budget by ID |
| `get_budget_summary` | Monthly summary (income, expenses, balance) |
| `get_accounts` | List accounts with balances |
| `create_account` | Create new account |
| `close_account` | Close an account |
| `get_transactions` | Query with filters (account, date range) |
| `create_transaction` | Add a transaction |
| `update_transaction` | Modify a transaction |
| `delete_transaction` | Remove a transaction |
| `import_transactions` | Bulk import |
| `get_categories` | List categories/groups |
| `create_category` | Create in a group |
| `update_category` | Rename or move |
| `delete_category` | Remove category |
| `get_payees` | List payees |
| `create_payee` | Create payee |
| `get_schedules` | List recurring transactions |
| `create_schedule` | Create recurring transaction |
| `get_rules` | List auto-categorization rules |
| `create_rule` | Create rule |

## Local Development

```bash
npm install
npm run dev   # starts on port 8090
```

Or via Docker Compose (from repo root):

```bash
docker compose up mcp-server
# Health check: curl http://localhost/api/mcp/health
# Tool list:    curl http://localhost/api/mcp/tools
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8090` |
| `JWT_SECRET` | Secret for validating auth-api JWTs | `change-me` |
| `FINANCE_API_URL` | Finance API base URL | (required) |
| `FINANCE_API_KEY` | Shared API key for finance-api | `dev-finance-key` |
| `ACTUAL_DATA_DIR` | Temp directory for API data | `/tmp/actual-data` |

## Testing

```bash
npm test   # 22 unit tests (Jest)
```
