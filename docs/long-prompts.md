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
