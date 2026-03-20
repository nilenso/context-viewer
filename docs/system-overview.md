# Context Viewer: System Overview

A formal description of the data model, processing pipeline, visualizations,
and interactive workflow. For directory structure and code organization, see
[architecture.md](./architecture.md).

## Data Model

```
type Id        = Text
type Tokens    = Int
type Timestamp = Text
type Component = Text
type Color     = HexString
type Prompt    = Text
type Threshold = Int
type Regex     = Text

-- Parts (the atomic units of content)

data TextPart       = TextPart       Id Text Tokens
data ReasoningPart  = ReasoningPart  Id Text Tokens
data ToolCallPart   = ToolCallPart   Id { toolCallId, toolName, args :: Value } Tokens
data ToolResultPart = ToolResultPart Id { toolCallId, toolName, output :: Value, isError :: Bool } Tokens
data ImagePart      = ImagePart      Id Text (Maybe MediaType)
data FilePart       = FilePart       Id { data, mediaType :: Text, filename :: Maybe Text }

-- Messages (sequences of parts, tagged by role)

data UserContent      = UCText TextPart | UCImage ImagePart | UCFile FilePart
data AssistantContent = ACText TextPart | ACFile FilePart | ACReasoning ReasoningPart | ACToolCall ToolCallPart

data Message
  = System    Id (NonEmpty TextPart)          Timestamp
  | User      Id (NonEmpty UserContent)       Timestamp
  | Assistant Id (NonEmpty AssistantContent)   Timestamp
  | Tool      Id [ToolResultPart]             Timestamp

-- A conversation is a sequence of messages

data Conversation = Conversation [Message]
```

A typical coding trajectory has parts ranging from 50 tokens (short user
prompts) to 45,000 tokens (large file reads or test output). Reasoning
blocks run 8,000–22,000 tokens. Tool call inputs with large edits can
reach 20,000+ tokens.


## Processing Pipeline

A single conversation goes through these steps **in sequence**. Each step
feeds its output to the next.

```
parse → countTokens → segment → identifyComponents → mapComponents → assignColors
                                                                          |
                                                              AnnotatedConversation
```

### Step 1: Parse

```
parse :: File -> Conversation
```

Read a file (JSON, JSONL, Markdown, or other supported format), detect its
format via a parser registry, and produce a normalized `Conversation`.


### Step 2: Count Tokens

```
countTokens :: Conversation -> Conversation
```

Walk every part. For text and reasoning parts, tokenize `part.text` using
the GPT-4o tiktoken encoding. For tool-call parts, tokenize
`toolName + JSON(args)`. For tool-result parts, tokenize
`toolName + JSON(output)`. Store the count on each part. Skip images and
files.


### Step 3: Segment

Split large parts into smaller semantic chunks so that component
identification has finer-grained material to work with.

```
findLargeParts :: Threshold -> Conversation -> [Part]
  -- Filter parts where tokenCount > threshold (default: 100).
  -- Only considers text and reasoning parts.

findSplitPoints :: Prompt -> Text -> [Regex]
  -- AI call: "given this text, where would you apply a break?"
  -- Returns regex lookaheads, e.g. ["(?=## Section 1)", "(?=## Section 2)"].

splitText :: [Regex] -> Text -> [Text]
  -- Combine regexes into one pattern, run text.split(combinedRegex).

segmentPart :: Prompt -> Part -> [Part]
  -- splitPoints = findSplitPoints(prompt, part.text)
  -- segments    = splitText(splitPoints, part.text)
  -- Return new parts with IDs "parentId.1", "parentId.2", etc.

segment :: Threshold -> Prompt -> Conversation -> Conversation
  -- largeParts = findLargeParts(threshold, conversation)
  -- For each large part (IN PARALLEL):
  --     replace it with segmentPart(prompt, part)
  -- Small parts pass through unchanged.
  -- Recount tokens on newly created parts.
```


### Step 4: Identify Components

Discover what the distinct categories or components are in this
conversation.

```
identifyComponents :: Prompt -> Conversation -> [Component]
  -- Strip binary data from conversation to reduce token count.
  -- Single AI call: send the full (stripped) conversation as JSON.
  -- AI returns a JSON array of component names.
  -- e.g. ["EXPLORE", "IMPLEMENT", "VERIFY", "ANALYZE", "PLAN"]
```

This is one AI call for the entire conversation.


### Step 5: Map Components

Assign every message part to one of the identified components.

```
extractParts :: Conversation -> [PartWithContext]
  -- Flatten all parts with their message index, role, part type, and content.

mapBatch :: [Component] -> [PartWithContext] -> Map PartId Component
  -- Single AI call: "given these components and these parts, classify each."
  -- Returns { "part-id-1": "EXPLORE", "part-id-2": "IMPLEMENT", ... }.

mapComponents :: [Component] -> Conversation -> Map PartId Component
  -- allParts = extractParts(conversation)
  -- batches  = chunk(allParts, batchSize = 20)
  -- results  = IN PARALLEL: map (mapBatch components) batches
  -- Return merge(results).
  -- Parts not mapped by any batch get assigned to "other".
```

Parts are processed in **batches of 20, all batches in parallel**.


### Step 6: Assign Colors

```
assignColors :: [Component] -> Prompt -> Map Component Color
  -- AI call: "assign a distinct hex color to each component."
```


### Result

```
data AnnotatedConversation =
  { conversation :: Conversation           -- segmented, with token counts
  , components   :: [Component]
  , mapping      :: Map PartId Component
  , colors       :: Map Component Color
  , timeline     :: [TimelineSnapshot]     -- derived from mapping
  }

data TimelineSnapshot =
  { messageIndex    :: Int
  , componentTokens :: Map Component Tokens  -- cumulative tokens per component up to this message
  , totalTokens     :: Tokens                -- cumulative total up to this message
  }
```

The timeline is computed deterministically from the mapping (no AI). For
each message index, it accumulates all part tokens seen so far, grouped
by component.


## Visualizations

### Waffle Chart (Token Distribution)

A **20x20 grid of 400 squares**. Each square represents 0.25% of total
tokens. Components are colored and sized proportionally to their token
share. Components with any tokens get at least one square.

Beside the grid, a legend lists each component with its color, token
count, and percentage. The legend is sortable by tokens or name. Clicking
a component in the legend filters the conversation view to show only parts
belonging to that component.

A **mini waffle chart** (10x10, 100 squares) is used in the comparison
view to show multiple conversations side by side at a glance.

An **absolute waffle chart** (variable height) supports cross-conversation
comparison where the grid size reflects actual token count rather than
percentage, so you can visually compare the scale of different
conversations.


### Stacked Bar Chart (Component Growth Over Time)

A stacked bar chart with **one bar per message**. Each bar is divided into
colored segments representing the components present in that message's
parts. The y-axis shows token count.

Interactivity:
- **Hover** a bar to preview that message's component distribution.
- **Click** a bar to pin it and lock the preview.
- Below the chart, a parts table shows the individual parts of the
  selected message with their types and components.
- Clicking a component in the legend filters to show only that component's
  contribution across all messages.


### Timeline Slider (Scrubbing)

A slider from message 0 to message N. Dragging it updates the waffle
chart in real time to show the cumulative component distribution up to
that point in the conversation. Displays "Message X of Y" and cumulative
token count.


## Analysis

Analysis is an **on-demand** step. The user triggers it after the pipeline
completes.

```
generateComponentCSV :: [TimelineSnapshot] -> [Component] -> Text
  -- Convert the timeline into a CSV table:
  -- Header: "Message, Total Tokens, Component1 (tokens %), Component2 (tokens %), ..."
  -- One row per message with cumulative token counts and percentages.

generateAnalysis :: Conversation -> [TimelineSnapshot] -> [Component] -> Summary -> Prompt -> Text
  -- Inputs:
  --   The conversation text
  --   The component timeline as CSV (token growth over time)
  --   The list of components
  --   A previously generated AI summary
  --   A customizable analysis prompt
  --
  -- Single AI call (streamed). The default prompt asks for:
  --   Context growth patterns
  --   Redundancy and efficiency observations
  --   Context relevance assessment
  --   Recommendations
  --
  -- Output: Markdown text, streamed chunk by chunk into the UI.
```

The AI summary is generated first (also on-demand, also streamed), and
then passed as input context to the analysis step.


## Grouping and Comparison

Multiple conversations that have each been processed independently can be
**grouped** for side-by-side comparison. Grouping involves no AI calls —
it is pure data merging.

```
group :: [AnnotatedConversation] -> GroupedConversation
  -- 1. Concatenate all messages, prefixing IDs to avoid collisions.
  --      For each conv, for each message, for each part:
  --        newPartId = conv.id ++ "-" ++ part.id
  --        Track sourceInfo[newPartId] = { convId, filename }.
  --
  -- 2. Merge components: union of all component sets.
  --
  -- 3. Merge mappings: remap part IDs to prefixed IDs.
  --      For each conv, for each (partId -> component):
  --        mergedMapping[conv.id ++ "-" ++ partId] = component
  --
  -- 4. Merge colors: later conversations override earlier ones.
  --
  -- 5. Rebuild timelines from merged data (deterministic, no AI).

data GroupedConversation =
  { conversation :: Conversation             -- concatenated messages
  , components   :: [Component]              -- union of all
  , mapping      :: Map PartId Component     -- merged, with prefixed IDs
  , colors       :: Map Component Color      -- merged
  , timeline     :: [TimelineSnapshot]       -- rebuilt
  , sourceMap    :: Map PartId SourceInfo    -- which conversation each part came from
  , sources      :: [{ id, filename }]
  }
```

### Comparison View

The grouped data is sliced back apart per source conversation to produce
side-by-side statistics.

```
compare :: GroupedConversation -> [ConversationStats]
  -- For each source conversation:
  --   Walk its messages, sum tokens per component using the mapping.
  --   Count turns (user messages), total messages, duration.
  --   Identify primary component per message (from its first mapped part).

data ConversationStats =
  { id              :: Text
  , filename        :: Text
  , componentTokens :: Map Component Tokens
  , totalTokens     :: Tokens
  , turnCount       :: Int                    -- number of user messages
  , messageCount    :: Int
  , duration        :: Duration
  , messageFlow     :: [Component]            -- primary component per message, in order
  }
```

Each conversation gets a mini waffle chart and summary statistics. The
absolute waffle chart mode lets you compare conversations by scale
(a 200k-token conversation visually dwarfs a 50k-token one).


## Interactive Iteration

All of this runs in a browser-based UI. The pipeline is not a one-shot
process — the user interacts with the results and refines them
iteratively.

After any step completes, the user can:

- **Edit the segmentation prompt and threshold.** Change how aggressively
  text is chunked. Lowering the threshold segments more parts; raising it
  leaves more parts intact. This reruns: segmentation → components →
  colors.

- **Edit the component identification prompt.** Change what the AI looks
  for. For example, switch from "workflow phases" to "code areas" or
  "topic categories." This reruns: components → colors.

- **Edit the component list directly.** Add, remove, or rename components
  by hand without involving AI identification. The mapping step reruns
  against the new list. This reruns: mapping → colors.

- **Edit the coloring prompt.** Change how colors are assigned. This
  reruns: coloring only.

- **Edit the summary prompt.** Change what the AI summary focuses on.
  This reruns: summary only.

- **Edit the analysis prompt.** Change what the analysis examines (e.g.,
  focus on redundancy, or on tool usage patterns). This reruns: analysis
  only.

- **Apply prompts to all.** Copy the current conversation's prompts and
  threshold to every other loaded conversation and reprocess them. Only
  the minimal necessary steps rerun per conversation (if only the coloring
  prompt changed, only coloring reruns).

- **Export prompts as a preset.** Save the current prompts, components,
  colors, and threshold as a JSON file. This preset can be loaded later
  or shared with others.

Each reprocessing step shows progress spinners in the sidebar. Multiple
conversations can reprocess in parallel. The user can continue browsing
other conversations while reprocessing runs.


## Full Picture

```
                         file
                          |
                        parse                          ──┐
                          |                              |
                     countTokens                         |
                          |                              |  Sequential
                   segment (parallel per part)           |  per conversation
                          |                              |
              identifyComponents (single AI call)        |
                          |                              |
              mapComponents (batched, parallel)           |
                          |                              |
                    assignColors                       ──┘
                          |
                AnnotatedConversation
                     /        \
                    /          \
          [on demand]      [select 2+, no AI]
              |                    |
     summary → analysis        group → compare
       (streamed)            (merge + slice)
                                   |
                           [ConversationStats]
                           (side-by-side view)

     ◄──── At any point, the user can edit prompts and iterate ────►
```
