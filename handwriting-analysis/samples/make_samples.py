"""Generate synthetic signature images for local testing / demos.

These are *not* real signatures — they are smooth pen-stroke curves drawn with
OpenCV so you can exercise the pipeline without sourcing handwriting samples.

    python samples/make_samples.py

Produces, in this folder:
    genuine_a.png    – reference signature
    genuine_b.png    – same signature, lightly jittered (should score high)
    forgery.png      – a clearly different curve (should score low)
"""

from __future__ import annotations

import os

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 600, 220


def _stroke(seed: int, jitter: float = 0.0, shape=(26.0, 11.0, 5.0)) -> np.ndarray:
    """Draw a wavy signature-like stroke on a white canvas.

    ``shape`` sets the three sine wavelengths, i.e. the underlying signature
    form. Two samples that share a ``shape`` are the "same" signature (the
    ``seed``/``jitter`` only add pen wobble); a different ``shape`` is a
    genuinely different signature.
    """
    rng = np.random.default_rng(seed)
    img = np.full((H, W), 255, np.uint8)
    xs = np.linspace(40, W - 40, 240)
    f1, f2, f3 = shape
    # A few overlaid sine components give a handwriting-ish baseline.
    base = (
        38 * np.sin(xs / f1)
        + 16 * np.sin(xs / f2 + 1.3)
        + 9 * np.sin(xs / f3 + 0.4)
    )
    ys = H / 2 + base
    if jitter:
        ys = ys + rng.normal(0, jitter, size=ys.shape)
        xs = xs + rng.normal(0, jitter, size=xs.shape)
    pts = np.stack([xs, ys], axis=1).astype(np.int32)
    for i in range(len(pts) - 1):
        cv2.line(img, tuple(pts[i]), tuple(pts[i + 1]), 0, 3, cv2.LINE_AA)
    return img


def main() -> None:
    cv2.imwrite(os.path.join(HERE, "genuine_a.png"), _stroke(seed=7))
    cv2.imwrite(os.path.join(HERE, "genuine_b.png"), _stroke(seed=7, jitter=1.6))
    # A different underlying shape => a genuinely distinct signature.
    forgery = _stroke(seed=99, jitter=2.0, shape=(13.0, 6.0, 3.0))
    cv2.imwrite(os.path.join(HERE, "forgery.png"), forgery)
    print("Wrote genuine_a.png, genuine_b.png, forgery.png to", HERE)


if __name__ == "__main__":
    main()
