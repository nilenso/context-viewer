# context-lens CLI Spec

`context-lens` is an agent-facing CLI for analyzing AI conversation transcripts using the analyzer library's `analyze2()` function.

The package will be published as:

```txt
@nilenso/context-lens
```

The installed binary should be:

```txt
context-lens
```

This branch should only add the CLI wrapper around `analyze2()` and the minimum package/publish plumbing needed for `@nilenso/context-lens`. Do not redesign the analyzer pipeline or viewer.

## Purpose

`context-lens` helps agents inspect conversation/context usage by producing a compact analytics report and a full Context Viewer export artifact.

The agent provides:

- transcript files to analyze
- an analysis spec containing segmentation instructions, dimensions, components, and colors

The tool returns:

- compact analytics on stdout for direct LLM reading
- a path to a full Context Viewer export written under `/tmp`

## Command shape

There is no subcommand. This is the only operation the tool performs.

Canonical invocation:

```bash
context-lens --spec - session.jsonl <<'JSON'
{
  "segmentation": {
    "threshold": 500,
    "prompt": "Split large message parts into chunks that preserve the evidence needed for the user's investigation."
  },
  "dimensions": [
    {
      "name": "dimension_chosen_for_this_question",
      "components": [
        {
          "name": "component_a",
          "description": "Specific criterion for assigning transcript parts to component_a."
        },
        {
          "name": "component_b",
          "description": "Specific criterion for assigning transcript parts to component_b."
        },
        {
          "name": "component_c",
          "description": "Specific criterion for assigning transcript parts to component_c."
        }
      ]
    }
  ],
  "colors": {
    "dimension_chosen_for_this_question": {
      "component_a": "#2563eb",
      "component_b": "#16a34a",
      "component_c": "#f59e0b"
    }
  }
}
JSON
```

Multiple files are positional arguments:

```bash
context-lens --spec - raw.jsonl compacted.jsonl <<'JSON'
{
  "segmentation": {
    "threshold": 700,
    "prompt": "Segment each transcript into self-contained units of work. Preserve enough surrounding context for each segment to be understandable independently."
  },
  "dimensions": [
    {
      "name": "context_topic",
      "components": [
        {
          "name": "requirements",
          "description": "User goals, constraints, acceptance criteria, desired behavior, and clarifying discussion."
        },
        {
          "name": "code_understanding",
          "description": "Reading files, inspecting existing architecture, searching symbols, and explaining current behavior."
        },
        {
          "name": "implementation",
          "description": "Writing, editing, refactoring, or generating source code."
        },
        {
          "name": "debugging",
          "description": "Investigating errors, stack traces, failed commands, unexpected behavior, and root-cause analysis."
        },
        {
          "name": "testing",
          "description": "Creating tests, running tests, interpreting failures, updating fixtures, and validating behavior."
        },
        {
          "name": "tool_output",
          "description": "Command outputs, file listings, logs, diffs, search results, and other tool responses."
        }
      ]
    }
  ],
  "colors": {
    "context_topic": {
      "requirements": "#0891b2",
      "code_understanding": "#2563eb",
      "implementation": "#16a34a",
      "debugging": "#dc2626",
      "testing": "#f59e0b",
      "tool_output": "#64748b"
    }
  }
}
JSON
```

## Help behavior

`--help` prints the agent instructions.

If the command is run with no input, it should print the same help text and exit without running analysis.

Examples:

```bash
context-lens --help
context-lens
```

The help text is also the intended system prompt / agent instructions for using the tool. It should show the single supported interface and canonical examples.

## CLI flags

### `--spec <path|->`

Required for analysis.

The analysis spec is the JSON object passed to `analyze2()` excluding `files`.

Use `--spec -` to read the spec from stdin.

```bash
context-lens --spec - session.jsonl <<'JSON'
{ "segmentation": { "threshold": 500, "prompt": "..." }, "dimensions": [], "colors": {} }
JSON
```

Use `--spec analysis.json` to read from a file.

```bash
context-lens --spec analysis.json session.jsonl
```

### Positional files

Transcript files are positional arguments:

```bash
context-lens --spec analysis.json file1.jsonl file2.jsonl
```

Initial implementation should require actual file paths. Directory traversal and `--files-from` are out of scope unless added later.

### Provider/runtime flags

The analyzer runtime config should come from `~/.context-lens/.env`, environment variables, or optional flags. The CLI does not read project-local `.env` files.

Recommended API key setup:

```bash
mkdir -p ~/.context-lens && printf 'OPENAI_API_KEY=%s\nOPENAI_MODEL=gpt-4o-mini\n' 'sk-REPLACE_WITH_YOUR_OPENAI_KEY' > ~/.context-lens/.env && chmod 600 ~/.context-lens/.env
```

API key lookup order:

```txt
--api-key
OPENAI_API_KEY
VITE_AI_API_KEY
AI_API_KEY
~/.context-lens/.env
```

At least one API key source is required for AI stages. If `~/.context-lens/.env` is missing and no other key is provided, the CLI should print the setup command above. The setup includes `OPENAI_MODEL=gpt-4o-mini` as the default model.

Optional flags:

```txt
--api-key <key>
--model <model>
--base-url <url>
--api-mode <responses|chat>
--reasoning-effort <none|low|medium|high>
--log-level <silent|info|debug>
```

Defaults should match the analyzer defaults where possible:

```txt
model: gpt-4o-mini
apiMode: responses
logLevel: silent
```

## Analysis spec JSON

The spec is the public agent-facing interface.

```ts
interface ContextLensSpec {
  segmentation?: {
    threshold?: number;
    prompt?: string;
  };
  dimensions?: Array<{
    name: string;
    components: Array<{
      name: string;
      description: string;
    }>;
  }>;
  colors?: Record<string, Record<string, string>>;
}
```

This maps to `Analyze2Options` as:

```ts
const result = await analyze2(
  {
    files,
    segmentation: spec.segmentation,
    dimensions: spec.dimensions,
    colors: spec.colors,
  },
  config,
);
```

### `segmentation`

Controls splitting large message parts into semantic chunks.

Agents should usually provide a task-specific segmentation prompt. A default exists, but explicit instructions are preferred. The CLI appends the low-level JSON-array output requirements expected by the analyzer, so the agent prompt only needs to describe how to split the content.

Guidance for prompts:

- keep related code, errors, commands, and reasoning together
- split independent topics into separate chunks
- preserve enough context for each segment to be understandable independently

### `dimensions`

Dimensions are explicit taxonomies supplied by the agent after inspecting the files.

The agent should not provide a classification prompt. The analyzer owns the classifier prompt. The agent provides names and descriptions.

Guidelines:

- choose dimension names that directly help investigate the user's question
- do not default to generic code-area axes unless that is what the user asked for
- examples: `retention_value` or `information_type` for compaction quality, `activity_type` for work process, `context_source` for source mix, `feature_area` for product/code area
- use the same dimensions/components across files when comparing files
- prefer 8–12 components per dimension when possible
- write component descriptions for someone who has not seen the code or conversation

### `colors`

Colors are keyed by dimension name and component name.

```json
{
  "retention_value": {
    "essential_context": "#16a34a",
    "supporting_detail": "#2563eb"
  }
}
```

Agents should usually provide colors up front when dimensions are known.

## Output behavior

The default stdout is an agent-readable report, not necessarily pure JSON.

It should contain:

1. a compact JSON analytics block
2. a final human-readable line pointing to the full export file

Example stdout:

```txt
{
  "format": "Claude Code",
  "model": "claude-sonnet-4",
  "analytics": [
    {
      "filename": "session.jsonl",
      "totalTokens": 42138,
      "messageCount": 96,
      "turnCount": 18,
      "dimensions": {
        "retention_value": {
          "totalTokens": 42138,
          "components": [
            {
              "component": "essential_context",
              "tokens": 12200,
              "percentage": 28.9,
              "color": "#16a34a"
            }
          ]
        }
      }
    }
  ],
  "errors": [],
  "warnings": []
}

Full Context Viewer export written to:
/tmp/context-lens-export-a8f31c.json
```

The JSON block should be small enough for an LLM to read directly. It should not include the full conversation or internal pipeline states.

## Full export file

The CLI should write a full Context Viewer-compatible export to `/tmp`.

Use the existing analyzer export helper:

```ts
buildSessionExport(result.states)
```

The export file should contain the full annotated conversation and component/dimension metadata needed by Context Viewer.

Filename pattern:

```txt
/tmp/context-lens-export-<id-or-hash>.json
```

The export path should be printed at the end of stdout.

Because transcripts may contain sensitive data, write the file with restrictive permissions where possible, e.g. `0o600`.

## Sessions

Do not expose sessions in the initial CLI interface.

The CLI can be stateless: each invocation analyzes the provided files with the provided spec.

Session persistence may be added later as an optimization, but it should not complicate the first public interface.

## No raw conversation on stdout

Stdout should not include:

- raw transcript content
- full parsed conversation
- `PipelineState[]`
- internal session state

Those belong only in the `/tmp` export artifact.

## Implementation notes

- Implement the binary as `context-lens`.
- Call `analyze2()` from the analyzer package/source in this branch.
- Read files into `FileInput[]` with `{ content, filename }`.
- Parse the spec JSON from `--spec -` or `--spec <path>`.
- Build `AnalyzerConfig` from flags/env.
- Write compact analytics to stdout.
- Write full export to `/tmp` and print the path.
- Print help on `--help` or when invoked with no input.
