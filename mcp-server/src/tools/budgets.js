// Budget-related MCP tools
export const budgetTools = [
  {
    name: "list_budgets",
    description: "List all budgets in the user's ActualBudget instance",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "load_budget",
    description: "Load a specific budget by its sync ID for subsequent operations",
    inputSchema: {
      type: "object",
      properties: {
        budgetId: { type: "string", description: "The sync ID of the budget to load" },
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
      const budgets = await api.getBudgets();
      return budgets;
    }
    case "load_budget": {
      await api.downloadBudget(args.budgetId);
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
