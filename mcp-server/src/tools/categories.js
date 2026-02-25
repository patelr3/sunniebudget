// Category-related MCP tools
export const categoryTools = [
  {
    name: "get_categories",
    description: "List all categories and category groups",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_category",
    description: "Create a new category within a group",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Category name" },
        groupId: { type: "string", description: "Category group ID" },
      },
      required: ["name", "groupId"],
    },
  },
  {
    name: "update_category",
    description: "Update a category's name or group",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Category ID" },
        name: { type: "string", description: "New name" },
        groupId: { type: "string", description: "New group ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_category",
    description: "Delete a category",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Category ID to delete" },
        transferCategoryId: { type: "string", description: "Category to transfer transactions to" },
      },
      required: ["id"],
    },
  },
];

export async function handleCategoryTool(api, name, args) {
  switch (name) {
    case "get_categories":
      return await api.getCategories();
    case "create_category": {
      const id = await api.createCategory({ name: args.name, group_id: args.groupId });
      return { id, name: args.name };
    }
    case "update_category": {
      const fields = {};
      if (args.name) fields.name = args.name;
      if (args.groupId) fields.group_id = args.groupId;
      await api.updateCategory(args.id, fields);
      return { updated: true, id: args.id };
    }
    case "delete_category":
      await api.deleteCategory(args.id, args.transferCategoryId);
      return { deleted: true, id: args.id };
    default:
      throw new Error(`Unknown category tool: ${name}`);
  }
}
