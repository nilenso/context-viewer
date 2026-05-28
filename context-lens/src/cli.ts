#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  analyze2,
  buildSessionExport,
  type Analyze2Options,
  type AnalyzerConfig,
  type AIApiMode,
  type Group,
  type Interceptor,
  type ReasoningEffort,
  type Stage,
} from "context-analyzer";

const HELP = `context-lens — analyze AI conversation transcripts

Usage:
  context-lens --spec <path|-> [options] <transcript...>
  context-lens --help

Agents should inspect the user's request and transcripts first, then provide
an analysis spec: segmentation instructions, dimensions, component descriptions,
and colors. Choose dimension names that directly help investigate what the user
asked. Do not default to generic code-area axes unless that is the user's
question. For compaction, useful dimensions might be retention_value or
information_type; for process analysis, activity_type; for source mix,
context_source. context-lens appends the low-level JSON output requirements for
segmentation.

Canonical invocation; replace the dimension/components with ones chosen for the
user's investigation:
  context-lens --spec - session.jsonl <<'JSON'
  {
    "segmentation": {
      "threshold": 500,
      "prompt": "Split large message parts into chunks that preserve the evidence needed for the user's investigation."
    },
    "dimensions": [{
      "name": "dimension_chosen_for_this_question",
      "components": [
        { "name": "component_a", "description": "Specific criterion for assigning transcript parts to component_a." },
        { "name": "component_b", "description": "Specific criterion for assigning transcript parts to component_b." },
        { "name": "component_c", "description": "Specific criterion for assigning transcript parts to component_c." }
      ]
    }],
    "colors": {
      "dimension_chosen_for_this_question": {
        "component_a": "#2563eb",
        "component_b": "#16a34a",
        "component_c": "#f59e0b"
      }
    }
  }
  JSON

Spec interface:
  segmentation?: { threshold?: number, prompt?: string }
  dimensions?: [{ name: string, components: [{ name: string, description: string }] }]
  colors?: { [dimensionName]: { [componentName]: "#rrggbb" } }

Options:
  --spec <path|->                 Read analysis spec from file or stdin
  --api-key <key>                 API key for one-off use
  --model <model>                 Default: gpt-5.4-mini
  --base-url <url>                OpenAI-compatible base URL
  --api-mode <responses|chat>     Default: responses
  --reasoning-effort <level>      none, low, medium, high
  --log-level <level>             silent, info, debug
  -h, --help                      Show this help

API key setup:
  context-lens reads ~/.context-lens/.env. If it does not exist, run:
  mkdir -p ~/.context-lens && printf 'OPENAI_API_KEY=%s\\nOPENAI_MODEL=gpt-5.4-mini\\n' 'sk-REPLACE_WITH_YOUR_OPENAI_KEY' > ~/.context-lens/.env && chmod 600 ~/.context-lens/.env

API key lookup order:
  --api-key, OPENAI_API_KEY, VITE_AI_API_KEY, AI_API_KEY, ~/.context-lens/.env

Output:
  stdout: analytics JSON with exportPath and contextViewerUrlTemplate.
  stderr: progress.

Share:
  Upload exportPath as a secret gist, replace RAW_URL in
  contextViewerUrlTemplate with the gist raw_url, and give the user only:
  [Open in Context Viewer](<viewer-url>)
  For multiple files this link opens the comparison tab automatically.

Optional display names:
  Before uploading, you may edit exportPath to improve viewer labels:
  set files[].title and groups[].title. Keep ids/fileIds unchanged.

Also present the result as a Markdown waffle-chart comparison:
  - Use the analytics as datasets: each has label/title, total value, and
    components with name, color/emoji if provided, value, and percentage.
  - Render one 10x10 waffle grid per dataset, vertically one below another.
  - Each marker is about 1%; round to whole markers but make exactly 100.
  - Keep each component contiguous; order by descending percentage unless an
    order is provided.
  - Use exact assigned emoji/color when provided. Otherwise assign consistent,
    visually distinct markers across all datasets, preferring squares first:
    🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜, then circles, then hearts.
  - After all waffles, render one combined comparison table containing every
    component in any dataset. Columns: Component, then for each dataset value
    and percentage. Missing components are 0 and 0%.
  - Preserve exact component names and dataset labels.
  - After the waffle comparison, provide a concise interpretation of the most
    important differences.
`;

interface CliArgs {
  help: boolean;
  specPath?: string;
  files: string[];
  apiKey?: string;
  model?: string;
  baseURL?: string;
  apiMode?: AIApiMode;
  reasoningEffort?: ReasoningEffort;
  logLevel?: AnalyzerConfig["logLevel"];
}

type Spec = Omit<Analyze2Options, "files" | "sessionId" | "interceptors">;

type EnvValues = Record<string, string>;

const CONTEXT_LENS_ENV_PATH = path.join(homedir(), ".context-lens", ".env");
const API_KEY_SETUP_COMMAND = "mkdir -p ~/.context-lens && printf 'OPENAI_API_KEY=%s\\nOPENAI_MODEL=gpt-5.4-mini\\n' 'sk-REPLACE_WITH_YOUR_OPENAI_KEY' > ~/.context-lens/.env && chmod 600 ~/.context-lens/.env";

function printHelp(): void {
  console.log(HELP);
}

function fail(message: string): never {
  console.error(`context-lens: ${message}\n`);
  console.error("Run `context-lens --help` for usage.");
  process.exit(1);
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, files: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--spec":
        args.specPath = takeValue(argv, i, arg);
        i++;
        break;
      case "--api-key":
        args.apiKey = takeValue(argv, i, arg);
        i++;
        break;
      case "--model":
        args.model = takeValue(argv, i, arg);
        i++;
        break;
      case "--base-url":
        args.baseURL = takeValue(argv, i, arg);
        i++;
        break;
      case "--api-mode": {
        const value = takeValue(argv, i, arg);
        if (value !== "responses" && value !== "chat") fail("--api-mode must be 'responses' or 'chat'");
        args.apiMode = value;
        i++;
        break;
      }
      case "--reasoning-effort": {
        const value = takeValue(argv, i, arg);
        if (!["none", "low", "medium", "high"].includes(value)) {
          fail("--reasoning-effort must be one of: none, low, medium, high");
        }
        args.reasoningEffort = value as ReasoningEffort;
        i++;
        break;
      }
      case "--log-level": {
        const value = takeValue(argv, i, arg);
        if (!["silent", "info", "debug"].includes(value)) fail("--log-level must be one of: silent, info, debug");
        args.logLevel = value as AnalyzerConfig["logLevel"];
        i++;
        break;
      }
      default:
        if (arg.startsWith("-")) fail(`unknown option: ${arg}`);
        args.files.push(arg);
    }
  }

  return args;
}

function parseDotEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const equals = withoutExport.indexOf("=");
  if (equals <= 0) return null;
  const key = withoutExport.slice(0, equals).trim();
  let value = withoutExport.slice(equals + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

async function loadContextLensEnv(): Promise<EnvValues | null> {
  if (!existsSync(CONTEXT_LENS_ENV_PATH)) return null;
  const values: EnvValues = {};
  const text = await readFile(CONTEXT_LENS_ENV_PATH, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    values[key] = value;
  }
  return values;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readSpec(specPath: string): Promise<Spec> {
  const text = specPath === "-" ? await readStdin() : await readFile(specPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`could not parse spec JSON: ${detail}`);
  }
  validateSpec(parsed);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSpec(value: unknown): asserts value is Spec {
  if (!isRecord(value)) fail("spec must be a JSON object");
  if ("files" in value) fail("spec must not include files; pass transcript files as positional arguments");
  if ("sessionId" in value) fail("sessions are not part of the context-lens CLI interface");
  if ("interceptors" in value) fail("interceptors are not part of the context-lens CLI interface");

  if (value.segmentation !== undefined) {
    if (!isRecord(value.segmentation)) fail("segmentation must be an object");
    if (value.segmentation.threshold !== undefined && typeof value.segmentation.threshold !== "number") {
      fail("segmentation.threshold must be a number");
    }
    if (value.segmentation.prompt !== undefined && typeof value.segmentation.prompt !== "string") {
      fail("segmentation.prompt must be a string");
    }
  }

  if (value.dimensions !== undefined) {
    if (!Array.isArray(value.dimensions)) fail("dimensions must be an array");
    for (const [dimIndex, dim] of value.dimensions.entries()) {
      if (!isRecord(dim)) fail(`dimensions[${dimIndex}] must be an object`);
      if (typeof dim.name !== "string" || dim.name.length === 0) fail(`dimensions[${dimIndex}].name must be a non-empty string`);
      if (!Array.isArray(dim.components)) fail(`dimensions[${dimIndex}].components must be an array`);
      for (const [compIndex, comp] of dim.components.entries()) {
        if (!isRecord(comp)) fail(`dimensions[${dimIndex}].components[${compIndex}] must be an object`);
        if (typeof comp.name !== "string" || comp.name.length === 0) {
          fail(`dimensions[${dimIndex}].components[${compIndex}].name must be a non-empty string`);
        }
        if (typeof comp.description !== "string" || comp.description.length === 0) {
          fail(`dimensions[${dimIndex}].components[${compIndex}].description must be a non-empty string`);
        }
      }
    }
  }

  if (value.colors !== undefined) {
    if (!isRecord(value.colors)) fail("colors must be an object");
    for (const [dimName, dimColors] of Object.entries(value.colors)) {
      if (!isRecord(dimColors)) fail(`colors.${dimName} must be an object`);
      for (const [componentName, color] of Object.entries(dimColors)) {
        if (typeof color !== "string") fail(`colors.${dimName}.${componentName} must be a string`);
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(`colors.${dimName}.${componentName} must be a #rrggbb hex color`);
      }
    }
  }
}

async function readInputFiles(filePaths: string[]): Promise<Analyze2Options["files"]> {
  const files: Analyze2Options["files"] = [];
  for (const filePath of filePaths) {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      fail(`input file not found: ${filePath}`);
    }
    if (!stat.isFile()) fail(`input path is not a file: ${filePath}`);
    files.push({ content: await readFile(filePath, "utf8"), filename: filePath });
  }
  return files;
}

function optionalReasoning(value: string | undefined): ReasoningEffort | undefined {
  if (!value || value === "none") return undefined;
  if (!["low", "medium", "high"].includes(value)) fail("reasoning effort must be one of: none, low, medium, high");
  return value as ReasoningEffort;
}

function optionalApiMode(value: string | undefined): AIApiMode | undefined {
  if (!value) return undefined;
  if (value !== "responses" && value !== "chat") fail("api mode must be 'responses' or 'chat'");
  return value;
}

function getEnvValue(values: EnvValues | null, key: string): string | undefined {
  return process.env[key] || values?.[key];
}

function missingApiKeyMessage(envFound: boolean): string {
  if (!envFound) {
    return `missing API key and ~/.context-lens/.env was not found.

Create it by running this command, replacing the placeholder key:
${API_KEY_SETUP_COMMAND}

Then rerun the same context-lens command.`;
  }

  return `missing API key.

Add OPENAI_API_KEY to ~/.context-lens/.env, or recreate it by running this command with your key:
${API_KEY_SETUP_COMMAND}`;
}

function buildAnalyzerConfig(args: CliArgs, contextLensEnv: EnvValues | null): AnalyzerConfig {
  const apiKey = args.apiKey
    || getEnvValue(contextLensEnv, "OPENAI_API_KEY")
    || getEnvValue(contextLensEnv, "VITE_AI_API_KEY")
    || getEnvValue(contextLensEnv, "AI_API_KEY");
  if (!apiKey) {
    fail(missingApiKeyMessage(contextLensEnv !== null));
  }

  return {
    apiKey,
    model: args.model || getEnvValue(contextLensEnv, "OPENAI_MODEL") || getEnvValue(contextLensEnv, "AI_MODEL"),
    baseURL: args.baseURL || getEnvValue(contextLensEnv, "OPENAI_BASE_URL") || getEnvValue(contextLensEnv, "AI_BASE_URL"),
    apiMode: args.apiMode || optionalApiMode(getEnvValue(contextLensEnv, "OPENAI_API_MODE") || getEnvValue(contextLensEnv, "AI_API_MODE")),
    reasoningEffort: optionalReasoning(args.reasoningEffort || getEnvValue(contextLensEnv, "OPENAI_REASONING_EFFORT") || getEnvValue(contextLensEnv, "AI_REASONING_EFFORT")),
    logLevel: args.logLevel || "silent",
  };
}

function segmentationPromptForAnalyzer(prompt: string | undefined): string | undefined {
  if (prompt === undefined) return undefined;
  return `${prompt}

Return ONLY a valid JSON array of regex strings with positive lookahead patterns suitable for JavaScript string splitting.
Example: ["(?=## Section one)", "(?=## Section two)"]`;
}

const STATUS_STAGES: Stage[] = [
  "parsing",
  "counting-tokens",
  "segmenting",
  "identifying-components",
  "classifying-components",
];

const STATUS_LABELS: Partial<Record<Stage, string>> = {
  "counting-tokens": "counting tokens",
  "identifying-components": "identifying components",
  "classifying-components": "classifying/coloring",
};

function displayFilename(filename: string): string {
  const relative = path.relative(process.cwd(), filename);
  const display = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : filename;
  if (display.length <= 80) return display;
  return path.join(path.basename(path.dirname(display)), path.basename(display));
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function createStatusInterceptors(): Interceptor[] {
  const startedAt = new Map<string, number>();
  return STATUS_STAGES.flatMap((stage) => {
    const label = STATUS_LABELS[stage] || stage;
    return [
      {
        stage,
        timing: "pre" as const,
        fn: (ctx) => {
          startedAt.set(`${ctx.id}:${stage}`, Date.now());
          console.error(`[context-lens] ${displayFilename(ctx.filename)} ${label} started`);
        },
      },
      {
        stage,
        timing: "post" as const,
        fn: (ctx) => {
          const key = `${ctx.id}:${stage}`;
          const elapsed = Date.now() - (startedAt.get(key) || Date.now());
          startedAt.delete(key);
          console.error(`[context-lens] ${displayFilename(ctx.filename)} ${label} done ${formatDuration(elapsed)}`);
        },
      },
    ];
  });
}

function optionsFromSpec(spec: Spec, files: Analyze2Options["files"]): Analyze2Options {
  return {
    files,
    segmentation: spec.segmentation
      ? {
          threshold: spec.segmentation.threshold,
          prompt: segmentationPromptForAnalyzer(spec.segmentation.prompt),
        }
      : undefined,
    dimensions: spec.dimensions,
    colors: spec.colors,
    interceptors: createStatusInterceptors(),
  };
}

function exportFilePath(resultShape: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(resultShape))
    .update(String(Date.now()))
    .update(randomBytes(8))
    .digest("hex")
    .slice(0, 12);
  const dir = existsSync("/tmp") ? "/tmp" : tmpdir();
  return path.join(dir, `context-lens-export-${hash}.json`);
}

function buildMultiFileGroup(
  states: Array<{ id: string; filename: string; title?: string; conversation?: unknown }>,
): Record<string, Group> | undefined {
  const exportableStates = states.filter((state) => state.conversation);
  if (exportableStates.length < 2) return undefined;

  const fingerprint = createHash("sha256")
    .update(exportableStates.map((state) => `${state.id}\0${state.filename}\0${state.title || ""}`).join("\0"))
    .digest("hex")
    .slice(0, 10);
  const groupId = `context-lens-${fingerprint}`;
  const group: Group = {
    id: groupId,
    name: `Context Lens comparison (${exportableStates.length} files)`,
    title: "Context Lens comparison",
    fileIds: exportableStates.map((state) => state.id),
  };
  return { [groupId]: group };
}

function firstGroup(groups: Record<string, Group> | undefined): Group | undefined {
  if (!groups) return undefined;
  return Object.values(groups)[0];
}

function contextViewerUrlTemplate(group: Group | undefined): string {
  if (!group) return "https://nilenso.github.io/context-viewer/?import=RAW_URL";
  return `https://nilenso.github.io/context-viewer/g/${encodeURIComponent(group.id)}/comparison?import=RAW_URL`;
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);

  if (args.help || rawArgs.length === 0) {
    printHelp();
    return;
  }

  if (!args.specPath) fail("missing --spec <path|->");
  if (args.files.length === 0) fail("provide at least one transcript file");

  const startedAt = Date.now();
  const [spec, files, contextLensEnv] = await Promise.all([
    readSpec(args.specPath),
    readInputFiles(args.files),
    loadContextLensEnv(),
  ]);
  const config = buildAnalyzerConfig(args, contextLensEnv);

  const result = await analyze2(optionsFromSpec(spec, files), config);

  const exportGroups = buildMultiFileGroup(result.states);
  const exportGroup = firstGroup(exportGroups);
  const exportData = buildSessionExport(result.states, exportGroups);
  const fullExportPath = exportFilePath({ analytics: result.analytics, filenames: args.files });
  const exportJson = JSON.stringify(exportData, null, 2);
  await writeFile(fullExportPath, exportJson, { mode: 0o600 });

  const report = {
    format: result.format,
    model: result.model,
    analysisModel: config.model || "gpt-5.4-mini",
    exportPath: fullExportPath,
    contextViewerUrlTemplate: contextViewerUrlTemplate(exportGroup),
    group: exportGroup
      ? {
          id: exportGroup.id,
          name: exportGroup.name,
          fileIds: exportGroup.fileIds,
        }
      : null,
    analytics: result.analytics,
    errors: result.errors,
    warnings: result.warnings,
    diagnostics: {
      durationMs: Date.now() - startedAt,
      exportBytes: Buffer.byteLength(exportJson),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nFull Context Viewer export written to:\n${fullExportPath}`);
  console.log(`\nContext Viewer URL template:\n${report.contextViewerUrlTemplate}`);

  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`context-lens: ${message}`);
  process.exit(1);
});
