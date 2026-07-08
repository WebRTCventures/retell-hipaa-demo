import express from "express";
import { createServer } from "node:http";
import { attachWebSocketServer } from "./websocket-handler.js";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

const server = createServer(app);

attachWebSocketServer(server);

server.listen(8080, () => {
  console.log("Custom LLM Server listening on port 8080");
});
