# Waffle Chart

Generate a waffle chart visualization showing token distribution by component.

## Overview

A waffle chart is a 20x20 grid (400 squares) where each square represents 0.25% of total tokens. Components are color-coded and a legend shows percentages.

## Input

Colored JSON with component data.

## Output

A standalone HTML file with the waffle chart:

```
┌────────────────────────────────────────┐
│ ████████████████████ ██████████████████│
│ ████████████████████ ██████████████████│
│ ████████████████████ ██████████████████│
│ ████████████████████ ██████████████████│
│ ████████████████████ ████░░░░░░░░░░░░░░│
│ ░░░░░░░░░░░░░░░░░░░░ ░░░░░░░░░░░░░░░░░░│
│ ...                                    │
├────────────────────────────────────────┤
│ Legend:                                │
│ ■ introduction (20%, 500 tokens)       │
│ ■ methodology (35%, 875 tokens)        │
│ ■ results (30%, 750 tokens)            │
│ ■ conclusion (15%, 375 tokens)         │
└────────────────────────────────────────┘
```

## How It Works

1. Load the colored JSON
2. Calculate the percentage of tokens for each component
3. Generate a 20x20 grid (400 cells)
4. Fill cells based on component percentages
5. Create an HTML file with the grid and legend
6. Include CSS for styling and JS for interactivity

## Usage

```bash
./scripts/waffle-chart.sh colored.json > waffle.html
open waffle.html
```

## Interactive Features

The generated HTML includes:

- **Hover**: Highlight all cells of the same component
- **Click legend**: Filter to show only that component's parts
- **Sort toggle**: Sort legend by token count or alphabetically

## Grid Layout

- 20 columns x 20 rows = 400 cells
- Each cell = 0.25% of total tokens
- Components are sorted by token count (descending)
- Cells are filled left-to-right, top-to-bottom

## Template

The waffle chart uses the template at `assets/templates/waffle-chart.html`.

## Notes

- Very small components (<1%) may not be visible
- Hovering shows exact token counts
- The chart is responsive and works on mobile
- All styling is self-contained (no external dependencies)
