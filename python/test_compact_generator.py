import argparse
import gzip
import hashlib
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from generate_dictionary import APIError, main, open_database, prepare, request_entry, run, validate_entry


ENTRY = {"t": "praca", "d": "an activity you do as part of your job",
         "s": ["job", "labor", "employment"],
         "e": ["I have work today.", "Her work is important.", "We work every day."]}


class CompactTests(unittest.TestCase):
    def test_export_only_creates_uploadable_dictionaries_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work" / "compact", words=words, count=1)
            db = open_database(args.work)
            prepare(db, args)
            with db:
                db.execute("UPDATE words SET entry=? WHERE word='work'", (json.dumps(ENTRY),))
            db.close()
            with patch("generate_dictionary.DIRECTORY", root), patch("sys.argv", [
                "generate_dictionary.py", "--count", "1", "--words", str(words), "--export-only",
            ]), patch("generate_dictionary.request_entry", side_effect=AssertionError("No API during export")), patch("builtins.print"):
                main()
            output = root / "dist" / "dictionaries"
            item = json.loads((output / "catalog.json").read_bytes())["pairs"]["en-pl"]
            destination = output / item["path"]
            raw = destination.read_bytes()
            self.assertEqual(len(raw), item["bytes"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item["sha256"])
            self.assertEqual(gzip.decompress(destination.with_suffix(".json.gz").read_bytes()), raw)
            self.assertEqual(json.loads(raw), {"work": ENTRY})
            self.assertTrue((output / "sources-en-pl.json").is_file())
            self.assertFalse((root / "dist" / "compact").exists())

    def test_gemini_request_and_rate_limit(self):
        args = argparse.Namespace(model="gemini-2.5-flash-lite", timeout=1)
        response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(ENTRY)}]}}]}
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}), patch("generate_dictionary.urllib.request.urlopen") as fetch:
            fetch.return_value.__enter__.return_value.read.return_value = json.dumps(response).encode()
            self.assertEqual(request_entry("work", args), ENTRY)
            request = fetch.call_args.args[0]
            body = json.loads(request.data)
            self.assertEqual(fetch.call_args.kwargs["timeout"], 1)
            self.assertEqual(request.full_url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent")
            self.assertEqual(request.get_header("X-goog-api-key"), "test-key")
            self.assertIn("generationConfig", body)
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}), patch("generate_dictionary.urllib.request.urlopen",
                side_effect=urllib.error.HTTPError("https://example.com", 429, "rate limit", {"Retry-After": "1200"}, None)):
            with self.assertRaises(APIError) as caught:
                request_entry("work", args)
            self.assertEqual(caught.exception.retry_after, 1200)

    def test_rejects_alternatives_duplicates_and_missing_word(self):
        self.assertEqual(validate_entry("work", ENTRY), ENTRY)
        for patch_value in ({"t": "praca / pracować"}, {"t": "ciężka praca"}, {"s": ["job", "Job"]},
                            {"s": ["work", "job"]}, {"e": ["Hello."] * 3}, {"d": "<script>"}):
            with self.subTest(patch_value=patch_value), self.assertRaises(ValueError):
                validate_entry("work", {**ENTRY, **patch_value})

    def test_failure_resume_and_content_addressed_export(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\nwork\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words, count=1,
                                      model="test", interval=0, export_every=250)
            db = open_database(args.work)
            prepare(db, args)
            calls = []
            def generate(word, _):
                calls.append(word)
                if len(calls) == 1:
                    raise APIError("HTTP 429", 1)
                return ENTRY
            clock = [10000]
            def sleep(seconds):
                clock[0] += seconds
            with patch("generate_dictionary.time.time", side_effect=lambda: clock[0]), patch("generate_dictionary.time.sleep", side_effect=sleep), patch("builtins.print"):
                run(db, args, generate)
            self.assertEqual(db.execute("SELECT attempts,errors FROM words").fetchone(), (2, 1))
            db.close()
            db = open_database(args.work)
            prepare(db, args)
            with patch("builtins.print"):
                run(db, args, lambda *_: self.fail("Completed words must not be requested again"))
            catalog = json.loads((args.output / "catalog.json").read_text())
            item = catalog["pairs"]["en-pl"]
            raw = (args.output / item["path"]).read_bytes()
            self.assertEqual(item["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(item["bytes"], len(raw))
            self.assertEqual(json.loads(raw), {"work": ENTRY})
            self.assertEqual(item["entryCount"], 1)
            db.close()


if __name__ == "__main__":
    unittest.main()
