"""Top-level signature comparison: preprocess, score, and render a verdict."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

from . import features
from .preprocess import Sample, preprocess

# Verdict thresholds on the 0–100 combined score. These are heuristic
# decision boundaries for a review aid, *not* a calibrated forensic
# instrument — see README for the disclaimer.
GENUINE_THRESHOLD = 75.0
INCONCLUSIVE_THRESHOLD = 55.0


@dataclass
class ComparisonResult:
    score: float                       # combined 0–100
    verdict: str                       # human-readable label
    verdict_class: str                 # css class: match / review / mismatch
    metrics: dict[str, float]          # raw per-metric similarity (0–1)
    weighted: dict[str, float]         # each metric's contribution to score
    sample_a: Sample = field(repr=False)
    sample_b: Sample = field(repr=False)

    def display_a_uri(self) -> str:
        return _png_data_uri(self.sample_a.display_png)

    def display_b_uri(self) -> str:
        return _png_data_uri(self.sample_b.display_png)


def _png_data_uri(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _verdict(score: float) -> tuple[str, str]:
    if score >= GENUINE_THRESHOLD:
        return "Likely genuine — high similarity", "match"
    if score >= INCONCLUSIVE_THRESHOLD:
        return "Inconclusive — manual review recommended", "review"
    return "Likely different signer / possible forgery", "mismatch"


def compare_bytes(data_a: bytes, data_b: bytes) -> ComparisonResult:
    """Compare two raw signature images and return a full result."""
    a = preprocess(data_a)
    b = preprocess(data_b)
    return compare_samples(a, b)


def compare_samples(a: Sample, b: Sample) -> ComparisonResult:
    metrics = features.all_metrics(a, b)
    weighted = {k: metrics[k] * features.WEIGHTS[k] for k in metrics}
    score = round(sum(weighted.values()) * 100.0, 1)
    verdict, verdict_class = _verdict(score)
    return ComparisonResult(
        score=score,
        verdict=verdict,
        verdict_class=verdict_class,
        metrics=metrics,
        weighted=weighted,
        sample_a=a,
        sample_b=b,
    )
