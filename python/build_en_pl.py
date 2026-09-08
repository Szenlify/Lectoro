"""Build a new English-Polish dictionary from wordfreq with GoogleTranslator."""
import argparse
from dictionary_pipeline import add_options, run, command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_options(parser)
    return run(parser.parse_args(), ["en"], ["pl"])


if __name__ == "__main__":
    raise SystemExit(command(main))
