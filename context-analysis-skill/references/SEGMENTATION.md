# Segmentation

Split large text blocks (>500 tokens) into smaller semantic chunks.

## Overview

Segmentation breaks large parts into coherent topical chunks for better componentisation. This is done by Claude directly, not via an external script.

## When to Segment

Segment parts that have more than 500 tokens. Smaller parts can remain as-is.

## Input

JSON with token-counted parts:

```json
{
  "source": "document.txt",
  "parts": [
    {
      "id": "part-1",
      "text": "A very long text with multiple topics...",
      "token_count": 1200
    }
  ],
  "total_tokens": 1200
}
```

## Output

Same JSON with large parts split:

```json
{
  "source": "document.txt",
  "parts": [
    {
      "id": "part-1.1",
      "text": "First section about topic A..."
    },
    {
      "id": "part-1.2",
      "text": "Second section about topic B..."
    },
    {
      "id": "part-1.3",
      "text": "Third section about topic C..."
    }
  ]
}
```

## How to Segment

1. **Read the text** of each part with >500 tokens

2. **Identify natural breakpoints:**
   - Markdown headings (`#`, `##`, `###`)
   - Blank lines between paragraphs on different topics
   - Transition phrases ("Next,", "Additionally,", "In contrast,")
   - List boundaries
   - Code block boundaries

3. **Split at breakpoints** to create coherent chunks:
   - Each chunk should cover one topic or concept
   - Aim for 100-500 tokens per chunk
   - Preserve context within each chunk

4. **Assign hierarchical IDs:**
   - `part-1` → `part-1.1`, `part-1.2`, `part-1.3`
   - `part-2` → `part-2.1`, `part-2.2`

5. **Write the updated JSON** and recount tokens:
   ```bash
   ./scripts/count-tokens.sh segmented.json > recounted.json
   ```

## Example

Original (1200 tokens):
```
# Introduction
This document covers machine learning basics...

## Supervised Learning
Supervised learning uses labeled data...

## Unsupervised Learning
Unsupervised learning finds patterns...

## Applications
Machine learning is used in healthcare...
```

Segmented:
- `part-1.1`: Introduction section (~200 tokens)
- `part-1.2`: Supervised Learning section (~350 tokens)
- `part-1.3`: Unsupervised Learning section (~300 tokens)
- `part-1.4`: Applications section (~350 tokens)

## Notes

- Token counts must be recalculated after segmentation
- Keep related content together (don't split mid-paragraph)
- If a part is already well-structured, fewer segments are fine
