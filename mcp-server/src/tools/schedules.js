// Schedule-related MCP tools
export const scheduleTools = [
  {
    name: "get_schedules",
    description: "List all scheduled/recurring transactions",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max schedules to return (default 50, max 200)" },
      },
    },
  },
  {
    name: "create_schedule",
    description: "Create a new scheduled/recurring transaction",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Account ID" },
        amount: { type: "number", description: "Amount in dollars" },
        payeeName: { type: "string", description: "Payee name" },
        categoryId: { type: "string", description: "Category ID" },
        frequency: { type: "string", description: "Frequency: daily, weekly, monthly, yearly" },
        startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
        endDate: { type: "string", description: "End date (YYYY-MM-DD, optional)" },
      },
      required: ["accountId", "amount", "frequency", "startDate"],
    },
  },
];

export async function handleScheduleTool(api, name, args) {
  switch (name) {
    case "get_schedules": {
      const limit = Math.min(Math.max(args.limit || 50, 1), 200);
      const schedules = await api.getSchedules();
      return schedules.slice(0, limit);
    }
    case "create_schedule": {
      const id = await api.createSchedule({
        account: args.accountId,
        amount: api.utils.amountToInteger(args.amount),
        payee_name: args.payeeName,
        category: args.categoryId,
        frequency: args.frequency,
        start_date: args.startDate,
        end_date: args.endDate,
      });
      return { id, created: true };
    }
    default:
      throw new Error(`Unknown schedule tool: ${name}`);
  }
}
