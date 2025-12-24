# Componentisation

Identify semantic components in the document and map each part to a component.

## Overview

Componentisation categorizes each part of the document into semantic components (themes, topics, or purposes). This is done by Claude directly.

## Input

Segmented JSON with token counts:

```json
{
  "source": "document.txt",
  "parts": [
    {"id": "part-1.1", "text": "Introduction...", "token_count": 200},
    {"id": "part-1.2", "text": "Methods...", "token_count": 350},
    {"id": "part-1.3", "text": "Results...", "token_count": 300}
  ],
  "total_tokens": 850
}
```

## Output

JSON with components identified and mapped:

```json
{
  "source": "document.txt",
  "parts": [
    {"id": "part-1.1", "text": "Introduction...", "token_count": 200, "component": "introduction"},
    {"id": "part-1.2", "text": "Methods...", "token_count": 350, "component": "methodology"},
    {"id": "part-1.3", "text": "Results...", "token_count": 300, "component": "results"}
  ],
  "components": ["introduction", "methodology", "results"],
  "component_tokens": {
    "introduction": 200,
    "methodology": 350,
    "results": 300
  },
  "total_tokens": 850
}
```

## How to Componentise

### Step 1: Read All Parts

Read through all parts to understand the document's overall structure and content.

### Step 2: Identify Components

Identify 3-10 distinct semantic categories. Common patterns:

**Academic/Research:**
- `abstract`, `introduction`, `methodology`, `results`, `discussion`, `conclusion`, `references`

**Technical Documentation:**
- `overview`, `installation`, `configuration`, `usage`, `api_reference`, `examples`, `troubleshooting`

**Instructional:**
- `prerequisites`, `setup`, `steps`, `tips`, `common_errors`

**System Prompts:**
- `identity`, `personality`, `environment`, `tools`, `workflow`, `guidelines`

### Step 3: Map Parts to Components

Assign each part to exactly one component:

- Read the part's text
- Determine which component best describes its purpose
- Add the `component` field

Use `other` for parts that don't fit any identified category.

### Step 4: Calculate Totals

Add to the JSON:

```json
{
  "components": ["component_a", "component_b", "other"],
  "component_tokens": {
    "component_a": 500,
    "component_b": 300,
    "other": 50
  }
}
```

## Naming Conventions

- Use lowercase
- Use underscores for multi-word names: `api_reference`
- Be descriptive but concise
- Use domain-appropriate terminology

## Example Componentisation

Document about API design:

| Part ID | Text Preview | Component |
|---------|-------------|-----------|
| part-1.1 | "This document outlines..." | `introduction` |
| part-1.2 | "REST uses HTTP methods..." | `rest_principles` |
| part-1.3 | "Resources should be named..." | `naming_conventions` |
| part-1.4 | "Use 200, 201, 400, 404..." | `http_status_codes` |
| part-1.5 | "Always validate input..." | `best_practices` |

## Notes

- Every part must have a component
- Components should be mutually exclusive where possible
- The `other` component catches anything that doesn't fit
- More specific components are better than generic ones
