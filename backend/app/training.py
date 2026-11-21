"""Training pipeline: reproduces the notebook (same splits, seeds, models, threshold rule).

Used by scripts/train_model.py (CLI) and by the API at startup when the artifacts are
missing, stale (the CSV changed) or incompatible with the installed scikit-learn.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score, f1_score, precision_score,
                             recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

RS = 42
REQUIRED = ["transaction_id", "amount", "transaction_hour", "merchant_category", "foreign_transaction",
            "location_mismatch", "device_trust_score", "velocity_last_24h", "cardholder_age", "is_fraud"]
NUM = ["amount", "transaction_hour", "foreign_transaction", "location_mismatch", "device_trust_score",
       "velocity_last_24h", "cardholder_age"]
CAT = ["merchant_category"]


class DatasetError(ValueError):
    """The CSV cannot be used for training (message is user-facing)."""


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_known_synthetic(csv: Path) -> bool:
    """True when data/dataset_info.json marks this exact file (by hash) as synthetic demo data."""
    info = csv.parent / "dataset_info.json"
    if not info.exists():
        return False
    try:
        meta = json.loads(info.read_text())
        return bool(meta.get("synthetic")) and meta.get("csv_sha256") == file_sha256(csv)
    except (OSError, ValueError):
        return False


def preprocessor() -> ColumnTransformer:
    return ColumnTransformer([
        ("numeric", Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]), NUM),
        ("categorical", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")),
                                  ("onehot", OneHotEncoder(handle_unknown="ignore"))]), CAT)])


def load_dataset(csv: Path) -> pd.DataFrame:
    data = pd.read_csv(csv, low_memory=False)
    data.columns = [str(c).strip() for c in data.columns]
    missing = sorted(set(REQUIRED) - set(data.columns))
    if missing:
        raise DatasetError(f"Dataset is missing required columns: {missing}")
    data = data[REQUIRED].copy()
    data["is_fraud"] = pd.to_numeric(data["is_fraud"], errors="coerce")
    data = data.dropna(subset=["is_fraud"])
    data["is_fraud"] = data["is_fraud"].astype(int)
    if not set(data["is_fraud"].unique()).issubset({0, 1}):
        raise DatasetError("is_fraud must contain only 0 and 1.")
    if data["is_fraud"].nunique() < 2:
        raise DatasetError("Both classes (0 and 1) must be present to train a classifier.")
    for c in NUM:
        data[c] = pd.to_numeric(data[c], errors="coerce")
    data["merchant_category"] = data["merchant_category"].fillna("Unknown").astype(str)
    data = data.dropna(subset=["amount"]).drop_duplicates(subset=["transaction_id"], keep="first").reset_index(drop=True)
    if data["is_fraud"].sum() < 10 or (1 - data["is_fraud"]).sum() < 10:
        raise DatasetError("Need at least 10 examples of each class to train and evaluate.")
    return data


def train(csv: Path, out: Path, synthetic: bool | None = None, log=print) -> dict:
    """Train on `csv`, write artifacts to `out`, return the evaluation dict."""
    csv, out = Path(csv), Path(out)
    if not csv.exists():
        raise DatasetError(f"Dataset not found: {csv}")
    if synthetic is None:
        synthetic = is_known_synthetic(csv)
    data = load_dataset(csv)

    X, y = data.drop(columns=["is_fraud", "transaction_id"]), data["is_fraud"]
    Xtf, Xte, ytf, yte = train_test_split(X, y, test_size=0.20, stratify=y, random_state=RS)
    Xtr, Xva, ytr, yva = train_test_split(Xtf, ytf, test_size=0.25, stratify=ytf, random_state=RS)

    models = {
        "Logistic Regression": Pipeline([("preprocessor", preprocessor()),
                                         ("model", LogisticRegression(class_weight="balanced", max_iter=2000, random_state=RS))]),
        "Random Forest": Pipeline([("preprocessor", preprocessor()),
                                   ("model", RandomForestClassifier(n_estimators=250, min_samples_leaf=3,
                                                                    class_weight="balanced_subsample", random_state=RS, n_jobs=-1))]),
    }
    rows, vprob = [], {}
    for name, pipe in models.items():
        t0 = time.perf_counter(); pipe.fit(Xtr, ytr); fit_s = time.perf_counter() - t0
        p = pipe.predict_proba(Xva)[:, 1]; vprob[name] = p; pr = (p >= 0.5).astype(int)
        rows.append({"model": name, "pr_auc": average_precision_score(yva, p), "roc_auc": roc_auc_score(yva, p),
                     "precision": precision_score(yva, pr, zero_division=0), "recall": recall_score(yva, pr, zero_division=0),
                     "f1": f1_score(yva, pr, zero_division=0), "accuracy": accuracy_score(yva, pr), "fit_seconds": fit_s})
    rows.sort(key=lambda r: r["pr_auc"], reverse=True)
    best_name = rows[0]["model"]; best = models[best_name]; vp = vprob[best_name]
    log(f"Selected model by validation PR-AUC: {best_name}")

    curve = []
    for th in np.arange(0.05, 0.96, 0.01):
        pr = (vp >= th).astype(int)
        curve.append({"threshold": float(th), "precision": precision_score(yva, pr, zero_division=0),
                      "recall": recall_score(yva, pr, zero_division=0), "f1": f1_score(yva, pr, zero_division=0),
                      "alerts_per_1000": float(pr.mean() * 1000)})
    threshold = float(max(curve, key=lambda r: r["f1"])["threshold"])  # first max, same as idxmax
    log(f"Validation-selected threshold: {threshold:.2f}")

    tp_ = best.predict_proba(Xte)[:, 1]; tpred = (tp_ >= threshold).astype(int); yt = yte.to_numpy()
    tn, fp = int(((tpred == 0) & (yt == 0)).sum()), int(((tpred == 1) & (yt == 0)).sum())
    fn, tp = int(((tpred == 0) & (yt == 1)).sum()), int(((tpred == 1) & (yt == 1)).sum())
    test_metrics = {"accuracy": accuracy_score(yte, tpred), "precision": precision_score(yte, tpred, zero_division=0),
                    "recall": recall_score(yte, tpred, zero_division=0), "f1": f1_score(yte, tpred, zero_division=0),
                    "roc_auc": roc_auc_score(yte, tp_), "pr_auc": average_precision_score(yte, tp_),
                    "false_positive_rate": fp / max(tn + fp, 1)}
    fpr, tpr, _ = roc_curve(yte, tp_)
    idx = np.unique(np.linspace(0, len(fpr) - 1, min(200, len(fpr))).astype(int))
    names = best.named_steps["preprocessor"].get_feature_names_out()
    est = best.named_steps["model"]
    vals = est.coef_[0] if hasattr(est, "coef_") else est.feature_importances_
    imp = sorted(({"feature": str(n).split("__", 1)[-1], "value": float(v)} for n, v in zip(names, vals)),
                 key=lambda r: abs(r["value"]), reverse=True)[:20]

    evaluation = {
        "dataset": {"rows": len(data), "fraud": int(y.sum()), "legitimate": int((1 - y).sum()), "fraud_rate": float(y.mean()),
                    "split": {"train": len(Xtr), "validation": len(Xva), "test": len(Xte)}, "csv": csv.name,
                    "csv_sha256": file_sha256(csv), "categories": sorted(data["merchant_category"].unique().tolist())},
        "selected_model": best_name, "selection_metric": "PR-AUC (validation)",
        "threshold": threshold, "threshold_selection": "Maximum F1 on validation set",
        "validation_summary": rows, "threshold_curve": curve, "test_metrics": test_metrics,
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp, "derived": False},
        "roc_curve": [{"fpr": float(fpr[i]), "tpr": float(tpr[i])} for i in idx],
        "feature_importance": {"kind": "coefficient" if hasattr(est, "coef_") else "importance", "items": imp},
    }

    best.fit(Xtf, ytf)  # final refit on train+validation, as in the notebook
    artifact = {"pipeline": best, "threshold": threshold, "model_name": best_name, "feature_columns": list(X.columns),
                "target_column": "is_fraud", "model_version": "fraud-risk-model-v1", "random_state": RS,
                "synthetic_demo_data": bool(synthetic), "validation_selection_metric": "PR-AUC",
                "threshold_selection_metric": "F1 on validation"}
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, out / "fraud_detection_model.joblib")
    data.loc[Xte.index].to_csv(out / "holdout_transactions.csv", index=False)
    (out / "evaluation.json").write_text(json.dumps(evaluation, indent=2))  # written last: marks a complete set
    log("Test metrics: " + str({k: round(v, 4) for k, v in test_metrics.items()}))
    log(f"Wrote {out}")
    return evaluation
