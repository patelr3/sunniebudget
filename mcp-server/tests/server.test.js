import { jest } from "@jest/globals";

// Set env vars before any imports (auth.js requires OIDC_JWKS_URL at module load)
process.env.OIDC_JWKS_URL = "https://example.com/.well-known/jwks.json";

// Mock jose to control token validation without needing real JWKS endpoints
const mockJwtVerify = jest.fn();

jest.unstable_mockModule("jose", () => ({
  createRemoteJWKSet: jest.fn(() => "mock-jwks"),
  jwtVerify: mockJwtVerify,
}));

function makeToken(payload = {}) {
  const claims = { sub: "42", email: "test@test.com", name: "Test", role: "user", ...payload };
  return "fake-oidc-token-" + JSON.stringify(claims);
}

// Mock @actual-app/api
const mockApi = {
  init: jest.fn(),
  shutdown: jest.fn(),
  getBudgets: jest.fn(),
  downloadBudget: jest.fn(),
  getBudgetMonth: jest.fn(),
  getBudgetMonths: jest.fn(),
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
  // OIDC-only auth: mock jose to validate tokens by extracting embedded claims
  mockJwtVerify.mockImplementation(async (token, _jwks) => {
    if (token.startsWith("fake-oidc-token-")) {
      return { payload: JSON.parse(token.slice("fake-oidc-token-".length)) };
    }
    throw new Error("Invalid token");
  });
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
  mockApi.getBudgetMonths.mockResolvedValue(["2026-01", "2026-02", "2026-03"]);
});

// Helper: make MCP JSON-RPC tool call
function mcpToolCall(app, token, toolName, args = {}) {
  const req = request(app)
    .post("/mcp")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args } });
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req;
}

describe("Health endpoint", () => {
  it("returns 200 with tool count", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("actualbudget-mcp-server");
    expect(res.body.tools).toBeGreaterThan(0);
  });
});

describe("OIDC Authentication", () => {
  it("rejects requests without Authorization header", async () => {
    const res = await mcpToolCall(app, null, "list_budgets").expect(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("Authentication required");
  });

  it("rejects invalid token", async () => {
    const res = await mcpToolCall(app, "invalid-token", "list_budgets").expect(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("Authentication required");
  });

  it("accepts valid OIDC token", async () => {
    mockApi.getBudgets.mockResolvedValue([{ id: "b1", groupId: "gs1", name: "Budget" }]);
    const res = await mcpToolCall(app, makeToken(), "list_budgets").expect(200);
    expect(res.body.result.content).toBeDefined();
    expect(res.body.result.isError).toBeUndefined();
  });

  it("extracts preferred_username as email fallback", async () => {
    mockApi.getBudgets.mockResolvedValue([{ id: "b1", groupId: "gs1", name: "Budget" }]);
    const token = makeToken({ email: undefined, preferred_username: "oidcuser@example.com" });
    await mcpToolCall(app, token, "list_budgets").expect(200);
    expect(mockActualClient.getUserInstance).toHaveBeenCalledWith("42");
  });

  it("rejects token when JWKS validation fails", async () => {
    mockJwtVerify.mockRejectedValue(new Error("Key not found"));
    const res = await mcpToolCall(app, makeToken(), "list_budgets").expect(200);
    expect(res.body.result.isError).toBe(true);
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

  it("returns error for unknown method", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 6, method: "unknown/method", params: {} })
      .expect(200);
    expect(res.body.error.code).toBe(-32601);
    expect(res.body.error.message).toContain("Method not found");
  });
});

describe("Tool: list_budgets", () => {
  it("returns budgets from the user's instance", async () => {
    const budgets = [
      { id: "b1", groupId: "gs1", name: "Personal" },
      { id: "b2", groupId: "gs2", name: "Business" },
    ];
    mockApi.getBudgets.mockResolvedValue(budgets);

    const res = await mcpToolCall(app, makeToken(), "list_budgets").expect(200);
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(budgets);
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

    const res = await mcpToolCall(app, makeToken(), "get_accounts").expect(200);
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(accounts);
    expect(mockApi.downloadBudget).toHaveBeenCalledWith("sync-1");
  });
});

describe("Tool: create_account", () => {
  it("creates an account with correct parameters", async () => {
    mockApi.createAccount.mockResolvedValue("new-acc-id");

    const res = await mcpToolCall(app, makeToken(), "create_account", {
      name: "New Checking", type: "checking", balance: 100.50,
    }).expect(200);

    const result = JSON.parse(res.body.result.content[0].text);
    expect(result.id).toBe("new-acc-id");
    expect(result.name).toBe("New Checking");
    expect(mockApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Checking", type: "checking" }),
      10050
    );
  });
});

describe("Tool: get_transactions", () => {
  it("returns transactions with filters", async () => {
    const txns = [{ id: "t1", amount: -5000, payee: "Store" }];
    mockApi.getTransactions.mockResolvedValue(txns);

    const res = await mcpToolCall(app, makeToken(), "get_transactions", {
      accountId: "acc1", startDate: "2025-01-01", endDate: "2025-01-31",
    }).expect(200);

    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(txns);
    expect(mockApi.getTransactions).toHaveBeenCalledWith("acc1", "2025-01-01", "2025-01-31");
  });
});

describe("Tool: create_transaction", () => {
  it("creates a transaction with amount conversion", async () => {
    mockApi.addTransactions.mockResolvedValue(["txn-new"]);

    const res = await mcpToolCall(app, makeToken(), "create_transaction", {
      accountId: "acc1", date: "2025-06-15", amount: -42.99,
      payeeName: "Coffee Shop", notes: "Morning latte",
    }).expect(200);

    const result = JSON.parse(res.body.result.content[0].text);
    expect(result.created).toBe(true);
    expect(mockApi.addTransactions).toHaveBeenCalledWith("acc1", [
      expect.objectContaining({
        account: "acc1", date: "2025-06-15", amount: -4299,
        payee_name: "Coffee Shop", notes: "Morning latte",
      }),
    ]);
  });
});

describe("Tool: update_transaction", () => {
  it("updates transaction fields", async () => {
    mockApi.updateTransaction.mockResolvedValue(undefined);

    const res = await mcpToolCall(app, makeToken(), "update_transaction", {
      id: "txn-1", amount: -25.00, notes: "Updated",
    }).expect(200);

    const result = JSON.parse(res.body.result.content[0].text);
    expect(result.updated).toBe(true);
    expect(mockApi.updateTransaction).toHaveBeenCalledWith("txn-1", expect.objectContaining({
      id: "txn-1", amount: -2500, notes: "Updated",
    }));
  });
});

describe("Tool: delete_transaction", () => {
  it("deletes a transaction", async () => {
    mockApi.deleteTransaction.mockResolvedValue(undefined);

    const res = await mcpToolCall(app, makeToken(), "delete_transaction", { id: "txn-del" }).expect(200);
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result.deleted).toBe(true);
    expect(mockApi.deleteTransaction).toHaveBeenCalledWith("txn-del");
  });
});

describe("Tool: get_categories", () => {
  it("returns categories", async () => {
    const cats = [{ id: "cat1", name: "Food", group_id: "g1" }];
    mockApi.getCategories.mockResolvedValue(cats);

    const res = await mcpToolCall(app, makeToken(), "get_categories").expect(200);
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(cats);
  });
});

describe("Tool: create_category", () => {
  it("creates a category in a group", async () => {
    mockApi.createCategory.mockResolvedValue("cat-new");

    const res = await mcpToolCall(app, makeToken(), "create_category", {
      name: "Dining", groupId: "food-group",
    }).expect(200);

    const result = JSON.parse(res.body.result.content[0].text);
    expect(result.id).toBe("cat-new");
    expect(mockApi.createCategory).toHaveBeenCalledWith({ name: "Dining", group_id: "food-group" });
  });
});

describe("Tool: get_payees", () => {
  it("returns payees", async () => {
    const payees = [{ id: "p1", name: "Amazon" }];
    mockApi.getPayees.mockResolvedValue(payees);

    const res = await mcpToolCall(app, makeToken(), "get_payees").expect(200);
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(payees);
  });
});

describe("Tool: get_schedules", () => {
  it("returns schedules", async () => {
    const scheds = [{ id: "s1", frequency: "monthly" }];
    mockApi.getSchedules.mockResolvedValue(scheds);

    const res = await mcpToolCall(app, makeToken(), "get_schedules").expect(200);
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(scheds);
  });
});

describe("Tool: get_rules", () => {
  it("returns rules", async () => {
    const rules = [{ id: "r1", conditions_op: "and" }];
    mockApi.getRules.mockResolvedValue(rules);

    const res = await mcpToolCall(app, makeToken(), "get_rules").expect(200);
    const result = JSON.parse(res.body.result.content[0].text);
    expect(result).toEqual(rules);
  });
});

describe("Unknown tool", () => {
  it("returns isError for unknown tool name", async () => {
    const res = await mcpToolCall(app, makeToken(), "nonexistent_tool").expect(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("Unknown tool");
  });
});

describe("Error handling", () => {
  it("returns isError when AB instance is not running", async () => {
    mockActualClient.getUserInstance.mockRejectedValue(new Error("Deployment not found"));
    mockActualClient.withActualApi.mockImplementation(async () => {
      await mockActualClient.getUserInstance();
    });

    const res = await mcpToolCall(app, makeToken(), "get_accounts").expect(200);
    expect(res.body.result.isError).toBe(true);
  });

  it("returns isError when no budgets exist", async () => {
    mockApi.getBudgets.mockResolvedValue([]);
    mockActualClient.withActualApi.mockImplementation(async (_userId, _url, _token, fn) => {
      return await fn(mockApi);
    });

    const res = await mcpToolCall(app, makeToken(), "get_accounts").expect(200);
    expect(res.body.result.content[0].text).toContain("No budgets");
    expect(res.body.result.isError).toBe(true);
  });

  it("returns isError when downloadBudget fails", async () => {
    mockApi.downloadBudget.mockRejectedValue(new Error("No budget file is open"));
    mockActualClient.withActualApi.mockImplementation(async (_userId, _url, _token, fn) => {
      return await fn(mockApi);
    });

    const res = await mcpToolCall(app, makeToken(), "get_accounts").expect(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("Failed to load budget");
  });
});
