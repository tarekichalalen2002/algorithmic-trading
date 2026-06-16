"""Copy processed datasets to NLPTask/data for model training."""

import shutil

from paths import MERGED_NORMALIZED, MERGED_NO_NEUTRAL, NLP_DATA


def main() -> None:
    NLP_DATA.mkdir(parents=True, exist_ok=True)

    for src in [MERGED_NORMALIZED, MERGED_NO_NEUTRAL]:
        if not src.is_file():
            raise FileNotFoundError(f"Missing {src} — run the pipeline first")
        dest = NLP_DATA / src.name
        shutil.copy2(src, dest)
        print(f"Copied {src.name} -> {dest}")


if __name__ == "__main__":
    main()
