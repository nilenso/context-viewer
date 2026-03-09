# Context Viewer - Capabilities Documentation

Context Viewer is an observability tool for LLM conversation contexts. It helps developers and prompt engineers understand how conversation context is being used, identify inefficiencies, and optimize token usage across AI assistant interactions.

## What It Does

Context Viewer takes conversation logs from various AI coding assistants and provides:

1. **Visual breakdown** of context components (what's taking up space)
2. **Token counting** per message part
3. **AI-powered component identification** (semantic categorization)
4. **Time-travel visualization** (how context grows over the conversation)
5. **Comparison analysis** across multiple conversations
6. **Context optimization recommendations**

---

## Key Capabilities

### 1. Multi-Format Support

Context Viewer supports conversation logs from:

| Format | Source | File Type |
|--------|--------|-----------|
| OpenAI Completions API | Direct API logs | JSON |
| OpenAI Responses API | Direct API logs | JSON |
| OpenAI Conversations API | Direct API logs | JSON |
| Claude Code CLI | `~/.claude/projects/*/` | JSONL |
| Codex CLI | `~/.codex/sessions/` | JSONL |
| OpenCode | Custom exports | JSON |
| Plain Text | System prompts, docs | TXT |

**Adding new formats**: Implement the `Parser` interface and register with `parserRegistry`.

### 2. Token Analysis

- **Accurate counting** using tiktoken (same as OpenAI)
- **Per-part breakdown** - see exactly where tokens are spent
- **Role-based grouping** - system, user, assistant, tool
- **Type-based grouping** - text, reasoning, tool-call, tool-result, image, file

### 3. Static Component Analysis

Immediate (no AI required) breakdown by role and message type:

```
system.text       - System prompt content
user.text         - User messages
user.image        - Uploaded images
assistant.text    - Assistant responses
assistant.tool-call - Tool invocations
assistant.reasoning - Chain-of-thought
tool.tool-result  - Tool outputs
```

### 4. AI-Powered Semantic Components

Uses LLM to identify logical components like:

- **identity** - AI persona, role definition
- **personality** - Communication style, behavior constraints
- **environment** - Platform info, security rules
- **tools** - Tool definitions, usage policies
- **workflow** - Task management, git conventions
- **code_style** - Coding conventions, quality rules
- **project_context** - Project-specific configuration

Fully customizable via UI - edit the prompt or provide your own component list.

### 5. Visualizations

#### Waffle Chart
- 20x20 grid where each square = 0.25% of tokens
- Color-coded by component
- Sortable by tokens, name, or category
- Click to drill down into message parts

#### Timeline / Time-Travel
- Slider to see context at any point in conversation
- Watch how components grow over turns
- Identify when context becomes bloated

#### Component Comparison Grid
- Side-by-side waffle charts for multiple conversations
- Compare token distribution across different runs
- Identify patterns and outliers

### 6. Conversation Grouping

Combine multiple conversations for aggregate analysis:

- **Select and group** conversations from the sidebar
- **Merged visualization** shows combined component distribution
- **Comparison view** shows grid of individual conversations
- **Filters apply** across grouped view

Use case: Compare how different prompts or models handle the same task.

### 7. AI Summary & Analysis

#### Automatic Summary
- Goal, turns, and result of conversation
- Streaming display as it generates
- Customizable prompt

#### Context Analysis (On-Demand)
- Pattern identification in context growth
- Redundancy and efficiency assessment
- Relevance evaluation
- Actionable optimization recommendations

### 8. Export

Export to Markdown with:
- File metadata
- Filter/sort state preserved
- Token counts per section
- Full message content

### 9. Prompt Customization

All AI prompts are editable via the UI:

| Prompt | Purpose |
|--------|---------|
| Segmentation | How to chunk large text parts |
| Summary | What to include in conversation summary |
| Component Identification | What components to find |
| Analysis | What insights to generate |

---

## Architecture

### Privacy-First Design

- **No backend** - runs entirely in browser
- **No data upload** - conversations stay local
- **Your API key** - you control where AI calls go

### Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Styling**: TailwindCSS + shadcn/ui
- **Charts**: Recharts
- **AI**: Vercel AI SDK (OpenAI provider)
- **Tokens**: tiktoken WASM
- **Schema**: Zod

### Processing Pipeline

```
File Upload
    ↓
Format Detection (Parser Registry)
    ↓
Token Counting (tiktoken)
    ↓
Static Componentization (instant)
    ↓ (parallel)
AI Segmentation ────── AI Summary
    ↓
AI Component Identification
    ↓
Component Mapping (batched, parallel)
    ↓
Color Assignment
    ↓ (optional, user-triggered)
Context Analysis
```

---

## Use Cases

### 1. System Prompt Optimization
Upload your system prompt as plain text. See which sections consume the most tokens. Identify opportunities to consolidate or trim.

### 2. Agent Conversation Analysis
Load Claude Code or Codex transcripts. Understand how much context is spent on tool calls vs. reasoning vs. user interaction.

### 3. Prompt Comparison
Upload multiple variations of the same task. Group them and use comparison view to see which prompt structure is most efficient.

### 4. Context Window Management
Use the time-travel slider to see exactly when context becomes too large. Identify the turn where optimization would have the most impact.

### 5. Component-Based Optimization
Filter by component type to focus on specific areas. See how much of your context is spent on identity vs. tools vs. workflow rules.

---

## Getting Started

```bash
# Install dependencies
bun install

# Configure API key
cp .env.example .env
# Edit .env: VITE_AI_API_KEY=your-key

# Start dev server
bun run dev
```

Then:
1. Drag & drop conversation files
2. Wait for processing (watch progress in sidebar)
3. Explore with visualizations
4. Customize prompts as needed
5. Generate analysis when ready

---

## Limitations

- **OpenAI models only** (currently) - AI SDK supports others, but only OpenAI tested
- **Browser memory** - Very large files (>5MB) may cause slowdowns
- **Token estimation** - tiktoken counts may differ slightly from actual API usage
- **Component identification** - AI-based, results may vary

---

## File Locations

| What | Where |
|------|-------|
| Prompts | `src/prompts.ts` |
| Parsers | `src/parsers/` |
| Components | `src/components/` |
| Schemas | `src/schema.ts`, `src/input-schemas.ts` |
| AI logic | `src/componentisation.ts`, `src/ai-summary.ts`, `src/segmentation.ts` |

---

## Contributing

To add a new input format:

1. Create `src/parsers/your-format-parser.ts`
2. Implement `Parser` interface with `canParse()` and `parse()` methods
3. Register in `src/parsers/index.ts`

To modify component identification:

1. Edit default prompt in `src/prompts.ts` (`getDefaultComponentIdentificationPrompt`)
2. Or use the UI prompt editor for per-session changes
