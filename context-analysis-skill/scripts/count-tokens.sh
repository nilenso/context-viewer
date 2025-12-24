#!/bin/bash
# Count tokens in each part using tiktoken (GPT-4o encoding)
# Usage: ./count-tokens.sh parsed.json > counted.json

set -e

INPUT_FILE="$1"

if [ -z "$INPUT_FILE" ]; then
    echo "Usage: $0 <parsed.json>" >&2
    exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File not found: $INPUT_FILE" >&2
    exit 1
fi

# Use Python with tiktoken to count tokens
INPUT_FILE="$INPUT_FILE" python3 -c '
import json
import os
import sys

try:
    import tiktoken
except ImportError:
    print("Error: tiktoken not installed. Run: pip install tiktoken", file=sys.stderr)
    sys.exit(1)

input_file = os.environ.get("INPUT_FILE")
if not input_file:
    print("Error: No input file provided", file=sys.stderr)
    sys.exit(1)

with open(input_file, "r") as f:
    data = json.load(f)

# Use GPT-4o encoding
enc = tiktoken.encoding_for_model("gpt-4o")

total_tokens = 0
for part in data.get("parts", []):
    text = part.get("text", "")
    token_count = len(enc.encode(text))
    part["token_count"] = token_count
    total_tokens += token_count

data["total_tokens"] = total_tokens

print(json.dumps(data, indent=2))
'
