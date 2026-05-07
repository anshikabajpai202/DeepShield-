# ============================================================
# backend.py — DeepShield FastAPI Backend
#
# Loads all 5 models at startup, exposes /predict endpoint.
# Run with: uvicorn backend:app --reload --port 8000
#
# The React frontend calls POST /predict with the image file
# and receives JSON with per-model scores + final verdict.
# ============================================================

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import torch
from transformers import AutoImageProcessor, AutoModelForImageClassification
from PIL import Image, ExifTags
import numpy as np
import cv2
import io
import urllib.request
import os
from typing import Optional

app = FastAPI(title="DeepShield API", version="1.0.0")

# ── CORS — allow the React dev server to call this backend ───
# In production, replace "*" with your actual frontend domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Model registry ───────────────────────────────────────────
MODELS_CONFIG = [
    {
        "id":    "haywoodsloan/ai-image-detector-deploy",
        "name":  "Haywoodsloan",
        "arch":  "SwinV2 · Generalist",
        "color": "#38bdf8",
        "note":  "Broad generalist across many image types and generators.",
    },
    {
        "id":    "Organika/sdxl-detector",
        "name":  "Organika",
        "arch":  "ViT · AI-Gen Specialist",
        "color": "#818cf8",
        "note":  "Specialist for modern diffusion-generated faces (SDXL, Flux).",
    },
    {
        "id":    "Wvolf/ViT_Deepfake_Detection",
        "name":  "Wvolf",
        "arch":  "ViT · 98.7% Accuracy",
        "color": "#e879f9",
        "note":  "MSc thesis model. Highest raw accuracy of the five.",
    },
    {
        "id":    "prithivMLmods/Deep-Fake-Detector-v2-Model",
        "name":  "PrithivMLmods v2",
        "arch":  "ViT · 92.12% F1",
        "color": "#34d399",
        "note":  "Trained on 56k images. Labels: Realism / Deepfake.",
    },
    {
        "id":    "Heem2/AI-vs-Real-Image-Detection",
        "name":  "Heem2",
        "arch":  "ViT · Low False Positive",
        "color": "#fb923c",
        "note":  "Very low false-positive rate on real photos.",
    },
]

# Fake-label keywords — handles different label naming conventions
FAKE_KEYWORDS = ["fake", "deepfake", "artificial", "ai", "generated", "synthetic"]

# ── Global model store (loaded once at startup) ──────────────
loaded_models = []

def get_fake_idx(model) -> int:
    for idx, label in model.config.id2label.items():
        if any(kw in label.lower() for kw in FAKE_KEYWORDS):
            return idx
    return 1  # fallback


@app.on_event("startup")
async def load_models():
    """
    Load all 5 models when the server starts.
    This runs once — models stay in memory for all subsequent requests.
    FastAPI's startup event is the right place to do expensive initialization.
    """
    global loaded_models
    print("\n[DeepShield] Loading models...")
    for cfg in MODELS_CONFIG:
        try:
            print(f"  → {cfg['name']}...", end=" ", flush=True)
            proc = AutoImageProcessor.from_pretrained(cfg["id"])
            mdl  = AutoModelForImageClassification.from_pretrained(cfg["id"])
            mdl.eval()
            loaded_models.append({
                **cfg,
                "processor": proc,
                "model":     mdl,
                "fake_idx":  get_fake_idx(mdl),
                "ok":        True,
            })
            print("✓")
        except Exception as e:
            print(f"✗ ({e})")
            loaded_models.append({**cfg, "ok": False, "error": str(e)})

    ok_count = sum(1 for m in loaded_models if m["ok"])
    print(f"\n[DeepShield] {ok_count}/5 models ready. Listening on http://localhost:8000\n")


# ── Face Detection Setup ─────────────────────────────────────
CASCADE_PATH = "haarcascade_frontalface_default.xml"

def ensure_cascade():
    if not os.path.exists(CASCADE_PATH):
        url = ("https://raw.githubusercontent.com/opencv/opencv/master"
               "/data/haarcascades/haarcascade_frontalface_default.xml")
        urllib.request.urlretrieve(url, CASCADE_PATH)
    return cv2.CascadeClassifier(CASCADE_PATH)


def detect_faces(pil_img: Image.Image) -> list:
    cascade = ensure_cascade()
    arr  = np.array(pil_img)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    hits = cascade.detectMultiScale(gray, scaleFactor=1.1,
                                    minNeighbors=5, minSize=(50, 50))
    return hits.tolist() if len(hits) > 0 else []


def get_exif(pil_img: Image.Image) -> dict:
    """
    Extract EXIF metadata.
    Real camera photos have EXIF (device, datetime, GPS).
    AI-generated images almost never do — a forensic signal.
    """
    try:
        raw = pil_img._getexif()
        if not raw:
            return {}
        return {
            ExifTags.TAGS.get(k, str(k)): str(v)
            for k, v in raw.items()
            if k in ExifTags.TAGS and len(str(v)) < 120
        }
    except Exception:
        return {}


def run_single_model(entry: dict, pil_img: Image.Image) -> dict:
    """Run one model and return fake/real probabilities."""
    inputs = entry["processor"](
        images=pil_img.convert("RGB"), return_tensors="pt"
    )
    with torch.no_grad():
        outputs = entry["model"](**inputs)
    probs  = torch.nn.functional.softmax(outputs.logits, dim=-1)[0].tolist()
    fake_p = probs[entry["fake_idx"]]
    real_p = 1.0 - fake_p
    return {
        "fake": round(fake_p, 4),
        "real": round(real_p, 4),
        "vote": "FAKE" if fake_p >= 0.5 else "REAL",
    }


def majority_vote(results: list) -> str:
    fake_votes = sum(1 for r in results if r["vote"] == "FAKE")
    real_votes = sum(1 for r in results if r["vote"] == "REAL")
    if fake_votes >= 3:
        return "FAKE"
    elif real_votes >= 3:
        return "REAL"
    return "UNCERTAIN"


# ── API Endpoints ────────────────────────────────────────────

@app.get("/")
def root():
    """Health check — visit http://localhost:8000 to confirm it's running."""
    active = [m["name"] for m in loaded_models if m["ok"]]
    return {
        "status":        "DeepShield API running",
        "models_loaded": len(active),
        "models":        active,
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """
    Main prediction endpoint.
    Accepts: multipart/form-data with an image file
    Returns: JSON with per-model scores, verdict, face info, EXIF

    The React frontend sends the image here and receives this JSON.
    """
    # Validate file type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Read and open the image
    contents = await file.read()
    try:
        pil_img = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image file")

    # Get active models only
    active = [m for m in loaded_models if m["ok"]]
    if len(active) < 3:
        raise HTTPException(
            status_code=503,
            detail=f"Only {len(active)} models loaded — need at least 3 for majority vote"
        )

    # Run all models
    model_results = []
    for entry in active:
        result = run_single_model(entry, pil_img)
        model_results.append({
            "name":  entry["name"],
            "arch":  entry["arch"],
            "color": entry["color"],
            "note":  entry["note"],
            **result,
        })

    # Determine verdict
    verdict = majority_vote(model_results)

    # Face detection
    faces     = detect_faces(pil_img)
    face_count = len(faces)

    # EXIF
    try:
        raw_pil = Image.open(io.BytesIO(contents))
        exif = get_exif(raw_pil)
    except Exception:
        exif = {}

    return {
        "verdict":      verdict,
        "fake_votes":   sum(1 for r in model_results if r["vote"] == "FAKE"),
        "real_votes":   sum(1 for r in model_results if r["vote"] == "REAL"),
        "model_results": model_results,
        "face_count":   face_count,
        "has_exif":     len(exif) > 0,
        "exif_count":   len(exif),
        "image_width":  pil_img.width,
        "image_height": pil_img.height,
    }
