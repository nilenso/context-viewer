/**
 * File format definitions - the single source of truth for
 * what file types the app accepts and how to parse them.
 */

export interface FileFormat {
  extensions: string[];
  parse: (text: string) => unknown;
}

// Plain text format (.txt, .md)
const plainTextFormat: FileFormat = {
  extensions: [".txt", ".md"],
  parse: (text) => text,
};

// JSONL format (.jsonl)
const jsonlFormat: FileFormat = {
  extensions: [".jsonl"],
  parse: (text) => {
    const lines = text.trim().split("\n");
    return lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
  },
};

// JSON format (.json)
const jsonFormat: FileFormat = {
  extensions: [".json"],
  parse: (text) => JSON.parse(text),
};

// All formats in priority order
const FILE_FORMATS: FileFormat[] = [plainTextFormat, jsonlFormat, jsonFormat];

// Derived: all supported extensions
export const SUPPORTED_EXTENSIONS = FILE_FORMATS.flatMap((f) => f.extensions);

// Derived: human-readable description
export const SUPPORTED_EXTENSIONS_TEXT = SUPPORTED_EXTENSIONS.join(", ");

// Validator for dropzone
export function createFileValidator() {
  return (file: File) => {
    const ext = file.name
      ? "." + (file.name.split(".").pop()?.toLowerCase() || "")
      : "";
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return {
        code: "file-invalid-type",
        message: `File type not supported. Accepted: ${SUPPORTED_EXTENSIONS_TEXT}`,
      };
    }
    return null;
  };
}

// Parse file content based on extension
export function parseFileContent(text: string, filename: string): unknown {
  const ext = "." + (filename.split(".").pop()?.toLowerCase() || "");

  // Find format by extension
  const format = FILE_FORMATS.find((f) => f.extensions.includes(ext));
  if (format) {
    return format.parse(text);
  }

  // Fallback: try JSONL detection by content (backwards compat)
  if (text.trim().startsWith("{") && text.includes("\n{")) {
    return jsonlFormat.parse(text);
  }

  // Default to JSON
  return jsonFormat.parse(text);
}
