"""Timestamps and freshness must come from real events, never be invented. Runs on the real trained artifacts."""
import time

import pytest

from app import monitor as M
from app.core import ModelStore, TransactionStore
from app.monitor import Monitor


@pytest.fixture(scope="module")
def stores():
    m = ModelStore()
    return m, TransactionStore(m)


def test_holdout_rows_have_no_invented_timestamp(stores):
    _, txs = stores
    assert txs.rows and all(r["timestamp"] is None for r in txs.rows)


def test_replay_stamps_rows_with_real_scoring_time(stores):
    m, txs = stores
    mon = Monitor(m, txs, on_event=lambda ev: txs.mark_scored(ev["transaction_id"], ev["processing_time_utc"]))
    mon.start(); time.sleep(2.2); mon.stop()
    stamped = [r for r in txs.rows if r["timestamp"]]
    assert 0 < len(stamped) <= mon.processed
    assert all(r["source"] == "held-out test set (replayed)" for r in stamped)


def test_freshness_stays_low_when_keeping_up_and_can_fail_when_not(stores, monkeypatch):
    m, txs = stores
    ok = Monitor(m, txs); ok.start(); time.sleep(1.5); ok.stop()
    k = ok.kpis()
    assert k["max_lag_s"] < 0.5 and k["freshness_sla_compliance_pct"] == 100.0
    monkeypatch.setattr(M, "EVENTS_PER_TICK", 2000)  # arrivals far faster than one model can score
    monkeypatch.setitem(M.NB_ALERTS, "freshness_sla_seconds", 0.5)
    slow = Monitor(m, txs); slow.start(); time.sleep(4); slow.stop()
    k2 = slow.kpis()
    assert k2["max_lag_s"] > k["max_lag_s"] and k2["freshness_sla_compliance_pct"] < 100.0
