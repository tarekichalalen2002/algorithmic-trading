"""Normalize dollar amounts in article text to today's gold price level."""

import re

import pandas as pd

from paths import MERGED, MERGED_NORMALIZED

CURRENT_ACTUAL_PRICE_TODAY = 4344
TEXT_COLUMNS = ["News", "article_body"]
PRICE_RE = re.compile(r"\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)")


def format_price(value: float) -> str:
    if abs(value - round(value)) < 1e-9:
        return f"${value:,.0f}"
    return f"${value:,.2f}"


def make_replacer(actual_price: float):
    factor = CURRENT_ACTUAL_PRICE_TODAY / actual_price

    def _replace(match: re.Match) -> str:
        raw = match.group(1).replace(",", "")
        try:
            mentioned = float(raw)
        except ValueError:
            return match.group(0)
        return format_price(mentioned * factor)

    return _replace


def main() -> None:
    df = pd.read_csv(MERGED, dtype=str)
    actual_prices = pd.to_numeric(df["actual_price"], errors="coerce")

    stats = {"rows_processed": 0, "rows_skipped": 0, "prices_replaced": 0}

    for col in TEXT_COLUMNS:
        if col not in df.columns:
            continue
        new_values = df[col].copy()
        for i in df.index:
            text = df.at[i, col]
            actual = actual_prices.iat[i]
            if not isinstance(text, str) or pd.isna(actual) or actual == 0:
                continue
            replacer = make_replacer(actual)

            def _counting(match, _r=replacer):
                stats["prices_replaced"] += 1
                return _r(match)

            new_values.at[i] = PRICE_RE.sub(_counting, text)
        df[col] = new_values

    stats["rows_skipped"] = int((actual_prices.isna() | (actual_prices == 0)).sum())
    stats["rows_processed"] = len(df) - stats["rows_skipped"]

    MERGED_NORMALIZED.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(MERGED_NORMALIZED, index=False)

    print(f"current_actual_price_today: {CURRENT_ACTUAL_PRICE_TODAY}")
    print(f"Rows with usable actual_price: {stats['rows_processed']}")
    print(f"Rows skipped (no actual_price): {stats['rows_skipped']}")
    print(f"Dollar amounts replaced:        {stats['prices_replaced']}")
    print(f"Wrote {MERGED_NORMALIZED}")


if __name__ == "__main__":
    main()
