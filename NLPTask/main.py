# Full pipeline: scrape gold-news articles, run goldBERT sentiment, save results.

import json
import math
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import torch
import torch.nn.functional as F
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parent
PRB_DIR = ROOT / "prb"
SCRAPER_SCRIPT = PRB_DIR / "index.js"
ARTICLES_JSON = PRB_DIR / "articles.json"
MODEL_DIR = ROOT / "goldbert-finetuned" / "best"
RESULTS_DIR = ROOT / "results"

MAX_LENGTH = 256
INFERENCE_BATCH = 16
DEFAULT_FRESHNESS_SCALER = 0.5
DEFAULT_CYCLE_MS = 12


def parse_cli_float(flag: str, default: float) -> float:
    for i, arg in enumerate(sys.argv):
        if arg == flag and i + 1 < len(sys.argv):
            return float(sys.argv[i + 1])
    return default


def run_scraper(with_keywords: bool = False) -> None:
    if not SCRAPER_SCRIPT.is_file():
        raise FileNotFoundError(f"Scraper not found: {SCRAPER_SCRIPT}")

    cmd = ["node", str(SCRAPER_SCRIPT)]
    if with_keywords:
        cmd.append("--with-keywords")
        print("=== Phase 1: scraping articles (keyword filter enabled) ===")
    else:
        print("=== Phase 1: scraping articles (prb/index.js) ===")

    subprocess.run(cmd, cwd=PRB_DIR, check=True)

    if not ARTICLES_JSON.is_file():
        raise FileNotFoundError(f"Scraper finished but {ARTICLES_JSON} was not created")


def load_articles() -> tuple[str, list[dict]]:
    with open(ARTICLES_JSON, encoding="utf-8") as f:
        data = json.load(f)

    scraped_at = data.get("scraped_at", "")
    flat: list[dict] = []
    for site_block in data.get("sites", []):
        site = site_block.get("site", "")
        for article in site_block.get("articles", []):
            flat.append(
                {
                    "site": site,
                    "url": article.get("url", ""),
                    "title": (article.get("title") or "").strip(),
                    "body": (article.get("body") or "").strip(),
                    "date": article.get("date", ""),
                    "author": article.get("author", ""),
                }
            )
    return scraped_at, flat


def load_model(device: str):
    print(f"Loading goldBERT from {MODEL_DIR}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    model.to(device)
    model.eval()

    id2label = model.config.id2label
    label_names = {int(k): v for k, v in id2label.items()}
    return tokenizer, model, label_names


def preprocess_pair(headline: str, body: str) -> tuple[str, str]:
    headline = headline.strip()
    body = body.strip()
    if not headline and body:
        headline = body[:200]
    return headline, body


def parse_time_to_ms(value: str) -> float | None:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text or text.lower() == "unknown date":
        return None

    ts = pd.to_datetime(text, errors="coerce", utc=True)
    if pd.isna(ts):
        return None
    return float(ts.timestamp() * 1000)


def emotion_value(label: str) -> int | None:
    if label == "positive":
        return 1
    if label == "negative":
        return -1
    return None


def freshness_weight(age_ms: float, freshness_scaler: float, cycle_ms: float) -> float:
    age_ms = max(age_ms, 0.0)
    if cycle_ms <= 0 or freshness_scaler <= 0:
        return 1.0
    scaled_age = freshness_scaler * (age_ms / cycle_ms)
    if scaled_age == 0:
        return 1.0
    return 1.0 - math.exp(-1.0 / scaled_age)


def compute_general_score_sentiment(
    articles: list[dict],
    scraped_at: str,
    now_ms: float,
    freshness_scaler: float,
    cycle_ms: float,
) -> tuple[float, int, float]:
    """
    general_score = sum(emotion * confidence * freshness_weight) / sum(freshness_weights)

    emotion: +1 positive, -1 negative
    freshness_weight = 1 - exp(-1 / (freshness_scaler * ((now - article_time) / cycle)))
    """
    fallback_ms = parse_time_to_ms(scraped_at)
    total = 0.0
    weight_sum = 0.0
    count = 0

    for article in articles:
        sentiment = article.get("sentiment", {})
        label = sentiment.get("label", "")
        emotion = emotion_value(label)
        if emotion is None:
            continue

        article_ms = parse_time_to_ms(article.get("date", ""))
        if article_ms is None:
            article_ms = fallback_ms
        if article_ms is None:
            continue

        weight = freshness_weight(now_ms - article_ms, freshness_scaler, cycle_ms)
        confidence = float(sentiment.get("confidence", 0.0))
        total += emotion * confidence * weight
        weight_sum += weight
        count += 1

    if count == 0 or weight_sum == 0:
        return 0.0, count, weight_sum
    return total / weight_sum, count, weight_sum


@torch.no_grad()
def predict_batch(
    tokenizer,
    model,
    label_names: dict[int, str],
    headlines: list[str],
    bodies: list[str],
    device: str,
) -> list[dict]:
    enc = tokenizer(
        headlines,
        bodies,
        truncation="only_second",
        max_length=MAX_LENGTH,
        padding=True,
        return_tensors="pt",
    )
    enc = {k: v.to(device) for k, v in enc.items()}
    logits = model(**enc).logits
    probs = F.softmax(logits, dim=-1)

    results = []
    for row_probs in probs:
        pred = int(torch.argmax(row_probs))
        scores = {
            label_names[i]: round(float(row_probs[i]), 4)
            for i in range(len(row_probs))
        }
        results.append(
            {
                "label": label_names[pred],
                "label_id": pred,
                "confidence": scores[label_names[pred]],
                "scores": scores,
            }
        )
    return results


def analyze_articles(articles: list[dict], tokenizer, model, label_names, device: str) -> list[dict]:
    usable = []
    headlines = []
    bodies = []

    for article in articles:
        headline, body = preprocess_pair(article["title"], article["body"])
        if not headline:
            continue
        usable.append(article)
        headlines.append(headline)
        bodies.append(body)

    print(f"Analyzing {len(usable)} articles with goldBERT...")
    sentiments: list[dict] = []
    for start in range(0, len(headlines), INFERENCE_BATCH):
        end = start + INFERENCE_BATCH
        batch_sentiments = predict_batch(
            tokenizer,
            model,
            label_names,
            headlines[start:end],
            bodies[start:end],
            device,
        )
        sentiments.extend(batch_sentiments)

    analyzed = []
    for article, sentiment in zip(usable, sentiments):
        analyzed.append({**article, "sentiment": sentiment})
    return analyzed


def save_results(
    scraped_at: str,
    articles: list[dict],
    general_score_sentiment: float,
    score_samples: int,
    weight_sum: float,
    freshness_scaler: float,
    cycle_ms: float,
) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS_DIR / f"gold_sentiment_{date.today().isoformat()}.json"

    payload = {
        "scraped_at": scraped_at,
        "analyzed_at": datetime.now().isoformat(),
        "model": str(MODEL_DIR.relative_to(ROOT)),
        "article_count": len(articles),
        "general_score_sentiment": round(general_score_sentiment, 6),
        "general_score_params": {
            "freshness_scaler": freshness_scaler,
            "cycle_ms": cycle_ms,
            "number_samples": score_samples,
            "weight_sum": round(weight_sum, 6),
        },
        "articles": articles,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return out_path


def main() -> None:
    skip_scrape = "--skip-scrape" in sys.argv
    with_keywords = "--with-keywords" in sys.argv
    freshness_scaler = parse_cli_float("--freshness-scaler", DEFAULT_FRESHNESS_SCALER)
    cycle_ms = parse_cli_float("--cycle", DEFAULT_CYCLE_MS) * 1000 * 3600

    if not skip_scrape:
        run_scraper(with_keywords=with_keywords)
    elif not ARTICLES_JSON.is_file():
        raise FileNotFoundError(
            f"--skip-scrape was set but {ARTICLES_JSON} does not exist"
        )
    else:
        print("=== Skipping scrape, using existing articles.json ===")

    scraped_at, articles = load_articles()
    if not articles:
        print("No articles found to analyze.")
        return

    device = (
        "cuda"
        if torch.cuda.is_available()
        else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
    )
    print(f"Using device: {device}")

    tokenizer, model, label_names = load_model(device)
    analyzed = analyze_articles(articles, tokenizer, model, label_names, device)

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    general_score, score_samples, weight_sum = compute_general_score_sentiment(
        analyzed,
        scraped_at,
        now_ms,
        freshness_scaler,
        cycle_ms,
    )

    out_path = save_results(
        scraped_at,
        analyzed,
        general_score,
        score_samples,
        weight_sum,
        freshness_scaler,
        cycle_ms,
    )

    print(
        f"general_score_sentiment: {general_score:.6f} "
        f"({score_samples} samples, weight_sum={weight_sum:.6f})"
    )
    print(f"Saved {len(analyzed)} articles to {out_path}")
    for item in analyzed[:5]:
        s = item["sentiment"]
        print(f"  [{item['site']}] {s['label']} ({s['confidence']:.2%}) - {item['title'][:80]}")


if __name__ == "__main__":
    main()
