#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "../src/server.mjs";

void serveStdio(createServer);
if (process.env.JEVSTEER_LOG === "1") console.error("[jevsteer] MCP server running on stdio");
