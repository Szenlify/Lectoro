"""Build the initial en-pl package and R2 catalog without network calls."""
import argparse
from datetime import date
from pathlib import Path
from dictionary_common import ROOT, import_legacy, publish_pack, read_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=ROOT / "dictionaries/pl.json", help="Legacy en->pl JSON, multilingual JSON, or schema v1 en-pl pack")
    parser.add_argument("--output", default=ROOT / "py/dist/dictionaries")
    parser.add_argument("--version", default=date.today().isoformat())
    parser.add_argument("--license", default="UNVERIFIED", help="Actual source license; never inferred by the script")
    parser.add_argument("--source-url", default="", help="Source attribution URL, if known")
    args = parser.parse_args()
    pack = import_legacy(read_json(args.input), args.version)
    destination = publish_pack(pack, args.output, {
        "sourceFile": Path(args.input).name,
        "sourceUrl": args.source_url, "license": args.license,
        "reviewStatus": "imported; linguistic quality not verified",
    })
    print(f"Created {destination} ({len(pack['entries'])} entries). No API calls.")
    print(f"Upload the dictionaries directory from {args.output} to the R2 root, catalog.json last.")
    if args.license == "UNVERIFIED":
        print("Source license is unknown; licenses.json records UNVERIFIED, not an invented license.")


if __name__ == "__main__":
    main()
