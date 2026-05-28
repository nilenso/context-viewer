# Context Viewer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Observability for contexts. Given a coversation log (messages), this
tool will provide a breakdown of its components and their sizes. It
also classifies messages into various categories so we can observe the
context in ways that matter to the business.

This tool itself is very simple, and the data mostly comes from a
single prompt that you can use yourself. The visualisations are useful
though.

It's [hosted on GitHub Pages](https://nilenso.github.io/context-viewer/) so you can try it directly, or run it locally (see Quick Start below).

### Samples

Explore these pre-loaded comparisons to see what Context Viewer can do:

- [Coding agent system prompts compared](https://nilenso.github.io/context-viewer/g/960d42ad-314c-44cf-8594-4b009ef528a1/comparison?sidebar=0&panel=0&sortBy=category&sortDir=asc&import=https://raw.githubusercontent.com/nilenso/long-prompts-analysis/refs/heads/main/context-viewer-exports/system-prompts-simpler.json) — Claude Code, Cursor, Gemini CLI, Codex CLI, OpenHands, and Kimi CLI side by side
- [Claude Code prompt evolution](https://nilenso.github.io/context-viewer/g/b179a05f-2bd4-4012-83ab-42a0cb1e79fd/comparison?sidebar=0&panel=0&legend=compact&sortBy=category&sortDir=asc&cols=5&import=https://raw.githubusercontent.com/nilenso/long-prompts-analysis/refs/heads/main/context-viewer-exports/claude-prompt-evolution-export-simpler.json) — how Claude's system prompt has changed across model versions
- [Codex CLI prompt evolution](https://nilenso.github.io/context-viewer/g/56b68fb5-7221-4c04-807e-b590f138c1fe/comparison?sidebar=0&panel=0&view=tokens-absolute&legend=compact&sortBy=category&sortDir=asc&cols=10&spr=4&import=https://raw.githubusercontent.com/nilenso/long-prompts-analysis/refs/heads/main/context-viewer-exports/codex-prompt-evolution-export-only-codex.json) — Codex's system prompt changes over time
- [Swapping prompts on SWE-bench](https://nilenso.github.io/context-viewer/g/67175678-6244-45bc-b022-238b72f8e646/comparison?sidebar=0&panel=0&legend=compact&sortBy=category&sortDir=asc&cols=5&import=https://raw.githubusercontent.com/nilenso/long-prompts-analysis/refs/heads/main/context-viewer-exports/swapping-prompts-swe-tasks.json) — how different system prompts affect agent behavior on identical tasks
- [Claude Code compaction analysis](https://nilenso.github.io/context-viewer/g/9a548109-f714-4e4a-a590-cba88af2193f/comparison?sortBy=name&cols=2&import=https://gist.githubusercontent.com/ssrihari/c2d86626e43bd51935ffd0034a20a083/raw/e98ce0e82f7cd84e0b6a3220a0a3da15b3a2aecc/pre-post-compaction-analysis.json) — pre vs post compaction breakdown of Claude Code sessions

The first four samples are from Drew Breunig's [System Prompts Define the Agent as Much as the Model](https://www.dbreunig.com/2026/02/10/system-prompts-define-the-agent-as-much-as-the-model.html).

### Demo

[![Context Viewer Demo](https://img.youtube.com/vi/tILkUHD3yz4/maxresdefault.jpg)](https://youtu.be/tILkUHD3yz4?si=ztlnsDeZu3RnkRYi&t=130)

### Quick Start

```bash
# Install bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Copy .env.example to .env and add your API key
cp .env.example .env
# Edit .env and set VITE_AI_API_KEY=your-api-key-here

# Start the development server
bun run dev

# Run tests
npx vitest run
```

### Environment Configuration

The application supports automatic semantic segmentation of large message parts using AI. This feature is optional but recommended for better analysis of large conversations.

Create a `.env` file based on `.env.example`:

```bash
# AI API Configuration for Semantic Segmentation
VITE_AI_API_KEY=your-openai-api-key
VITE_AI_MODEL=gpt-5.4-mini  # Optional, defaults to gpt-5.4-mini

# Optional: Use a different provider (Ollama, Cerebras, Groq, etc.)
VITE_AI_BASE_URL=http://localhost:11434/v1  # e.g. Ollama
VITE_AI_API_MODE=chat  # "chat" for non-OpenAI providers, "responses" (default) for OpenAI
```

#### Alternative providers

Any OpenAI-compatible API works. Set `VITE_AI_API_MODE=chat` for non-OpenAI providers.

| Provider | Base URL | Example model | Notes |
|----------|----------|---------------|-------|
| **Ollama** (local) | `http://localhost:11434/v1` | `gemma3:1b` | Free, no API key needed (set any value) |
| **Cerebras** | `https://api.cerebras.ai/v1` | `llama3.1-8b` | Free tier: 24M tokens/day, very fast |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` | ~$0.06/1M tokens, fast |
| **OpenAI** (default) | _(not needed)_ | `gpt-5.4-mini` | Uses Responses API by default |

## Documentation

- [System overview](docs/system-overview.md) — data model, processing pipeline, visualizations, and interactive workflow
- [Workflow](docs/WORKFLOW.md) — multi-stage pipeline from conversation log to visual insights
- [Capabilities](docs/CAPABILITIES.md) — what Context Viewer can do
- [Categorisation](docs/categorisation.md) — how conversation content is organized into semantic categories
- [Segmentation](docs/segmentation.md) — splitting message parts into self-contained semantic units
- [Tech stack](docs/tech-stack.md) — TypeScript/React stack, build tools, and libraries
- [Long prompts analysis](docs/long-prompts.md) — patterns and evolution of system prompts across CLI tools

## Design

Conversation data is private. Your data should stay with you. So this
implementation doesn't have a backend component. However, the
breakdown and classification is done by an LLM, so you'll need to
provide an API key. It could be an API key to the same provider as the
conversation, so the data stays in one place. This tool doesn't have a
server component which would require sending conversations to another
host apart from your model.

Input conversations should support a few formats, since this space is
evolving, still. To begin with, it will support the completions and
responses API formats. They're implemented behind an interface so it's
easy to add another format's parser.

This tool supports any OpenAI-compatible LLM provider, including local
models via Ollama. It uses Vercel's AI SDK with a configurable base
URL and API mode, so you can use OpenAI, Cerebras, Groq, or run a
small model like Gemma 3 1B locally.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
