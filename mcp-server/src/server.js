// ActualBudget MCP Server — HTTP streamable transport for Azure AI Foundry
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

  // Register tool list
  server.tool(
    ALL_TOOLS.map(t => t.name),
    async ({ params, _meta }) => {
      // This handler is called for each tool; we'll dispatch via the Express wrapper
      return { content: [{ type: "text", text: "Tool registered" }] };
    },
  );

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

  // MCP protocol endpoint (streamable HTTP for Azure AI Foundry)
  app.post("/mcp", express.json(), async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      const server = createMcpServer();

      // Override tool handler to use our custom dispatch
      const originalToolHandler = server._registeredTools;

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] Protocol error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP protocol error" });
      }
    }
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
