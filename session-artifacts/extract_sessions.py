#!/usr/bin/env python3
"""
Split Claude Code session JSONL files at compaction boundaries.

Produces raw JSONL files for each segment — as though they were separate sessions.
"""

import json
import os

PROJECTS_DIR = os.path.expanduser(
    "~/.claude/projects/-Users-srihari-work-nilenso-context-viewer"
)
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

SESSIONS = {
    "multi-dimension": {
        "id": "9c226e00-3408-44c9-875e-3ba7ee4408f5",
        "label": "Multi-Dimension Componentisation (Mar 9-10)",
    },
    "segmentation-svg": {
        "id": "78c90328-d2e2-47dc-bc9a-e6eb036bf001",
        "label": "Segmentation SVG as HTML/CSS (Mar 2)",
    },
}


def load_raw_lines(path):
    """Load JSONL as raw strings (preserving original serialization)."""
    with open(path) as f:
        return f.readlines()


def find_compaction_boundaries(lines):
    """Find line indices where compaction continuations start."""
    boundaries = []
    for i, line in enumerate(lines):
        obj = json.loads(line)
        if obj.get("type") == "user":
            msg = obj.get("message", {})
            content = msg.get("content", "")
            text = ""
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        text = item["text"]
                        break
            if "This session is being continued from a previous conversation" in text:
                boundaries.append(i)
    return boundaries


def process_session(name, config):
    session_id = config["id"]
    label = config["label"]
    jsonl_path = os.path.join(PROJECTS_DIR, f"{session_id}.jsonl")

    print(f"\n{'=' * 60}")
    print(f"Processing: {label}")
    print(f"Session ID: {session_id}")

    lines = load_raw_lines(jsonl_path)
    print(f"Total lines: {len(lines)}")

    boundaries = find_compaction_boundaries(lines)
    print(f"Compaction boundaries at lines: {boundaries}")

    segment_starts = [0] + boundaries
    segment_ends = boundaries + [len(lines)]

    output_subdir = os.path.join(OUTPUT_DIR, name)
    os.makedirs(output_subdir, exist_ok=True)

    for seg_idx in range(len(segment_starts)):
        start = segment_starts[seg_idx]
        end = segment_ends[seg_idx]
        seg_num = seg_idx + 1

        output_file = os.path.join(output_subdir, f"segment-{seg_num}.jsonl")
        with open(output_file, "w") as f:
            for line in lines[start:end]:
                f.write(line)

        size = os.path.getsize(output_file)
        print(f"  segment-{seg_num}.jsonl: lines {start}-{end - 1} ({end - start} records, {size:,} bytes)")


def main():
    for name, config in SESSIONS.items():
        process_session(name, config)

    # Clean up old .md files
    for name in SESSIONS:
        subdir = os.path.join(OUTPUT_DIR, name)
        for f in os.listdir(subdir):
            if f.endswith(".md"):
                os.remove(os.path.join(subdir, f))
                print(f"  Removed old {name}/{f}")

    print(f"\nDone! Output in: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
