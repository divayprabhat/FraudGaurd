"""Alert store. Conditions and thresholds come from the notebook's monitoring cell."""
from __future__ import annotations

import itertools
import threading
from .core import now_iso
from .monitor import NB_ALERTS

STATUSES = ("open", "acknowledged", "resolved")


class AlertStore:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.items: dict[str, dict] = {}
        self._ids = itertools.count(1)

    def _upsert(self, key: str, **fields) -> None:
        cur = self.items.get(key)
        if cur and cur["status"] != "resolved":
            cur.update({k: fields[k] for k in ("observed", "description") if k in fields})
            return
        if cur:  # archive the resolved one so the new alert can own the key
            self.items[f"{key}#{cur['id']}"] = self.items.pop(key)
        self.items[key] = {
            "id": f"ALT-{next(self._ids):04d}", "key": key, "status": "open", "timestamp": now_iso(), **fields}

    def _clear(self, key: str) -> None:
        cur = self.items.get(key)
        if cur and cur["status"] != "resolved":
            cur["status"], cur["resolved_by"] = "resolved", "auto"

    def evaluate(self, k: dict) -> None:
        n = k["transactions_processed"]
        if not n:
            return
        t = NB_ALERTS
        with self.lock:
            rate = k["predicted_fraud_rate_pct"]
            if n >= t["min_events_for_rate_alert"] and rate > t["high_risk_rate_alert_pct"]:
                self._upsert("rate", type="Predicted fraud rate above threshold", severity="warning", observed=f"{rate:.2f}%",
                             threshold=f"{t['high_risk_rate_alert_pct']:.2f}%",
                             description=f"{rate:.2f}% of replayed transactions are predicted fraud (limit {t['high_risk_rate_alert_pct']:.2f}%).")
            else:
                self._clear("rate")
            p95 = k["p95_latency_ms"]
            if p95 > t["p95_latency_alert_ms"]:
                self._upsert("p95", type="p95 processing latency exceeded", severity="warning", observed=f"{p95:.1f} ms",
                             threshold=f"{t['p95_latency_alert_ms']:.0f} ms",
                             description=f"p95 scoring latency is {p95:.1f} ms (limit {t['p95_latency_alert_ms']:.0f} ms).")
            else:
                self._clear("p95")
            sla = k["freshness_sla_compliance_pct"]
            if sla < t["min_freshness_sla_compliance_pct"]:
                self._upsert("sla", type="Freshness SLA compliance below target", severity="critical", observed=f"{sla:.2f}%",
                             threshold=f"{t['min_freshness_sla_compliance_pct']:.2f}%",
                             description=f"Only {sla:.2f}% of events were processed within {t['freshness_sla_seconds']}s.")
            else:
                self._clear("sla")

    def clear_monitoring(self) -> None:
        """Replay was reset: the threshold alerts it raised no longer describe any data, so resolve them."""
        with self.lock:
            for key in ("rate", "p95", "sla"):
                self._clear(key)

    def high_risk_tx(self, tx_id: str, prob: float, source: str) -> None:
        with self.lock:
            if f"tx:{tx_id}" in self.items:
                return
            self._upsert(f"tx:{tx_id}", type="High-risk transaction", severity="warning", observed=f"{prob:.1%}", threshold="HIGH band",
                         description=f"{tx_id} scored {prob:.1%} fraud probability ({source}); escalate for review.")
            tx = [k for k in self.items if k.startswith("tx:")]
            for k in tx[:-150]:  # keep the list bounded
                del self.items[k]

    def list(self) -> list[dict]:
        with self.lock:
            return sorted(self.items.values(), key=lambda a: a["timestamp"], reverse=True)

    def set_status(self, alert_id: str, status: str) -> dict | None:
        with self.lock:
            for a in self.items.values():
                if a["id"] == alert_id:
                    a["status"] = status
                    a["resolved_by"] = "user" if status == "resolved" else None
                    return a
        return None
