const config = {
  port: Number(process.env.PORT) || 8090,
  // auth-api JWT secret (for validating user identity from Foundry headers)
  jwtSecret: process.env.JWT_SECRET || "change-me",
  // finance-api URL + API key (for looking up user's AB instance + service token)
  financeApiUrl: process.env.FINANCE_API_URL || "",
  financeApiKey: process.env.FINANCE_API_KEY || "dev-finance-key",
  // Temp directory for @actual-app/api data
  actualDataDir: process.env.ACTUAL_DATA_DIR || "/tmp/actual-data",
};

export default config;
