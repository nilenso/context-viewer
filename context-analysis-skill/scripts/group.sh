#!/bin/bash
# Process multiple text files - runs deterministic steps
# Usage: ./group.sh input_folder/ output_dir/
#
# This script parses and counts tokens for all files.
# Claude should then segment and componentise each file,
# then run the finalization commands.

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <input_folder> <output_dir>" >&2
    exit 1
fi

INPUT_DIR="$1"
OUTPUT_DIR="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$INPUT_DIR" ]; then
    echo "Error: Input directory not found: $INPUT_DIR" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Find all text files
TXT_FILES=$(find "$INPUT_DIR" -maxdepth 1 -name "*.txt" -type f)

if [ -z "$TXT_FILES" ]; then
    echo "Error: No .txt files found in $INPUT_DIR" >&2
    exit 1
fi

FILE_COUNT=$(echo "$TXT_FILES" | wc -l | tr -d ' ')
echo "Found $FILE_COUNT text files"
echo ""

# Process each file
for file in $TXT_FILES; do
    filename=$(basename "$file" .txt)
    echo "Processing: $filename"

    # Parse
    "$SCRIPT_DIR/parse.sh" "$file" > "$OUTPUT_DIR/${filename}-1-parsed.json"

    # Count tokens
    "$SCRIPT_DIR/count-tokens.sh" "$OUTPUT_DIR/${filename}-1-parsed.json" > "$OUTPUT_DIR/${filename}-2-counted.json"

    echo "  Created: ${filename}-2-counted.json"
done

echo ""
echo "=== All files parsed and token-counted ==="
echo ""
echo "Next steps for each file (Claude should do these):"
echo ""
echo "For each ${filename}-2-counted.json:"
echo ""
echo "1. SEGMENT large parts (>500 tokens)"
echo "   - Split into semantic chunks"
echo "   - Save as ${filename}-3-segmented.json"
echo "   - Run: ./scripts/count-tokens.sh ... > ${filename}-3b-recounted.json"
echo ""
echo "2. COMPONENTISE"
echo "   - Identify semantic components"
echo "   - Add component fields"
echo "   - Save as ${filename}-4-componentised.json"
echo ""
echo "3. FINALIZE each file:"
echo "   ./scripts/colorise.sh ${filename}-4-componentised.json > ${filename}.json"
echo "   ./scripts/waffle-chart.sh ${filename}.json > ${filename}-waffle.html"
echo ""
echo "4. Generate comparison view:"
echo "   ./scripts/comparison.sh $OUTPUT_DIR > $OUTPUT_DIR/comparison.html"
