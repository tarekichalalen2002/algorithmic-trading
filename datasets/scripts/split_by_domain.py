"""Split the raw gold-news CSV into one file per URL domain."""

import csv
import re
from collections import defaultdict
from urllib.parse import urlparse

from paths import BY_DOMAIN, RAW_GOLD_DATASET


def domain_of(url: str) -> str:
    netloc = urlparse(url.strip()).netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc


def safe_filename(domain: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "_", domain) or "unknown"


def main() -> None:
    BY_DOMAIN.mkdir(parents=True, exist_ok=True)

    with open(RAW_GOLD_DATASET, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
        url_index = header.index("URL")

        rows_by_domain: dict[str, list] = defaultdict(list)
        for row in reader:
            if not row:
                continue
            rows_by_domain[domain_of(row[url_index])].append(row)

    for domain, rows in sorted(rows_by_domain.items()):
        out_path = BY_DOMAIN / f"{safe_filename(domain)}.csv"
        with open(out_path, "w", newline="", encoding="utf-8") as out:
            writer = csv.writer(out)
            writer.writerow(header)
            writer.writerows(rows)
        print(f"{len(rows):6d}  {domain} -> {out_path}")

    total = sum(len(r) for r in rows_by_domain.values())
    print(f"\nSplit {total} rows into {len(rows_by_domain)} files in {BY_DOMAIN}")


if __name__ == "__main__":
    main()
