# Token Counting

Add token counts to each part using tiktoken with GPT-4o encoding.

## Overview

Token counting adds a `token_count` field to each part, enabling analysis of how tokens are distributed across the document.

## Input

Parsed JSON with parts.

## Output

Same JSON with `token_count` added to each part:

```json
{
  "source": "filename.txt",
  "parts": [
    {
      "id": "part-1",
      "text": "Some text content here...",
      "token_count": 150
    }
  ],
  "total_tokens": 150
}
```

## How It Works

1. Load the parsed JSON
2. For each part, encode the text using tiktoken (GPT-4o encoding)
3. Count the resulting tokens
4. Add `token_count` to the part
5. Sum all counts for `total_tokens`

## Usage

```bash
./scripts/count-tokens.sh parsed.json > counted.json
```

## Token Counting Logic

```python
from tiktoken import encoding_for_model

enc = encoding_for_model("gpt-4o")
token_count = len(enc.encode(text))
```

## Notes

- Uses GPT-4o encoding (cl100k_base)
- Token counts are approximate - different models may tokenize slightly differently
- Large files may take a moment to process
