# Grouping

Process multiple files together for comparative analysis.

## Overview

Grouping allows you to analyze multiple text files and compare their component distributions side by side.

## Input

A directory containing multiple `.txt` files.

## Output

- Individual analysis for each file
- Merged component list (union of all components)
- Comparison grid with waffle charts for each file

## How It Works

1. Find all `.txt` files in the input directory
2. Process each file in parallel:
   - Parse → Count tokens → Segment → Componentise → Color
3. Merge component lists (union)
4. Normalize colors across all files
5. Generate individual waffle charts
6. Generate comparison grid HTML

## Usage

```bash
./scripts/group.sh input_folder/ output_dir/

# Generated files:
# output_dir/file1.json          - Analysis for file1.txt
# output_dir/file1-waffle.html   - Waffle chart for file1
# output_dir/file2.json          - Analysis for file2.txt
# output_dir/file2-waffle.html   - Waffle chart for file2
# output_dir/comparison.html     - Side-by-side comparison
```

## Comparison Grid

The comparison view shows:

```
┌─────────────────────────────────────────────────────────────┐
│                    Component Comparison                      │
├─────────────────┬─────────────────┬─────────────────────────┤
│    file1.txt    │    file2.txt    │       file3.txt         │
│                 │                 │                         │
│ ████████████    │ ████████████    │  ████████████           │
│ ████████████    │ ████░░░░░░░░    │  ████████████           │
│ ░░░░░░░░░░░░    │ ░░░░░░░░░░░░    │  ░░░░░░░░░░░░           │
│                 │                 │                         │
│ 2,500 tokens    │ 1,800 tokens    │  3,200 tokens           │
└─────────────────┴─────────────────┴─────────────────────────┘
│ Legend (shared across all files):                           │
│ ■ introduction  ■ methodology  ■ results  ■ conclusion      │
└─────────────────────────────────────────────────────────────┘
```

## Sorting Options

The comparison grid supports sorting:

- **By token count**: Files with more tokens first
- **By filename**: Alphabetical order
- **By component**: Group files by dominant component

## Merged Components

When grouping files:
- All unique components are collected
- Same component names are unified
- Colors are consistent across all files
- "other" catches unmapped parts in any file

## Parallel Processing

Files are processed in parallel for speed:

```bash
# Process up to 4 files at once
./scripts/group.sh folder/ output/ --parallel 4
```

## Notes

- All files must be plain text (.txt)
- Binary files are skipped with a warning
- Empty files are skipped
- Progress is shown during processing
- The comparison view is interactive (hover, click to filter)
