# NLPTask — goldBERT Training & Inference

Fine-tunes FinBERT on gold-news headlines + article bodies and runs a daily
inference pipeline over freshly scraped articles.

## Contents

| Path | Description |
|------|-------------|
| `goldBERT.ipynb` | Train / evaluate goldBERT (binary: positive / negative) |
| `main.py` | Live pipeline: scrape → infer → aggregate sentiment score |
| `prb/` | Node scraper for Benzinga, Investing.com, Yahoo Finance (GLD) |
| `data/` | Training CSVs copied from `datasets/` (gitignored) |
| `goldbert-finetuned/` | Saved model weights (gitignored) |
| `results/` | Daily JSON reports (gitignored) |

## Setup

```bash
# From repo root, with venv activated
pip install -r requirements.txt

# Live scraper dependencies
cd NLPTask/prb
npm install
cd ..
```

## Training

1. Build training data (from repo root):

   ```bash
   python datasets/scripts/run_pipeline.py
   ```

2. Open `goldBERT.ipynb` and run all cells.

3. Best checkpoint → `goldbert-finetuned/best/`.

Training reads `data/merged_normalized_no_neutral.csv` (positive / negative only).

## Live inference (`main.py`)

```bash
python main.py                  # scrape + analyze
python main.py --skip-scrape    # reuse prb/articles.json
```

### CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--skip-scrape` | off | Skip Puppeteer scrape, use existing `prb/articles.json` |
| `--with-keywords` | off | Keep only articles whose headline or body contains a keyword |
| `--freshness-scaler` | `0.5` | How strongly article age affects weight |
| `--cycle` | `12` | Cycle length in **hours** (converted to ms internally) |

### Output (`results/gold_sentiment_YYYY-MM-DD.json`)

```json
{
  "general_score_sentiment": 0.15,
  "general_score_params": {
    "freshness_scaler": 0.5,
    "cycle_ms": 43200000,
    "number_samples": 28,
    "weight_sum": 12.4
  },
  "articles": [ ... ]
}
```

**Aggregate score formula** (per article with positive/negative label):

```
weight = 1 - exp(-1 / (freshness_scaler * (age_ms / cycle_ms)))
score  = sum(emotion * confidence * weight) / sum(weight)
```

`emotion`: +1 positive, −1 negative.

## Scrapers (`prb/`)

```bash
cd prb
node index.js
```

Writes:

- `article_links.json` — discovered URLs per site
- `articles.json` — title, body, date, author (consumed by `main.py`)

Sources: Benzinga (XAU-USD search), Investing.com (XAU/USD news), Yahoo Finance (GLD).
