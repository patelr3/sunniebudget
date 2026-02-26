// ActualBudget MCP Server — HTTP streamable transport for Azure AI Foundry
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import config from "./config.js";
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

  // MCP tools/list endpoint (for direct HTTP access outside MCP protocol)
  app.get("/tools", (_req, res) => {
    res.json({ tools: ALL_TOOLS });
  });

  // MCP tool call endpoint (simplified HTTP API for tool execution)
  app.post("/tools/call", express.json(), async (req, res) => {
    const { name, arguments: args } = req.body;

    // Validate user from Authorization header
    let user;
    try {
      user = validateAuth(req.headers);
    } catch (err) {
      if (err instanceof AuthError) {
        return res.status(401).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal error" });
    }

    // Find the handler
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return res.status(400).json({ error: `Unknown tool: ${name}` });
    }

    try {
      // Get user's AB instance
      const { serverUrl, sessionToken } = await getUserInstance(user.userId);

      // Execute tool with @actual-app/api connection
      const result = await withActualApi(user.userId, serverUrl, sessionToken, async (api) => {
        // Load budget if needed (for tools that require a loaded budget)
        if (!NO_BUDGET_TOOLS.has(name)) {
          // Get the first budget if none specified
          const budgets = await api.getBudgets();
          if (budgets.length === 0) {
            throw new Error("No budgets found");
          }
          await api.downloadBudget(budgets[0].id);
        }
        return await handler(api, name, args || {});
      });

      res.json({
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      console.error(`[mcp] Tool ${name} error for user ${user.userId}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // MCP Streamable HTTP endpoint (JSON-RPC 2.0 for Azure AI Foundry Agent Service)
  app.post("/mcp", express.json(), async (req, res) => {
    const { method, id, params } = req.body;

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

      // Validate auth from headers (Foundry forwards tool_resources headers)
      let user;
      try {
        user = validateAuth(req.headers);
      } catch (err) {
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
        const result = await withActualApi(user.userId, serverUrl, sessionToken, async (api) => {
          if (!NO_BUDGET_TOOLS.has(name)) {
            const budgets = await api.getBudgets();
            if (budgets.length === 0) throw new Error("No budgets found");
            await api.downloadBudget(budgets[0].id);
          }
          return await handler(api, name, args || {});
        });

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (err) {
        console.error(`[mcp] Tool ${name} error for user ${user.userId}:`, err.message);
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

// Start server if run directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const app = createApp();
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`ActualBudget MCP Server listening on :${config.port}`);
    console.log(`Tools available: ${ALL_TOOLS.length}`);
  });
}
