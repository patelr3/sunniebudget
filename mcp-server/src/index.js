import "./tracing.js"; // must be first — initializes OTel before Express loads
import { createApp } from "./server.js";
import config from "./config.js";
import logger from "./logger.js";

const app = createApp();
app.listen(config.port, "0.0.0.0", () => {
  logger.info("MCP server started", { port: config.port });
});
