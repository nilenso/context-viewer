#!/bin/bash

# Appends a prompt to docs/prompts.md
# This script is designed to be called as a hook from Claude Code
# When called as a hook, it receives JSON data via stdin
# Can also be called manually: ./scripts/append-prompt.sh "Your prompt here"

# Get the prompt from arguments or stdin JSON
if [ "$#" -gt 0 ]; then
    # Manual usage: prompt passed as arguments
    PROMPT="$*"
else
    # Hook usage: read JSON from stdin and extract prompt field using jq
    INPUT=$(cat)
    PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')
fi

# Exit if no prompt received
if [ -z "$PROMPT" ]; then
    exit 0
fi

# Get the project root (script is in scripts/, so go up one level)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPTS_FILE="$PROJECT_ROOT/docs/prompts.md"

# Get formatted timestamp
TIMESTAMP=$(date '+%b %d, %Y %H:%M:%S')

# Append to docs/prompts.md
{
    echo ""
    echo "### $TIMESTAMP"
    echo "$PROMPT"
} >> "$PROMPTS_FILE"

echo "✓ Prompt appended to docs/prompts.md"
