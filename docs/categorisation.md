## **Context Category Map Generator (Final Unified Form)**

**Goal**
Produce a **hierarchical category map** that shows how information is organized in a conversation. Each category aggregates related message parts, summaries, and structure, enabling visualization and navigation of context usage.

**Instruction**
Given a structured conversation where each message part has a unique `message_part_id`, build a JSON tree that groups the conversation into semantically coherent categories and subcategories.

Do **not** use code tools or programmatic parsing for this task. Use reasoning and language understanding only.

### Your task
1. **Identify major categories** – infer the dominant conceptual or functional blocks from the conversation (for example: *Checklist of questions*, *File reads*, *Reasoning*, *Decisions*).
2. **Decompose recursively** – create subcategories only where the material naturally divides into smaller, meaningful topics.
   - Do **not** fix the number of levels; infer depth as needed.
3. **Assign message parts** – tag each message part with exactly one category or subcategory that best represents its content, using its `message_part_id`.
4. **Summarize each category** – every category node, including children, must contain:
   - `id`: unique short identifier, preferably using dot notation to indicate hierarchy (for example: `checklist`, `checklist.data_model`, `analysis.synthesis`)
   - `name`: concise label
   - `summary`: one-sentence description of what this category covers
   - `message_parts`: array of `message_part_id`s assigned directly to this category
   - `children`: nested categories, if any
5. **Preserve domain terminology** – derive category names from the conversation’s subject matter.
6. **Output** – return a structured, machine-readable JSON array representing the hierarchy, ready for downstream parsing and visualization.

---

### Reflection
Before returning the final JSON, perform the following validation steps:

1. **Completeness check** – ensure every `message_part_id` from the input appears in exactly one category.
2. **Representativeness check** – verify that the categories and subcategories together capture the overall structure and intent of the conversation, aligned with the goal.
3. **Domain integrity check** – confirm that terminology and phrasing reflect the conversation’s domain accurately, not abstract generalizations.
4. **Ground-level identification check** – make sure ground-level material (for example: detailed lists, code, or data) is correctly placed in leaf categories.
5. **Empty-category check** – remove or merge any category that has no assigned `message_parts` and no children with assigned parts. Categories without content are not useful.
6. **Final coherence review** – confirm that summaries are accurate, hierarchy depth is sensible, and the map as a whole provides a faithful and navigable representation of the conversation.

---

### Output specification
Return a **JSON array** of top-level categories.

**Example (illustrative only, not a schema):**

```json
[
  {
    "id": "checklist",
    "name": "Checklist of questions",
    "summary": "User’s structured audit checklist.",
    "message_parts": ["mp_12", "mp_13"],
    "children": [
      {
        "id": "checklist.data_model",
        "name": "Data model checks",
        "summary": "Questions about schema alignment.",
        "message_parts": ["mp_14", "mp_15"]
      },
      {
        "id": "checklist.security",
        "name": "Security and authentication checks",
        "summary": "Questions related to authentication and authorization.",
        "message_parts": ["mp_16"]
      }
    ]
  },
  {
    "id": "analysis.synthesis",
    "name": "Analysis and synthesis",
    "summary": "Assistant’s reasoning and conclusions.",
    "message_parts": ["mp_20", "mp_22"]
  },
  {
    "id": "files.reads",
    "name": "File readings and tool calls",
    "summary": "Assistant’s inspection of repository files using tools.",
    "message_parts": ["mp_30", "mp_31"]
  }
]
