## Milestones

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

[DONE] Milestone 2: show components
- Count tokens per component
- Get api-key
- Show spinner when calling AI
- Break down the messages to components
- No relevance tags
- Render chips per component, create the responses visualisation

[DONE] Milestone 3: time-travel view
- Build a slider that lets one visualise the context growth chronologically

[DOING] Milestone 4: tree-map view
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
### bugfix on parsing reasoning
checkout sample-logs/responses/1.json, and see the reasoning message. it has multiple elements in the array of summary.
 however, when parsed into our format in schema, it only has one reasoning part. it should parse multiple array elements
each into one reasoning part, which together will be inside the same assistant message.

### UX improvement: immediate feedback on drag-drop, and others
- when I upload 2 files, I want to see them appear immediately in the conversation list, so that i know the drag-drop
- operation has succeeded, and that the system is processing. currently there's a delay.
- after parsing is done, render the ui with the messages. let the counting of tokens happen with the progress indicator
in the conversation list. when the counting of tokens is done, show it the token counts on the component.
- make the conversation list the drag-drop area, and remove the top-banner. show the dotted border line around the
conversation list instead. and also show the drop files ehre to select text, etc in the conversaiton list.
### bug fix: empty text part in assistant messages
when parsing assistant messages, there seems to be an empty text part before the tool calls? why is that?
### break down messages
use vercel's ai sdk: - [Vercel AI SDK (“ai”)](https://ai-sdk.dev/docs/introduction)
- i want to take an api key and model as env-vars when starting the program
- after the token count, identify message parts that account for more than 10% of the total token count.
- this is a new stage int eh conversation, so you can count it into the status as "segmenting"
- for each of these message parts that are large, break them down further using the following mechanism
  - send the message part's text and the following prompt to ai using the ai-sdk
  - get back structured json response, that's just an array of substrings
  - use those substrings to split the text, and create new parts with new ids and replace this message part with them
  - re-render the component if necessary to pick up the new components
- process all the large message parts in parallel because the call to ai is slow and i want to show results on the ui as and when the parts are updated
- add all semgentation code in segmentation.ts or equivalent

here's the prompt to use:
```
Given the following text, tell me where all you would apply a break.
The purpose is semantic segmentation in way that's suitable for hierarchical categorization.
Only give me the top level sections.
Return an array of substrings which I can use to run string split on in javascript, and return nothing else.
```

### components
- after segmentation, call ai with the full json of the conversation, and this prompt:
---
given this conversation, give me a list of all its components
just give me a list in a json array
 <conversation>{conversation}</conversation>
---

- then, with the result of components in a json array, make another call with this promopt:
---
given this conversation and the list of components, give me a mapping
of id in the conversation, to a component from the list, for all the messages
just give me a simple json object {id: component}

<conversation>{conversation}</conversation>
 <components>{components}</components>
---
- the conversation's status should say "Finding components"
- make middle "Conversation" section a part of a tab group
- add a tab for "Components", and in there, show the result mapping as ids (for now, we'll improve on this)
- create a componentisation.ts and write all relevant code there

### component visualisation
now, in the components tab, above the mapping display, create a visualisation that shows the list of categories as
chips/boxes like this diagram. [Image #1] (anthropic context viz)

### component part token counting
now, after component-mapping the message parts to the components, based on the ids, and the token counts of the message
parts, create total counts per component, and display them in the components overview as a badge, isntead of the number
of parts

### give ids to message parts and messages
when parsing give each message and message part a small and unique id, keep the implementation really simple. add the
id to schema too.

### time slider
i want a slider that I can control on top of the conversation overview diagram.
every step on the slider represents a "message" (not a message part) in the conversation
the conversation overview diagram needs to represent the contents of the conversation until that message
the components, token counts, everything should reflect the conversat until that message
as i move that forward and backward, the overview should change to reflect the composition of the covnersation until that point
do all the computation in advance, along with the componentisation, so that the slider works smoothly

### summary of conversation
at the same time that segmentation starts, start off another ai call
- make an ai call to get a "summary of the conversation. the goal, turns of conversation, and result"
- show this in the right-panel instead of the summary of counts we show right now.
- stream this text to the view so UX is nicer
- all this should happen in parallel as the segmentation, and componentization happen

### message part summarisation [reverted]
after segmentation is complete, start a new status / process called "summarising"
- use the following prompt, and get a summary of message-part-ids to their summaries
- send 10 messages from the conversation at a time to a single api call, and make parallel ai calls to cover all of them
- collect all responses together and create a single collection of all the summaries
- store the ids to summaries in a different variable called message-summaries (add a window.__debug variable for this so i can inspect/debug)
- use the message-summaries as the input for componentisation instead of the full conversation json

 prompt:
---
  given the following json, give back an array of message-parts with just short-line summary of the message-part's text.
  output just a json like this: {id: 42, summary: text}
  messages: ```{list of messages go here}```
---

### component detail on click
instead of the component mapping section under the overview diagram,
when i click on a component in the overview (make that clickable,
selectable), show the relevant messages and their parts in the section
below. include their summaries, token counts, etc.

### debug response times
symptom: ai network calls take 10s of seconds
known facts: gpt-5-nano model is fast, same works super fast on chat-gpt
come up with possible

### refactor: extract prompts
i want to manage all my prompts from a single place. create a prompts.ts which has a simple keyword to prompt map, and use that everywhere

### get component colors from ai
- after rendering components, keep them all gray
- make a call to ai to get colors for the components
- idea is to make similar kinds of components the same color
- use the current color set, provide a list of simple color names to ai in prompt
- ask it to get back with component to color name just like in other prompts
- update component and render with the new colors
- set status as "coloring"

### [TODO] provide ability to iterate on the components through the UI itself

### tree map
- create another tab like components
- in it, i want a different view. i want a tree map visualisation that represents space occupied
- total space is total tokens
- the parts of the tree and their sizes/spaces are the components and their token counts
- use same colors for components as the components tab
- need the slider here + click-to-view the parts functionality here too
- reuse react components across tabs where possible

### bug fix: rendering delayed after segmentation
the conversation view doesn't seem to get updated after segmentation,
 it only seems to get updated with the segments after componentisation
or after something later. debug it, and if you find it fix it


### AI analysis
- create another tab in the right pane of the summary, and call it analysis
- after componentisation and coloring is done, start the analysis status
- send the components, their counts and %s over time as a csv, along with the ai-summary of conversation to ai, and ask for an analysis
- analysis should be in markdown and shown the smae way the summary is
- intent is to get ai to tell us what we're looking to find out for ourselves anyway
- which is find ways to improve context relevance
### UI fix expand button
- move the expand/collapse-all button into the conversation tab

### [TODO] create a button to optionally meta-analyse ai conversations from the context-viewer itself

### ux: show progress better
Rather than showing statuses one after another in the same place that vanish,
create a small section under the file name in conversations list
create a list of checkboxes there for showing progress. update those line items to show which item is in progress, and mark them done.
have a simple > to expand/collapse that section
keep it expanded by default

## Things I've put a pin on
- spinner is not smooth
- parsing the tool definition
- turn off all reasoning by switching effort in vercel to none
