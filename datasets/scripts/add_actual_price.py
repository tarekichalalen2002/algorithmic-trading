"""Add an `actual_price` column to merged.csv using daily gold close prices."""

import pandas as pd

from paths import DAILY_GOLD_PRICES, MERGED

DATE_FORMAT = "%d-%m-%Y"


def main() -> None:
    articles = pd.read_csv(MERGED, dtype=str)

    prices = pd.read_csv(DAILY_GOLD_PRICES)
    prices["date"] = (
        pd.to_datetime(prices["Date"], utc=True).dt.tz_localize(None).dt.normalize()
    )
    prices = prices[["date", "Close"]].dropna(subset=["date"]).sort_values("date")
    prices = prices.drop_duplicates(subset="date", keep="last").reset_index(drop=True)

    article_dates = pd.to_datetime(
        articles["Dates"], format=DATE_FORMAT, errors="coerce"
    )

    lookup = pd.DataFrame({"_idx": range(len(articles)), "date": article_dates})
    parseable = lookup.dropna(subset=["date"]).sort_values("date")

    matched = pd.merge_asof(
        parseable,
        prices,
        on="date",
        direction="nearest",
    )

    actual_price = pd.Series(pd.NA, index=articles.index, dtype="object")
    actual_price.loc[matched["_idx"].to_numpy()] = matched["Close"].to_numpy()

    articles["actual_price"] = actual_price
    articles.to_csv(MERGED, index=False)

    filled = int(articles["actual_price"].notna().sum())
    missing = len(articles) - filled
    print(f"Articles:            {len(articles)}")
    print(f"Prices (trading days): {len(prices)}")
    print(f"Filled actual_price:   {filled}")
    print(f"Missing (no date):     {missing}")
    print(f"Wrote {MERGED}")


if __name__ == "__main__":
    main()
