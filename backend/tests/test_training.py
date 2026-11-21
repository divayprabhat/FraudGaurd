"""Retraining behaviour: new CSV -> new model; unusable artifact -> automatic recovery."""
import numpy as np
import pandas as pd
import pytest

from app import core
from app.training import DatasetError, train

CATS = ["Electronics", "Travel", "Grocery", "Food", "Clothing"]


def make_csv(path, n=10_000, seed=0, fraud_rate=0.015):
    """Strong-signal dataset shaped like the notebook's real one (5 categories, ~1.5% fraud)."""
    rng = np.random.default_rng(seed)
    fraud = rng.random(n) < fraud_rate
    df = pd.DataFrame({
        "transaction_id": np.arange(1, n + 1),
        "amount": np.round(np.where(fraud, rng.gamma(4, 200, n), rng.gamma(2, 90, n)) + 1, 2),
        "transaction_hour": np.where(fraud, rng.integers(0, 5, n), rng.integers(6, 23, n)),
        "merchant_category": rng.choice(CATS, n),
        "foreign_transaction": np.where(fraud, rng.random(n) < .8, rng.random(n) < .05).astype(int),
        "location_mismatch": np.where(fraud, rng.random(n) < .8, rng.random(n) < .05).astype(int),
        "device_trust_score": np.where(fraud, rng.integers(10, 40, n), rng.integers(40, 100, n)),
        "velocity_last_24h": np.where(fraud, rng.integers(6, 12, n), rng.integers(0, 6, n)),
        "cardholder_age": rng.integers(18, 85, n), "is_fraud": fraud.astype(int)})
    df.to_csv(path, index=False)
    return df


@pytest.fixture()
def sandbox(tmp_path, monkeypatch):
    art = tmp_path / "artifacts"
    csv = tmp_path / "data.csv"
    for name, val in {"ARTIFACT_DIR": art, "MODEL_PATH": art / "fraud_detection_model.joblib",
                      "EVAL_PATH": art / "evaluation.json", "HOLDOUT_PATH": art / "holdout_transactions.csv",
                      "DATA_CSV": csv}.items():
        monkeypatch.setattr(core, name, val)
    return art, csv


def test_trains_from_scratch_and_reproduces_notebook_shape(sandbox):
    art, csv = sandbox
    make_csv(csv)
    m = core.ModelStore()
    assert m.ready and m.error is None
    assert m.categories == sorted(CATS)
    assert m.evaluation["dataset"]["split"] == {"train": 6000, "validation": 2000, "test": 2000}  # notebook split
    assert m.evaluation["selected_model"] in ("Random Forest", "Logistic Regression")
    assert 0.05 <= m.threshold <= 0.95
    assert m.artifact["synthetic_demo_data"] is False  # unknown file is treated as the user's own data
    hold = pd.read_csv(art / "holdout_transactions.csv")
    assert len(hold) == 2000


def test_changed_csv_triggers_retrain(sandbox):
    art, csv = sandbox
    make_csv(csv, seed=1)
    first = core.ModelStore().evaluation["dataset"]["csv_sha256"]
    make_csv(csv, seed=2, n=6000)
    second = core.ModelStore()
    assert second.ready and second.evaluation["dataset"]["csv_sha256"] != first
    assert second.evaluation["dataset"]["rows"] == 6000


def test_unchanged_csv_does_not_retrain(sandbox):
    art, csv = sandbox
    make_csv(csv)
    core.ModelStore()
    stamp = (art / "fraud_detection_model.joblib").stat().st_mtime_ns
    core.ModelStore()
    assert (art / "fraud_detection_model.joblib").stat().st_mtime_ns == stamp


def test_corrupt_model_file_recovers(sandbox):
    art, csv = sandbox
    make_csv(csv)
    core.ModelStore()
    (art / "fraud_detection_model.joblib").write_bytes(b"not a model")
    m = core.ModelStore()
    assert m.ready and m.error is None


def test_without_data_or_model_reports_setup_help(sandbox):
    m = core.ModelStore()
    assert not m.ready and "Model artifact not found" in m.error


def test_bad_dataset_gives_clear_error(sandbox, tmp_path):
    art, csv = sandbox
    pd.DataFrame({"amount": [1, 2]}).to_csv(csv, index=False)
    m = core.ModelStore()
    assert not m.ready and "missing required columns" in m.error
    with pytest.raises(DatasetError):
        train(csv, tmp_path / "x")
