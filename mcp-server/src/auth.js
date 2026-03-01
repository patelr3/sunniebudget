// Validates user identity from Authorization header (JWT issued by auth-api)
import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import config from "./config.js";

// Lazily initialised JWKS client (only when OIDC_JWKS_URL is configured)
let jwksClient = null;

function getJwksClient() {
  if (!jwksClient && config.oidcJwksUrl) {
    jwksClient = jwksRsa({
      jwksUri: config.oidcJwksUrl,
      cache: true,
      cacheMaxEntries: 5,
      jwksRequestsPerMinute: 5,
    });
  }
  return jwksClient;
}

function extractClaims(payload) {
  return {
    userId: payload.sub,
    email: payload.email || payload.preferred_username,
    name: payload.name,
    role: payload.role,
  };
}

export async function validateAuth(headers) {
  const authHeader = headers?.authorization || headers?.Authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);

  // Fast path: try HS256 verification with shared secret
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    console.log("[auth] Validated token via HS256");
    return extractClaims(payload);
  } catch {
    // HS256 failed — fall through to RS256 if configured
  }

  // Fallback: try RS256 verification via OIDC JWKS
  if (config.oidcJwksUrl) {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (decoded?.header?.alg === "RS256" && decoded.header.kid) {
        const client = getJwksClient();
        const key = await client.getSigningKey(decoded.header.kid);
        const publicKey = key.getPublicKey();
        const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
        console.log("[auth] Validated token via RS256 (OIDC)");
        return extractClaims(payload);
      }
    } catch {
      // RS256 also failed
    }
  }

  throw new AuthError("Invalid or expired JWT");
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}
