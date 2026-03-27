/**
 * Shared test helpers.
 */
import fs from "fs";
import path from "path";
import { parseFileContent } from "../parsers/file-formats";
import { parserRegistry } from "../parsers/parser";
import "../parsers/index";

const INPUTS_DIR = path.resolve(__dirname, "fixtures/inputs");
const RECORDINGS_DIR = path.resolve(__dirname, "fixtures/recordings");

/** Load a conversation input file and return raw text */
export function loadArtifact(filename: string): { text: string; filename: string } {
  const filepath = path.join(INPUTS_DIR, filename);
  const text = fs.readFileSync(filepath, "utf-8");
  return { text, filename };
}

/** Load and parse a conversation input file into a Conversation + metadata */
export function loadParsedArtifact(filename: string) {
  const { text } = loadArtifact(filename);
  const data = parseFileContent(text, filename);
  return parserRegistry.parseWithMetadata(data);
}

/** Load a session recording JSON file */
export function loadRecording(filename: string): any {
  const filepath = path.join(RECORDINGS_DIR, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}
