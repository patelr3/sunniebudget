// Manages @actual-app/api connections to per-user ActualBudget instances.
// Each connection is short-lived (per tool call) to keep the MCP server stateless.
import * as api from "@actual-app/api";
import fs from "fs/promises";
import path from "path";
import config from "./config.js";

// Fetch user's AB instance URL and service token from finance-api
export async function getUserInstance(userId) {
  if (!config.financeApiUrl) {
    throw new Error("FINANCE_API_URL not configured");
  }

  // Get deployment status
  const statusRes = await fetch(`${config.financeApiUrl}/deployments/${userId}`, {
    headers: { "X-Api-Key": config.financeApiKey },
  });
  if (!statusRes.ok) {
    throw new Error(`Failed to get deployment status: ${statusRes.status}`);
  }
  const status = await statusRes.json();
  if (status.status !== "running") {
    throw new Error(`ActualBudget instance is not running (status: ${status.status})`);
  }

  // Get service token
  const tokenRes = await fetch(`${config.financeApiUrl}/deployments/${userId}/token`, {
    headers: { "X-Api-Key": config.financeApiKey },
  });
  if (!tokenRes.ok) {
    if (tokenRes.status === 404) {
      throw new Error("Service token not found — instance may not be bootstrapped yet");
    }
    throw new Error(`Failed to get service token: ${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json();

  return {
    serverUrl: tokenData.fqdn || status.fqdn,
    sessionToken: tokenData.token,
  };
}

// Execute a function with an initialized @actual-app/api connection
export async function withActualApi(userId, serverUrl, sessionToken, fn) {
  // Create isolated data directory per user
  const dataDir = path.join(config.actualDataDir, `user-${userId}`);
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await api.init({
      dataDir,
      serverURL: serverUrl,
    });

    // Set the pre-existing session token (init only accepts password, not token)
    await api.internal.send('subscribe-set-token', { token: sessionToken });

    return await fn(api);
  } finally {
    try {
      await api.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  }
}
