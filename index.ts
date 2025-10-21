#!/usr/bin/env bun

import { readFile } from "fs/promises";
import { parserRegistry } from "./src/parser";
import "./src/parsers"; // Register all parsers
import { summarizeConversation } from "./src/conversation-summary";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run index.ts <path-to-json-file>");
    console.error("\nExample:");
    console.error("  bun run index.ts sample-logs/responses/1.json");
    console.error("  bun run index.ts sample-logs/completions/1.json");
    process.exit(1);
  }

  const filePath = args[0];

  try {
    // Read the file
    const fileContent = await readFile(filePath, "utf-8");
    const data = JSON.parse(fileContent);

    // Parse using the appropriate parser
    const conversation = parserRegistry.parse(data);

    // Print the parsed result
    console.log(JSON.stringify(conversation, null, 2));

    // Print summary statistics
    console.error("\n=== Summary ===");
    const summary = summarizeConversation(conversation);
    console.error(`Total messages: ${summary.totalMessages}`);

    console.error("\nMessages by role:");
    for (const [role, count] of Object.entries(summary.messagesByRole)) {
      console.error(`  ${role}: ${count}`);
    }

    // Count content types
    console.error("\nContent structure:");
    console.error(`  String content: ${summary.stringContentCount}`);
    console.error(`  Multipart content: ${summary.multipartContentCount}`);

    if (Object.keys(summary.partCounts).length > 0) {
      console.error("\nParts by type:");
      for (const [type, count] of Object.entries(summary.partCounts)) {
        console.error(`  ${type}: ${count}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Unknown error occurred");
    }
    process.exit(1);
  }
}

main();
