#!/bin/bash
# Context analysis pipeline helper
# Usage: ./analyze.sh input.txt output_dir/
#
# This script runs the deterministic steps. Claude performs segmentation
# and componentisation directly by editing the JSON files.

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <input.txt> <output_dir>" >&2
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_DIR="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File not found: $INPUT_FILE" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Step 1: Parsing..."
"$SCRIPT_DIR/parse.sh" "$INPUT_FILE" > "$OUTPUT_DIR/1-parsed.json"

echo "Step 2: Counting tokens..."
"$SCRIPT_DIR/count-tokens.sh" "$OUTPUT_DIR/1-parsed.json" > "$OUTPUT_DIR/2-counted.json"

echo ""
echo "=== Intermediate files ready ==="
echo ""
echo "Next steps (Claude should do these):"
echo ""
echo "1. SEGMENT: Read $OUTPUT_DIR/2-counted.json"
echo "   - For parts >500 tokens, split into semantic chunks"
echo "   - Write result to $OUTPUT_DIR/3-segmented.json"
echo "   - Then run: $SCRIPT_DIR/count-tokens.sh $OUTPUT_DIR/3-segmented.json > $OUTPUT_DIR/3b-recounted.json"
echo ""
echo "2. COMPONENTISE: Read the recounted JSON"
echo "   - Identify semantic components"
echo "   - Add 'component' field to each part"
echo "   - Add 'components' array and 'component_tokens' object"
echo "   - Write result to $OUTPUT_DIR/4-componentised.json"
echo ""
echo "3. FINALIZE: Run these commands:"
echo "   $SCRIPT_DIR/colorise.sh $OUTPUT_DIR/4-componentised.json > $OUTPUT_DIR/5-colored.json"
echo "   $SCRIPT_DIR/waffle-chart.sh $OUTPUT_DIR/5-colored.json > $OUTPUT_DIR/waffle-chart.html"
echo "   $SCRIPT_DIR/bar-chart.sh $OUTPUT_DIR/5-colored.json > $OUTPUT_DIR/bar-chart.html"
echo "   $SCRIPT_DIR/text-view.sh $OUTPUT_DIR/5-colored.json > $OUTPUT_DIR/text-view.html"
