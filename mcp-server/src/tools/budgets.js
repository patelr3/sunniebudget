// Budget-related MCP tools
export const budgetTools = [
  {
    name: "list_budgets",
    description: "List all budgets in the user's ActualBudget instance",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max budgets to return (default 50, max 100)" },
      },
    },
  },
  {
    name: "load_budget",
    description: "Load a specific budget by its groupId (sync ID) for subsequent operations",
    inputSchema: {
      type: "object",
      properties: {
        budgetId: { type: "string", description: "The groupId (sync ID) of the budget to load, from list_budgets" },
      },
      required: ["budgetId"],
    },
  },
  {
    name: "get_budget_summary",
    description: "Get a monthly budget summary including income, expenses, and balances",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month in YYYY-MM format (defaults to current month)" },
      },
    },
  },
];

export async function handleBudgetTool(api, name, args) {
  switch (name) {
    case "list_budgets": {
      const limit = Math.min(Math.max(args.limit || 50, 1), 100);
      const budgets = await api.getBudgets();
      return budgets.slice(0, limit);
    }
    case "load_budget": {
      await api.downloadBudget(args.budgetId);
      // Validate the budget actually loaded (downloadBudget can silently fail)
      await api.getBudgetMonths();
      return { loaded: true, budgetId: args.budgetId };
    }
    case "get_budget_summary": {
      const month = args.month || new Date().toISOString().slice(0, 7);
      const summary = await api.getBudgetMonth(month);
      return summary;
    }
    default:
      throw new Error(`Unknown budget tool: ${name}`);
  }
}
