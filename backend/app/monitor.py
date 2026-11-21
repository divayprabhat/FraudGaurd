"""Simulated live monitoring: replays held-out test transactions through the real model.

This is a REPLAY of historical data (as in the notebook), not a feed of real banking transactions.
Latency is measured around the real model call for each event.
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque
from datetime import datetime, timezone

import numpy as np

from .core import FEATURES, ModelStore, TransactionStore

NB_ALERTS = {"high_risk_rate_alert_pct": 5.0, "min_events_for_rate_alert": 100,
             "p95_latency_alert_ms": 250.0, "min_freshness_sla_compliance_pct": 99.0, "freshness_sla_seconds": 30}
REPLAY_EVENTS = 5000  # same cap as the notebook
TICK_SECONDS = 1.0
EVENTS_PER_TICK = max(1, int(os.getenv("FRAUDGUARD_REPLAY_EPS", "8")))  # events per second; raise it to stress-test the SLA


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class Monitor:
    def __init__(self, model: ModelStore, txs: TransactionStore, on_event=None, on_tick=None) -> None:
        self.model, self.txs, self.on_event, self.on_tick = model, txs, on_event, on_tick
        self.lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.reset()

    # ---- state -------------------------------------------------------------
    def reset(self) -> None:
        with self.lock:
            self.processed = self.high = self.medium = self.flagged = self.actual_fraud = self.sla_met = 0
            self.latencies: list[float] = []
            self.feed: deque = deque(maxlen=60)
            self.series: deque = deque(maxlen=90)
            self.cursor = 0
            self.run_seconds = 0.0
            self.next_arrival = 0.0
            self.fresh_sum = self.fresh_max = 0.0
            self.scoring_seconds = 0.0
            self.started_at: str | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive() and not self._stop.is_set()

    @property
    def available(self) -> bool:
        return self.txs.holdout_df is not None and len(self.txs.holdout_df) > 0

    def start(self) -> None:
        if self.running or not self.available:
            return
        self._stop.clear()
        self.next_arrival = time.time()  # a pause must not count as processing lag
        if not self.started_at:
            self.started_at = datetime.now(timezone.utc).isoformat()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="replay")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    # ---- worker ------------------------------------------------------------
    def _loop(self) -> None:
        df = self.txs.holdout_df.iloc[: min(REPLAY_EVENTS, len(self.txs.holdout_df))]
        n = len(df)
        while not self._stop.is_set():
            tick_start = time.perf_counter()
            tick = {"processed": 0, "high": 0, "medium": 0, "lat": []}
            for _ in range(EVENTS_PER_TICK):
                if self._stop.is_set():
                    break
                # Events arrive on a fixed schedule. Freshness = how long after its scheduled arrival scoring finished,
                # so it grows (and the SLA can fail) when scoring cannot keep up with the arrival rate.
                arrival = self.next_arrival
                self.next_arrival = arrival + TICK_SECONDS / EVENTS_PER_TICK
                wait = arrival - time.time()
                if wait > 0 and self._stop.wait(wait):
                    break
                row = df.iloc[self.cursor % n]
                res = self.model.predict_one({k: row[k] for k in FEATURES})
                proc_ts = time.time()
                lat, fresh = res["latency_ms"], max(0.0, proc_ts - arrival)
                ev = {
                    "transaction_id": f"TXN-{int(row['transaction_id']):07d}", "amount": float(row["amount"]),
                    "merchant_category": str(row["merchant_category"]), "fraud_probability": res["fraud_probability"],
                    "risk_level": res["risk_level"], "recommended_action": res["recommended_action"],
                    "predicted_fraud": res["predicted_fraud"], "actual_is_fraud": int(row["is_fraud"]),
                    "latency_ms": lat, "freshness_seconds": fresh,
                    "event_time_utc": _iso(arrival), "processing_time_utc": _iso(proc_ts),
                }
                with self.lock:
                    self.cursor += 1
                    self.processed += 1
                    self.high += ev["risk_level"] == "HIGH"
                    self.medium += ev["risk_level"] == "MEDIUM"
                    self.flagged += ev["predicted_fraud"]
                    self.actual_fraud += ev["actual_is_fraud"]
                    self.sla_met += fresh <= NB_ALERTS["freshness_sla_seconds"]
                    self.fresh_sum += fresh
                    self.fresh_max = max(self.fresh_max, fresh)
                    self.latencies.append(lat)
                    self.scoring_seconds += lat / 1000
                    self.feed.appendleft(ev)
                tick["processed"] += 1
                tick["high"] += ev["risk_level"] == "HIGH"
                tick["medium"] += ev["risk_level"] == "MEDIUM"
                tick["lat"].append(lat)
                if self.on_event:
                    self.on_event(ev)
            with self.lock:
                lat = tick["lat"]
                self.series.append({
                    "t": datetime.now(timezone.utc).isoformat(), "processed": tick["processed"],
                    "high": tick["high"], "medium": tick["medium"],
                    "avg_latency_ms": float(np.mean(lat)) if lat else 0.0,
                    "p95_latency_ms": float(np.percentile(lat, 95)) if lat else 0.0,
                })
            if self.on_tick:
                self.on_tick(self.snapshot())
            self._stop.wait(max(0.0, TICK_SECONDS - (time.perf_counter() - tick_start)))
            with self.lock:  # wall time, so throughput reflects the paced replay
                self.run_seconds += time.perf_counter() - tick_start

    # ---- views -------------------------------------------------------------
    def kpis(self) -> dict:
        with self.lock:
            lat = np.array(self.latencies) if self.latencies else np.array([])
            n = self.processed
            return {
                "transactions_processed": n, "high_risk": int(self.high), "medium_risk": int(self.medium),
                "predicted_fraud": int(self.flagged), "actual_fraud_in_replay": int(self.actual_fraud),
                "predicted_fraud_rate_pct": 100 * self.flagged / n if n else 0.0,
                "mean_latency_ms": float(lat.mean()) if n else None,
                "p95_latency_ms": float(np.percentile(lat, 95)) if n else None,
                "throughput_eps": n / self.run_seconds if self.run_seconds else None,
                "scoring_capacity_eps": n / self.scoring_seconds if self.scoring_seconds else None,
                "freshness_sla_compliance_pct": 100 * self.sla_met / n if n else None,
                "mean_lag_s": self.fresh_sum / n if n else None, "max_lag_s": self.fresh_max if n else None,
            }

    def snapshot(self) -> dict:
        return self.kpis()

    def view(self) -> dict:
        k = self.kpis()
        with self.lock:
            feed, series, started = list(self.feed), list(self.series), self.started_at
        return {
            "mode": "SIMULATED", "running": self.running, "available": self.available, "started_at": started,
            "description": "Replay of held-out test transactions through the trained model. Not real banking traffic.",
            "target_events_per_second": EVENTS_PER_TICK / TICK_SECONDS,
            "freshness_definition": "Seconds between an event's scheduled arrival and the moment its scoring finished. It stays near zero while scoring keeps up and grows when it cannot.",
            "kpis": k, "feed": feed, "series": series, "alert_thresholds": NB_ALERTS,
            "health": self.health(k),
        }

    def health(self, k: dict) -> list[dict]:
        n = k["transactions_processed"]
        def st(ok, warn=False): return "healthy" if ok else ("critical" if not warn else "warning")
        checks = [{"name": "Model artifact", "status": "healthy" if self.model.ready else "critical",
                   "detail": self.model.artifact["model_version"] if self.model.ready else "not loaded"},
                  {"name": "Replay worker", "status": "healthy" if self.running else "idle",
                   "detail": "running" if self.running else "stopped"}]
        if n:
            checks += [
                {"name": "p95 latency", "status": "healthy" if k["p95_latency_ms"] <= NB_ALERTS["p95_latency_alert_ms"] else "warning",
                 "detail": f"{k['p95_latency_ms']:.1f} ms / limit {NB_ALERTS['p95_latency_alert_ms']:.0f} ms"},
                {"name": "Freshness SLA", "status": "healthy" if k["freshness_sla_compliance_pct"] >= NB_ALERTS["min_freshness_sla_compliance_pct"] else "critical",
                 "detail": f"{k['freshness_sla_compliance_pct']:.1f}% within {NB_ALERTS['freshness_sla_seconds']}s"},
            ]
        return checks
