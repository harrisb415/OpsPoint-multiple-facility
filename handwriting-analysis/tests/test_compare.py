"""Behavioural tests for the signature comparison pipeline.

These build synthetic signature images in-memory so the suite is fully
self-contained (no fixture files needed). The key invariants:

    * identical images score near 100 and read as a match
    * a lightly jittered copy still scores clearly higher than a
      structurally different curve
    * every per-metric score stays within [0, 1]
"""

from __future__ import annotations

import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from signature_verifier import compare_bytes, preprocess  # noqa: E402
from signature_verifier.features import all_metrics  # noqa: E402


def _curve_png(seed: int, jitter: float = 0.0, freq: float = 26.0) -> bytes:
    rng = np.random.default_rng(seed)
    img = np.full((220, 600), 255, np.uint8)
    xs = np.linspace(40, 560, 240)
    ys = 110 + 38 * np.sin(xs / freq) + 14 * np.sin(xs / 9.0 + 1.0)
    if jitter:
        ys = ys + rng.normal(0, jitter, size=ys.shape)
    pts = np.stack([xs, ys], axis=1).astype(np.int32)
    for i in range(len(pts) - 1):
        cv2.line(img, tuple(pts[i]), tuple(pts[i + 1]), 0, 3, cv2.LINE_AA)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def test_identical_signatures_score_high():
    png = _curve_png(seed=1)
    result = compare_bytes(png, png)
    assert result.score >= 95
    assert result.verdict_class == "match"


def test_metrics_within_unit_range():
    a = preprocess(_curve_png(seed=1))
    b = preprocess(_curve_png(seed=1, jitter=2.0))
    for name, value in all_metrics(a, b).items():
        assert 0.0 <= value <= 1.0, f"{name} out of range: {value}"


def test_genuine_beats_forgery():
    ref = _curve_png(seed=1)
    genuine = _curve_png(seed=1, jitter=1.5)        # same curve, small jitter
    forgery = _curve_png(seed=42, jitter=2.0, freq=12.0)  # different curve

    genuine_score = compare_bytes(ref, genuine).score
    forgery_score = compare_bytes(ref, forgery).score
    assert genuine_score > forgery_score


def test_blank_image_does_not_crash():
    blank = np.full((100, 300), 255, np.uint8)
    ok, buf = cv2.imencode(".png", blank)
    assert ok
    result = compare_bytes(buf.tobytes(), buf.tobytes())
    assert 0.0 <= result.score <= 100.0


def test_corrupt_bytes_raise_value_error():
    with pytest.raises(ValueError):
        compare_bytes(b"not an image", b"also not an image")
