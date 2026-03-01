// Validates user identity from Authorization header (OIDC token from Foundry OAuth identity passthrough)
import { createRemoteJWKSet, jwtVerify } from "jose";
import config from "./config.js";
import logger from "./logger.js";

// OIDC JWKS validation — tokens issued by auth-api OIDC IdP, forwarded by Foundry
if (!config.oidcJwksUrl) {
  throw new Error("OIDC_JWKS_URL is required — MCP server validates OIDC tokens from Foundry OAuth identity passthrough");
}
const oidcJwks = createRemoteJWKSet(new URL(config.oidcJwksUrl));

function extractClaims(payload) {
  return {
    userId: String(payload.sub),
    email: payload.email || payload.preferred_username,
    name: payload.name,
    role: payload.role || "user",
  };
}

export async function validateAuth(headers) {
  const authHeader = headers?.authorization || headers?.Authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, oidcJwks);
    logger.info("Auth validated via OIDC JWKS", { sub: payload.sub, email: payload.email });
    return extractClaims(payload);
  } catch (err) {
    logger.warn("OIDC JWKS validation failed", { error: err.message });
    throw new AuthError("Invalid or expired token");
  }
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}
