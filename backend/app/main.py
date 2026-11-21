from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .alerts import STATUSES, AlertStore
from .core import (ACTIONS, FEATURES, HIGH_RISK_FLOOR, SETUP_HELP, ModelStore, TransactionStore)
from .monitor import NB_ALERTS, Monitor

app = FastAPI(title="FraudGuard API", version="1.0.0")
_origins = [o.strip() for o in os.getenv("FRAUDGUARD_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"])

model = ModelStore()
txs = TransactionStore(model)
alerts = AlertStore()


def on_replay_event(ev: dict) -> None:
    txs.mark_scored(ev["transaction_id"], ev["processing_time_utc"])  # real time of this scoring, not a made-up date
    if ev["risk_level"] == "HIGH":
        alerts.high_risk_tx(ev["transaction_id"], ev["fraud_probability"], "simulated replay")


monitor = Monitor(model, txs, on_event=on_replay_event, on_tick=alerts.evaluate)


def require_model() -> None:
    if not model.ready:
        raise HTTPException(503, detail=model.error or SETUP_HELP)


# ---- schemas -----------------------------------------------------------------
class TransactionIn(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)
    transaction_hour: int = Field(ge=0, le=23)
    merchant_category: str = Field(min_length=1, max_length=60)
    foreign_transaction: Literal[0, 1]
    location_mismatch: Literal[0, 1]
    device_trust_score: int = Field(ge=0, le=100)
    velocity_last_24h: int = Field(ge=0, le=1000)
    cardholder_age: int = Field(ge=18, le=110)


class AlertPatch(BaseModel):
    status: Literal["open", "acknowledged", "resolved"]


# ---- helpers -----------------------------------------------------------------
def reference_or_eval() -> tuple[dict, str]:
    """Evaluation recomputed locally by scripts/train_model.py if present, else the notebook's saved outputs."""
    if model.evaluation:
        return model.evaluation, "recomputed"
    return model.reference, "notebook"


def threshold_value() -> float | None:
    return model.threshold if model.ready else model.reference["threshold"]


# ---- routes ------------------------------------------------------------------
@app.get("/api/health")
def health():
    ev, src = reference_or_eval()
    return {
        "status": "ok" if model.ready else "degraded", "model_loaded": model.ready,
        "model_name": model.artifact["model_name"] if model.ready else model.reference["selected_model"],
        "model_version": model.artifact["model_version"] if model.ready else None,
        "threshold": threshold_value(), "high_cutoff": model.high_cutoff if model.ready else max(model.reference["threshold"], HIGH_RISK_FLOOR),
        "synthetic_demo_data": bool(model.artifact.get("synthetic_demo_data")) if model.ready else None,
        "holdout_loaded": txs.holdout_df is not None, "evaluation_source": src,
        "error": model.error, "setup_help": None if model.ready and txs.holdout_df is not None else SETUP_HELP,
    }


@app.get("/api/meta")
def meta():
    return {
        "features": FEATURES, "categories": model.categories,
        "ranges": {"amount": [0.01, 1_000_000], "transaction_hour": [0, 23], "device_trust_score": [0, 100],
                   "velocity_last_24h": [0, 1000], "cardholder_age": [18, 110]},
        "risk_bands": {"threshold": threshold_value(), "high_cutoff": model.high_cutoff if model.ready else None},
        "actions": ACTIONS, "alert_thresholds": NB_ALERTS,
    }


@app.post("/api/predict")
def predict(body: TransactionIn):
    require_model()
    tx = body.model_dump()
    cat = model.canonical_category(tx["merchant_category"])
    if cat is None:  # an unseen category would be silently scored as "no category"; refuse instead
        raise HTTPException(422, detail=f"Unknown merchant_category '{tx['merchant_category']}'. "
                                        f"Use one of: {', '.join(model.categories)}.")
    tx["merchant_category"] = cat
    res = model.predict_one(tx)
    row = txs.add_manual(tx, res)
    if res["risk_level"] == "HIGH":
        alerts.high_risk_tx(row["id"], res["fraud_probability"], "manual analysis")
    return {**res, "transaction_id": row["id"], "timestamp": row["timestamp"], "high_cutoff": model.high_cutoff, "input": tx}


@app.get("/api/transactions")
def list_transactions(search: str = "", risk: str = "ALL", sort: str = "timestamp", order: Literal["asc", "desc"] = "desc",
                      page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100)):
    rows = txs.rows
    if search:
        q = search.lower().strip()
        rows = [r for r in rows if q in r["id"].lower() or q in r["merchant_category"].lower() or q in f"{r['amount']:.2f}"]
    if risk.upper() in ACTIONS:
        rows = [r for r in rows if r["risk_level"] == risk.upper()]
    keys = {"id", "amount", "merchant_category", "timestamp", "fraud_probability", "risk_level"}
    sort = sort if sort in keys else "timestamp"
    rank = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    # rows never scored live have timestamp None: they sort as oldest instead of crashing the comparison
    kf = (lambda r: rank[r["risk_level"]]) if sort == "risk_level" else (lambda r: (r[sort] is not None, r[sort] if r[sort] is not None else "", r["id"]))
    rows = sorted(rows, key=kf, reverse=order == "desc")
    total = len(rows)
    start = (page - 1) * page_size
    return {"items": rows[start:start + page_size], "total": total, "page": page, "page_size": page_size,
            "pages": max(1, -(-total // page_size)), "available": bool(txs.rows)}


@app.get("/api/transactions/{tid}")
def get_transaction(tid: str):
    row = txs.get(tid)
    if not row:
        raise HTTPException(404, "Transaction not found")
    return row


@app.get("/api/dashboard")
def dashboard():
    ev, src = reference_or_eval()
    rows = txs.rows
    tm = ev["test_metrics"]
    by_hour = [{"hour": h, "transactions": 0, "flagged": 0} for h in range(24)]
    for r in rows:
        b = by_hour[r["transaction_hour"]]
        b["transactions"] += 1
        b["flagged"] += r["predicted_fraud"]
    labelled = [r for r in rows if r["actual_is_fraud"] is not None]
    recent = sorted((r for r in rows if r["timestamp"]), key=lambda r: (r["timestamp"], r["id"]), reverse=True)[:6]  # only really-scored rows
    mk = monitor.kpis()
    if mk["mean_latency_ms"] is not None:
        lat, lat_src, lat_n = mk["mean_latency_ms"], "live replay", mk["transactions_processed"]
    elif txs.live_latencies:
        lat, lat_src, lat_n = float(sum(txs.live_latencies) / len(txs.live_latencies)), "your analyses", len(txs.live_latencies)
    else:
        lat, lat_src, lat_n = txs.startup_latency_ms, "startup sample", txs.startup_samples
    flagged = sum(r["predicted_fraud"] for r in rows)
    return {
        "available": bool(rows), "evaluation_source": src,
        "kpis": {
            "total_transactions": len(rows), "flagged_fraud": flagged,
            "confirmed_fraud_labels": sum(r["actual_is_fraud"] for r in labelled),
            "detection_rate": tm["recall"], "accuracy": tm["accuracy"],
            "avg_latency_ms": lat, "latency_source": lat_src, "latency_samples": lat_n,
        },
        "activity_by_hour": by_hour,
        "distribution": {"flagged": flagged, "legitimate": len(rows) - flagged,
                         "by_risk": {k: sum(r["risk_level"] == k for r in rows) for k in ACTIONS}},
        "recent": recent,
    }


@app.get("/api/performance")
def performance():
    ev, src = reference_or_eval()
    ref = model.reference
    return {
        "source": src, "validation_cutoff": 0.5,  # cut-off used for the validation table (training.py)
        "source_note": ("Recomputed from your dataset by scripts/train_model.py using the notebook's pipeline." if src == "recomputed"
                        else "Values from the notebook's saved outputs. Run scripts/train_model.py to add ROC curve and feature importance."),
        "selected_model": ev["selected_model"], "selection_metric": ev.get("selection_metric", ref["selection_metric"]),
        "threshold": ev["threshold"], "threshold_selection": ev.get("threshold_selection", ref["threshold_selection"]),
        "dataset": ev.get("dataset", ref["dataset"]),
        "validation_summary": ev["validation_summary"], "test_metrics": ev["test_metrics"],
        "confusion_matrix": ev["confusion_matrix"], "roc_curve": ev.get("roc_curve"),
        "feature_importance": ev.get("feature_importance"), "threshold_curve": ev.get("threshold_curve"),
    }


@app.get("/api/monitoring")
def monitoring():
    return monitor.view()


@app.post("/api/monitoring/{action}")
def monitoring_action(action: Literal["start", "stop", "reset"]):
    require_model()
    if not monitor.available:
        raise HTTPException(503, "Held-out replay data not found. " + SETUP_HELP)
    if action == "start":
        monitor.start()
    elif action == "stop":
        monitor.stop()
    else:
        monitor.stop()
        monitor.reset()
        alerts.clear_monitoring()
    return monitor.view()


@app.get("/api/alerts")
def list_alerts():
    monitor_view = monitor.kpis()
    alerts.evaluate(monitor_view)
    items = alerts.list()
    return {"items": items, "counts": {s: sum(a["status"] == s for a in items) for s in STATUSES},
            "open_critical": sum(a["status"] == "open" and a["severity"] == "critical" for a in items)}


@app.patch("/api/alerts/{alert_id}")
def patch_alert(alert_id: str, body: AlertPatch):
    a = alerts.set_status(alert_id, body.status)
    if not a:
        raise HTTPException(404, "Alert not found")
    return a


# ---- serve the built frontend (production) -------------------------------------
DIST = (Path(__file__).resolve().parent.parent.parent / "frontend" / "dist").resolve()


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"], include_in_schema=False)
def api_not_found(rest: str):
    raise HTTPException(404, f"No such API route: /api/{rest}")


if (DIST / "index.html").exists():
    if (DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST in f.parents:  # never serve anything outside dist/
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"service": "FraudGuard API", "docs": "/docs", "health": "/api/health",
                "frontend": "Not built. Run `npm install && npm run build` in frontend/, or `npm run dev` for development."}
