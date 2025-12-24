# Coloring

Assign colors to components for visualization.

## Overview

The coloring step maps each component to a color, ensuring similar components get the same color for visual grouping.

## Input

Componentised JSON.

## Output

Same JSON with colors assigned:

```json
{
  "source": "filename.txt",
  "parts": [
    {
      "id": "part-1",
      "text": "...",
      "component": "introduction",
      "color": "blue"
    }
  ],
  "components": ["introduction", "methodology"],
  "component_colors": {
    "introduction": "blue",
    "methodology": "emerald"
  }
}
```

## Available Colors

The following colors are available:

| Color | Hex | Use For |
|-------|-----|---------|
| `orange` | #f97316 | Primary content, highlights |
| `emerald` | #10b981 | Success, workflows, processes |
| `purple` | #a855f7 | Personality, style, tone |
| `blue` | #3b82f6 | Information, search, navigation |
| `slate` | #64748b | Environment, context |
| `indigo` | #6366f1 | Code, technical content |
| `gray` | #6b7280 | Tools, utilities, other |

## How It Works

1. Load the componentised JSON
2. For each component, assign a color based on:
   - Hardcoded mappings for known components
   - Round-robin assignment for unknown components
3. Add `color` field to each part
4. Add `component_colors` mapping to the output

## Usage

```bash
./scripts/colorise.sh componentised.json > colored.json
```

## Hardcoded Color Mappings

Certain component patterns have predefined colors:

```
identity       → gray
personality.*  → purple
environment.*  → slate
code_style.*   → indigo
search.*       → blue
workflow.*     → emerald
tools.*        → gray
```

## Notes

- Colors are designed to work well together in visualizations
- Similar components (sharing a prefix) get the same color
- Unknown components cycle through available colors
- The `other` component always gets gray
