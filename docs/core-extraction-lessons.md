# Tracer Bullet Lessons — Core Extraction from context-viewer

Learnings from the tracer bullet experiment (2026-03-26) for when we do the real extraction.

Source sessions:
- **Extraction session**: `~/.pi/agent/sessions/--Users-srihari-work-nilenso-context-viewer--/2026-03-26T14-47-41-151Z_ca732108-12ab-48ef-8f3b-298bd43c60b6.jsonl`
- **Trial/extension session**: `~/.pi/agent/sessions/--Users-srihari-work-nilenso-context-analyzer-trial--/2026-03-26T16-40-43-038Z_64faac53-9eb0-4949-87e8-af9f63e3ad8d.jsonl`

---

## 1. Architecture & Extraction

### The core is already 80% extractable
Stage functions are pure: parse → tokenize → segment → identify → classify → color. The data model (`schema.ts`, `types.ts`) has zero UI dependencies. The parser registry is clean and extensible. Main work is removing Vite/browser assumptions.

### Core boundary
Everything in `src/stages/`, `src/parsers/`, `src/operations/`, `src/model/`, `src/pipeline/`, `src/lib/` — minus Vite/browser imports.

### Gotcha: `import.meta.env` → caller-provided config
Every `import.meta.env.VITE_*` reference needs replacing. AI config (API key, model, base URL), logging (DEV mode), preset loader (`fetch()` with `BASE_URL`). The library should **not read env vars itself** — the caller provides config: `{ apiKey, model?, baseURL? }`.

### Gotcha: path aliases (`@/*`) break outside the project
The tsconfig `paths` alias needs resolving for the library to be importable externally. Use relative imports or bundle with resolved paths.

---

## 2. API Design

### "One function is enough"
The tracer bullet ended with 4 exports (`analyze`, `group`, `summarize`, `analyzeContext`), but **`analyze()` is the only call needed for 90% of use cases**. Group/summary/analysis are optional add-ons. When the LLM had all 4 available, it over-called them unnecessarily — wrote 180 lines of glue code instead of one call.

### No incremental/caching inside the tool
The original had `previousResult` / `_pipelineState` for incremental re-runs. This was "half-baked" — an AI agent won't hold onto opaque state blobs between tool calls. The agent manages iteration by calling the tool multiple times with refined components. Remove this from the core API.

### No summary/analysis by default
Primary output is structured analytics JSON (per-file, per-component token counts, percentages, colors). Summary and analysis are separate optional calls.

---

## 3. Component Design — The Most Important Lesson

### Descriptions are essential, not optional
The first iteration had components as bare strings (`["auth", "database"]`). This produced poor classification. The fix: `{ name: string, description: string }` where the description is written **for the classifier**. This was the single biggest quality improvement.

Good: `{ name: "auth_system", description: "Authentication, login flows, sessions, RBAC, and security-related code" }`
Bad: `{ name: "auth_system", description: "Content related to auth_system" }`

### 8–12 components is the sweet spot
Fewer than 5 is too coarse. More than 15 confuses the classifier.

### Two-pass workflow: discover then compare
1. Run once with auto-discovery (or a custom discovery prompt) to see what components exist
2. Re-run with explicit named components for consistent classification across files

Auto-discovered names differ between files, making direct comparison impossible.

### Agents are great at crafting prompts and components
The AI agent was good at reading transcript files, understanding what's in them, and then writing well-targeted discovery prompts and component descriptions. This is a strength to lean into — the tool should make it easy for agents to iterate: run discovery, read results, craft components, re-run with those components.

---

## 4. Error Handling

### Errors are unclear — and silently swallowed everywhere
The current code has a pervasive pattern: catch errors, log them, return empty results. The caller has no idea something went wrong — they just get an empty array or `{}` and the pipeline continues with degraded data. The UI might show errors on screen, but the core should expose these **as structured error data**, not side-channel console output.

### Error taxonomy — four categories
The real extraction needs typed errors that the caller can distinguish:

1. **Upstream AI errors** (provider errors): OpenAI timeouts, rate limits, auth failures, model not found. The caller needs to know "the AI provider didn't respond" vs "the analysis logic broke." These may be retryable.

2. **AI response parsing errors** (malformed output): The AI responded, but the output was unparsable. Examples from the current code:
   - Segmentation: AI returns regexes that don't compile, or JSON that doesn't parse → currently silently falls back to unsegmented text (`return [text]`)
   - Identification: AI response can't be parsed as component list → currently returns `[]`
   - Classification: AI response can't be parsed as mapping → currently returns `{}`
   - These are worth retrying (maybe with a different prompt nudge).

3. **Input errors** (4xx-type): Bad file format, unsupported transcript type, invalid component descriptions, missing API key, malformed prompts. The caller made a mistake and needs to fix their input. Not retryable.

4. **Internal errors** (5xx-type): Bugs in the library itself — unexpected null, type errors, logic errors. Should surface clearly with stack traces.

### Current silent failure inventory
Audit of what the tracer bullet code does today — **this is what needs fixing**:

| Stage | Failure mode | Current behavior | Should be |
|-------|-------------|-----------------|-----------|
| **Segment** | AI call fails | `return []` — no segmentation, silently | Upstream error, retryable |
| **Segment** | AI returns bad regexes | `return [text]` — fallback to original | Parse error, warn + fallback is OK but should be visible |
| **Segment** | JSON parse fails on AI response | `return []` | Parse error, retryable |
| **Identify** | AI call fails | `return []` — no components found | Upstream error, retryable |
| **Identify** | No API key | `return { error: "No API key configured" }` | Input error, not retryable |
| **Classify** | AI call fails | `return {}` — no classification | Upstream error, retryable |
| **Color** | AI call fails | `return {}` — no colors | Upstream error, retryable |
| **Summarize** | AI call fails | Returns error string in result | Upstream error, retryable |
| **Parse** | Zod validation fails | Throws with formatted message | ✅ Already decent (input error) |
| **Parse** | No parser matches | ? | Input error |

### Document retry/fallback/fail behavior
The real extraction should clearly document for each stage:
- **What errors can occur** (with the category above)
- **What the library does automatically** (retry? fallback? fail?)
- **What the caller sees** (error in result? exception? silent degradation?)

Currently there are **no retries anywhere** — every AI failure is a single attempt that silently degrades. The real extraction should decide: does the library retry (with backoff for rate limits)? Or does it surface the error and let the caller retry?

### Errors should be data, not exceptions
Prefer returning errors in the result object (like `{ result, errors: [...] }`) over throwing exceptions. The pipeline should be able to complete partially — parsing succeeded, segmentation partially failed, classification worked for 8/10 chunks — and the caller sees exactly what happened. Exceptions should be reserved for truly unrecoverable situations (internal bugs).

---

## 5. Logging

### Log levels need proper implementation
The tracer bullet used a binary `setVerbose(true/false)` toggle. This is too coarse. The real extraction should implement proper log levels:
- **silent**: no output (default for tool/library use)
- **info**: stage progress ("Parsing...", "Classifying...", durations)
- **debug**: detailed internals (API payloads, intermediate results, regex patterns tried)

The logging infrastructure (`logging.ts`) already has `LogLevel = "info" | "warn" | "error" | "debug"` and stores entries in memory — but the verbose flag bypasses all of this and just does `console.log`. Wire up the actual log level filtering, and let callers set a level or subscribe to log entries.

---

## 6. Pi Extension & TUI

### Extension was trivial to build
Once the core library existed, the extension was ~100 lines wrapping `analyze()` into a tool registration. Runs in-process via Node/jiti — no shelling out.

### Global vs project-local extension conflict
If installed both globally (`~/.pi/agent/extensions/`) and locally (`.pi/extensions/`), pi reports a tool name conflict. Pick one location.

### Waffle chart rendering in TUI needs iteration
The ANSI-colored waffle charts rendered as **a single block of gray** inside pi's TUI. The 24-bit ANSI color codes (`\x1b[38;2;r;g;b`) aren't rendering properly in the tool result display. This needs design iteration:
- Investigate whether pi's TUI supports 24-bit color in tool results
- Consider fallback rendering: ASCII art with labels, plain-text tables, or structured data that pi's TUI can render natively
- The comparison table (text-based) worked fine — the waffle grid was the problem
- May need to output the chart as a different format, or let pi render it from structured data rather than pre-rendered ANSI

### USAGE.md as a tool manual is critical
The LLM reads it to decide how to call the tool. When usage docs were unclear, the LLM wrote unnecessary code. After improving USAGE.md with explicit workflows and "don't do this" guidance, behavior improved dramatically. Write the manual as if explaining to an eager but literal junior developer.

---

## 7. What the Real Extraction Should Produce

1. **A standalone npm-publishable package** with zero UI dependencies
2. **Primary export**: `analyze(files, config, options?)` — takes file contents + config, returns structured analytics
3. **Optional exports**: `group`, `summarize`, `analyzeContext` — clearly documented as optional
4. **Config object**: `{ apiKey, model?, baseURL?, logLevel? }` — no env var reading inside the library
5. **Output format**: structured analytics JSON matching the context-viewer export format's analytics section
6. **Typed error categories** (upstream/parse/input/internal) returned as data in results, not thrown
7. **Documented retry/fallback/fail behavior** per stage
8. **Proper log levels** (silent/info/debug) with caller-configurable verbosity
9. **USAGE.md** written as a tool manual for AI agents
10. **README.md** with API reference, install instructions, quick start

### Source for extraction
Branch `zustand-state-management` on context-viewer — now includes unit tests that should be carried over or adapted.
