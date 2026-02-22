import express from "express";
import config from "./config.js";
import { getStatus, create, update, remove } from "./deploy.js";

const app = express();
app.use(express.json());

// API key auth middleware
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

app.use(requireApiKey);

// GET /deployments/:userId — check deployment status
app.get("/deployments/:userId", async (req, res) => {
  try {
    const result = await getStatus(req.params.userId);
    res.json(result);
  } catch (err) {
    console.error("[finance-api] getStatus error:", err);
    res.status(500).json({ error: "Failed to get status", message: err.message });
  }
});

// POST /deployments/:userId — create a new deployment
app.post("/deployments/:userId", async (req, res) => {
  try {
    // Check if already exists
    const current = await getStatus(req.params.userId);
    if (current.status === "running" || current.status === "provisioning") {
      return res.status(409).json({ error: "Deployment already exists", ...current });
    }
    const result = await create(req.params.userId);
    res.status(201).json(result);
  } catch (err) {
    console.error("[finance-api] create error:", err);
    res.status(500).json({ error: "Failed to create deployment", message: err.message });
  }
});

// PUT /deployments/:userId — update to latest image
app.put("/deployments/:userId", async (req, res) => {
  try {
    const result = await update(req.params.userId);
    res.json(result);
  } catch (err) {
    console.error("[finance-api] update error:", err);
    res.status(500).json({ error: "Failed to update deployment", message: err.message });
  }
});

// DELETE /deployments/:userId — delete deployment
app.delete("/deployments/:userId", async (req, res) => {
  try {
    const result = await remove(req.params.userId);
    res.json(result);
  } catch (err) {
    console.error("[finance-api] delete error:", err);
    res.status(500).json({ error: "Failed to delete deployment", message: err.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "finance-api" });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`finance-api listening on :${config.port}`);
});

export default app;
