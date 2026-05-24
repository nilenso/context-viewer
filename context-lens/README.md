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

The CLI prints compact analytics JSON to stdout and writes a full Context Viewer export under `/tmp`. Agents should publish that export as a secret gist with `gh gist create`, fetch the raw URL with `gh api gists/<id>`, and give users a Context Viewer link like:

```txt
https://nilenso.github.io/context-viewer/?import=<raw-gist-url>
```

Run:

```bash
context-lens --help
```
