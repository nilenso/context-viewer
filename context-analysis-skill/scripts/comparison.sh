#!/bin/bash
# Generate comparison HTML from multiple analyzed JSON files
# Usage: ./comparison.sh output_dir/ > comparison.html

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <output_dir>" >&2
    exit 1
fi

OUTPUT_DIR="$1"

if [ ! -d "$OUTPUT_DIR" ]; then
    echo "Error: Directory not found: $OUTPUT_DIR" >&2
    exit 1
fi

OUTPUT_DIR_ENV="$OUTPUT_DIR" python3 -c '
import json
import os
import glob
import re

output_dir = os.environ.get("OUTPUT_DIR_ENV")

# Find all final JSON files (exclude intermediate files like -1-parsed, -2-counted, etc.)
json_files = [f for f in glob.glob(os.path.join(output_dir, "*.json"))
              if not re.search(r"-\d+-[a-z]+\.json$", os.path.basename(f))]

if not json_files:
    print("<!-- No JSON files found -->")
    exit(0)

# Load all data
all_data = []
all_components = set()
all_component_colors = {}

for json_file in sorted(json_files):
    with open(json_file, "r") as f:
        data = json.load(f)
        all_data.append(data)
        all_components.update(data.get("components", []))
        all_component_colors.update(data.get("component_colors", {}))

# Sort components by total tokens
component_totals = {}
for data in all_data:
    for comp, tokens in data.get("component_tokens", {}).items():
        component_totals[comp] = component_totals.get(comp, 0) + tokens

sorted_components = sorted(all_components, key=lambda c: component_totals.get(c, 0), reverse=True)

COLOR_HEX = {
    "orange": "#f97316",
    "emerald": "#10b981",
    "purple": "#a855f7",
    "blue": "#3b82f6",
    "slate": "#64748b",
    "indigo": "#6366f1",
    "gray": "#6b7280"
}

print("""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Component Comparison</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f8fafc;
            padding: 2rem;
            color: #1e293b;
        }
        h1 { margin-bottom: 1.5rem; }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        .card {
            background: white;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 1rem;
        }
        .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }
        .card .tokens { color: #64748b; font-size: 0.875rem; margin-bottom: 1rem; }
        .card-content {
            display: flex;
            gap: 1rem;
        }
        .mini-waffle {
            display: grid;
            grid-template-columns: repeat(10, 1fr);
            gap: 2px;
            flex-shrink: 0;
            width: 160px;
            height: fit-content;
        }
        .mini-cell {
            aspect-ratio: 1;
            border-radius: 3px;
        }
        .card-legend {
            flex: 1;
            font-size: 0.8rem;
        }
        .card-legend-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.15rem 0;
        }
        .card-legend-swatch {
            width: 0.75rem;
            height: 0.75rem;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .card-legend-name {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .card-legend-pct {
            color: #64748b;
            text-align: right;
            min-width: 2.5rem;
        }
    </style>
</head>
<body>
    <h1>Component Comparison</h1>

    <div class="grid">""")

# Sort all_data by source name
all_data.sort(key=lambda d: d.get("source", ""))

for data in all_data:
    source = data.get("source", "Unknown")
    total_tokens = data.get("total_tokens", 0)
    component_tokens = data.get("component_tokens", {})
    component_colors = data.get("component_colors", {})

    # Sort this document components by token count (descending)
    file_components = sorted(component_tokens.keys(), key=lambda c: component_tokens.get(c, 0), reverse=True)

    # Generate mini waffle (100 cells = 10x10)
    cells = []
    remaining = 100

    for comp in file_components:
        tokens = component_tokens.get(comp, 0)
        if total_tokens > 0:
            pct = tokens / total_tokens
            count = int(round(pct * 100))
            if tokens > 0 and count == 0:
                count = 1
            count = min(count, remaining)
        else:
            count = 0

        color = component_colors.get(comp, "gray")
        hex_color = COLOR_HEX.get(color, "#6b7280")

        for _ in range(count):
            cells.append(hex_color)
        remaining -= count

    for _ in range(remaining):
        cells.append("#f3f4f6")

    print(f"""        <div class="card">
            <h2>{source}</h2>
            <div class="tokens">{total_tokens:,} tokens</div>
            <div class="card-content">
                <div class="mini-waffle">""")

    for color in cells:
        print(f"                    <div class=\"mini-cell\" style=\"background: {color}\"></div>")

    print("""                </div>
                <div class="card-legend">""")

    for comp in file_components:
        tokens = component_tokens.get(comp, 0)
        pct = (tokens / total_tokens * 100) if total_tokens > 0 else 0
        color = component_colors.get(comp, "gray")
        hex_color = COLOR_HEX.get(color, "#6b7280")
        print(f"""                    <div class="card-legend-item">
                        <div class="card-legend-swatch" style="background: {hex_color}"></div>
                        <span class="card-legend-name">{comp}</span>
                        <span class="card-legend-pct">{pct:.0f}%</span>
                    </div>""")

    print("""                </div>
            </div>
        </div>""")

print("""    </div>
</body>
</html>""")
'
