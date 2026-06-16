"""Run the full data preparation pipeline."""

import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent

STEPS = [
    "split_by_domain.py",
    "merge_domains.py",
    "fetch_gold_prices.py",
    "add_actual_price.py",
    "normalize_articles_prices.py",
    "filter_no_neutral.py",
    "export_for_training.py",
]


def main() -> None:
    for script in STEPS:
        path = SCRIPTS_DIR / script
        print(f"\n=== {script} ===")
        subprocess.run([sys.executable, str(path)], check=True, cwd=SCRIPTS_DIR)


if __name__ == "__main__":
    main()
