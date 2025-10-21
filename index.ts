#!/usr/bin/env bun

import { readFile } from "fs/promises";
import { parserRegistry } from "./src/parser";
import "./src/parsers"; // Register all parsers

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
    console.error(`Total messages: ${conversation.messages.length}`);

    console.error("\nMessages by role:");
    const roleCount = conversation.messages.reduce((acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    for (const [role, count] of Object.entries(roleCount)) {
      console.error(`  ${role}: ${count}`);
    }

    // Count content types
    console.error("\nContent structure:");
    let stringContent = 0;
    let multipartContent = 0;
    const partTypes: Record<string, number> = {};

    for (const msg of conversation.messages) {
      if (typeof msg.content === "string") {
        stringContent++;
      } else {
        multipartContent++;
        for (const part of msg.content) {
          partTypes[part.type] = (partTypes[part.type] || 0) + 1;
        }
      }
    }

    console.error(`  String content: ${stringContent}`);
    console.error(`  Multipart content: ${multipartContent}`);

    if (Object.keys(partTypes).length > 0) {
      console.error("\nParts by type:");
      for (const [type, count] of Object.entries(partTypes)) {
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
