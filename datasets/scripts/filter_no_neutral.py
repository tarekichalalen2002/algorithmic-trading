"""Keep only positive/negative rows for binary sentiment training."""

import pandas as pd

from paths import MERGED_NORMALIZED, MERGED_NO_NEUTRAL

LABEL_COL = "Price Sentiment"
BINARY_LABELS = ["positive", "negative"]


def main() -> None:
    df = pd.read_csv(MERGED_NORMALIZED, dtype=str)
    filtered = df[df[LABEL_COL].isin(BINARY_LABELS)].reset_index(drop=True)

    MERGED_NO_NEUTRAL.parent.mkdir(parents=True, exist_ok=True)
    filtered.to_csv(MERGED_NO_NEUTRAL, index=False)

    removed = len(df) - len(filtered)
    print(f"Input rows:   {len(df)}")
    print(f"Output rows:  {len(filtered)}")
    print(f"Removed rows: {removed} (neutral + none)")
    print(filtered[LABEL_COL].value_counts())
    print(f"Wrote {MERGED_NO_NEUTRAL}")


if __name__ == "__main__":
    main()
