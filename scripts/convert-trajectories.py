#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

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



def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    parquet_parser = subparsers.add_parser("parquet-to-jsonl")
    parquet_parser.add_argument("source", type=Path)
    parquet_parser.add_argument("target", type=Path)

    jsonl_parser = subparsers.add_parser("jsonl-to-json")
    jsonl_parser.add_argument("source", type=Path)
    jsonl_parser.add_argument("target", type=Path)

    raw_jsonl_parser = subparsers.add_parser("raw-jsonl-to-json")
    raw_jsonl_parser.add_argument("source", type=Path)
    raw_jsonl_parser.add_argument("target", type=Path)

    args = parser.parse_args()
    if args.command == "parquet-to-jsonl":
        count = convert_parquet_to_jsonl(args.source, args.target)
    elif args.command == "raw-jsonl-to-json":
        count = extract_raw_individual_trajectories(args.source, args.target)
    else:
        count = extract_adp_individual_trajectories(args.source, args.target)
    print(f"wrote {count} trajectories to {args.target}")


if __name__ == "__main__":
    main()
