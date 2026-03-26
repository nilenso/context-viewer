/**
 * Shared test helpers. Loads the actual files used in session recordings
 * so that recording results can be used as ground-truth assertions.
 *
 * Fixtures layout:
 *   src/__tests__/fixtures/inputs/       — conversation files processed in the recordings
 *   src/__tests__/fixtures/recordings/   — session recording JSON files
 */
import fs from "fs";
import path from "path";
import { parseFileContent } from "@/parsers/file-formats";
import { parserRegistry } from "@/parsers/parser";
import "@/parsers/index";

const INPUTS_DIR = path.resolve(__dirname, "fixtures/inputs");
const RECORDINGS_DIR = path.resolve(__dirname, "fixtures/recordings");

/** Load a conversation input file and return raw text + File object */
export function loadArtifact(filename: string): { text: string; file: File } {
  const filepath = path.join(INPUTS_DIR, filename);
  const text = fs.readFileSync(filepath, "utf-8");
  return { text, file: new File([text], filename) };
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


