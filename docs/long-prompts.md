## Problem statement
We want to analyse the contents of the system prompts of various CLI
tools. We will use the github repo of all system prompts to do
this. The point is to understand, and illustrate what's common across
various CLIs, and then to synthesise that information into usable
insight (if any).
- What _kind_ of instructions go into making a CLI?
- _Why_ do models need that prompting?
- How has that prompt changed over time?
  - What kind of things get added over time?
    - What does that say about organic discovery?
  - How have models have updates influenced the prompts?

And then the idea would be to repeat this for chatbots too. And then
potentially deep research tools/agents, and then potentially the
boyfriend/girlfriend kind of chats.

## Where context-viewer makes sense?
- Even if we as humans read all the system prompts, finding patterns
  across all of them is hard. And even more so if there are multiple
  versions of them.
- In this sense, it is not a conversation-context viewer as it exists
  today. It's a prompts-evolution viewer. Similar perhaps, but not the
  same thing.
- I can dump all contexts into a chat-gpt and prompt a useful
  analysis. However, the process involves:
  1. Breaking prompts down into semantic segments
  2. Assigning common component names across all prompts
  3. Viewing this change over time while measuring space
- Some back and forth between a chat-gpt and the data is useful, and
  this is what context viewer enables.
- What are the important dimensions of analysis?
  - We will be discovering this as we progress
  - Context length in the window, as a proxy for importance
  - Some semantic inference of emphasis in the text? Repeated
    instruction, Caps, negative instructions?
  - Common and not common parts of the prompts across CLIs

## Things to do
- Go through the github prompts repo, see what's in there actually
- Get the data together
- Read the prompts, do some of this analysis manually
- Read dbreunig's blog post:
  https://www.dbreunig.com/2025/05/07/claude-s-system-prompt-chatbots-are-more-than-just-models.html
- Read analyses of these system prompts by other people
- Add support for simple txt/md files into context-viewer
- Add support for combining multiple files into context viewer

## Open questions
- How do we want to deal with tools? CLI / Coding Agent prompts
  include available tools. Some have tools specified in the prompt and
  some have separate tools.json for this. How do we want to analyse
  tools?
- Similarly with examples?

### Rough notes
I want to collect the system prompts from various terminal-based
agentic-coding CLI tools. These should be available in github
repositories like these:
- https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools
- https://github.com/asgeirtj/system_prompts_leaks
- https://github.com/elder-plinius/L1B3RT4S
- https://github.com/jujumilk3/leaked-system-prompts
- https://github.com/dontriskit/awesome-ai-system-prompts
- https://github.com/elder-plinius/CL4R1T4S
- https://github.com/labac-dev/cursor-system-prompts
- https://github.com/thekishandev/ai-system-prompt

You can also explore github for various other repositories using topic
like these:
- https://github.com/topics/system-prompts
- https://github.com/topics/windsurf-ai

For the open source ones like Aider, OpenHands etc, get the official
system prompts from their official repos.

To put the data together, I'd like the prompts in this format (2
example rows added):
| agent/appp-name | version/number | date | source link (from github, or elsewhere) |
|-----------------------|----------------|------------|-----------------------------------------------------------------------------------------------|
| Anthropic Claude Code | unavailable | 2025-11-01 | https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code-2025-11-1.md |
| Anthropic Claude Code | 0.2.9 | 2025-05-24 | https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code.md |

The version numbers might be present inside the document, or in the
name of the document.  Similarly, the date might be present inside the
document, or in the file name, or the date of the commit, or when it
was added.

Terminal based AI agents I'd like to cover:
- [Anthropic Claude Code](https://www.anthropic.com/claude-code)
- [OpenAI Codex](https://github.com/openai/codex)
- [Google Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli)
- [Cursor CLI](https://cursor.com/cli)
- [Amazon Kiro CLI](https://kiro.dev/docs/cli/)
- [Moonshot Kimi CLI](https://github.com/MoonshotAI/kimi-cli)
- [Sourcegraph Amp](https://ampcode.com/)
- [Aider](https://aider.chat/)
- [OpenHands CLI](https://github.com/OpenHands/OpenHands-CLI)
- [Alibaba Qwen Code](https://github.com/QwenLM/qwen-code)
- [Block Goose](https://block.github.io/goose/)

Note that I DO NOT WANT the system prompts for the chat-bots, or other
usecases, I only want the system prompts for the above products.

#### Note: I ended up cloning all the above github repos and running claude on it to get the data
