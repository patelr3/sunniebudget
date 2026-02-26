// Transaction-related MCP tools
export const transactionTools = [
  {
    name: "get_transactions",
    description: "Query transactions with optional filters. Returns most recent first, limited to 50 by default.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Filter by account ID" },
        startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
        endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
        limit: { type: "number", description: "Max transactions to return (default 50, max 200)" },
      },
    },
  },
  {
    name: "create_transaction",
    description: "Add a new transaction",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Account ID" },
        date: { type: "string", description: "Transaction date (YYYY-MM-DD)" },
        amount: { type: "number", description: "Amount in dollars (negative for expenses)" },
        payeeName: { type: "string", description: "Payee name" },
        categoryId: { type: "string", description: "Category ID" },
        notes: { type: "string", description: "Notes/memo" },
      },
      required: ["accountId", "date", "amount"],
    },
  },
  {
    name: "update_transaction",
    description: "Modify an existing transaction",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Transaction ID" },
        date: { type: "string", description: "New date" },
        amount: { type: "number", description: "New amount in dollars" },
        payeeName: { type: "string", description: "New payee name" },
        categoryId: { type: "string", description: "New category ID" },
        notes: { type: "string", description: "New notes" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_transaction",
    description: "Remove a transaction",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Transaction ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "import_transactions",
    description: "Bulk import transactions into an account",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Account ID to import into" },
        transactions: {
          type: "array",
          description: "Array of transactions to import",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date (YYYY-MM-DD)" },
              amount: { type: "number", description: "Amount in dollars" },
              payee_name: { type: "string", description: "Payee name" },
              notes: { type: "string", description: "Notes" },
              imported_id: { type: "string", description: "External ID for dedup" },
            },
            required: ["date", "amount"],
          },
        },
      },
      required: ["accountId", "transactions"],
    },
  },
];

export async function handleTransactionTool(api, name, args) {
  switch (name) {
    case "get_transactions": {
      const limit = Math.min(Math.max(args.limit || 50, 1), 200);
      const txns = await api.getTransactions(
        args.accountId,
        args.startDate,
        args.endDate,
      );
      // Sort by date descending (most recent first), then apply limit
      txns.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return txns.slice(0, limit);
    }
    case "create_transaction": {
      const txn = {
        account: args.accountId,
        date: args.date,
        amount: api.utils.amountToInteger(args.amount),
        payee_name: args.payeeName,
        category: args.categoryId,
        notes: args.notes,
      };
      const id = await api.addTransactions(args.accountId, [txn]);
      return { id: id?.[0], created: true };
    }
    case "update_transaction": {
      const fields = { id: args.id };
      if (args.date) fields.date = args.date;
      if (args.amount !== undefined) fields.amount = api.utils.amountToInteger(args.amount);
      if (args.payeeName) fields.payee_name = args.payeeName;
      if (args.categoryId) fields.category = args.categoryId;
      if (args.notes !== undefined) fields.notes = args.notes;
      await api.updateTransaction(args.id, fields);
      return { updated: true, id: args.id };
    }
    case "delete_transaction": {
      await api.deleteTransaction(args.id);
      return { deleted: true, id: args.id };
    }
    case "import_transactions": {
      const txns = args.transactions.map(t => ({
        ...t,
        amount: api.utils.amountToInteger(t.amount),
      }));
      const result = await api.importTransactions(args.accountId, txns);
      return result;
    }
    default:
      throw new Error(`Unknown transaction tool: ${name}`);
  }
}
