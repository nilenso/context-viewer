#!/bin/bash
# Generate a stacked bar chart HTML visualization
# Usage: ./bar-chart.sh colored.json > barchart.html

set -e

INPUT_FILE="$1"

if [ -z "$INPUT_FILE" ]; then
    echo "Usage: $0 <colored.json>" >&2
    exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File not found: $INPUT_FILE" >&2
    exit 1
fi

INPUT_FILE="$INPUT_FILE" python3 -c '
import json
import os

input_file = os.environ.get("INPUT_FILE")

with open(input_file, "r") as f:
    data = json.load(f)

source = data.get("source", "Document")
total_tokens = data.get("total_tokens", 0)
components = data.get("components", [])
component_tokens = data.get("component_tokens", {})
component_colors = data.get("component_colors", {})

COLOR_HEX = {
    "orange": "#f97316",
    "emerald": "#10b981",
    "purple": "#a855f7",
    "blue": "#3b82f6",
    "slate": "#64748b",
    "indigo": "#6366f1",
    "gray": "#6b7280"
}

sorted_components = sorted(components, key=lambda c: component_tokens.get(c, 0), reverse=True)

print(f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bar Chart - {source}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f8fafc;
            padding: 2rem;
            color: #1e293b;
        }}
        .container {{ max-width: 800px; margin: 0 auto; }}
        h1 {{ margin-bottom: 0.5rem; font-size: 1.5rem; }}
        .subtitle {{ color: #64748b; margin-bottom: 1.5rem; }}
        .bar-container {{
            background: white;
            padding: 1rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 1.5rem;
        }}
        .bar {{
            display: flex;
            height: 3rem;
            border-radius: 0.25rem;
            overflow: hidden;
        }}
        .segment {{
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 0.75rem;
            font-weight: 500;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
            transition: opacity 0.2s;
            cursor: pointer;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            padding: 0 0.25rem;
        }}
        .segment:hover {{ opacity: 0.8; }}
        .legend {{
            background: white;
            padding: 1rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
        }}
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        .legend-swatch {{
            width: 1rem;
            height: 1rem;
            border-radius: 2px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{source}</h1>
        <p class="subtitle">{total_tokens:,} tokens total</p>

        <div class="bar-container">
            <div class="bar">""")

for comp in sorted_components:
    tokens = component_tokens.get(comp, 0)
    percentage = (tokens / total_tokens * 100) if total_tokens > 0 else 0
    if percentage < 0.5:
        continue
    color = component_colors.get(comp, "gray")
    hex_color = COLOR_HEX.get(color, "#6b7280")
    label = comp if percentage > 8 else ""
    print(f"                <div class=\"segment\" style=\"width: {percentage}%; background: {hex_color}\" title=\"{comp}: {percentage:.1f}%\">{label}</div>")

print("""            </div>
        </div>

        <div class="legend">""")

for comp in sorted_components:
    tokens = component_tokens.get(comp, 0)
    percentage = (tokens / total_tokens * 100) if total_tokens > 0 else 0
    color = component_colors.get(comp, "gray")
    hex_color = COLOR_HEX.get(color, "#6b7280")
    print(f"""            <div class="legend-item">
                <div class="legend-swatch" style="background: {hex_color}"></div>
                <span>{comp} ({percentage:.1f}%)</span>
            </div>""")

print("""        </div>
    </div>
</body>
</html>""")
'
