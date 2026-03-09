# Context Viewer - Feature Exploration Log

## Overview
Context Viewer is an observability tool for LLM conversation contexts. It analyzes conversation logs, breaks them down into components, and visualizes their structure and token usage. The tool helps users understand how their conversation context is being used and identify opportunities for optimization.

## Key Design Principles (from README)
- **Privacy-focused**: No backend, runs entirely in browser - data stays local
- **Model-agnostic**: Uses Vercel AI SDK for flexibility
- **Format-agnostic**: Supports multiple conversation formats via parser interface

---

## Development Milestones (from docs/prompts.md)

### Milestone 0: Tech Stack Definition
- Browser-local (no server-client/API)
- Model-agnostic client using Vercel AI SDK
- JavaScript/TypeScript all the way

### Milestone 1: Basic Conversation Display
- Parser interface with registry pattern
- Parser implementations for completions and responses APIs
- Domain model for messages (Zod schemas)
- HTML file drag-drop interface

### Milestone 2: Component Breakdown
- Token counting per component using tiktoken
- API key integration (OpenAI)
- Spinner/progress indicators for AI calls
- Component breakdown visualization
- Response chips per component

### Milestone 3: Time-Travel View
- Slider to visualize context growth chronologically
- Component timeline snapshots at each message

### Milestone 4: Tree-Map View (later changed to Waffle Chart)
- Waffle chart showing components by size (20x20 grid = 400 squares)
- Each square represents 0.25% of total tokens

### Milestone 5-7: Multi-Conversation Support
- Drag-drop up to 10+ conversations
- Parallel processing
- Conversation grouping for comparison analysis

---

## Supported Input Formats

1. **OpenAI Completions API** (`completions-parser.ts`)
   - Standard completions format

2. **OpenAI Responses API** (`responses-parser.ts`)
   - Responses format with structured items

3. **OpenAI Conversations API** (`conversations-parser.ts`)
   - Conversation items list format

4. **Claude Code Transcripts** (`claude-transcripts-parser.ts`)
   - JSONL format from Claude Code CLI
   - Supports assistant, user, summary, file-history-snapshot types

5. **Codex CLI Transcripts** (`codex-transcripts-parser.ts`)
   - Similar to Claude transcripts
   - JSONL format from Codex CLI

6. **OpenCode Transcripts** (`opencode-transcripts-parser.ts`)
   - JSON format with reasoning parts
   - Supports agent field for model identification

7. **Plain Text Files** (`plain-text-parser.ts`)
   - Simple text files parsed as single system message
   - Catch-all parser registered last

---

## Core Workflow Pipeline

The application follows a multi-stage workflow for each conversation:

### Stage 1: Parsing
- File upload via drag-drop or click
- Auto-detect format using parser registry
- Parse into unified `Conversation` schema

### Stage 2: Token Counting
- Uses tiktoken WASM for accurate counts
- Encoder instance reused to prevent UI freeze
- Token counts added to each message part

### Stage 3: Static Componentization
- Deterministic breakdown by role + message type
- Categories like: `system.text`, `user.text`, `assistant.tool-call`, `tool.tool-result`
- No AI calls required - instant

### Stage 4: Segmentation
- AI-powered semantic chunking of large text parts
- Threshold: >500 tokens triggers segmentation
- Uses regex lookahead patterns for splitting
- Skips tool results (structured output)

### Stage 5: AI Summary Generation
- Streaming summary of conversation goal, turns, and result
- Runs in parallel with segmentation
- Customizable prompt

### Stage 6: Component Identification (AI)
- Identifies logical components in the conversation
- Customizable prompt with hierarchical category support
- Categories like: identity, personality, environment, tools, workflow, etc.

### Stage 7: Component Mapping
- Maps each message part ID to an identified component
- Batched processing (20 parts per batch)
- Parallel API calls for efficiency

### Stage 8: Color Assignment
- Currently hardcoded color mapping
- AI-based coloring code preserved but disabled
- Colors: orange, emerald, purple, blue, slate, indigo, gray

### Stage 9: Context Analysis (Optional)
- User-triggered, not automatic
- Analyzes component distribution over time
- Provides recommendations for context optimization
- Uses CSV timeline data

---

## Visualization Features

### 1. Waffle Chart (`WaffleChart.tsx`)
- 20x20 grid (400 squares)
- Each square = 0.25% of tokens
- Sortable by: tokens (desc), name (asc/desc), category
- Legend with token counts and percentages
- Click to view component message parts

### 2. Stacked Bar Chart (`StackedBarChartView.tsx`)
- Timeline visualization
- Shows component growth over messages
- Uses Recharts library

### 3. Time-Travel Slider
- Scrub through conversation chronologically
- See component composition at each message
- Built using component timeline snapshots

### 4. Component Comparison View (`ComponentComparisonView.tsx`)
- Grid of mini waffle charts (10x10)
- Compare multiple grouped conversations
- Configurable grid columns (1-5)
- Shows: tokens, turns, messages, duration
- Sort by: tokens, name, category (with asc/desc)

### 5. Static Components View (`StaticComponentsView.tsx`)
- Role.type breakdown
- Drill-down to automatic components

---

## UI Components and Features

### Sidebar (Conversation List)
- Collapsible (like Notion)
- File browser style navigation
- Progress indicators per conversation
- Multi-select with checkboxes
- Select all/none for grouping
- Delete conversations (if not in group)
- Links to edit prompts for each stage

### Conversation View
- Collapsible messages and parts
- Message type filter (multi-select)
- Component filter
- Sort by time, tokens
- Token counts on each part
- Relative timestamps
- Source file indicator for grouped conversations

### Insights Panel (Right)
- Collapsible
- Tabs: Summary, Analysis
- Streaming text display
- Markdown rendering with GFM tables
- Metadata card (format, model, agent, messages, turns, duration)
- "Generate Analysis" link (optional trigger)

### Prompt Editor Dialogs
- Edit Component Identification Prompt
- Edit Segmentation Prompt
- Edit Summary Prompt
- Edit Analysis Prompt
- Edit Components (custom list)
- Warnings about re-triggering workflow stages

---

## Conversation Grouping

### Creating Groups
- Select multiple conversations with checkboxes
- Click "Group" button
- Conversations concatenated with source tracking

### Group Features
- Messages tagged with source filename
- Merged component mappings and colors
- Combined timeline
- Comparison view shows grid of source conversations
- Filters apply to grouped comparison view

### Ungrouping
- Remove grouped conversation without affecting sources
- Cannot delete source conversations while in a group

---

## Export Features

### Markdown Export
- Copy button on toolbar
- Includes file metadata
- Filters and sort reflected
- Format: `# filename (tokens)` > `## message part` > code block

---

## Performance Optimizations

1. **Tiktoken encoder reuse** - Single instance prevents UI freeze
2. **Parallel batch processing** - Component mapping in 20-part batches
3. **Optional analysis** - User triggers, not automatic
4. **Tool result stripping** - First 200 chars + "..." for LLM calls
5. **Large content stripping** - Images, files excluded from AI prompts
6. **Streaming responses** - AI summary and analysis streamed to UI

---

## Prompt Customization

### Default Prompts Location
`src/prompts.ts` - Centralized prompt management

### Customizable Prompts
1. **Segmentation** - Semantic chunking patterns
2. **Summary** - Conversation summary format
3. **Component Identification** - What components to find
4. **Component Mapping** - How to assign parts to components
5. **Context Analysis** - Analysis focus and recommendations

### Component Categories (Default)
- identity - AI identity and role
- personality - Communication style, autonomy, behavior
- environment - Platform, security, sandboxing
- code_style - Conventions, quality, examples
- search - Tool selection, context separation
- workflow - Task management, modes, git
- project_context - Config files
- tools - Policies, file, shell, communication, advanced

---

## Technical Stack

### Frontend
- React 18 with TypeScript
- Vite for build
- TailwindCSS for styling
- shadcn/ui components
- Recharts for visualizations
- TanStack Query for async state
- react-dropzone for file upload
- react-markdown + remark-gfm for rendering

### AI
- Vercel AI SDK (@ai-sdk/openai)
- OpenAI models (gpt-4o-mini, gpt-5.2)
- Streaming text generation

### Token Counting
- tiktoken WASM
- vite-plugin-wasm + vite-plugin-top-level-await

### Schema
- Zod for input validation and types
- Discriminated unions for message types

---

## Files Structure Summary

```
src/
├── App.tsx                    # Main app, workflow orchestration
├── schema.ts                  # Zod schemas for conversation model
├── input-schemas.ts           # Zod schemas for input validation
├── parser.ts                  # Parser registry and interface
├── prompts.ts                 # All AI prompts centralized
├── add-token-counts.ts        # Tiktoken integration
├── segmentation.ts            # AI semantic chunking
├── componentisation.ts        # AI component identification/mapping
├── static-componentisation.ts # Deterministic role.type breakdown
├── ai-summary.ts              # AI summary and analysis generation
├── ai-config.ts               # AI configuration from env
├── strip-large-content.ts     # Content truncation for AI calls
├── conversation-summary.ts    # Static summary calculation
├── parsers/
│   ├── index.ts               # Parser registration
│   ├── completions-parser.ts
│   ├── responses-parser.ts
│   ├── conversations-parser.ts
│   ├── claude-transcripts-parser.ts
│   ├── codex-transcripts-parser.ts
│   ├── opencode-transcripts-parser.ts
│   └── plain-text-parser.ts
├── components/
│   ├── FileUploader.tsx
│   ├── ConversationList.tsx
│   ├── ConversationView.tsx
│   ├── ConversationSummary.tsx
│   ├── ConversationMetadataCard.tsx
│   ├── MessageView.tsx
│   ├── MessagePartView.tsx
│   ├── MessageTypeFilter.tsx
│   ├── ComponentsView.tsx
│   ├── StaticComponentsView.tsx
│   ├── WaffleChart.tsx
│   ├── StackedBarChartView.tsx
│   ├── ComponentComparisonView.tsx
│   ├── AISummary.tsx
│   ├── PromptEditorDialog.tsx
│   └── ui/                    # shadcn/ui components
└── lib/
    ├── utils.ts
    ├── component-colors.ts
    └── static-component-colors.ts
```

---

## Commit History Highlights

### Input Format Support
- cf93582: Claude transcripts
- 925b874: Plain text files
- a41be77: Codex CLI transcripts
- ff570c5: OpenCode transcripts

### Visualization
- cf93582, a68de5a: Waffle chart
- 1055b8c: Component comparison grid view
- cd0df33: Duration display
- d4f314c: Turn/message counts

### AI Features
- ea518a5: Custom segmentation prompt
- f55eb1d: Custom components
- 33bb658: Analysis prompt customization
- b290695: Optional analysis generation

### Performance
- 19d3469: Tiktoken encoder reuse
- a28815a: Tool content truncation

### UX
- b418f7c: Delete conversations
- b5c34d9: Relative time display
- 2ca20c: Column selector
- e424dbd: Select all/none checkbox
- 1055b8c: Markdown export
