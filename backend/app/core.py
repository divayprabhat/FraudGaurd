"""Model loading, scoring and the in-memory transaction store.

All predictions come from the artifact produced by the notebook / scripts/train_model.py.
If the artifact is missing the API says so; there is no fallback predictor.
"""
from __future__ import annotations

import json
import os
import threading
import time
import warnings
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .training import DatasetError, file_sha256
from .training import train as train_model

BASE_DIR = Path(__file__).resolve().parent.parent
ARTIFACT_DIR = Path(os.getenv("FRAUDGUARD_ARTIFACT_DIR", BASE_DIR / "artifacts"))
MODEL_PATH = ARTIFACT_DIR / "fraud_detection_model.joblib"
EVAL_PATH = ARTIFACT_DIR / "evaluation.json"
HOLDOUT_PATH = ARTIFACT_DIR / "holdout_transactions.csv"
REFERENCE_PATH = BASE_DIR / "reference" / "notebook_results.json"
DATA_CSV = Path(os.getenv("FRAUDGUARD_DATA_CSV", BASE_DIR / "data" / "credit_card_fraud_10k.csv"))
AUTO_TRAIN = os.getenv("FRAUDGUARD_AUTO_TRAIN", "1").lower() not in ("0", "false", "no")

FEATURES = [
    "amount", "transaction_hour", "merchant_category", "foreign_transaction",
    "location_mismatch", "device_trust_score", "velocity_last_24h", "cardholder_age",
]
HIGH_RISK_FLOOR = 0.70  # notebook: HIGH if prob >= max(threshold, 0.70)
ACTIONS = {"LOW": "STANDARD_PROCESSING", "MEDIUM": "MANUAL_REVIEW", "HIGH": "ESCALATE_FOR_REVIEW"}

SETUP_HELP = (
    "Model artifact not found. Place credit_card_fraud_10k.csv in backend/data/ and restart the API "
    "(it trains automatically), or run `python scripts/train_model.py`."
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_reference() -> dict:
    return json.loads(REFERENCE_PATH.read_text())


class ModelStore:
    def __init__(self) -> None:
        self.artifact: dict | None = None
        self.error: str | None = None
        self.categories: list[str] = []
        self.evaluation: dict | None = None
        self.reference = load_reference()
        self.load()

    # ---- (re)training --------------------------------------------------------
    def _artifacts_current(self) -> bool:
        """True when a complete artifact set exists and was trained on the CSV that is on disk now."""
        if not (MODEL_PATH.exists() and EVAL_PATH.exists() and HOLDOUT_PATH.exists()):
            return False
        if not DATA_CSV.exists():
            return True  # nothing to retrain from; use what we have
        try:
            trained_on = json.loads(EVAL_PATH.read_text()).get("dataset", {}).get("csv_sha256")
            return trained_on == file_sha256(DATA_CSV)
        except (OSError, ValueError):
            return False

    def _retrain(self, why: str) -> bool:
        if not (AUTO_TRAIN and DATA_CSV.exists()):
            return False
        print(f"[fraudguard] {why} - training from {DATA_CSV.name} (takes a few seconds)...", flush=True)
        try:
            train_model(DATA_CSV, ARTIFACT_DIR)
            return True
        except DatasetError as exc:
            self.error = f"Cannot train from {DATA_CSV.name}: {exc}"
        except Exception as exc:  # noqa: BLE001
            self.error = f"Training failed: {exc}"
        return False

    def _read_artifact(self) -> dict:
        from sklearn.exceptions import InconsistentVersionWarning
        with warnings.catch_warnings():
            warnings.simplefilter("error", InconsistentVersionWarning)  # artifact built by another scikit-learn
            art = joblib.load(MODEL_PATH)
        if list(art["feature_columns"]) != FEATURES:
            raise ValueError(f"Artifact features {art['feature_columns']} differ from expected {FEATURES}")
        return art

    def load(self) -> None:
        self.artifact, self.error, self.evaluation = None, None, None
        if not self._artifacts_current():
            self._retrain("Artifacts missing or older than the dataset")
        art = None
        if MODEL_PATH.exists():
            try:
                art = self._read_artifact()
            except Exception as exc:  # noqa: BLE001  (incompatible version, corrupt file, wrong features)
                self.error = f"Could not load model artifact: {exc}"
                if self._retrain("Model artifact unusable here"):
                    try:
                        art, self.error = self._read_artifact(), None
                    except Exception as exc2:  # noqa: BLE001
                        art, self.error = None, f"Could not load model artifact: {exc2}"
        elif self.error is None:
            self.error = SETUP_HELP
        if art is not None:
            est = art["pipeline"].named_steps["model"]
            if hasattr(est, "n_jobs"):  # single-row inference is much faster without a thread pool
                est.n_jobs = 1
            enc = art["pipeline"].named_steps["preprocessor"].named_transformers_["categorical"].named_steps["onehot"]
            self.categories = [str(c) for c in enc.categories_[0]]
            self.artifact = art
        if EVAL_PATH.exists():
            try:
                self.evaluation = json.loads(EVAL_PATH.read_text())
            except ValueError:
                self.evaluation = None

    def canonical_category(self, value: str) -> str | None:
        """Match a merchant category against the trained ones (case/whitespace-insensitive)."""
        v = value.strip().lower()
        return next((c for c in self.categories if c.lower() == v), None)

    @property
    def ready(self) -> bool:
        return self.artifact is not None

    @property
    def threshold(self) -> float:
        return float(self.artifact["threshold"])

    @property
    def high_cutoff(self) -> float:
        return max(self.threshold, HIGH_RISK_FLOOR)

    def classify(self, prob: float) -> tuple[str, str]:
        if prob >= self.high_cutoff:
            risk = "HIGH"
        elif prob >= self.threshold:
            risk = "MEDIUM"
        else:
            risk = "LOW"
        return risk, ACTIONS[risk]

    def predict_df(self, df: pd.DataFrame) -> np.ndarray:
        return self.artifact["pipeline"].predict_proba(df[FEATURES])[:, 1]

    def predict_one(self, tx: dict) -> dict:
        t0 = time.perf_counter()
        prob = float(self.predict_df(pd.DataFrame([tx]))[0])
        latency_ms = (time.perf_counter() - t0) * 1000
        risk, action = self.classify(prob)
        return {
            "fraud_probability": prob, "model_threshold": self.threshold, "risk_level": risk,
            "recommended_action": action, "predicted_fraud": int(prob >= self.threshold),
            "model_version": self.artifact["model_version"], "latency_ms": latency_ms,
        }


class TransactionStore:
    """Holds scored held-out transactions plus anything analysed through the API."""

    def __init__(self, model: ModelStore) -> None:
        self.model = model
        self.rows: list[dict] = []
        self.holdout_df: pd.DataFrame | None = None
        self.lock = threading.Lock()
        self.startup_latency_ms: float | None = None
        self.startup_samples = 0
        self.live_latencies: deque = deque(maxlen=500)  # real scoring times of analyses made through the API
        self.index: dict[str, dict] = {}
        self._manual_seq = 0
        self.load_holdout()

    def load_holdout(self) -> None:
        self.rows, self.holdout_df, self.index = [], None, {}
        if not (self.model.ready and HOLDOUT_PATH.exists()):
            return
        df = pd.read_csv(HOLDOUT_PATH)
        df["merchant_category"] = df["merchant_category"].fillna("Unknown").astype(str)
        self.holdout_df = df.reset_index(drop=True)
        probs = self.model.predict_df(df)
        for i, p in enumerate(probs):
            r = df.iloc[i]
            risk, action = self.model.classify(float(p))
            self.rows.append({
                "id": f"TXN-{int(r['transaction_id']):07d}", "amount": float(r["amount"]),
                "merchant_category": str(r["merchant_category"]), "transaction_hour": int(r["transaction_hour"]),
                "foreign_transaction": int(r["foreign_transaction"]), "location_mismatch": int(r["location_mismatch"]),
                "device_trust_score": int(r["device_trust_score"]), "velocity_last_24h": int(r["velocity_last_24h"]),
                "cardholder_age": int(r["cardholder_age"]), "fraud_probability": float(p), "risk_level": risk,
                "recommended_action": action, "predicted_fraud": int(p >= self.model.threshold),
                "actual_is_fraud": int(r["is_fraud"]), "source": "held-out test set", "timestamp": None,  # the dataset has no event times; set when actually scored live
                "model_version": self.model.artifact["model_version"],
            })
        self.index = {r["id"]: r for r in self.rows}
        # Real measurement of single-transaction scoring latency on this machine (startup sample only).
        lat = [self.model.predict_one({k: df.iloc[i][k] for k in FEATURES})["latency_ms"] for i in range(min(40, len(df)))]
        self.startup_latency_ms = float(np.mean(lat)) if lat else None
        self.startup_samples = len(lat)

    def add_manual(self, tx: dict, result: dict) -> dict:
        with self.lock:
            self._manual_seq += 1
            row = {
                "id": f"MAN-{int(time.time()) % 10_000_000:07d}-{self._manual_seq}", **tx,
                **{k: result[k] for k in ("fraud_probability", "risk_level", "recommended_action", "predicted_fraud", "model_version")},
                "actual_is_fraud": None, "source": "manual analysis", "timestamp": now_iso(),
            }
            self.rows.append(row)
            self.index[row["id"]] = row
            self.live_latencies.append(result["latency_ms"])
            return row

    def mark_scored(self, tid: str, iso: str) -> None:
        """A held-out transaction was just scored by the live replay: record when."""
        with self.lock:
            row = self.index.get(tid)
            if row is not None:
                row["timestamp"], row["source"] = iso, "held-out test set (replayed)"

    def get(self, tid: str) -> dict | None:
        return self.index.get(tid)
