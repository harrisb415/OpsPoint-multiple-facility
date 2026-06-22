"""Image preprocessing pipeline for signature/handwriting verification.

The pipeline normalises raw signature scans so that two samples can be
compared fairly regardless of scan resolution, ink colour, page background,
or where on the page the signature sits.

Steps:
    1. Decode to grayscale.
    2. Denoise + Otsu binarisation (ink becomes white on black).
    3. Locate the ink bounding box and crop tightly to it.
    4. Resize-with-padding onto a fixed canvas so structural metrics
       (SSIM, HOG) operate on aligned, equally sized images.

It returns both the fixed-size normalised image (for pixel/gradient
comparison) and the tightly cropped image (so we can measure the signer's
true proportions and ink habits before the aspect ratio is forced).
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

# Fixed canvas used for all structural comparisons.
CANVAS_W = 512
CANVAS_H = 256


@dataclass
class Sample:
    """Everything downstream comparison needs from a single signature."""

    gray_norm: np.ndarray      # CANVAS_H x CANVAS_W, uint8 grayscale (ink dark)
    bin_norm: np.ndarray       # CANVAS_H x CANVAS_W, uint8 binary (ink white)
    crop_bin: np.ndarray       # tightly cropped binary, original proportions
    aspect: float              # width / height of the ink bounding box
    ink_density: float         # fraction of cropped area that is ink
    stroke_count: int          # number of distinct ink contours
    display_png: bytes         # PNG of the normalised image for the UI


def _decode(data: bytes) -> np.ndarray:
    """Decode raw image bytes into a grayscale uint8 array."""
    buf = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Could not decode image — unsupported or corrupt file.")
    return img


def _binarise(gray: np.ndarray) -> np.ndarray:
    """Return a binary image where ink pixels are white (255) on black."""
    # Light blur tames scanner noise without erasing thin strokes.
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    # THRESH_BINARY_INV: dark ink on light paper -> white ink on black.
    _, binary = cv2.threshold(
        blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    # Drop specks smaller than a few pixels (dust, JPEG artefacts).
    kernel = np.ones((2, 2), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
    return binary


def _ink_bbox(binary: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box (x, y, w, h) of all ink, or the full frame if blank."""
    ys, xs = np.where(binary > 0)
    if xs.size == 0:
        h, w = binary.shape
        return 0, 0, w, h
    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    return int(x0), int(y0), int(x1 - x0 + 1), int(y1 - y0 + 1)


def _fit_canvas(crop: np.ndarray) -> np.ndarray:
    """Resize the crop to fit CANVAS while preserving aspect, pad with black."""
    h, w = crop.shape
    if h == 0 or w == 0:
        return np.zeros((CANVAS_H, CANVAS_W), np.uint8)
    scale = min(CANVAS_W / w, CANVAS_H / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((CANVAS_H, CANVAS_W), np.uint8)
    x_off = (CANVAS_W - new_w) // 2
    y_off = (CANVAS_H - new_h) // 2
    canvas[y_off:y_off + new_h, x_off:x_off + new_w] = resized
    return canvas


def _count_strokes(binary: np.ndarray) -> int:
    """Approximate stroke count via external contours of the ink."""
    contours, _ = cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    # Ignore trivial contours that survived denoising.
    return sum(1 for c in contours if cv2.contourArea(c) >= 4)


def preprocess(data: bytes) -> Sample:
    """Run the full pipeline on raw image bytes."""
    gray = _decode(data)
    binary = _binarise(gray)

    x, y, w, h = _ink_bbox(binary)
    crop_bin = binary[y:y + h, x:x + w]
    crop_gray = gray[y:y + h, x:x + w]

    bin_norm = _fit_canvas(crop_bin)
    # Normalised grayscale: invert the binary canvas back to ink-dark for SSIM
    # readability, but keep it derived from the same aligned crop.
    gray_norm = _fit_canvas(crop_gray)

    ink_pixels = int((crop_bin > 0).sum())
    area = max(1, crop_bin.shape[0] * crop_bin.shape[1])
    ink_density = ink_pixels / area
    aspect = w / h if h else 1.0
    stroke_count = _count_strokes(crop_bin)

    ok, png = cv2.imencode(".png", gray_norm)
    display_png = png.tobytes() if ok else b""

    return Sample(
        gray_norm=gray_norm,
        bin_norm=bin_norm,
        crop_bin=crop_bin,
        aspect=aspect,
        ink_density=ink_density,
        stroke_count=stroke_count,
        display_png=display_png,
    )
