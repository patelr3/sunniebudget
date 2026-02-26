// Account-related MCP tools
export const accountTools = [
  {
    name: "get_accounts",
    description: "List all accounts with their balances and types",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max accounts to return (default 100, max 200)" },
      },
    },
  },
  {
    name: "create_account",
    description: "Create a new account",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Account name" },
        type: { type: "string", description: "Account type: checking, savings, credit, investment, mortgage, debt, other" },
        offBudget: { type: "boolean", description: "Whether the account is off-budget (default: false)" },
        balance: { type: "number", description: "Initial balance in dollars (default: 0)" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "close_account",
    description: "Close an account (marks it as closed, does not delete)",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "The ID of the account to close" },
        transferAccountId: { type: "string", description: "Account to transfer remaining balance to" },
      },
      required: ["accountId"],
    },
  },
];

export async function handleAccountTool(api, name, args) {
  switch (name) {
    case "get_accounts": {
      const limit = Math.min(Math.max(args.limit || 100, 1), 200);
      const accounts = await api.getAccounts();
      return accounts.slice(0, limit);
    }
    case "create_account": {
      const balance = args.balance ? api.utils.amountToInteger(args.balance) : 0;
      const id = await api.createAccount({
        name: args.name,
        type: args.type,
        offbudget: args.offBudget ? 1 : 0,
      }, balance);
      return { id, name: args.name };
    }
    case "close_account": {
      await api.closeAccount(args.accountId, args.transferAccountId);
      return { closed: true, accountId: args.accountId };
    }
    default:
      throw new Error(`Unknown account tool: ${name}`);
  }
}
