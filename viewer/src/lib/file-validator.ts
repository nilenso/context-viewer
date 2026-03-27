import { SUPPORTED_EXTENSIONS, SUPPORTED_EXTENSIONS_TEXT } from "context-analyzer";

export { SUPPORTED_EXTENSIONS_TEXT };

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
