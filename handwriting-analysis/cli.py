"""Command-line signature comparison.

Usage:
    python cli.py reference.png questioned.png
"""

from __future__ import annotations

import argparse
import sys

from signature_verifier import compare_bytes
from signature_verifier.features import WEIGHTS

LABELS = {
    "structural": "Structural overlap (SSIM)",
    "gradient": "Stroke direction (HOG)",
    "keypoint": "Local features (ORB)",
    "global_geom": "Writing habits (geometry)",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compare two signature images and print a similarity score."
    )
    parser.add_argument("reference", help="path to the reference signature image")
    parser.add_argument("questioned", help="path to the questioned signature image")
    args = parser.parse_args(argv)

    try:
        with open(args.reference, "rb") as f:
            data_a = f.read()
        with open(args.questioned, "rb") as f:
            data_b = f.read()
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    try:
        result = compare_bytes(data_a, data_b)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"\nSimilarity score : {result.score} / 100")
    print(f"Verdict          : {result.verdict}\n")
    print(f"{'Metric':<28}{'Similarity':>12}{'Weight':>9}")
    print("-" * 49)
    for key, value in result.metrics.items():
        print(f"{LABELS[key]:<28}{value * 100:>11.1f}%{int(WEIGHTS[key] * 100):>8}%")
    print()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        # Downstream pipe closed early (e.g. `| head`); exit quietly.
        sys.exit(0)
