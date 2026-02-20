#!/usr/bin/env node

/**
 * Simple test script to verify MCP server functionality
 * This simulates MCP protocol interactions with the server
 */

import { spawn } from "child_process";
import { resolve } from "path";
import fs from "fs";

const serverPath = resolve("./dist/index.js");

function sendMessage(server, message) {
  const jsonMessage = JSON.stringify(message) + "\n";
  server.stdin.write(jsonMessage);
}

function runTest() {
  console.log("Starting MCP Mediachips server test...\n");

  const server = spawn("node", [serverPath], {
    env: { ...process.env, MEDIACHIPS_DB_PATH: "./test-db.sqlite" },
  });

  let responseData = "";

  server.stdout.on("data", (data) => {
    const text = data.toString();
    responseData += text;
    console.log("Server stdout:", text);
  });

  server.stderr.on("data", (data) => {
    console.error("Server stderr:", data.toString());
  });

  server.on("close", (code) => {
    console.log(`\nServer exited with code ${code}`);
  });

  setTimeout(() => {
    console.log("\n=== Test 1: List available tools ===");
    sendMessage(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
  }, 1000);

  setTimeout(() => {
    console.log("\n=== Test 2: Create media item ===");
    sendMessage(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_media_item",
        arguments: {
          title: "Test Video",
          url: "https://example.com/test.mp4",
          type: "video",
          description: "A test video item",
          tags: "test,demo",
        },
      },
    });
  }, 2000);

  setTimeout(() => {
    console.log("\n=== Test 3: Read media items ===");
    sendMessage(server, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "read_media_items",
        arguments: {},
      },
    });
  }, 3000);

  setTimeout(() => {
    console.log("\n=== Cleaning up and exiting ===");
    server.kill("SIGINT");
    
    setTimeout(() => {
      if (fs.existsSync("./test-db.sqlite")) {
        fs.unlinkSync("./test-db.sqlite");
        console.log("Test database cleaned up");
      }
      process.exit(0);
    }, 1000);
  }, 5000);
}

runTest();
