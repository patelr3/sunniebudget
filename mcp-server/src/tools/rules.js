// Rule-related MCP tools
export const ruleTools = [
  {
    name: "get_rules",
    description: "List all transaction rules",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rules to return (default 50, max 200)" },
      },
    },
  },
  {
    name: "create_rule",
    description: "Create a new transaction rule for auto-categorization",
    inputSchema: {
      type: "object",
      properties: {
        conditions: {
          type: "array",
          description: "Conditions that trigger the rule",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: "Field to match: payee, notes, amount, date" },
              op: { type: "string", description: "Operator: is, contains, gt, lt, gte, lte" },
              value: { type: "string", description: "Value to match" },
            },
            required: ["field", "op", "value"],
          },
        },
        actions: {
          type: "array",
          description: "Actions to apply when conditions match",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: "Field to set: category, payee, notes" },
              value: { type: "string", description: "Value to set" },
            },
            required: ["field", "value"],
          },
        },
        conditionsOp: { type: "string", description: "'and' or 'or' (default: 'and')" },
      },
      required: ["conditions", "actions"],
    },
  },
];

export async function handleRuleTool(api, name, args) {
  switch (name) {
    case "get_rules": {
      const limit = Math.min(Math.max(args.limit || 50, 1), 200);
      const rules = await api.getRules();
      return rules.slice(0, limit);
    }
    case "create_rule": {
      const id = await api.createRule({
        conditions: args.conditions,
        actions: args.actions,
        conditions_op: args.conditionsOp || "and",
      });
      return { id, created: true };
    }
    default:
      throw new Error(`Unknown rule tool: ${name}`);
  }
}
