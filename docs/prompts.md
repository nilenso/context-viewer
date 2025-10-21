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


## Things I need to do:

Milestone 0:
Define the tech stack
- Need model agnostic client
- Keep it browser-local, so there's no server-client / API
- Javascript all the way

Milestone 1: show the conversation on the UI as-is
1. Parser interface
2. Parser implementation for completions and responses
3. Domain model for messages
4. Command to run program
5. Render HTML that allows a file to be drag-dropped


Milestone 2: show components
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
