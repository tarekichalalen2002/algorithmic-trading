# Trading Bot — Gold News Sentiment

End-to-end pipeline for scraping gold-related financial news, fine-tuning
FinBERT (goldBERT) on historical labeled data, and producing a freshness-weighted
aggregate sentiment score from live articles.

## Project structure

```
Trading_bot/
├── README.md                 # this file
├── requirements.txt          # Python dependencies
├── datasets/                 # historical dataset preparation (training data)
│   ├── README.md
│   ├── scripts/              # Python pipeline
│   └── scrapers/             # historical article-body scrapers (Puppeteer)
├── NLPTask/                  # model training & live inference
│   ├── README.md
│   ├── goldBERT.ipynb        # fine-tune ProsusAI/finbert
│   ├── main.py               # scrape → infer → aggregate score
│   ├── prb/                  # live-news scraper (Benzinga, Investing, Yahoo)
│   ├── data/                 # training CSVs (generated, gitignored)
│   ├── goldbert-finetuned/   # saved model (generated, gitignored)
│   └── results/              # daily sentiment JSON (generated, gitignored)
└── gold_env/                 # local venv (gitignored)
```

## Quick start

### 1. Environment

```bash
python -m venv gold_env
source gold_env/bin/activate   # Windows: gold_env\Scripts\activate
pip install -r requirements.txt
```

### 2. Prepare training data

See [`datasets/README.md`](datasets/README.md).

```bash
pip install -r datasets/requirements.txt
cd datasets/scrapers && npm install && cd ../..
python datasets/scripts/run_pipeline.py
```

This exports `merged_normalized_no_neutral.csv` into `NLPTask/data/`.

### 3. Train goldBERT

Open and run [`NLPTask/goldBERT.ipynb`](NLPTask/goldBERT.ipynb).
The best checkpoint is saved to `NLPTask/goldbert-finetuned/best/`.

### 4. Run live inference

See [`NLPTask/README.md`](NLPTask/README.md).

```bash
cd NLPTask/prb && npm install && cd ..
python NLPTask/main.py
```

Output: `NLPTask/results/gold_sentiment_YYYY-MM-DD.json` with per-article
sentiment and `general_score_sentiment`.

## Pipelines at a glance

| Stage | Location | Purpose |
|-------|----------|---------|
| Historical scraping | `datasets/scrapers/` | Fill article bodies in legacy CSVs |
| Dataset pipeline | `datasets/scripts/` | Merge, normalize prices, export for training |
| Model training | `NLPTask/goldBERT.ipynb` | Fine-tune FinBERT (positive / negative) |
| Live scraping | `NLPTask/prb/` | Fetch today's gold news |
| Inference | `NLPTask/main.py` | Sentiment + freshness-weighted aggregate score |

## Notes

- Scrapers use **Puppeteer** (`puppeteer-real-browser`) and may open a real browser window.
- Large artifacts (CSVs, model weights, scrape outputs) are **gitignored**; regenerate locally.
- Do not commit credentials. Historical MarketWatch scraper credentials should use environment variables if enabled.

## License

ISC (scrapers). Check third-party model licenses for [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert).
