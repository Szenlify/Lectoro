"""Build directed dictionaries for other languages with GoogleTranslator."""
import argparse
from dictionary_pipeline import add_options, language_list, run, command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_options(parser)
    parser.add_argument("--sources", type=language_list, default=["en"])
    parser.add_argument("--targets", type=language_list, default=language_list("ja,de,ko,fr,nl,he,es,it,cs,pt"))
    args = parser.parse_args()
    return run(args, args.sources, args.targets)


if __name__ == "__main__":
    raise SystemExit(command(main))
