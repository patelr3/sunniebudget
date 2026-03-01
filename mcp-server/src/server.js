// ActualBudget MCP Server — HTTP streamable transport for Azure AI Foundry
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import config from "./config.js";
import logger from "./logger.js";
import { validateAuth, AuthError } from "./auth.js";
import { getUserInstance, withActualApi } from "./actual-client.js";
import { budgetTools, handleBudgetTool } from "./tools/budgets.js";
import { accountTools, handleAccountTool } from "./tools/accounts.js";
import { transactionTools, handleTransactionTool } from "./tools/transactions.js";
import { categoryTools, handleCategoryTool } from "./tools/categories.js";
import { payeeTools, handlePayeeTool } from "./tools/payees.js";
import { scheduleTools, handleScheduleTool } from "./tools/schedules.js";
import { ruleTools, handleRuleTool } from "./tools/rules.js";

// All available tools
const ALL_TOOLS = [
  ...budgetTools,
  ...accountTools,
  ...transactionTools,
  ...categoryTools,
  ...payeeTools,
  ...scheduleTools,
  ...ruleTools,
];

// Route tool calls to the appropriate handler
const TOOL_HANDLERS = {
  list_budgets: handleBudgetTool,
  load_budget: handleBudgetTool,
  get_budget_summary: handleBudgetTool,
  get_accounts: handleAccountTool,
  create_account: handleAccountTool,
  close_account: handleAccountTool,
  get_transactions: handleTransactionTool,
  create_transaction: handleTransactionTool,
  update_transaction: handleTransactionTool,
  delete_transaction: handleTransactionTool,
  import_transactions: handleTransactionTool,
  get_categories: handleCategoryTool,
  create_category: handleCategoryTool,
  update_category: handleCategoryTool,
  delete_category: handleCategoryTool,
  get_payees: handlePayeeTool,
  create_payee: handlePayeeTool,
  get_schedules: handleScheduleTool,
  create_schedule: handleScheduleTool,
  get_rules: handleRuleTool,
  create_rule: handleRuleTool,
};

// Tools that don't need a loaded budget
const NO_BUDGET_TOOLS = new Set(["list_budgets", "load_budget"]);

export function createMcpServer() {
  const server = new McpServer({
    name: "actualbudget-mcp",
    version: "1.0.0",
  });
  return server;
}

// Create the Express app with MCP HTTP transport
export function createApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "actualbudget-mcp-server", tools: ALL_TOOLS.length });
  });

  // MCP Streamable HTTP endpoint — GET for SSE transport discovery
  // Foundry sends GET first to establish SSE; server returns endpoint event
  app.get("/mcp", (req, res) => {
    logger.info("SSE transport connection opened");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    // Tell client to POST JSON-RPC messages to this same path
    res.write("event: endpoint\ndata: /mcp\n\n");
    res.flush?.();
    // Keep connection open for server-initiated messages (heartbeat)
    const heartbeat = setInterval(() => {
      try { res.write(":heartbeat\n\n"); res.flush?.(); } catch { /* client gone */ }
    }, 15_000);
    req.on("close", () => clearInterval(heartbeat));
  });

  // MCP Streamable HTTP endpoint (JSON-RPC 2.0 for Azure AI Foundry Agent Service)
  app.post("/mcp", express.json(), async (req, res) => {
    const { method, id, params } = req.body;
    logger.info("MCP JSON-RPC request", { method, id });

    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "actualbudget-mcp", version: "1.0.0" },
        },
      });
    }

    if (method === "notifications/initialized") {
      return res.status(204).end();
    }

    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: { tools: ALL_TOOLS },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      logger.info("MCP tools/call", { tool: name, hasAuth: !!req.headers.authorization });

      // Validate auth from headers (Foundry forwards tool_resources headers)
      let user;
      try {
        user = await validateAuth(req.headers);
        logger.info("MCP auth success", { tool: name, userId: user.userId, email: user.email });
      } catch (err) {
        logger.warn("MCP auth failed", { tool: name, error: err.message });
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Authentication required: ${err.message}` }],
            isError: true,
          },
        });
      }

      const handler = TOOL_HANDLERS[name];
      if (!handler) {
        logger.error("MCP tool error", { tool: name, output: `Unknown tool: ${name}` });
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          },
        });
      }

      try {
        const { serverUrl, sessionToken } = await getUserInstance(user.userId);
        logger.info("MCP tool executing", { tool: name, userId: user.userId, serverUrl });
        const result = await withActualApi(user.userId, serverUrl, sessionToken, async (api) => {
          if (!NO_BUDGET_TOOLS.has(name)) {
            const budgets = await api.getBudgets();
            if (budgets.length === 0) throw new Error("No budgets found for user");
            try {
              await api.downloadBudget(budgets[0].groupId);
            } catch (dlErr) {
              logger.error("Auto-load budget failed", {
                tool: name, budgetId: budgets[0].groupId, error: dlErr.message,
              });
              throw new Error(`Failed to load budget: ${dlErr.message}`);
            }
          }
          return await handler(api, name, args || {});
        });

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result) }],
          },
        });
      } catch (err) {
        logger.error("MCP tool error", { tool: name, userId: user.userId, error: err.message });
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          },
        });
      }
    }

    // Unknown method
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });

  return app;
}
