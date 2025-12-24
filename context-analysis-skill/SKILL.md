---
name: context-analysis
description: Analyze plain text documents to understand their semantic structure and token distribution. Use when asked to analyze context, visualize token usage, segment text, identify components, create waffle charts, or compare multiple documents.
---

# Context Analysis

Analyze plain text documents to understand their semantic structure and token distribution. This skill helps visualize how tokens are distributed across different semantic components of a document.

## Workflow

When analyzing a document, follow these steps:

### 1. Parse the Text

Convert the input text file to JSON format:

```bash
./scripts/parse.sh input.txt > parsed.json
```

### 2. Count Tokens

Add token counts using tiktoken (GPT-4o encoding):

```bash
./scripts/count-tokens.sh parsed.json > counted.json
```

### 3. Segment Large Parts

For parts with more than 500 tokens, identify semantic breakpoints and split them.

**You (Claude) should do this directly:**
- Read the text of each large part
- Identify natural semantic boundaries (topic changes, section breaks, logical divisions)
- Split into coherent chunks
- Update the JSON with new parts (use IDs like `part-1.1`, `part-1.2`, etc.)

After segmenting, recount tokens:
```bash
./scripts/count-tokens.sh segmented.json > recounted.json
```

### 4. Identify Components

Analyze the document and identify the distinct semantic components it contains.

**You (Claude) should do this directly:**
- Read all parts
- Identify categories/themes (e.g., "introduction", "methodology", "examples", "conclusion")
- Assign each part to a component
- Add to JSON: `components` array and `component` field on each part
- Calculate `component_tokens` totals

### 5. Assign Colors

Run the colorization script to assign consistent colors:

```bash
./scripts/colorise.sh componentised.json > colored.json
```

### 6. Generate Visualizations

```bash
./scripts/waffle-chart.sh colored.json > waffle.html
./scripts/bar-chart.sh colored.json > bar-chart.html
./scripts/text-view.sh colored.json > text-view.html
```

## Quick Commands

For a complete analysis pipeline:

```bash
# Parse and count
./scripts/parse.sh input.txt > /tmp/1-parsed.json
./scripts/count-tokens.sh /tmp/1-parsed.json > /tmp/2-counted.json

# You segment and componentise the JSON directly, then:
./scripts/colorise.sh /tmp/3-componentised.json > /tmp/4-colored.json
./scripts/waffle-chart.sh /tmp/4-colored.json > waffle.html
```

For multiple files:

```bash
./scripts/group.sh input_folder/ output_dir/
```

## Data Format

The JSON format used throughout:

```json
{
  "source": "filename.txt",
  "parts": [
    {
      "id": "part-1",
      "text": "The actual text content...",
      "token_count": 150,
      "component": "introduction"
    }
  ],
  "components": ["introduction", "methodology", "results"],
  "component_tokens": {
    "introduction": 500,
    "methodology": 1200,
    "results": 800
  },
  "total_tokens": 2500
}
```

## Segmentation Guidelines

When segmenting large parts (>500 tokens):

1. Look for natural breakpoints:
   - Markdown headings (`#`, `##`, etc.)
   - Topic transitions
   - Logical section boundaries
   - List groupings

2. Create semantically coherent chunks:
   - Each segment should cover one topic/concept
   - Aim for 100-500 tokens per segment
   - Preserve context within segments

3. Update IDs hierarchically:
   - `part-1` splits into `part-1.1`, `part-1.2`, etc.

## Component Identification Guidelines

When identifying components:

1. Read all parts to understand the document structure
2. Identify 3-10 distinct semantic categories
3. Use descriptive, lowercase names with underscores
4. Common patterns:
   - Documents: `introduction`, `methodology`, `results`, `conclusion`
   - Technical: `configuration`, `implementation`, `examples`, `api_reference`
   - Instructional: `overview`, `prerequisites`, `steps`, `troubleshooting`

5. Assign each part to exactly one component
6. Use `other` for parts that don't fit elsewhere

## Available Colors

Components are assigned these colors:
- `blue` - Primary content, introductions
- `emerald` - Workflows, processes, methodology
- `purple` - Style, personality, guidelines
- `orange` - Context, examples, highlights
- `indigo` - Code, technical content
- `slate` - Environment, configuration
- `gray` - Tools, utilities, other

## References

See the [references/](references/) folder for detailed documentation on each step.
