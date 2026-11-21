"""Train the fraud model from the notebook's pipeline and write the API artifacts.

Usage (from backend/):  python scripts/train_model.py [--csv data/credit_card_fraud_10k.csv] [--synthetic-flag]

Outputs in artifacts/ (or $FRAUDGUARD_ARTIFACT_DIR):
  fraud_detection_model.joblib   same dict structure the notebook saves
  evaluation.json                validation comparison, threshold curve, test metrics, ROC, importance
  holdout_transactions.csv       the notebook's test split (used for the transaction table and replay)

The API also does this automatically on startup when the artifacts are missing or the CSV changed.
"""
import argparse
import os
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
from app.training import DatasetError, train  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(BASE / "data" / "credit_card_fraud_10k.csv"))
    ap.add_argument("--synthetic-flag", action="store_true", help="mark the artifact as trained on synthetic demo data")
    a = ap.parse_args()
    try:
        train(Path(a.csv), Path(os.getenv("FRAUDGUARD_ARTIFACT_DIR", BASE / "artifacts")),
              synthetic=True if a.synthetic_flag else None)
    except DatasetError as exc:
        sys.exit(f"{exc}\nExpected columns: transaction_id, amount, transaction_hour, merchant_category, "
                 "foreign_transaction, location_mismatch, device_trust_score, velocity_last_24h, cardholder_age, is_fraud")
