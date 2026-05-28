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
mkdir -p ~/.context-lens && printf 'OPENAI_API_KEY=%s\nOPENAI_MODEL=gpt-5.4-mini\n' 'sk-REPLACE_WITH_YOUR_OPENAI_KEY' > ~/.context-lens/.env && chmod 600 ~/.context-lens/.env
```

`--api-key`, `OPENAI_API_KEY`, `VITE_AI_API_KEY`, and `AI_API_KEY` are also accepted for one-off use.

The CLI prints analytics JSON to stdout, including `exportPath` and `contextViewerUrlTemplate`; progress goes to stderr.

To share results, optionally edit `exportPath` first to set `files[].title` and `groups[].title` for better viewer labels. Keep `ids`/`fileIds` unchanged. Then publish `exportPath` as a secret gist, replace `RAW_URL` in `contextViewerUrlTemplate` with the gist raw URL, and give users one Markdown link:

```md
[Open in Context Viewer](https://nilenso.github.io/context-viewer/g/<group-id>/comparison?import=<raw-gist-url>)
```

Run:

```bash
context-lens --help
```
