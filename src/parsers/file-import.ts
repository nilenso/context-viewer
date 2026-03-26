/**
 * Parse file drop input: detect session exports, file exports, and plain files.
 */

import { SessionExportSchema, FileExportSchema } from "@/model/export-schema";
import { recordCall } from "@/lib/session-recorder";

interface FileDropResult {
  filesToProcess: File[];
  oldIdToIndex: Map<string, number>;
  sessionGroups: Array<{ id: string; name: string; title?: string; fileIds: string[] }>;
}

export async function parseFileDropInput(files: File[]): Promise<FileDropResult> {
  return recordCall("parsers/file-import", "parseFileDropInput", [{ fileCount: files.length, fileNames: files.map(f => f.name) }], () => _parseFileDropInput(files));
}

async function _parseFileDropInput(files: File[]): Promise<FileDropResult> {
  const filesToProcess: File[] = [];
  const oldIdToIndex = new Map<string, number>();
  let sessionGroups: Array<{ id: string; name: string; title?: string; fileIds: string[] }> = [];

  for (const file of files) {
    if (file.name.endsWith(".json")) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        const sessionResult = SessionExportSchema.safeParse(data);
        if (sessionResult.success) {
          const startIndex = filesToProcess.length;
          for (let i = 0; i < sessionResult.data.files.length; i++) {
            const fileExport = sessionResult.data.files[i]!;
            oldIdToIndex.set(fileExport.id, startIndex + i);
            const blob = new Blob([JSON.stringify(fileExport)], { type: "application/json" });
            const virtualFile = new File([blob], fileExport.filename + ".json", { type: "application/json" });
            filesToProcess.push(virtualFile);
          }
          sessionGroups = sessionResult.data.groups;
          continue;
        }

        const fileResult = FileExportSchema.safeParse(data);
        if (fileResult.success) {
          filesToProcess.push(file);
          continue;
        }
      } catch {
        // JSON parse error, process normally
      }
    }
    filesToProcess.push(file);
  }

  return { filesToProcess, oldIdToIndex, sessionGroups };
}
