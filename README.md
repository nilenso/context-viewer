# Context Viewer

Observability for contexts. Given a coversation log (messages), this
tool will provide a breakdown of its components and their sizes. It
also classifies messages into various categories so we can observe the
context in ways that matter to the business.

It comes with a UI that provides some visualisation options:
1. A simple components view with a time-slider: so we can see how the
   context changes as the conversation progresses.
2. A tree-map of the components to analyze the biggest parts of it.

This tool itself is very simple, and the data mostly comes from a
single prompt that you can use yourself. The visualisations are useful
though.

## Usage
Clone and run `command run`. It will open up a browser with the following UI.
<Image / GIF>

## Design

Conversation data is private. Your data should stay with you. However,
the breakdown and classification is done by an LLM, so you'll need to
provide an API key. It could be an API key to the same provider as the
conversation, so the data stays in one place. This tool doesn't have a
server component which would require sending conversations to another
host apart from your model.

Input conversations should support a few formats, since this space is
evolving, still. To begin with, it will support the completions and
responses API formats. They're implemented behind an interface so it's
easy to add another format's parser.

## Rationale

Context-engineering involves finding the most relevant context to
provide to an LLM. But unless we can actually see and pull-apart the
context, we can't understand the problem well enough to solve it.

- Context rot
- Context window length
- Context bloat

## Features
- Single and multiple-conversation
- Drag-drop conversation
- Auto-classifier for relevance-tags
- Recognizes artifacts
- Break down of messages into components
- Recognizes XML tags in the input
- Custom relevance tags
- Insights on context for context engineering
- Time-travel-view: to observe context bloat / rot
- Tree-map view: to observe size -> value
