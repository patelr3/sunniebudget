// Payee-related MCP tools
export const payeeTools = [
  {
    name: "get_payees",
    description: "List all payees",
    inputSchema: { type: "object", properties: {}, required: [] },
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
    case "get_payees":
      return await api.getPayees();
    case "create_payee": {
      const id = await api.createPayee({ name: args.name });
      return { id, name: args.name };
    }
    default:
      throw new Error(`Unknown payee tool: ${name}`);
  }
}
