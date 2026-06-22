"""Flask web app for signature / handwriting forensic verification.

Run:
    python app.py
then open http://127.0.0.1:5000/ and upload two signature images.
"""

from __future__ import annotations

import os

from flask import Flask, render_template, request

from signature_verifier import compare_bytes
from signature_verifier.features import WEIGHTS

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
MAX_CONTENT_LENGTH = 12 * 1024 * 1024  # 12 MB per request

# Friendly labels for the per-metric breakdown shown in the UI.
METRIC_LABELS = {
    "structural": "Structural overlap (SSIM)",
    "gradient": "Stroke direction (HOG)",
    "keypoint": "Local features (ORB)",
    "global_geom": "Writing habits (geometry)",
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


def _ext_ok(filename: str) -> bool:
    return os.path.splitext(filename.lower())[1] in ALLOWED_EXT


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/compare", methods=["POST"])
def compare():
    file_a = request.files.get("signature_a")
    file_b = request.files.get("signature_b")

    if not file_a or not file_b or not file_a.filename or not file_b.filename:
        return render_template(
            "index.html", error="Please choose two signature images."
        ), 400

    for f in (file_a, file_b):
        if not _ext_ok(f.filename):
            return render_template(
                "index.html",
                error=f"Unsupported file type: {f.filename}. "
                f"Allowed: {', '.join(sorted(ALLOWED_EXT))}",
            ), 400

    try:
        result = compare_bytes(file_a.read(), file_b.read())
    except ValueError as exc:
        return render_template("index.html", error=str(exc)), 400

    rows = [
        {
            "label": METRIC_LABELS[key],
            "similarity": round(result.metrics[key] * 100, 1),
            "weight": int(WEIGHTS[key] * 100),
            "contribution": round(result.weighted[key] * 100, 1),
        }
        for key in result.metrics
    ]

    return render_template(
        "result.html",
        result=result,
        rows=rows,
        name_a=file_a.filename,
        name_b=file_b.filename,
    )


@app.errorhandler(413)
def too_large(_err):
    return render_template(
        "index.html", error="File too large (max 12 MB per image)."
    ), 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=True)
