# context-lens

Agent-facing CLI for analyzing AI conversation transcripts.

Choose dimensions that answer the user's question. Do not default to generic code-area axes unless the user specifically asks for that breakdown.

```bash
context-lens --spec - session.jsonl <<'JSON'
{
  "segmentation": {
    "threshold": 500,
    "prompt": "Split large message parts into chunks that preserve the evidence needed for the user's investigation."
  },
  "dimensions": [
    {
      "name": "dimension_chosen_for_this_question",
      "components": [
        {
          "name": "component_a",
          "description": "Specific criterion for assigning transcript parts to component_a."
        },
        {
          "name": "component_b",
          "description": "Specific criterion for assigning transcript parts to component_b."
        }
      ]
    }
  ],
  "colors": {
    "dimension_chosen_for_this_question": {
      "component_a": "#2563eb",
      "component_b": "#16a34a"
    }
  }
}
JSON
```

Store your API key in `~/.context-lens/.env`:

```bash
mkdir -p ~/.context-lens && printf 'OPENAI_API_KEY=%s\nOPENAI_MODEL=gpt-4o-mini\n' 'sk-REPLACE_WITH_YOUR_OPENAI_KEY' > ~/.context-lens/.env && chmod 600 ~/.context-lens/.env
```

`--api-key`, `OPENAI_API_KEY`, `VITE_AI_API_KEY`, and `AI_API_KEY` are also accepted for one-off use.

The CLI prints compact analytics JSON to stdout, writes a full Context Viewer export under `/tmp`, and prints concise progress to stderr as one start/end line per file and stage. The JSON includes `exportPath` and `contextViewerUrlTemplate`. For multi-file analyses, the export includes a viewer group and the template opens `/g/<group-id>/comparison` directly.

Agents should publish the export as a secret gist with `gh gist create`, fetch the raw URL with `gh api gists/<id>`, substitute it for `RAW_URL` in `contextViewerUrlTemplate`, and give users a Markdown link like:

```md
[Open in Context Viewer](https://nilenso.github.io/context-viewer/g/<group-id>/comparison?import=<raw-gist-url>)
```

Run:

```bash
context-lens --help
```
