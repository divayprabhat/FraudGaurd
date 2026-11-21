"""End-to-end API tests against the real trained artifacts (no mocks)."""
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app, monitor

VALID = {"amount": 920.5, "transaction_hour": 2, "merchant_category": "Travel", "foreign_transaction": 1,
         "location_mismatch": 1, "device_trust_score": 28, "velocity_last_24h": 9, "cardholder_age": 36}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
    monitor.stop()


def test_health_and_meta(client):
    h = client.get("/api/health").json()
    assert h["model_loaded"] and h["holdout_loaded"] and h["status"] == "ok"
    m = client.get("/api/meta").json()
    assert len(m["features"]) == 8 and m["categories"]
    assert m["risk_bands"]["threshold"] == h["threshold"]


def test_predict_valid_and_consistent_bands(client):
    r = client.post("/api/predict", json=VALID)
    assert r.status_code == 200
    d = r.json()
    p, th, hi = d["fraud_probability"], d["model_threshold"], d["high_cutoff"]
    assert 0 <= p <= 1 and d["latency_ms"] > 0
    expected = "HIGH" if p >= hi else "MEDIUM" if p >= th else "LOW"
    assert d["risk_level"] == expected
    assert hi == max(th, 0.70)  # notebook rule
    assert client.get(f"/api/transactions/{d['transaction_id']}").json()["source"] == "manual analysis"


def test_predict_is_deterministic(client):
    a = client.post("/api/predict", json=VALID).json()["fraud_probability"]
    b = client.post("/api/predict", json=VALID).json()["fraud_probability"]
    assert a == b


@pytest.mark.parametrize("patch", [
    {"amount": 0}, {"amount": -5}, {"transaction_hour": 24}, {"foreign_transaction": 2},
    {"device_trust_score": 101}, {"cardholder_age": 17}, {"velocity_last_24h": -1}, {"merchant_category": ""},
])
def test_predict_rejects_invalid_input(client, patch):
    assert client.post("/api/predict", json={**VALID, **patch}).status_code == 422


def test_predict_rejects_missing_field(client):
    bad = {k: v for k, v in VALID.items() if k != "amount"}
    assert client.post("/api/predict", json=bad).status_code == 422


def test_unknown_category_rejected_and_case_normalised(client):
    r = client.post("/api/predict", json={**VALID, "merchant_category": "Casino"})
    assert r.status_code == 422 and "Casino" in r.json()["detail"] and "Travel" in r.json()["detail"]
    ok = client.post("/api/predict", json={**VALID, "merchant_category": "  travel "})
    assert ok.status_code == 200
    assert client.get(f"/api/transactions/{ok.json()['transaction_id']}").json()["merchant_category"] == "Travel"


def test_transactions_paging_search_filter_sort(client):
    p1 = client.get("/api/transactions?page_size=5&page=1").json()
    assert len(p1["items"]) == 5 and p1["total"] >= 100 and p1["pages"] >= 2
    p2 = client.get("/api/transactions?page_size=5&page=2").json()
    assert {t["id"] for t in p1["items"]}.isdisjoint({t["id"] for t in p2["items"]})
    high = client.get("/api/transactions?risk=HIGH&page_size=100").json()
    assert all(t["risk_level"] == "HIGH" for t in high["items"])
    by_prob = client.get("/api/transactions?sort=fraud_probability&order=desc&page_size=10").json()["items"]
    probs = [t["fraud_probability"] for t in by_prob]
    assert probs == sorted(probs, reverse=True)
    first_id = p1["items"][0]["id"]
    assert any(t["id"] == first_id for t in client.get(f"/api/transactions?search={first_id}").json()["items"])
    assert client.get("/api/transactions?page_size=1000").status_code == 422
    assert client.get("/api/transactions/NOPE").status_code == 404


def test_dashboard_and_performance(client):
    d = client.get("/api/dashboard").json()
    assert d["available"] and d["kpis"]["total_transactions"] >= 100
    assert sum(h["transactions"] for h in d["activity_by_hour"]) == d["kpis"]["total_transactions"]
    assert sum(d["distribution"]["by_risk"].values()) == d["kpis"]["total_transactions"]
    pf = client.get("/api/performance").json()
    cm = pf["confusion_matrix"]
    assert cm["tp"] + cm["fn"] > 0 and pf["roc_curve"] and pf["feature_importance"]["items"]
    assert pf["selected_model"] == pf["validation_summary"][0]["model"]  # best by PR-AUC is first


def test_monitoring_lifecycle_and_alerts(client):
    client.post("/api/monitoring/reset")
    assert client.get("/api/monitoring").json()["kpis"]["transactions_processed"] == 0
    v = client.post("/api/monitoring/start").json()
    assert v["running"] is True
    time.sleep(2.5)
    v = client.post("/api/monitoring/stop").json()
    assert v["running"] is False
    n = v["kpis"]["transactions_processed"]
    assert n > 0 and len(v["feed"]) > 0 and v["kpis"]["p95_latency_ms"] is not None
    assert v["kpis"]["freshness_sla_compliance_pct"] == 100.0
    time.sleep(1.2)
    assert client.get("/api/monitoring").json()["kpis"]["transactions_processed"] == n  # truly stopped
    # alerts: patch status round-trip
    items = client.get("/api/alerts").json()["items"]
    if items:
        a = items[0]
        r = client.patch(f"/api/alerts/{a['id']}", json={"status": "acknowledged"})
        assert r.status_code == 200 and r.json()["status"] == "acknowledged"
    assert client.patch("/api/alerts/ALT-9999", json={"status": "resolved"}).status_code == 404
    assert client.patch("/api/alerts/ALT-0001", json={"status": "bogus"}).status_code == 422
    assert client.post("/api/monitoring/reset").json()["kpis"]["transactions_processed"] == 0


def test_manual_high_risk_creates_alert(client):
    r = client.post("/api/predict", json=VALID).json()
    if r["risk_level"] == "HIGH":
        keys = [a for a in client.get("/api/alerts").json()["items"] if r["transaction_id"] in a["description"]]
        assert keys and keys[0]["type"] == "High-risk transaction"


def test_unknown_api_route_is_404_not_html(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")


def test_no_path_traversal(client):
    for p in ("/..%2f..%2fbackend%2fapp%2fmain.py", "/%2e%2e/backend/app/main.py"):
        r = client.get(p)
        assert "FastAPI(" not in r.text


def test_dashboard_recent_only_lists_really_scored_rows(client):
    client.post("/api/predict", json=VALID)
    d = client.get("/api/dashboard").json()
    assert d["recent"] and all(t["timestamp"] for t in d["recent"])
    assert d["kpis"]["latency_source"] in ("live replay", "your analyses", "startup sample")


def test_sorting_by_timestamp_handles_rows_never_scored_live(client):
    for order in ("asc", "desc"):
        assert client.get(f"/api/transactions?sort=timestamp&order={order}&page_size=100").status_code == 200
