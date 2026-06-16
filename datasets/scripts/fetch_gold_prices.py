"""Download historical gold futures (GC=F) daily prices from Yahoo Finance."""

import yfinance as yf

from paths import DAILY_GOLD_PRICES

gold = yf.Ticker("GC=F")
df = gold.history(start="2000-01-01", end="2019-12-31", interval="1d")
df = df[["Open", "High", "Low", "Close", "Volume"]]

DAILY_GOLD_PRICES.parent.mkdir(parents=True, exist_ok=True)
df.to_csv(DAILY_GOLD_PRICES)
print(f"Saved {len(df)} trading days to {DAILY_GOLD_PRICES}")
