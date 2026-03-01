const config = {
  port: Number(process.env.PORT) || 8090,
  // Firebase project ID for token validation
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
  // OIDC JWKS URL for RS256 token validation (fallback for auth-api OIDC tokens)
  oidcJwksUrl: process.env.OIDC_JWKS_URL || null,
  // finance-api URL + API key (for looking up user's AB instance + service token)
  financeApiUrl: process.env.FINANCE_API_URL || "",
  financeApiKey: process.env.FINANCE_API_KEY || "dev-finance-key",
  // Temp directory for @actual-app/api data
  actualDataDir: process.env.ACTUAL_DATA_DIR || "/tmp/actual-data",
};

export default config;
