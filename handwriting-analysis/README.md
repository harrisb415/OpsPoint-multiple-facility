# Signature & Handwriting Forensic Verification

A Python (OpenCV + ML) **web app** that compares two signature or handwriting
samples and produces a similarity score, a plain-language verdict, and a
per-metric breakdown — built as a decision-support aid for review workflows.

> ⚠️ **Disclaimer.** Scores are heuristic and intended to *assist* a human
> reviewer. This tool is **not** a certified forensic instrument and its
> output should not be treated as a legal determination of authenticity.
> Confirm any consequential decision with a qualified document examiner.

---

## What it does

1. **Normalises** each sample — grayscale → denoise → Otsu binarisation →
   crop to the ink → fit onto a common canvas, so two scans compare fairly
   regardless of resolution, ink colour, or page placement.
2. **Measures** similarity from four complementary angles:

   | Metric | Captures | Method |
   |--------|----------|--------|
   | Structural overlap | overall shape / pixel overlap | SSIM |
   | Stroke direction | edge & pen-stroke orientation | HOG + cosine similarity |
   | Local features | distinctive local detail | ORB keypoints + ratio-test matching |
   | Writing habits | ink density, aspect ratio, stroke count | geometric ratios |

3. **Scores** — combines the metrics into a weighted **0–100** similarity and
   maps it to a verdict:

   | Score | Verdict |
   |-------|---------|
   | ≥ 75 | Likely genuine — high similarity |
   | 55–74 | Inconclusive — manual review recommended |
   | < 55 | Likely different signer / possible forgery |

Weights live in `signature_verifier/features.py` (`WEIGHTS`) and the verdict
thresholds in `signature_verifier/compare.py` — tune them to your data.

---

## Project layout

```
handwriting-analysis/
  app.py                       Flask web app (upload two images → result page)
  cli.py                       Command-line comparison
  requirements.txt
  signature_verifier/
    preprocess.py              OpenCV normalisation pipeline → Sample
    features.py                SSIM / HOG / ORB / geometry similarity metrics
    compare.py                 Orchestration, scoring, verdict
  templates/                   base / index / result HTML
  static/style.css
  samples/make_samples.py      Generates synthetic signatures for testing
  tests/test_compare.py        Behavioural tests (self-contained)
```

---

## Setup

```bash
cd handwriting-analysis
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run the web app

```bash
python app.py
# open http://127.0.0.1:5000/
```

Upload a **reference** and a **questioned** signature, then read the score,
the normalised side-by-side previews, and the metric breakdown.

## Run from the command line

```bash
python cli.py path/to/reference.png path/to/questioned.png
```

## Try it with synthetic samples

```bash
python samples/make_samples.py          # writes genuine_a/b.png + forgery.png
python cli.py samples/genuine_a.png samples/genuine_b.png   # high score
python cli.py samples/genuine_a.png samples/forgery.png     # low score
```

## Tests

```bash
pip install pytest
pytest -q
```

---

## How scoring works (detail)

Each metric returns a similarity in `[0, 1]`. The combined score is:

```
score = 100 × Σ ( metric_i × weight_i )
```

with default weights `structural 0.30`, `gradient 0.30`, `keypoint 0.20`,
`global_geom 0.20`. Because the metrics view the signature differently, a
genuine pair tends to score high across most of them, while a forgery usually
fails at least one (e.g. matching global shape but diverging on local ORB
features). The breakdown table on the result page shows each metric's raw
similarity and its contribution so a reviewer can see *why* a pair scored the
way it did.

## Notes & limitations

- Best results come from reasonably clean, cropped signature images on a light
  background. Heavy background texture or overlapping text degrades accuracy.
- The default thresholds are starting points, not calibrated decision
  boundaries — collect labelled genuine/forgery pairs and tune `WEIGHTS` and
  the thresholds for your population.
- For production-grade accuracy, consider training a Siamese CNN on a labelled
  signature dataset; the preprocessing pipeline here is a solid front end for
  that next step.
