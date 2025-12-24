# Export

Export the analyzed document to various formats.

## Overview

Export the analyzed and annotated document to markdown or HTML.

## Input

Colored JSON with full analysis data.

## Output Formats

### Markdown

```markdown
# Document Analysis

**Total Tokens:** 2,500

## Components

| Component | Tokens | Percentage |
|-----------|--------|------------|
| introduction | 500 | 20% |
| methodology | 875 | 35% |
| results | 750 | 30% |
| conclusion | 375 | 15% |

## Content

### introduction

This document introduces the topic of semantic analysis...

### methodology

Our approach uses a multi-step pipeline...
```

### HTML

A styled HTML document with:
- Summary statistics
- Component breakdown table
- Annotated text with colors

## Usage

```bash
# Export to markdown
./scripts/export.sh colored.json markdown > output.md

# Export to HTML
./scripts/export.sh colored.json html > output.html
```

## Options

```bash
# Include raw text only (no annotations)
./scripts/export.sh colored.json markdown --raw

# Include token counts inline
./scripts/export.sh colored.json markdown --tokens
```

## Notes

- Markdown export is useful for documentation
- HTML export includes styling
- Component boundaries are preserved with headers
