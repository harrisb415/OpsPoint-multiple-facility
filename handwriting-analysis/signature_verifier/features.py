"""Per-metric similarity scores between two preprocessed signatures.

Each function returns a similarity in [0, 1] where 1 means "identical" for
that particular view of the signature. The metrics are deliberately
complementary:

    structural  – SSIM on the aligned grayscale canvases (overall shape/overlap)
    gradient    – cosine similarity of HOG descriptors (stroke direction/edges)
    keypoint    – ORB descriptor match ratio (local distinctive features)
    global_geom – ink density / aspect ratio / stroke count (writing habits)

Keeping them separate lets the UI explain *why* two samples scored the way
they did, which matters for a forensic / review context.
"""

from __future__ import annotations

import cv2
import numpy as np
from skimage.feature import hog
from skimage.metrics import structural_similarity as ssim

from .preprocess import Sample


def structural_score(a: Sample, b: Sample) -> float:
    """SSIM on the aligned grayscale canvases."""
    score = ssim(a.gray_norm, b.gray_norm)
    # SSIM is in [-1, 1]; clamp the (rare) negative tail to 0.
    return float(max(0.0, score))


def _hog_vector(gray: np.ndarray) -> np.ndarray:
    return hog(
        gray,
        orientations=9,
        pixels_per_cell=(16, 16),
        cells_per_block=(2, 2),
        block_norm="L2-Hys",
        feature_vector=True,
    )


def gradient_score(a: Sample, b: Sample) -> float:
    """Cosine similarity of HOG descriptors (edge/stroke orientation)."""
    va = _hog_vector(a.gray_norm)
    vb = _hog_vector(b.gray_norm)
    na = np.linalg.norm(va)
    nb = np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    cos = float(np.dot(va, vb) / (na * nb))
    return max(0.0, cos)


def keypoint_score(a: Sample, b: Sample) -> float:
    """ORB descriptor match ratio using Lowe's ratio test."""
    orb = cv2.ORB_create(nfeatures=500)
    ka, da = orb.detectAndCompute(a.bin_norm, None)
    kb, db = orb.detectAndCompute(b.bin_norm, None)
    if da is None or db is None or len(ka) == 0 or len(kb) == 0:
        return 0.0

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    knn = matcher.knnMatch(da, db, k=2)
    good = 0
    for pair in knn:
        if len(pair) < 2:
            continue
        m, n = pair
        if m.distance < 0.75 * n.distance:
            good += 1

    denom = min(len(ka), len(kb))
    return float(min(1.0, good / denom)) if denom else 0.0


def _ratio_sim(x: float, y: float) -> float:
    """Symmetric similarity of two non-negative scalars, in [0, 1]."""
    hi = max(x, y)
    if hi == 0:
        return 1.0
    return 1.0 - abs(x - y) / hi


def global_geom_score(a: Sample, b: Sample) -> float:
    """Average similarity of ink density, aspect ratio and stroke count."""
    density = _ratio_sim(a.ink_density, b.ink_density)
    aspect = _ratio_sim(a.aspect, b.aspect)
    strokes = _ratio_sim(float(a.stroke_count), float(b.stroke_count))
    return float(np.mean([density, aspect, strokes]))


# Weights sum to 1.0. Structural and gradient similarity are the most
# reliable signals for signatures, so they carry the most weight.
WEIGHTS = {
    "structural": 0.30,
    "gradient": 0.30,
    "keypoint": 0.20,
    "global_geom": 0.20,
}


def all_metrics(a: Sample, b: Sample) -> dict[str, float]:
    """Compute every per-metric similarity score in [0, 1]."""
    return {
        "structural": structural_score(a, b),
        "gradient": gradient_score(a, b),
        "keypoint": keypoint_score(a, b),
        "global_geom": global_geom_score(a, b),
    }
