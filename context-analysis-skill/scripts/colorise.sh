#!/bin/bash
# Assign colors to components for visualization
# Usage: ./colorise.sh componentised.json > colored.json

set -e

INPUT_FILE="$1"

if [ -z "$INPUT_FILE" ]; then
    echo "Usage: $0 <componentised.json>" >&2
    exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File not found: $INPUT_FILE" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COLORS_FILE="${COLORS_FILE:-$SCRIPT_DIR/../docs/colors.json}"

INPUT_FILE="$INPUT_FILE" COLORS_FILE="$COLORS_FILE" python3 -c '
import json
import os

input_file = os.environ.get("INPUT_FILE")
colors_file = os.environ.get("COLORS_FILE", "")

with open(input_file, "r") as f:
    data = json.load(f)

# Load color mappings from external file if available
KNOWN_MAPPINGS = {}
if colors_file and os.path.exists(colors_file):
    with open(colors_file, "r") as f:
        KNOWN_MAPPINGS = json.load(f)
else:
    # Default mappings
    KNOWN_MAPPINGS = {
        "identity": "gray",
        "personality": "purple",
        "environment": "slate",
        "code_style": "indigo",
        "search": "blue",
        "workflow": "emerald",
        "project_context": "orange",
        "tools": "gray",
        "introduction": "blue",
        "methodology": "emerald",
        "results": "purple",
        "conclusion": "orange",
        "discussion": "indigo",
        "abstract": "slate",
        "references": "gray",
        "content": "blue",
        "other": "gray"
    }

# Fallback colors for round-robin
COLORS = ["blue", "emerald", "purple", "orange", "indigo", "slate", "gray"]

def get_color(component, index):
    """Get color for a component."""
    # Check for exact match
    if component in KNOWN_MAPPINGS:
        return KNOWN_MAPPINGS[component]

    # Check for prefix match (e.g., tools.file matches tools)
    parts = component.split(".")
    for i in range(len(parts), 0, -1):
        prefix = ".".join(parts[:i])
        if prefix in KNOWN_MAPPINGS:
            return KNOWN_MAPPINGS[prefix]

    # Also check underscore-based prefixes
    parts = component.split("_")
    for i in range(len(parts), 0, -1):
        prefix = "_".join(parts[:i])
        if prefix in KNOWN_MAPPINGS:
            return KNOWN_MAPPINGS[prefix]

    # Round-robin for unknown components
    return COLORS[index % len(COLORS)]

# Assign colors to components
components = data.get("components", [])
component_colors = {}

for i, comp in enumerate(components):
    component_colors[comp] = get_color(comp, i)

# Apply colors to parts
for part in data.get("parts", []):
    comp = part.get("component", "other")
    part["color"] = component_colors.get(comp, "gray")

data["component_colors"] = component_colors

# Calculate component_tokens by aggregating part token counts
component_tokens = {}
for part in data.get("parts", []):
    comp = part.get("component", "other")
    tokens = part.get("token_count", 0)
    component_tokens[comp] = component_tokens.get(comp, 0) + tokens

data["component_tokens"] = component_tokens

print(json.dumps(data, indent=2))
'
