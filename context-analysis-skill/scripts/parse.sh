#!/bin/bash
# Parse a plain text file into the internal JSON format
# Usage: ./parse.sh input.txt > parsed.json

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <input.txt>" >&2
    exit 1
fi

INPUT_FILE="$1"

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File not found: $INPUT_FILE" >&2
    exit 1
fi

FILENAME=$(basename "$INPUT_FILE")
TEXT=$(cat "$INPUT_FILE")

# Escape text for JSON (handle newlines, quotes, backslashes)
escape_json() {
    python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$1"
}

ESCAPED_TEXT=$(escape_json "$TEXT")

cat << EOF
{
  "source": "$FILENAME",
  "parts": [
    {
      "id": "part-1",
      "text": $ESCAPED_TEXT
    }
  ]
}
EOF
