// Validates user identity from Authorization header (JWT issued by auth-api)
import jwt from "jsonwebtoken";
import config from "./config.js";

export function validateAuth(headers) {
  const authHeader = headers?.authorization || headers?.Authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    throw new AuthError("Invalid or expired JWT");
  }
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}
