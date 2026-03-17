Thoughts on restructuring or rewriting.

- Colors are wonky. Default prompt doesn't say hexes. Needs fixing.
  - Colors are also per dimension now, but it's not implemented like that
  - Colors in grouped conversations are weird. Where does it pick up the colors from, if the colors of individual conversations are different?

- Filtering is broken.
  - Filtering in conversation to see effect in comparison is weird.
  - Multiple layers of filtering. Conversation, then components, then grouped conversation.
  - Want to filter by clicking on things, ideally, but that's not made intuitive right now.
  - Want to be able to filter by multiple components, and single components, and static role types etc at the same time.
  - Currently I can filter components out in conversation and see them reflect in group. But same doesn't happen for single conversation.

- Operations across levels is confusing
  - Sorting only works across messages. For large prompts, I want to sort the segments inside.
  - Expand and contract: i want to expand the message, but contract all the segments.

- Apply prompts to all doesn't do the right thing.
  - It should ideally apply the list of components as well, not just the components prompt.
  - Similarly on colors it should use the list of colors directly instead of just the prompt.

- Workflow visualisation is confusing
  - It's unclear what the color represents. Segments or messages? What should it actually be?

- Percentage visualisation might need toggle on precision, up to 2 decimal points.

- The workflow code and the understanding of it seems messy.
  - State management is buggy because it's not simple by design. The
    whole editing of prompts and iterative workflow was an
    afterthought, whereas the workflow needs to be more central and
    ground up given the current shape of the tool.
  - Generate summary in it's current posiotion is weird
  - The connection between summary and analysis is confusing too. Has tripped the LLM

- Time (duration) is not a fundamental concept. Being able to slice by time is important.
  - Currently only the workflow view and the static summary mention duration. And there's the time scrubber.
  - But I want it to be as primary as the count of tokens.
  - Trajectories have time information in them, but I'm not using them right now.

- Interface for editing prompts, especially after multiple dimensions, is weird.
  - Buried inside list of components
  - IMPORTANT: while iterating on prompts, it might help to have the older prompt in context, not just for editing, but for the LLM too.
    - having previous list of components in the context allows me to say "Don't do X, do Y" in the prompt
    - similarly for segmentation or colors.
    - this gives "iteration" a meaning, where we're building on what was, not just building anew

- Grouped conversations are an afterthought too. So, somewhat poorly implemented.
  - Waffle chart comparisons are one of the the most important features.
  - Summary and analysis on these would be very useful. Currently we don't get them. Analysis and summary of grouped conversations doesn't exist.
  - Groups are constructed by appending conversations one after the other. This is a hack, and it is nearing the end of its life.

- Presets don't work flawlessly
  - Exporting a preset, moving that file manually, registering in code before using, etc, is cumbersome.
  - "Apply prompts to all" is another way of doing this same thing that's confusing.

- The timeline graph isn't used at all. I thought it was the most
  useful thing when I built it, but currently it isn't being used.

- LLMs prodding on next step of analysis is a very useful thing. Using
  LLM's summary and analysis is very useful but poor guided right
  now. What are the best use cases for this so far?

- The parsers are great. They have worked flawlessly.

- I need to separate the core from the extras. The core =
  - Parsers, schemas, modelling of conversation
  - Token counting, segmenting, topic identification, classification, coloring, analysis / summary
  - Aggregates that go into visualisations, %s, etc
  - JSON Exports
  - Not core: filters, UI pieces, visualisations, presets, copy-to-markdown

- I don't have any tests. Rewriting would have been much easier with
  these. So in the rewrite I will start with tests.

- I want to do artifact chunking.

- I build routing, and URL based imports in a hurry before blog post launch. It's held up okay.
  - But I think it's not clean, the URLs are dirty, I think there are some hacks in there.
  - Especially the import URL stuff? Need to check.

- Terminology can be simpler, better
  - Context, not conversation, because context is not only conversations
  - "Automatic vs Static" components
  - "Dimensions"
  -
