#!/bin/bash
# Export analyzed document to markdown or HTML
# Usage: ./export.sh colored.json markdown > output.md
# Usage: ./export.sh colored.json html > output.html

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <colored.json> <markdown|html>" >&2
    exit 1
fi

INPUT_FILE="$1"
FORMAT="$2"

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File not found: $INPUT_FILE" >&2
    exit 1
fi

if [ "$FORMAT" != "markdown" ] && [ "$FORMAT" != "html" ]; then
    echo "Error: Format must be 'markdown' or 'html'" >&2
    exit 1
fi

python3 << PYTHON_SCRIPT
import json
import html
import sys

input_file = "$INPUT_FILE"
output_format = "$FORMAT"

with open(input_file, 'r') as f:
    data = json.load(f)

source = data.get('source', 'Document')
total_tokens = data.get('total_tokens', 0)
parts = data.get('parts', [])
components = data.get('components', [])
component_tokens = data.get('component_tokens', {})

# Sort components by token count
sorted_components = sorted(components, key=lambda c: component_tokens.get(c, 0), reverse=True)

if output_format == 'markdown':
    print(f"# {source}")
    print()
    print(f"**Total Tokens:** {total_tokens:,}")
    print()
    print("## Components")
    print()
    print("| Component | Tokens | Percentage |")
    print("|-----------|--------|------------|")
    for comp in sorted_components:
        tokens = component_tokens.get(comp, 0)
        pct = (tokens / total_tokens * 100) if total_tokens > 0 else 0
        print(f"| {comp} | {tokens:,} | {pct:.1f}% |")
    print()
    print("## Content")
    print()

    # Group parts by component
    for comp in sorted_components:
        comp_parts = [p for p in parts if p.get('component') == comp]
        if not comp_parts:
            continue
        print(f"### {comp}")
        print()
        for part in comp_parts:
            text = part.get('text', '')
            print(text)
            print()
else:
    # HTML output
    print(f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{source}</title>
    <style>
        body {{ font-family: sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }}
        table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
        th, td {{ border: 1px solid #ddd; padding: 0.5rem; text-align: left; }}
        th {{ background: #f5f5f5; }}
        .section {{ margin: 2rem 0; padding: 1rem; background: #fafafa; border-radius: 0.5rem; }}
        .section h3 {{ margin-top: 0; }}
        pre {{ white-space: pre-wrap; font-size: 0.9rem; }}
    </style>
</head>
<body>
    <h1>{source}</h1>
    <p><strong>Total Tokens:</strong> {total_tokens:,}</p>

    <h2>Components</h2>
    <table>
        <tr><th>Component</th><th>Tokens</th><th>Percentage</th></tr>''')

    for comp in sorted_components:
        tokens = component_tokens.get(comp, 0)
        pct = (tokens / total_tokens * 100) if total_tokens > 0 else 0
        print(f'        <tr><td>{comp}</td><td>{tokens:,}</td><td>{pct:.1f}%</td></tr>')

    print('''    </table>

    <h2>Content</h2>''')

    for comp in sorted_components:
        comp_parts = [p for p in parts if p.get('component') == comp]
        if not comp_parts:
            continue
        print(f'    <div class="section">')
        print(f'        <h3>{comp}</h3>')
        for part in comp_parts:
            text = html.escape(part.get('text', ''))
            print(f'        <pre>{text}</pre>')
        print('    </div>')

    print('''</body>
</html>''')
PYTHON_SCRIPT
