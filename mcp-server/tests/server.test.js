import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";

const JWT_SECRET = "change-me";

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: "1", email: "test@test.com", name: "Test", role: "user", ...payload },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

// Mock @actual-app/api
const mockApi = {
  init: jest.fn(),
  shutdown: jest.fn(),
  getBudgets: jest.fn(),
  downloadBudget: jest.fn(),
  getBudgetMonth: jest.fn(),
  getAccounts: jest.fn(),
  createAccount: jest.fn(),
  closeAccount: jest.fn(),
  getTransactions: jest.fn(),
  addTransactions: jest.fn(),
  updateTransaction: jest.fn(),
  deleteTransaction: jest.fn(),
  importTransactions: jest.fn(),
  getCategories: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  getPayees: jest.fn(),
  createPayee: jest.fn(),
  getSchedules: jest.fn(),
  createSchedule: jest.fn(),
  getRules: jest.fn(),
  createRule: jest.fn(),
  utils: {
    amountToInteger: (amount) => Math.round(amount * 100),
  },
};

jest.unstable_mockModule("@actual-app/api", () => mockApi);

// Mock actual-client
const mockActualClient = {
  getUserInstance: jest.fn(),
  withActualApi: jest.fn(),
};

jest.unstable_mockModule("../src/actual-client.js", () => mockActualClient);

const { createApp } = await import("../src/server.js");
const request = (await import("supertest")).default;

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: withActualApi executes the callback with mockApi
  mockActualClient.withActualApi.mockImplementation(async (_userId, _url, _token, fn) => {
    return await fn(mockApi);
  });
  mockActualClient.getUserInstance.mockResolvedValue({
    serverUrl: "https://ab-test.example.com",
    sessionToken: "service-token-123",
  });
  // Default: one budget available
  mockApi.getBudgets.mockResolvedValue([{ id: "budget-1", groupId: "sync-1", name: "My Budget" }]);
  mockApi.downloadBudget.mockResolvedValue(undefined);
});

describe("Health endpoint", () => {
  it("returns 200 with tool count", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("actualbudget-mcp-server");
    expect(res.body.tools).toBeGreaterThan(0);
  });
});

describe("Tools list endpoint", () => {
  it("returns all available tools", async () => {
    const res = await request(app).get("/tools").expect(200);
    expect(res.body.tools).toBeInstanceOf(Array);
    expect(res.body.tools.length).toBeGreaterThan(15);

    const names = res.body.tools.map(t => t.name);
    expect(names).toContain("list_budgets");
    expect(names).toContain("get_accounts");
    expect(names).toContain("get_transactions");
    expect(names).toContain("create_transaction");
    expect(names).toContain("get_categories");
    expect(names).toContain("get_payees");
    expect(names).toContain("get_schedules");
    expect(names).toContain("get_rules");
  });

  it("each tool has name, description, and inputSchema", async () => {
    const res = await request(app).get("/tools").expect(200);
    for (const tool of res.body.tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("Authentication", () => {
  it("rejects requests without Authorization header", async () => {
    const res = await request(app)
      .post("/tools/call")
      .send({ name: "list_budgets", arguments: {} })
      .expect(401);
    expect(res.body.error).toContain("Authorization");
  });

  it("rejects invalid JWT", async () => {
    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", "Bearer invalid-token")
      .send({ name: "list_budgets", arguments: {} })
      .expect(401);
    expect(res.body.error).toContain("Invalid");
  });

  it("rejects expired JWT", async () => {
    const token = jwt.sign({ sub: "1" }, JWT_SECRET, { expiresIn: "-1h" });
    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "list_budgets", arguments: {} })
      .expect(401);
    expect(res.body.error).toContain("Invalid");
  });

  it("accepts valid JWT", async () => {
    mockApi.getBudgets.mockResolvedValue([{ id: "b1", groupId: "gs1", name: "Budget" }]);

    const token = makeToken();
    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "list_budgets", arguments: {} })
      .expect(200);
    expect(res.body.content).toBeDefined();
  });
});

describe("Tool: list_budgets", () => {
  it("returns budgets from the user's instance", async () => {
    const budgets = [
      { id: "b1", groupId: "gs1", name: "Personal" },
      { id: "b2", groupId: "gs2", name: "Business" },
    ];
    mockApi.getBudgets.mockResolvedValue(budgets);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "list_budgets", arguments: {} })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result).toEqual(budgets);
    // list_budgets should NOT download a budget
    expect(mockApi.downloadBudget).not.toHaveBeenCalled();
  });
});

describe("Tool: get_accounts", () => {
  it("returns accounts and auto-loads first budget", async () => {
    const accounts = [
      { id: "acc1", name: "Checking", balance: 150000 },
      { id: "acc2", name: "Savings", balance: 500000 },
    ];
    mockApi.getAccounts.mockResolvedValue(accounts);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "get_accounts", arguments: {} })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result).toEqual(accounts);
    // Should auto-load first budget
    expect(mockApi.downloadBudget).toHaveBeenCalledWith("sync-1");
  });
});

describe("Tool: create_account", () => {
  it("creates an account with correct parameters", async () => {
    mockApi.createAccount.mockResolvedValue("new-acc-id");

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        name: "create_account",
        arguments: { name: "New Checking", type: "checking", balance: 100.50 },
      })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result.id).toBe("new-acc-id");
    expect(result.name).toBe("New Checking");
    expect(mockApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Checking", type: "checking" }),
      10050 // $100.50 in cents
    );
  });
});

describe("Tool: get_transactions", () => {
  it("returns transactions with filters", async () => {
    const txns = [{ id: "t1", amount: -5000, payee: "Store" }];
    mockApi.getTransactions.mockResolvedValue(txns);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        name: "get_transactions",
        arguments: { accountId: "acc1", startDate: "2025-01-01", endDate: "2025-01-31" },
      })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result).toEqual(txns);
    expect(mockApi.getTransactions).toHaveBeenCalledWith("acc1", "2025-01-01", "2025-01-31");
  });
});

describe("Tool: create_transaction", () => {
  it("creates a transaction with amount conversion", async () => {
    mockApi.addTransactions.mockResolvedValue(["txn-new"]);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        name: "create_transaction",
        arguments: {
          accountId: "acc1",
          date: "2025-06-15",
          amount: -42.99,
          payeeName: "Coffee Shop",
          notes: "Morning latte",
        },
      })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result.created).toBe(true);
    expect(mockApi.addTransactions).toHaveBeenCalledWith("acc1", [
      expect.objectContaining({
        account: "acc1",
        date: "2025-06-15",
        amount: -4299,
        payee_name: "Coffee Shop",
        notes: "Morning latte",
      }),
    ]);
  });
});

describe("Tool: update_transaction", () => {
  it("updates transaction fields", async () => {
    mockApi.updateTransaction.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        name: "update_transaction",
        arguments: { id: "txn-1", amount: -25.00, notes: "Updated" },
      })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result.updated).toBe(true);
    expect(mockApi.updateTransaction).toHaveBeenCalledWith("txn-1", expect.objectContaining({
      id: "txn-1",
      amount: -2500,
      notes: "Updated",
    }));
  });
});

describe("Tool: delete_transaction", () => {
  it("deletes a transaction", async () => {
    mockApi.deleteTransaction.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "delete_transaction", arguments: { id: "txn-del" } })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result.deleted).toBe(true);
    expect(mockApi.deleteTransaction).toHaveBeenCalledWith("txn-del");
  });
});

describe("Tool: get_categories", () => {
  it("returns categories", async () => {
    const cats = [{ id: "cat1", name: "Food", group_id: "g1" }];
    mockApi.getCategories.mockResolvedValue(cats);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "get_categories", arguments: {} })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result).toEqual(cats);
  });
});

describe("Tool: create_category", () => {
  it("creates a category in a group", async () => {
    mockApi.createCategory.mockResolvedValue("cat-new");

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "create_category", arguments: { name: "Dining", groupId: "food-group" } })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result.id).toBe("cat-new");
    expect(mockApi.createCategory).toHaveBeenCalledWith({ name: "Dining", group_id: "food-group" });
  });
});

describe("Tool: get_payees", () => {
  it("returns payees", async () => {
    const payees = [{ id: "p1", name: "Amazon" }];
    mockApi.getPayees.mockResolvedValue(payees);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "get_payees", arguments: {} })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result).toEqual(payees);
  });
});

describe("Tool: get_schedules", () => {
  it("returns schedules", async () => {
    const scheds = [{ id: "s1", frequency: "monthly" }];
    mockApi.getSchedules.mockResolvedValue(scheds);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "get_schedules", arguments: {} })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result).toEqual(scheds);
  });
});

describe("Tool: get_rules", () => {
  it("returns rules", async () => {
    const rules = [{ id: "r1", conditions_op: "and" }];
    mockApi.getRules.mockResolvedValue(rules);

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "get_rules", arguments: {} })
      .expect(200);

    const result = JSON.parse(res.body.content[0].text);
    expect(result).toEqual(rules);
  });
});

describe("Unknown tool", () => {
  it("returns 400 for unknown tool name", async () => {
    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "nonexistent_tool", arguments: {} })
      .expect(400);

    expect(res.body.error).toContain("Unknown tool");
  });
});

describe("Error handling", () => {
  it("returns 500 when AB instance is not running", async () => {
    mockActualClient.getUserInstance.mockRejectedValue(new Error("Deployment not found"));
    mockActualClient.withActualApi.mockImplementation(async () => {
      const { serverUrl } = await mockActualClient.getUserInstance();
    });

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "get_accounts", arguments: {} })
      .expect(500);

    expect(res.body.error).toBeDefined();
  });

  it("returns 500 when no budgets exist", async () => {
    mockApi.getBudgets.mockResolvedValue([]);
    mockActualClient.withActualApi.mockImplementation(async (_userId, _url, _token, fn) => {
      return await fn(mockApi);
    });

    const res = await request(app)
      .post("/tools/call")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "get_accounts", arguments: {} })
      .expect(500);

    expect(res.body.error).toContain("No budgets");
  });
});

describe("MCP JSON-RPC endpoint (/mcp)", () => {
  it("handles initialize", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      .expect(200);
    expect(res.body.jsonrpc).toBe("2.0");
    expect(res.body.id).toBe(1);
    expect(res.body.result.protocolVersion).toBe("2024-11-05");
    expect(res.body.result.capabilities.tools).toBeDefined();
    expect(res.body.result.serverInfo.name).toBe("actualbudget-mcp");
  });

  it("handles notifications/initialized with 204", async () => {
    await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "notifications/initialized" })
      .expect(204);
  });

  it("handles tools/list", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      .expect(200);
    expect(res.body.result.tools).toBeInstanceOf(Array);
    expect(res.body.result.tools.length).toBeGreaterThan(15);
    const names = res.body.result.tools.map(t => t.name);
    expect(names).toContain("list_budgets");
    expect(names).toContain("get_accounts");
  });

  it("handles tools/call with valid auth", async () => {
    const budgets = [{ id: "b1", groupId: "gs1", name: "Test Budget" }];
    mockApi.getBudgets.mockResolvedValue(budgets);

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_budgets", arguments: {} } })
      .expect(200);
    expect(res.body.result.content[0].type).toBe("text");
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(budgets);
  });

  it("returns isError for tools/call without auth", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_budgets", arguments: {} } })
      .expect(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("Authentication required");
  });

  it("returns isError for unknown tool", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "fake_tool", arguments: {} } })
      .expect(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("Unknown tool");
  });

  it("returns error for unknown method", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 6, method: "unknown/method", params: {} })
      .expect(200);
    expect(res.body.error.code).toBe(-32601);
    expect(res.body.error.message).toContain("Method not found");
  });
});
