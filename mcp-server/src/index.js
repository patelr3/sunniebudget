import "./tracing.js"; // must be first — initializes OTel before Express loads
import { createApp } from "./server.js";
import config from "./config.js";
import logger from "./logger.js";

// Prevent unhandled promise rejections from crashing the process.
// @actual-app/api internals can throw async errors (e.g., during budget
// load/close) that escape our try/catch in the request handler.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

const app = createApp();
app.listen(config.port, "0.0.0.0", () => {
  logger.info("MCP server started", { port: config.port });
});
