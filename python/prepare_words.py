"""Prepare larger frequency-ranked wordlists without calling a translator."""
import argparse
from pathlib import Path
from dictionary_pipeline import DIRECTORY, language_list, job_lock, prepare_source, command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--languages", type=language_list, default=["en"])
    parser.add_argument("--count", type=int, default=50000)
    parser.add_argument("--work", type=Path, default=DIRECTORY / "work")
    args = parser.parse_args()
    if not 1 <= args.count <= 190000:
        parser.error("count: 1..190000")
    with job_lock(args.work):
        for language in args.languages:
            result = prepare_source(language, args.count, args.work)
            print(f"{language}: {len(result['words'])} hasel -> {args.work / 'sources' / (language + '.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(command(main))
