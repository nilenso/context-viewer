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

[DONE] Milestone 4: tree-map view
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

## Things I've put a pin on
- spinner is not smooth
- parsing the tool definition
- turn off all reasoning by switching effort in vercel to none
- use any model that vercel's ai-sdk supports
- use a category tree (nested using dot notation) instead of a flat list, and allow zooming in a few levels.
  - Add ability to select zoom-levels in both the visualisation options
  - this will need the underlying abstraction to change quite a bit, and will have some cascading effects, but should be doable
  - token counts will need to sum up how many ever levels this is in
  - need to assess if a tree structure would actually work well with an llm
- create a button to optionally meta-analyse ai conversations from the context-viewer itself
- provide ability to iterate on the components with ai through the UI itself. provide a redo with feedback interface?

## Feature prompts

### Prompts around parsing and schema
I dug these up from claude's conversation history for reference

> can i use zod's parse to parse instead of writing custom parsing logic?

> delete old code if we don't need it

> do we have both the old and new parsers?

> help me understand how the contennt in completions-parser.ts makes sense if the schema is defined fully in input-schemas.ts, and we're already using zod to parse.


> let's remove the business logic from here. the parser should only parse and do nothing else. even though target structure has token count, component type etc, don't fill in those. let every message have a single component only. don't do any token
counts here either. role should just be one of the roles specified in the input schema, look for roles in the input files to expand if needed. log/input files should contain data from standard APIs anyway, so, don't need to lowercase etc.


> redo the message schema based on this pasted example structure. there are 4 types of messages. and each message has content that could be of various parts. user messages can have text, image and file parts. assistant can have reasoning and tool
call parts additionally. tools only share results for calls. the tool set should be passed in the user message. remove the component type, relevance tags, token count etc for now. just have these in there that represent the conversation itself. ##
API Signature

#### Parameters

<PropertiesTable
  content={[
    {
      name: 'model',
      type: 'LanguageModel',
      description: "The language model to use. Example: openai('gpt-4o')",
    },
    {
      name: 'system',
      type: 'string',
      description:
        'The system prompt to use that specifies the behavior of the model.',
    },
    {
      name: 'prompt',
      type: 'string | Array<SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage>',
      description: 'The input prompt to generate the text from.',
    },
    {
      name: 'messages',
      type: 'Array<SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage>',
      description:
        'A list of messages that represent a conversation. Automatically converts UI messages from the useChat hook.',
      properties: [
        {
          type: 'SystemModelMessage',
          parameters: [
            {
              name: 'role',
              type: "'system'",
              description: 'The role for the system message.',
            },
            {
              name: 'content',
              type: 'string',
              description: 'The content of the message.',
            },
          ],
        },
        {
          type: 'UserModelMessage',
          parameters: [
            {
              name: 'role',
              type: "'user'",
              description: 'The role for the user message.',
            },
            {
              name: 'content',
              type: 'string | Array<TextPart | ImagePart | FilePart>',
              description: 'The content of the message.',
              properties: [
                {
                  type: 'TextPart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'text'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'text',
                      type: 'string',
                      description: 'The text content of the message part.',
                    },
                  ],
                },
                {
                  type: 'ImagePart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'image'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'image',
                      type: 'string | Uint8Array | Buffer | ArrayBuffer | URL',
                      description:
                        'The image content of the message part. String are either base64 encoded content, base64 data URLs, or http(s) URLs.',
                    },
                    {
                      name: 'mediaType',
                      type: 'string',
                      description:
                        'The IANA media type of the image. Optional.',
                      isOptional: true,
                    },
                  ],
                },
                {
                  type: 'FilePart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'file'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'data',
                      type: 'string | Uint8Array | Buffer | ArrayBuffer | URL',
                      description:
                        'The file content of the message part. String are either base64 encoded content, base64 data URLs, or http(s) URLs.',
                    },
                    {
                      name: 'mediaType',
                      type: 'string',
                      description: 'The IANA media type of the file.',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'AssistantModelMessage',
          parameters: [
            {
              name: 'role',
              type: "'assistant'",
              description: 'The role for the assistant message.',
            },
            {
              name: 'content',
              type: 'string | Array<TextPart | FilePart | ReasoningPart | ToolCallPart>',
              description: 'The content of the message.',
              properties: [
                {
                  type: 'TextPart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'text'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'text',
                      type: 'string',
                      description: 'The text content of the message part.',
                    },
                  ],
                },
                {
                  type: 'ReasoningPart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'reasoning'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'text',
                      type: 'string',
                      description: 'The reasoning text.',
                    },
                  ],
                },
                {
                  type: 'FilePart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'file'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'data',
                      type: 'string | Uint8Array | Buffer | ArrayBuffer | URL',
                      description:
                        'The file content of the message part. String are either base64 encoded content, base64 data URLs, or http(s) URLs.',
                    },
                    {
                      name: 'mediaType',
                      type: 'string',
                      description: 'The IANA media type of the file.',
                    },
                    {
                      name: 'filename',
                      type: 'string',
                      description: 'The name of the file.',
                      isOptional: true,
                    },
                  ],
                },
                {
                  type: 'ToolCallPart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'tool-call'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'toolCallId',
                      type: 'string',
                      description: 'The id of the tool call.',
                    },
                    {
                      name: 'toolName',
                      type: 'string',
                      description:
                        'The name of the tool, which typically would be the name of the function.',
                    },
                    {
                      name: 'input',
                      type: 'object based on zod schema',
                      description:
                        'Input (parameters) generated by the model to be used by the tool.',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'ToolModelMessage',
          parameters: [
            {
              name: 'role',
              type: "'tool'",
              description: 'The role for the assistant message.',
            },
            {
              name: 'content',
              type: 'Array<ToolResultPart>',
              description: 'The content of the message.',
              properties: [
                {
                  type: 'ToolResultPart',
                  parameters: [
                    {
                      name: 'type',
                      type: "'tool-result'",
                      description: 'The type of the message part.',
                    },
                    {
                      name: 'toolCallId',
                      type: 'string',
                      description:
                        'The id of the tool call the result corresponds to.',
                    },
                    {
                      name: 'toolName',
                      type: 'string',
                      description:
                        'The name of the tool the result corresponds to.',
                    },
                    {
                      name: 'output',
                      type: 'unknown',
                      description:
                        'The result returned by the tool after execution.',
                    },
                    {
                      name: 'isError',
                      type: 'boolean',
                      isOptional: true,
                      description:
                        'Whether the result is an error or an error message.',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'tools',
      type: 'ToolSet',
      description:
        'Tools that are accessible to and can be called by the model. The model needs to support calling tools.',
      properties: [
        {
          type: 'Tool',
          parameters: [
            {
              name: 'description',
              isOptional: true,
              type: 'string',
              description:
                'Information about the purpose of the tool including details on how and when it can be used by the model.',
            },
            {
              name: 'inputSchema',
              type: 'Zod Schema | JSON Schema',
              description:
                'The schema of the input that the tool expects. The language model will use this to generate the input. It is also used to validate the output of the language model. Use descriptions to make the input understandable for the language
model. You can either pass in a Zod schema or a JSON schema (using the `jsonSchema` function).',
            },
            {
              name: 'execute',
              isOptional: true,
              type: 'async (parameters: T, options: ToolExecutionOptions) => RESULT',
              description:
                'An async function that is called with the arguments from the tool call and produces a result. If not provided, the tool will not be executed automatically.',
              properties: [
                {
                  type: 'ToolExecutionOptions',
                  parameters: [
                    {
                      name: 'toolCallId',
                      type: 'string',
                      description:
                        'The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.',
                    },
                    {
                      name: 'messages',
                      type: 'ModelMessage[]',
                      description:
                        'Messages that were sent to the language model to initiate the response that contained the tool call. The messages do not include the system prompt nor the assistant response that contained the tool call.',
                    },
                    {
                      name: 'abortSignal',
                      type: 'AbortSignal',
                      description:
                        'An optional abort signal that indicates that the overall operation should be aborted.',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },


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

### tree map [abandoned]
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

### ux: show progress better
Rather than showing statuses one after another in the same place that vanish,
create a small section under the file name in conversations list
create a list of checkboxes there for showing progress. update those line items to show which item is in progress, and mark them done.
have a simple > to expand/collapse that section
keep it expanded by default

### add nilenso branding
- get nilenso's logo from https://nilenso.com/.
- make the title of the page nilenso(logo)/context-viewer
### [Dropped] ability to turn off reasoning and use gpt-5-nano
i want to use gpt-5-nano, but i feel like the vercel-ai-sdk doesn't
have a way to set reasoning to off, I think nano is still very slow
because of that. look at the openai spec, with the repsonses api, and
see if there's a way i can turn off reasoning through vercel.
###

### Format json in tool calls
in the tool calls and tool call results, when parsing, if the text content is json, format it as json
### Allow simultaneous uploads
when all am i not-allowed to drop new files? sometimes when there are things in progress, I'm unable to drag-drop new
files. why is this? and what's a reasonable behaviour.
### Some misc fixes (each it's own prompt)
- in the left pane, it isn't clear which conversation is currently selected
- clicking on the expanded area (progress section) should also select the covnersation
### Show time with progress
- i want to see the time in seconds, that each step took, next to the progress, like "Segment Content (5s)", rounded to nearest second. Not just time the AI call, but time the whole section.
### Support conversation format
Look at the file sample-logs/conversations/swing_storymachine.json.
I want to support this file's format as input.
Build a parser like we have for responses and completions. Call this one conversations.
official docs for item list is this:
```
The item list
A list of Conversation items.

data
array

A list of conversation items.


Hide possible types
Message
object
A message to or from the model.


Show properties
Function tool call
object
A tool call to run a function. See the function calling guide for more information.


Show properties
Function tool call output
object
The output of a function tool call.


Show properties
File search tool call
object
The results of a file search tool call. See the file search guide for more information.


Show properties
Web search tool call
object
The results of a web search tool call. See the web search guide for more information.


Show properties
Image generation call
object
An image generation request made by the model.


Show properties
Computer tool call
object
A tool call to a computer use tool. See the computer use guide for more information.


Show properties
Computer tool call output
object
The output of a computer tool call.


Show properties
Reasoning
object
A description of the chain of thought used by a reasoning model while generating a response. Be sure to include these items in your input to the Responses API for subsequent turns of a conversation if you are manually managing context.


Show properties
Code interpreter tool call
object
A tool call to run code.


Show properties
Local shell call
object
A tool call to run a command on the local shell.


Show properties
Local shell call output
object
The output of a local shell tool call.


Show properties
MCP list tools
object
A list of tools available on an MCP server.


Show properties
MCP approval request
object
A request for human approval of a tool invocation.


Show properties
MCP approval response
object
A response to an MCP approval request.


Show properties
MCP tool call
object
An invocation of a tool on an MCP server.


Show properties
Custom tool call
object
A call to a custom tool created by the model.


Show properties
Custom tool call output
object
The output of a custom tool call from your code, being sent back to the model.


Show properties
first_id
string

The ID of the first item in the list.

has_more
boolean

Whether there are more items available.

last_id
string

The ID of the last item in the list.

object
string

The type of object returned, must be list.
```

### I'm just parsing input messages, need to parse the output too

### components in conversationv iew
i want to see the components of a message's parts in the conversation view too.
so, in the title of the message part, along with "TEXT", "1010 Tokens", I want to see the same sort of chip with color indicating the component this message part is assigned to

### change large segment selection logic
instead of choosing large by 10% or whatever %, just decide that any part greater than 500 tokens is large enough to be segmented

### Changeable components prompt
I want to expose the prompt used to identify the components in the UI, and make it editable by the user.
The first run to componentisation can run automatically as per the prompt in code.
In the UI, above the components in the tab, I want to see an edit button that will expand text area to edit this prompt
The user can edit it and run it. There's a run button, cancel button, can also cmd+enter to run in addition to the button.
Near the actions, i want to indicate to the user that doing this will re-run componentisation, re-render visualisation and the analysis.
Keep the output format specification in the code, don't show it on the UI, and append it to the prompt shown on the interface before sending to AI.
In the text area, indicate that one can edit this to specify a different, or more appropriate way to componentise this, but request to keep it simple for good results.
- when I run from the prompt, I want the progress to be visible on the conversation list like it does the first time. It should go back to componentisation, redo the assign colors and analysis stages.
- show the prompt and area etc only when edit prompt is clicked, keep it hidden/collapsed until then.
- when I switch away from the text area and come back to it, the contents switch back to the original/default prompt, they should show the current prompt

#### refactor
- It looks like the custom prompt workflow in app.tsx is implemented independently of the original workflow.
- I want a structure in the workflow. I want the activities to be composable enough that parts of the workflow can be redone. I want to also be able to create alternative workflows easily.
- Find an abstraction for an activity that would satisfy the composability criteria and propose that to me.
  - instead of automatically figuring out parallelism based on dependencies, lets keep the workflow imperative in code, but still using the underlying activities. no magic in figuring out parallelism or execution, and no DSL. just code to write out the workflow execution.
  - workflow abstraction will then be about managing state, especially for multiple files that are being processed in parallel.
  - activities return specific types based on their result. they take in workflow context as input. but all state managmenet of workflow happens in code inside the workflow, not inside context. this is so that all common-state management is in one place, especially considering parallel activities.
  - to reuse the workflow execution for the edit-prompt use-case, the workflow can be started with an event-type (enum type). if the event is new-file, then default execution occurs. if event is component-prompt-changed, then it picks up from components instead.
  - in the future, if there's a segment-prompt-changed event, then the workflow can use that event to guide execution, or skip steps appopriately
  - instead of a switch on the event, just skip activities based on the event type. for exampel, if event is WorkflowEvent.ComponentPromptChanged, then skip the initial steps.

##### Bugs, iteration
  * Rendering of the conversation doesn't seem to be happening correctly. It gets stuck in "parsing" in the middle pane, until workflow until analysis is complete.
  * [Image #1] see that the middle pane still shows parsing when the left pane shows that it's moved on
  * no, it should not show the step name, it should show the parsed covnersations.
  * activities should not be updating state, only workflow should be updating state. look for other places as well where this happens, and fix them all.
  * what is interface `ParsedConversation {?` it feels like a duplicate of workflow. is it the workflow? can we name it
  * how is workflow-context different from workflow-state? appropriately if not?
  * Option A: Merge them into one type with all fields optional, and the workflow/React just use what they need?
  * i find that when I edit the prompt in components, it immediately wipes out the interface etc, perhaps because the state
powering the component is getting reset on submitting a new prompt. instead, can we only change the interface / set state
when the new components are being generated? that way I can play with the existing components until then. also, the edit
prompt can be disabled / hidden until componentisation is done and we can redo the prompt.
##### Renaming
  - this function in app.tsx ``async function parseFiles(`` strikes me as odd. how is it different from other workflow activities? suggest a different name
   - `Return type containing WorkflowState array` this can be workflowStates if its literally an array of workflow states?
  - conversations sounds good, as long as it doesn't conflict with the use of that name for other things
  - how about `runWorkflows`? and also look at the other variables which start with parse, and see if they're parsing related or workflow related or something else, and suggest better name there too.
### Disable animation with recharts
