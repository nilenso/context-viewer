#!/bin/bash
# Generate a waffle chart HTML visualization
# Usage: ./waffle-chart.sh colored.json > waffle.html

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

# Color hex values
COLOR_HEX = {
    "orange": "#f97316",
    "emerald": "#10b981",
    "purple": "#a855f7",
    "blue": "#3b82f6",
    "slate": "#64748b",
    "indigo": "#6366f1",
    "gray": "#6b7280"
}

# Sort components by token count (descending)
sorted_components = sorted(components, key=lambda c: component_tokens.get(c, 0), reverse=True)

# Generate waffle grid data (400 cells = 20x20)
GRID_SIZE = 400
cells = []
remaining_cells = GRID_SIZE

for comp in sorted_components:
    tokens = component_tokens.get(comp, 0)
    if total_tokens > 0:
        percentage = tokens / total_tokens
        cell_count = int(round(percentage * GRID_SIZE))
        # Ensure at least 1 cell for non-zero components
        if tokens > 0 and cell_count == 0:
            cell_count = 1
        cell_count = min(cell_count, remaining_cells)
    else:
        cell_count = 0

    color = component_colors.get(comp, "gray")
    hex_color = COLOR_HEX.get(color, "#6b7280")

    for _ in range(cell_count):
        cells.append({"component": comp, "color": hex_color})
    remaining_cells -= cell_count

# Fill remaining cells with gray
for _ in range(remaining_cells):
    cells.append({"component": "", "color": "#f3f4f6"})

# Generate HTML
print(f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Waffle Chart - {source}</title>
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
        .waffle-grid {{
            display: grid;
            grid-template-columns: repeat(20, 1fr);
            gap: 2px;
            background: white;
            padding: 1rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 1.5rem;
        }}
        .cell {{
            aspect-ratio: 1;
            border-radius: 2px;
            transition: transform 0.1s, box-shadow 0.1s;
            cursor: pointer;
        }}
        .cell:hover {{
            transform: scale(1.2);
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            z-index: 10;
        }}
        .legend {{
            background: white;
            padding: 1rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        .legend h2 {{ font-size: 1rem; margin-bottom: 0.75rem; }}
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.25rem 0;
            cursor: pointer;
        }}
        .legend-item:hover {{ background: #f1f5f9; }}
        .legend-swatch {{
            width: 1rem;
            height: 1rem;
            border-radius: 2px;
            flex-shrink: 0;
        }}
        .legend-name {{ flex: 1; }}
        .legend-stats {{ color: #64748b; font-size: 0.875rem; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{source}</h1>
        <p class="subtitle">{total_tokens:,} tokens total</p>

        <div class="waffle-grid">""")

for cell in cells:
    comp = cell["component"]
    color = cell["color"]
    title = comp if comp else "empty"
    print(f"            <div class=\"cell\" style=\"background: {color}\" title=\"{title}\" data-component=\"{comp}\"></div>")

print("""        </div>

        <div class="legend">
            <h2>Components</h2>""")

for comp in sorted_components:
    tokens = component_tokens.get(comp, 0)
    percentage = (tokens / total_tokens * 100) if total_tokens > 0 else 0
    color = component_colors.get(comp, "gray")
    hex_color = COLOR_HEX.get(color, "#6b7280")
    print(f"""            <div class="legend-item" data-component="{comp}">
                <div class="legend-swatch" style="background: {hex_color}"></div>
                <span class="legend-name">{comp}</span>
                <span class="legend-stats">{percentage:.1f}% ({tokens:,} tokens)</span>
            </div>""")

print("""        </div>
    </div>

    <script>
        // Hover highlighting
        document.querySelectorAll(".cell").forEach(cell => {
            cell.addEventListener("mouseenter", () => {
                const comp = cell.dataset.component;
                if (!comp) return;
                document.querySelectorAll(".cell").forEach(c => {
                    c.style.opacity = c.dataset.component === comp ? "1" : "0.3";
                });
            });
            cell.addEventListener("mouseleave", () => {
                document.querySelectorAll(".cell").forEach(c => {
                    c.style.opacity = "1";
                });
            });
        });

        // Legend click filtering
        document.querySelectorAll(".legend-item").forEach(item => {
            item.addEventListener("click", () => {
                const comp = item.dataset.component;
                document.querySelectorAll(".cell").forEach(c => {
                    c.style.opacity = c.dataset.component === comp ? "1" : "0.1";
                });
            });
        });
    </script>
</body>
</html>""")
'
