# Datasets — Historical Gold News Data Preparation

Builds labeled training datasets from the Sinha-Khandait gold-news corpus and
historical gold prices. Outputs are exported to `NLPTask/data/` for fine-tuning.

## Folder layout

```
datasets/
├── README.md
├── requirements.txt
├── scripts/                 # Python pipeline
│   ├── paths.py             # shared path constants
│   ├── split_by_domain.py
│   ├── merge_domains.py
│   ├── fetch_gold_prices.py
│   ├── add_actual_price.py
│   ├── normalize_articles_prices.py
│   ├── filter_no_neutral.py
│   ├── export_for_training.py
│   └── run_pipeline.py
├── scrapers/                # historical article-body scrapers (Puppeteer)
│   ├── package.json
│   ├── index.js             # MarketWatch
│   ├── investing.js
│   ├── moneycontrol.js
│   ├── thehindubusiness.js
│   └── economictimes.indiatimes.js
└── data/
    ├── raw/                 # source CSVs (commit these)
    ├── by_domain/           # generated per-domain splits
    ├── prices/              # Yahoo Finance GC=F history
    └── processed/           # merged & normalized outputs
```

## Setup

```bash
pip install -r requirements.txt

cd scrapers
npm install
```

## Full pipeline

From the repo root:

```bash
python datasets/scripts/run_pipeline.py
```

| Step | Script | Output |
|------|--------|--------|
| 1 | `split_by_domain.py` | `data/by_domain/*.csv` |
| 2 | `merge_domains.py` | `data/processed/merged.csv` |
| 3 | `fetch_gold_prices.py` | `data/prices/daily_gold_prices_2000_2021.csv` |
| 4 | `add_actual_price.py` | adds `actual_price` column to `merged.csv` |
| 5 | `normalize_articles_prices.py` | `data/processed/merged_normalized.csv` |
| 6 | `filter_no_neutral.py` | `data/processed/merged_normalized_no_neutral.csv` |
| 7 | `export_for_training.py` | copies CSVs to `NLPTask/data/` |

## Historical scrapers (optional)

Fill missing `article_body` fields in `data/by_domain/` before merging:

```bash
cd scrapers
node index.js              # MarketWatch
node investing.js
node moneycontrol.js
node thehindubusiness.js
node economictimes.indiatimes.js
```

Then re-run from `merge_domains.py` onward.

## Training exports

| File | Description |
|------|-------------|
| `merged_normalized.csv` | All labels; dollar amounts scaled to today's gold price |
| `merged_normalized_no_neutral.csv` | Binary positive / negative only |

Large generated paths are gitignored. Keep `data/raw/` in the repo if you want
others to rebuild without external downloads.
