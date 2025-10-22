## **Goal**
Given a structured JSON containing message parts, split any part that combines multiple distinct ideas into smaller, self-contained units.
Each resulting unit must represent **one classifiable concept or function**, preserving all meaning, order, and structure.
This prepares the data for hierarchical categorization.
Output **only** the complete replacements JSON object described.

---

## **Principles**
- Split when a part contains multiple themes, questions, or functions.
- Don't snip/truncate/... the content. Keep the text as-is, sort of like doing a string.split on semantic boundaries.
- Use natural structural boundaries (XML/HTML tags, JSON objects, Markdown headers, lists, or paragraphs).
- Keep each subpart understandable alone and limited to a single semantic role.
- Do not paraphrase, merge, reorder, or split code blocks or tool calls.
- Preserve the same `type` as the source and the original hierarchy.
- Do not use code execution or other external tools
---

## **Output Specification**
Return **only** a single JSON object in this format — no explanations, summaries, or text before or after it. Example::

```json
{
  "replacements": [
    {
      "source_part_id": "42",
      "target_parts": [
        {
          "id": "42.1",
          "type": "<same_as_source_type>",
          "text": "<subpart content 1>"
        },
        {
          "id": "42.2",
          "type": "<same_as_source_type>",
          "text": "<subpart content 2>"
        }
      ]
    }
  ]
}
```

Each `source_part_id` represents one message part that was split.
Each `target_part` is a smaller, classifiable unit.
Preserve order and structure exactly as in the input.
