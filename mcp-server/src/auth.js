// Validates user identity from Authorization header (Firebase ID token or OIDC token)
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import config from "./config.js";
import logger from "./logger.js";

// Firebase token validation via Google's public keys
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const FIREBASE_JWKS = createRemoteJWKSet(new URL(GOOGLE_CERTS_URL));

// OIDC JWKS validation (for tokens from auth-api OIDC IdP)
let oidcJwks = null;
function getOidcJwks() {
  if (!oidcJwks && config.oidcJwksUrl) {
    oidcJwks = createRemoteJWKSet(new URL(config.oidcJwksUrl));
  }
  return oidcJwks;
}

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

  // Try Firebase ID token validation first
  if (config.firebaseProjectId) {
    try {
      const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
        issuer: `https://securetoken.google.com/${config.firebaseProjectId}`,
        audience: config.firebaseProjectId,
      });
      logger.info("Auth validated via Firebase", { sub: payload.sub, email: payload.email });
      return extractClaims(payload);
    } catch (err) {
      logger.info("Firebase validation failed, trying OIDC", { error: err.message });
    }
  }

  // Fallback: try OIDC JWKS validation (for auth-api issued OIDC tokens)
  const jwks = getOidcJwks();
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks);
      logger.info("Auth validated via OIDC JWKS", { sub: payload.sub, email: payload.email });
      return extractClaims(payload);
    } catch (err) {
      logger.warn("OIDC JWKS validation failed", { error: err.message });
    }
  }

  logger.warn("Auth failed: no valid token", { hasFirebase: !!config.firebaseProjectId, hasOidcJwks: !!config.oidcJwksUrl });
  throw new AuthError("Invalid or expired token");
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}
