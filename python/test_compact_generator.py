import argparse
import gzip
import hashlib
import json
import io
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from generate_dictionary import APIError, Progress, export, main, open_database, prepare, request_entry, run, run_reverse, validate_entry


ENTRY = {"t": "praca", "d": {"s": "an activity you do as part of your job", "t": "czynność wykonywana w ramach pracy"},
         "s": ["job", "labor", "employment"],
         "e": [{"s": "I have work today.", "t": "Mam dziś pracę."},
               {"s": "Her work is important.", "t": "Jej praca jest ważna."},
               {"s": "We work every day.", "t": "Pracujemy codziennie."}]}


class CompactTests(unittest.TestCase):
    def test_fixed_release_replaces_content_and_cleans_only_generated_folders(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words,
                                      count=1, model="test", interval=0, export_every=1)
            db = open_database(args.work)
            prepare(db, args)
            with db:
                db.execute("UPDATE words SET entry=?", (json.dumps(ENTRY),))
            old = args.output / "releases" / ("compact-" + "a" * 20)
            old.mkdir(parents=True)
            (old / "en-pl.json").write_text("{}")
            with patch("builtins.print"):
                export(db, args)
                run_reverse(db, args, lambda *_: [])
                with db:
                    db.execute("UPDATE words SET entry=?", (json.dumps({**ENTRY, "s": []}),))
                export(db, args)
            self.assertEqual([p.name for p in old.parent.iterdir()], ["compact"])
            catalog = json.loads((args.output / "catalog.json").read_text())
            item = catalog["pairs"]["en-pl"]
            self.assertEqual(item["path"], "releases/compact/en-pl.json")
            raw = (args.output / item["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item["sha256"])
            self.assertEqual(json.loads(raw)["work"]["s"], [])
            self.assertTrue((old.parent / "compact" / "pl-en.json").exists())
            db.close()

    def test_main_runs_reverse_after_partial_forward(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\n", encoding="utf-8")
            calls = []
            def forward(db, args):
                self.assertFalse(args.bidirectional)
                args.forward_blocked = False
                calls.append("forward")
                return False
            def reverse(db, args):
                calls.append("reverse")
                return True
            with patch("generate_dictionary.DIRECTORY", root), patch.dict("os.environ", {"GEMINI_API_KEY":"test"}), patch("sys.argv", [
                "generate_dictionary.py", "--count", "1", "--words", str(words)
            ]), patch("generate_dictionary.run", forward), patch("generate_dictionary.run_reverse", reverse):
                with self.assertRaises(SystemExit) as stopped:
                    main()
            self.assertEqual(stopped.exception.code, 2)
            self.assertEqual(calls, ["forward", "reverse"])

    def test_reverse_runs_before_missing_words_and_after_each_success(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\njob\nthe\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words,
                                      count=3, model="test", interval=0, export_every=250, max_attempts=2, bidirectional=True)
            db = open_database(args.work)
            prepare(db, args)
            # Existing files with verbose keys must also be usable without regeneration.
            old = {**ENTRY, "d": {"source": ENTRY["d"]["s"], "target": ENTRY["d"]["t"]},
                   "e": [{"source": e["s"], "target": e["t"]} for e in ENTRY["e"]]}
            with db:
                db.execute("UPDATE words SET entry=? WHERE word='work'", (json.dumps(old),))
            events = []
            def forward(word, _):
                events.append("en:" + word)
                if word == "the":
                    raise ValueError("No valid entry")
                return {**ENTRY, "s": [], "e": [{**e, "s": e["s"].replace("work", word)} for e in ENTRY["e"]]}
            def reverse(word, _):
                events.append("pl:" + word)
                return []
            with patch("builtins.print"):
                self.assertFalse(run(db, args, forward, reverse))
            self.assertEqual(events, ["pl:work", "en:job", "pl:job", "en:the", "en:the"])
            catalog = json.loads((args.output / "catalog.json").read_text())
            self.assertEqual(set(catalog["pairs"]), {"en-pl", "pl-en"})
            for item in catalog["pairs"].values():
                raw = (args.output / item["path"]).read_bytes()
                self.assertNotIn(b'"source":', raw)
                self.assertNotIn(b'"target":', raw)
                self.assertEqual(hashlib.sha256(raw).hexdigest(), item["sha256"])
            db.close()

    def test_reverse_preserves_colliding_senses_and_resumes_synonyms(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\njob\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words,
                                      count=2, model="test", interval=0, export_every=1, max_attempts=2)
            db = open_database(args.work)
            prepare(db, args)
            with db:
                for word in ("work", "job"):
                    entry = {**ENTRY, "s": [], "e": [{**e, "s": e["s"].replace("work", word)} for e in ENTRY["e"]]}
                    db.execute("UPDATE words SET entry=? WHERE word=?", (json.dumps(entry), word))
            def synonyms(word, entry):
                if word == "work":
                    return [entry["t"]]  # Invalid: the original word is not its own synonym.
                return []
            with patch("builtins.print"), patch("generate_dictionary.time.sleep") as sleep:
                self.assertFalse(run_reverse(db, args, synonyms))
            sleep.assert_not_called()
            self.assertEqual(len(json.loads((args.work / "pending-pl-en.json").read_text())), 1)
            calls = []
            def retry(word, entry):
                calls.append(word)
                return ["zajęcie"]
            with patch("builtins.print"):
                self.assertTrue(run_reverse(db, args, retry))
                self.assertTrue(run_reverse(db, args, lambda *_: self.fail("Saved synonyms must be reused")))
            self.assertEqual(calls, ["work"])
            catalog = json.loads((args.output / "catalog.json").read_text())
            self.assertEqual(set(catalog["pairs"]), {"en-pl", "pl-en"})
            item = catalog["pairs"]["pl-en"]
            raw = (args.output / item["path"]).read_bytes()
            self.assertEqual(item["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(item["bytes"], len(raw))
            entry = json.loads(raw)["praca"]
            self.assertEqual(set(entry), {"t", "d", "s", "e"})
            self.assertEqual(entry["t"], "job")
            self.assertEqual(entry["d"]["s"], ENTRY["d"]["t"])
            self.assertEqual(entry["e"][0]["s"], ENTRY["e"][0]["t"])
            self.assertNotIn(b'"senseId"', raw)
            db.close()

    def test_definition_upgrade_preserves_existing_content(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words,
                                      count=1, model="test", interval=0, export_every=1)
            db = open_database(args.work)
            prepare(db, args)
            old = {**ENTRY, "d": ENTRY["d"]["s"]}
            with db:
                db.execute("UPDATE words SET entry=?", (json.dumps(old),))
            db.close()
            db = open_database(args.work)
            prepare(db, args)
            with patch("generate_dictionary.request_json", return_value={"t": ENTRY["d"]["t"]}) as api, patch("builtins.print"):
                self.assertTrue(run(db, args, request_entry))
            self.assertEqual(api.call_count, 1)
            self.assertEqual(api.call_args.kwargs["context"]["definition"], old["d"])
            self.assertEqual(json.loads(db.execute("SELECT entry FROM words").fetchone()[0]), ENTRY)
            db.close()

    def test_invalid_entries_stop_without_sleep_and_export_pending(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words,
                                      count=1, model="test", interval=0, export_every=1)
            db = open_database(args.work)
            prepare(db, args)
            with db:
                db.execute("UPDATE words SET errors=11,next_try=9999999999,error='Wymagane 3 rozne zdania'")
            calls = []
            def invalid(word, options):
                calls.append(options.validation_feedback.get(word))
                return {**ENTRY, "e": [{**e, "s": "Missing exact term."} for e in ENTRY["e"]]}
            with patch("builtins.print"), patch("generate_dictionary.time.sleep") as sleep:
                self.assertFalse(run(db, args, invalid))
            sleep.assert_not_called()
            self.assertEqual(len(calls), 3)
            self.assertIn("exact word 'work'", calls[1])
            self.assertEqual(json.loads((args.work / "pending.json").read_text())[0]["word"], "work")
            self.assertFalse((args.output / "catalog.json").exists())
            with patch("builtins.print"):
                self.assertTrue(run(db, args, lambda *_: ENTRY))
            self.assertEqual(json.loads((args.work / "pending.json").read_text()), [])
            db.close()

    def test_invalid_api_key_stops_after_one_attempt(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words,
                                      count=1, model="test", interval=0, export_every=1)
            db = open_database(args.work)
            prepare(db, args)
            def denied(*_):
                raise APIError("HTTP 403", status=403)
            with patch("builtins.print"), patch("generate_dictionary.time.sleep") as sleep:
                self.assertFalse(run(db, args, denied))
            sleep.assert_not_called()
            self.assertEqual(db.execute("SELECT attempts FROM words").fetchone()[0], 1)
            db.close()

    def test_live_progress_and_success_without_sleep(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\njob\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "out", words=words,
                                      count=2, model="test", interval=0, export_every=1)
            db = open_database(args.work)
            prepare(db, args)
            output = io.StringIO()
            output.isatty = lambda: True
            def generate(word, _):
                return {**ENTRY, "s": [], "e": [{**e, "s": e["s"].replace("work", word)} for e in ENTRY["e"]]}
            with patch("generate_dictionary.sys.stdout", output), patch("generate_dictionary.time.sleep") as sleep:
                run(db, args, generate)
            sleep.assert_not_called()
            self.assertIn("0.00% 0/2", output.getvalue())
            self.assertIn("100.00% 2/2", output.getvalue())
            self.assertEqual(output.getvalue().count("\n"), 1)
            self.assertGreater(output.getvalue().count("\r"), 2)
            with patch.dict("os.environ", {"GEMINI_API_KEY": "test-secret"}), patch("builtins.print"):
                Progress(db, args).update("Failure test-secret\nnew line", error=True)
            log = (args.work / "errors.log").read_text()
            self.assertIn("[REDACTED] new line", log)
            self.assertNotIn("test-secret", log)
            db.close()

    def test_legacy_entries_are_backed_up_and_regenerated(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            words = root / "words.txt"
            words.write_text("work\n", encoding="utf-8")
            args = argparse.Namespace(work=root / "work", output=root / "dist" / "dictionaries",
                                      words=words, count=1, model="test", interval=0, export_every=1)
            db = open_database(args.work)
            prepare(db, args)
            legacy = {**ENTRY, "e": [e["s"] for e in ENTRY["e"]]}
            with db:
                db.execute("UPDATE words SET entry=?", (json.dumps(legacy),))
            db.close()
            db = open_database(args.work)
            with patch("builtins.print"):
                prepare(db, args)
                self.assertIsNone(db.execute("SELECT entry FROM words").fetchone()[0])
                self.assertEqual(json.loads(db.execute("SELECT entry FROM legacy_entries").fetchone()[0]), legacy)
                run(db, args, lambda *_: ENTRY)
            self.assertEqual(json.loads(db.execute("SELECT entry FROM words").fetchone()[0]), ENTRY)
            db.close()

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
        for synonyms in ([], ["job"], ["job", "labor", "employment"]):
            validate_entry("work", {**ENTRY, "s": synonyms})
        for patch_value in ({"t": "praca / pracować"}, {"t": "ciężka praca"}, {"s": ["job", "Job"]},
                            {"s": ["work", "job"]}, {"s": ["job", "labor", "employment", "task"]},
                            {"e": ["Hello."] * 3}, {"e": [{"s": "I work.", "t": ""}] * 3}, {"d": "<script>"}):
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
