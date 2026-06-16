"""Shared paths for the data preparation pipeline."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
SCRAPERS = ROOT / "scrapers"
DATA = ROOT / "data"

RAW = DATA / "raw"
BY_DOMAIN = DATA / "by_domain"
PRICES = DATA / "prices"
PROCESSED = DATA / "processed"

# Training datasets consumed by NLPTask/goldBERT.ipynb
NLP_DATA = ROOT.parent / "NLPTask" / "data"

RAW_GOLD_DATASET = RAW / "gold-dataset-sinha-khandait.csv"
DAILY_GOLD_PRICES = PRICES / "daily_gold_prices_2000_2021.csv"
MERGED = PROCESSED / "merged.csv"
MERGED_NORMALIZED = PROCESSED / "merged_normalized.csv"
MERGED_NO_NEUTRAL = PROCESSED / "merged_normalized_no_neutral.csv"
