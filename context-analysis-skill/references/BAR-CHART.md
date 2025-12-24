# Bar Chart (Optional)

Generate a stacked bar chart showing token distribution.

## Overview

An alternative visualization to the waffle chart. Shows a single horizontal bar divided into colored segments, one per component.

## Input

Colored JSON with component data.

## Output

A standalone HTML file with the bar chart:

```
┌─────────────────────────────────────────────────────────────┐
│ ███████████████████████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░ │
│        intro              methodology        results       │
└─────────────────────────────────────────────────────────────┘
│ Legend:                                                     │
│ ■ introduction (20%)  ■ methodology (35%)  ■ results (30%)  │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

1. Load the colored JSON
2. Calculate percentage for each component
3. Generate a stacked horizontal bar using CSS flex
4. Add labels and legend

## Usage

```bash
./scripts/bar-chart.sh colored.json > barchart.html
open barchart.html
```

## Interactive Features

- **Hover**: Show exact token count and percentage
- **Click segment**: Scroll to that component's parts (if using with text view)

## Template

Uses the template at `assets/templates/bar-chart.html`.

## Notes

- Simpler than waffle chart but less detailed
- Good for quick overview of major components
- Components under 5% may have truncated labels
