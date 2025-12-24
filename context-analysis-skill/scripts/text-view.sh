#!/bin/bash
# Generate an HTML text view with component annotations
# Usage: ./text-view.sh colored.json > textview.html

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
import html
import os

input_file = os.environ.get("INPUT_FILE")

with open(input_file, "r") as f:
    data = json.load(f)

source = data.get("source", "Document")
total_tokens = data.get("total_tokens", 0)
parts = data.get("parts", [])
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

COLOR_BG = {
    "orange": "#fff7ed",
    "emerald": "#ecfdf5",
    "purple": "#faf5ff",
    "blue": "#eff6ff",
    "slate": "#f8fafc",
    "indigo": "#eef2ff",
    "gray": "#f9fafb"
}

print(f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Text View - {source}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f8fafc;
            padding: 2rem;
            color: #1e293b;
            line-height: 1.6;
        }}
        .container {{ max-width: 900px; margin: 0 auto; }}
        h1 {{ margin-bottom: 0.5rem; font-size: 1.5rem; }}
        .subtitle {{ color: #64748b; margin-bottom: 1.5rem; }}
        .part {{
            margin-bottom: 1rem;
            border-radius: 0.5rem;
            overflow: hidden;
        }}
        .part-header {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            cursor: pointer;
            font-size: 0.875rem;
        }}
        .part-badge {{
            padding: 0.125rem 0.5rem;
            border-radius: 9999px;
            color: white;
            font-size: 0.75rem;
            font-weight: 500;
        }}
        .part-tokens {{
            color: #64748b;
            font-size: 0.75rem;
        }}
        .part-content {{
            padding: 1rem;
            white-space: pre-wrap;
            font-family: "SF Mono", Monaco, "Courier New", monospace;
            font-size: 0.875rem;
            max-height: 300px;
            overflow-y: auto;
        }}
        .filter-bar {{
            background: white;
            padding: 1rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 1.5rem;
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
        }}
        .filter-btn {{
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            border: 1px solid #e2e8f0;
            background: white;
            cursor: pointer;
            font-size: 0.875rem;
        }}
        .filter-btn:hover {{ background: #f1f5f9; }}
        .filter-btn.active {{ background: #1e293b; color: white; border-color: #1e293b; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{source}</h1>
        <p class="subtitle">{total_tokens:,} tokens total | {len(parts)} parts</p>

        <div class="filter-bar">
            <button class="filter-btn active" data-filter="all">All</button>""")

unique_components = sorted(set(p.get("component", "other") for p in parts))
for comp in unique_components:
    print(f"            <button class=\"filter-btn\" data-filter=\"{comp}\">{comp}</button>")

print("        </div>")

for part in parts:
    text = html.escape(part.get("text", ""))
    comp = part.get("component", "other")
    tokens = part.get("token_count", 0)
    color_name = component_colors.get(comp, "gray")
    badge_color = COLOR_HEX.get(color_name, "#6b7280")
    bg_color = COLOR_BG.get(color_name, "#f9fafb")

    print(f"""        <div class="part" data-component="{comp}" style="background: {bg_color}">
            <div class="part-header">
                <span class="part-badge" style="background: {badge_color}">{comp}</span>
                <span class="part-tokens">{tokens:,} tokens</span>
            </div>
            <div class="part-content">{text}</div>
        </div>""")

print("""    </div>

    <script>
        document.querySelectorAll(".filter-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const filter = btn.dataset.filter;
                document.querySelectorAll(".part").forEach(part => {
                    if (filter === "all" || part.dataset.component === filter) {
                        part.style.display = "block";
                    } else {
                        part.style.display = "none";
                    }
                });
            });
        });
    </script>
</body>
</html>""")
'
