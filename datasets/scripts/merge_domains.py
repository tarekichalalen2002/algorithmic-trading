"""Merge per-domain CSVs into a single dataset ordered by date."""

import glob

import pandas as pd

from paths import BY_DOMAIN, MERGED

DATE_COLUMN = "Dates"
DATE_FORMAT = "%d-%m-%Y"


def main() -> None:
    csv_files = sorted(glob.glob(str(BY_DOMAIN / "*.csv")))
    if not csv_files:
        raise SystemExit(f"No CSV files found in {BY_DOMAIN}")

    frames = []
    for path in csv_files:
        domain = path.rsplit("/", 1)[-1].replace(".csv", "")
        df = pd.read_csv(path, dtype=str)
        df["source_domain"] = domain
        frames.append(df)
        print(f"Loaded {len(df):>7} rows from {domain}")

    merged = pd.concat(frames, ignore_index=True)

    parsed_dates = pd.to_datetime(
        merged[DATE_COLUMN], format=DATE_FORMAT, errors="coerce"
    )

    needs_fallback = parsed_dates.isna() & merged["URL"].notna()
    if needs_fallback.any():
        url_dates = merged.loc[needs_fallback, "URL"].str.extract(
            r"(\d{4}-\d{2}-\d{2})(?:-\d+)?$"
        )[0]
        recovered = pd.to_datetime(url_dates, format="%Y-%m-%d", errors="coerce")
        parsed_dates.loc[needs_fallback] = recovered.values
        print(f"Recovered {int(recovered.notna().sum())} dates from URLs")

    unparsed = int(parsed_dates.isna().sum())
    if unparsed:
        print(f"Warning: {unparsed} rows had unparseable dates (sorted to the end)")

    normalized = parsed_dates.dt.strftime(DATE_FORMAT)
    merged[DATE_COLUMN] = normalized.fillna(merged[DATE_COLUMN])

    merged = merged.assign(_sort_date=parsed_dates)
    merged = merged.sort_values(
        "_sort_date", ascending=True, na_position="last", kind="stable"
    ).drop(columns="_sort_date")

    MERGED.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(MERGED, index=False)
    print(f"Wrote {len(merged):>7} total rows to {MERGED}")


if __name__ == "__main__":
    main()
