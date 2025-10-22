## Message structure
<message_structure>
- token_count
- role: one of user / assistant / system / tool
- component (a single message can have multiple components)
  - token_count
  - type: instruction / input-context / artifact / result / tool / reasoning
  - name [2–4 word name for it that remains the same for this sort of thing through the conversation]
  - relevance: (similar to a list of tags from the following, can be 1 or more tags per component)
</message_structure>

## Prompt
<task>
in the given conversation
- take each message part, and add the properties in the message_structure below.
- wherever the message is complex, break the message down into multiple components that can be represented in the same message_structure.
- wherever there are xml tags in the messages, use the name of that tag as the component's name. one component per xml tag.
</task>


## Things I need to do:

[DONE] Milestone 0:
Define the tech stack
- Need model agnostic client
- Keep it browser-local, so there's no server-client / API
- Javascript all the way

[DONE] Milestone 1: show the conversation on the UI as-is
1. Parser interface
2. Parser implementation for completions and responses
3. Domain model for messages
4. Command to run program
5. Render HTML that allows a file to be drag-dropped


[TODO] Milestone 2: show components
- Get api-key
- Show spinner when calling AI
- Break down the messages to components
- Count tokens per component
- No relevance tags
- Render chips per component, create the responses visualisation

Milestone 3: time-travel view
- Build a slider that lets one visualise the context growth chronologically

Milestone 4: tree-map view
- Build a simple tree map that shows the components by size

Milestone 5: try it out
- Get some large conversations, and see how they look
- Make adjustments as necessary

Milestone 6: support multiple conversations
- Allow drag-drop up to 10 conversations at a time
- Process them in parallel
- Add simple pagination interface to move between conversations

Milestone 7: support grouping conversations
- When submitting, add a check box that says "group conversations"
- When grouped

## Feature prompts

### UI
okay, now implement this: when I run the program, it should open a
browser tab and render a web page. it should have an interface to
upload files. i am allowed to upload multiple files. they should be text files.

when I upload, these files are parsed, essentially it does what index.ts does right now.
it should display the conversation (scrollable), and the summary next to it.

read docs/tech-stack.md for library specifications

### Bugfix
the content of any message schema in schema.ts should not be a raw string, it should at least be a textpartschema. change it to reflect that.

### Token counts
add a token_count to the "parts" in the target schema.
- every part that has a "text" property will have a token count.
- for tool calls and results, concatenate the tool name, args, and output and then count total tokens.
- ignore images and files for now.
- use tiktoken to do this, see below for usage
- don't add token counts when parsing. only add token counts after parsing, perhaps in index.ts.

<tiktoken_usage>
Fast + parity with OpenAI encodings (WASM): tiktoken

npm i tiktoken

// Node, Bun, or browser (works with bundlers)
import { init, encoding_for_model } from "tiktoken/init";
import wasm from "tiktoken/tiktoken_bg.wasm";

await init((imports) =>
  WebAssembly.instantiate(await (await fetch(wasm)).arrayBuffer(), imports)
);

const enc = encoding_for_model("gpt-5"); // picks the right encoding
const count = enc.encode(yourText).length;
enc.free(); // release WASM memory

Vite
If you are using Vite, you will need to add both the vite-plugin-wasm and vite-plugin-top-level-await. Add the following to your vite.config.js:

import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
});
</tiktoken_usage>

###

### UI feedback
when loading larger conversation, i want feedback on the ui that something is happening. currently when i drag-drop a
large conversation, it looks like nothing is happening, or like something is broken. use - [TanStack Query (React
Query)](https://tanstack.com/query/v5/docs/react/overview) to show that we're parsing, or counting tokens.

### React components and shadcn/ui
Use react components as appropriate, don't just keep it all in one big component. use shadcn/ui, and find and use appropriate components from there for this interface. Here are components I can think of:
- file-uploader (drag-drop)
- conversation-list (like the file browser on the left of editors/ides)
- conversation-view, which is composed of
  - message-view (user,system, assistant, tool view, etc)
  - message-part-view (each part of the message, with the token count)
  - the above two views must collapse on click, showing only the label + token-count, not the entire contents. perhaps put the label and token count on the same line.
  - add a collapse-all/expand-all toggle on top of the conversation view that lets me see the structure of the conversation
- conversation-summary
### break down
- for each partb
