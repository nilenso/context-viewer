# Parsing

Convert plain text files into the internal JSON format.

## Overview

The parsing step reads a plain text file and converts it into a structured JSON format that subsequent steps can process.

## Input

A plain text file (`.txt`).

## Output

```json
{
  "source": "filename.txt",
  "parts": [
    {
      "id": "part-1",
      "text": "The entire contents of the text file..."
    }
  ]
}
```

## How It Works

1. Read the entire text file
2. Trim whitespace from beginning and end
3. Create a single "part" containing the full text
4. Assign a unique ID to the part

## Usage

```bash
./scripts/parse.sh input.txt > parsed.json
```

## Notes

- The entire text is initially placed in a single part
- The segmentation step later breaks this into smaller semantic chunks
- IDs are generated as `part-1`, `part-2`, etc.
- The `source` field preserves the original filename for reference
