# Text View (Optional)

Generate an HTML view showing the original text with component annotations.

## Overview

Displays the full text with each part color-coded and labeled by its component.

## Input

Colored JSON with component data.

## Output

An HTML file showing annotated text:

```
┌─────────────────────────────────────────────────────────────┐
│ [introduction]                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ This document introduces the topic of semantic analysis │ │
│ │ and provides an overview of the methodology...          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [methodology]                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Our approach uses a multi-step pipeline starting with   │ │
│ │ tokenization followed by semantic segmentation...       │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

1. Load the colored JSON
2. For each part, create a colored block
3. Add component label and token count badge
4. Render as HTML with collapsible sections

## Usage

```bash
./scripts/text-view.sh colored.json > textview.html
open textview.html
```

## Interactive Features

- **Collapse/expand**: Click to toggle part visibility
- **Filter**: Show only parts of a specific component
- **Search**: Find text within the document
- **Copy**: Copy as markdown with component annotations

## Template

Uses the template at `assets/templates/text-view.html`.

## Notes

- Useful for understanding why parts were categorized a certain way
- Long parts are truncated with "show more" option
- Export to markdown preserves component annotations as comments
