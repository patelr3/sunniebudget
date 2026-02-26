// Payee-related MCP tools
export const payeeTools = [
  {
    name: "get_payees",
    description: "List all payees",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max payees to return (default 50, max 200)" },
      },
    },
  },
  {
    name: "create_payee",
    description: "Create a new payee",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Payee name" },
      },
      required: ["name"],
    },
  },
];

export async function handlePayeeTool(api, name, args) {
  switch (name) {
    case "get_payees": {
      const limit = Math.min(Math.max(args.limit || 50, 1), 200);
      const payees = await api.getPayees();
      payees.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return payees.slice(0, limit);
    }
    case "create_payee": {
      const id = await api.createPayee({ name: args.name });
      return { id, name: args.name };
    }
    default:
      throw new Error(`Unknown payee tool: ${name}`);
  }
}
