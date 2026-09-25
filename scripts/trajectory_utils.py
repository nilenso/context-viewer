#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Standardized ADP trajectories are available from the `std` JSONL split:
# https://datasets-server.huggingface.co/first-rows?dataset=neulab%2Fagent-data-collection&config=nebius_SWE-agent-trajectories&split=std
def extract_adp_individual_trajectories(source: Path, target: Path) -> int:
    target.mkdir(parents=True, exist_ok=True)
    count = 0
    with source.open() as lines:
        for line in lines:
            if not line.strip():
                continue
            record = json.loads(line)
            trajectory_id = str(record["id"])
            if Path(trajectory_id).name != trajectory_id:
                raise ValueError(f"unsafe trajectory id: {trajectory_id}")
            (target / f"{trajectory_id}.json").write_text(json.dumps(record, indent=2) + "\n")
            count += 1
    return count


# Trajectories can come from either the `std` or `raw` split. This experiment uses `raw`:
# https://datasets-server.huggingface.co/first-rows?dataset=neulab%2Fagent-data-collection&config=nebius_SWE-agent-trajectories&split=raw
def extract_raw_individual_trajectories(source: Path, target: Path) -> int:
    target.mkdir(parents=True, exist_ok=True)
    count = 0
    with source.open() as lines:
        for line in lines:
            if not line.strip():
                continue
            record = json.loads(line)
            trajectory_id = str(record["instance_id"])
            if Path(trajectory_id).name != trajectory_id:
                raise ValueError(f"unsafe trajectory id: {trajectory_id}")
            (target / f"{trajectory_id}.json").write_text(json.dumps(record, indent=2) + "\n")
            count += 1
    return count


# Original trajectories come from the Parquet-backed Nebius dataset:
# https://datasets-server.huggingface.co/rows?dataset=nebius%2FSWE-agent-trajectories&config=default&split=train&offset=0&length=100
# Download a Parquet shard, then convert it to JSONL with this function.
def convert_parquet_to_jsonl(source: Path, target: Path) -> int:
    try:
        import pyarrow.parquet as parquet
    except ImportError as error:
        raise SystemExit("parquet conversion requires pyarrow: python3 -m pip install pyarrow") from error

    target.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with target.open("w") as output:
        for batch in parquet.ParquetFile(source).iter_batches():
            for record in batch.to_pylist():
                output.write(json.dumps(record) + "\n")
                count += 1
    return count


def analyze_trajectory(
    source: Path,
    output: Optional[Path] = None,
    spec_path: Optional[Path] = None,
) -> Path:
    root = Path(__file__).resolve().parent.parent
    output = output or root / "results/cv-analyzed-trajectories" / f"{source.stem}.annotated.json"
    spec_path = spec_path or root / "context-lens/sample-specs/agent-trajectory.json"

    env = os.environ.copy()
    api_key = env.get("VITE_OPENROUTER_API_KEY")
    if not api_key:
        raise SystemExit("VITE_OPENROUTER_API_KEY is missing from the process environment")

    # Context Lens reads OPENAI_* variables while this process uses Vite-facing names.
    # Override them here to route analysis through OpenRouter instead of OpenAI defaults.
    env.update({
        "OPENAI_API_KEY": api_key,
        "OPENAI_BASE_URL": "https://openrouter.ai/api/v1",
        "OPENAI_MODEL": env.get("VITE_AI_MODEL", "openai/gpt-6-luna"),
        "OPENAI_API_MODE": "chat",
    })
    result = subprocess.run(
        [
            "bun", "run", str(root / "context-lens/src/cli.ts"),
            "--preserve-tool-calls",
            "--spec", str(spec_path.resolve()),
            str(source.resolve()),
        ],
        cwd=root,
        env=env,
        stdout=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        raise SystemExit(result.returncode)

    lines = result.stdout.splitlines()
    marker = lines.index("Full Context Viewer export written to:")
    export_path = Path(lines[marker + 1])
    export = json.loads(export_path.read_text())

    # Context Lens stores the input path as filename; exports only need its display stem.
    export["files"][0]["filename"] = source.stem
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(export, indent=2) + "\n")
    return output


def analyze_trajectories(names: list[str]) -> list[Path]:
    root = Path(__file__).resolve().parent.parent
    return [
        analyze_trajectory(root / "results/raw-agent-trajectories" / f"{Path(name).stem}.json")
        for name in names
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze trajectories with Context Lens")
    parser.add_argument("names", nargs="+")
    args = parser.parse_args()
    for output in analyze_trajectories(args.names):
        print(output)
