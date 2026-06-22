"""Signature / handwriting forensic verification toolkit.

Public API:
    preprocess(data: bytes) -> Sample
    compare_bytes(a: bytes, b: bytes) -> ComparisonResult
"""

from .compare import ComparisonResult, compare_bytes, compare_samples
from .preprocess import Sample, preprocess

__all__ = [
    "Sample",
    "ComparisonResult",
    "preprocess",
    "compare_bytes",
    "compare_samples",
]

__version__ = "0.1.0"
