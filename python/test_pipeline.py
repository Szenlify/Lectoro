import argparse
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import dictionary_pipeline as pipeline


class PipelineTest(unittest.TestCase):
    def test_missing_translation_is_deferred_and_retried_only_when_requested(self):
        from deep_translator.exceptions import TranslationNotFound
        with tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
            args = argparse.Namespace(work=Path(work), output=Path(work) / "out", timeout=10, delay=1)
            document = {"words": ["bad", "book", "bad2", "apple"], "source": {}}
            calls, pauses = [], []
            responses = {"bad": TranslationNotFound("bad"), "book": "książka",
                         "bad2": TranslationNotFound("bad2"), "apple": "jabłko"}
            class Client:
                def __init__(self, *args):
                    pass
                def translate(self, term):
                    calls.append(term)
                    value = responses[term]
                    if isinstance(value, Exception):
                        raise value
                    return value
                def close(self):
                    pass
            cache = pipeline.open_cache(work)
            try:
                self.assertEqual(pipeline.run_pair("en", "pl", document, cache, args, 10, Client, pauses.append), (4, False))
                report = pipeline.read_json(Path(work) / "reports/en-pl.json")
                self.assertEqual(report["entryCount"], 2)
                self.assertEqual(report["missing"], ["bad", "bad2"])
                self.assertEqual(pauses.count(5), 2)
                self.assertEqual(pipeline.run_pair("en", "pl", document, cache, args, 10, Client, pauses.append), (0, False))
                self.assertEqual(calls, document["words"])
                responses.update(bad="zły", bad2="drugi wynik")
                args.retry_failed = True
                self.assertEqual(pipeline.run_pair("en", "pl", document, cache, args, 10, Client, pauses.append), (2, False))
                self.assertEqual(calls[-2:], ["bad", "bad2"])
                self.assertEqual(cache.execute("SELECT COUNT(*) FROM failures").fetchone()[0], 0)
                self.assertTrue(pipeline.read_json(Path(work) / "reports/en-pl.json")["complete"])
            finally:
                cache.close()

    def test_repeated_missing_responses_and_rate_limits_stop_without_hammering(self):
        from deep_translator.exceptions import TranslationNotFound, TooManyRequests
        for error, expected_calls in ((TranslationNotFound("term"), 3), (TooManyRequests(), 1)):
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
                args = argparse.Namespace(work=Path(work), output=Path(work) / "out", timeout=10, delay=1)
                calls = []
                class Client:
                    def __init__(self, *args):
                        pass
                    def translate(self, term):
                        calls.append(term)
                        raise error
                    def close(self):
                        pass
                cache = pipeline.open_cache(work)
                try:
                    result = pipeline.run_pair("en", "pl", {"words": ["one", "two", "three", "four"], "source": {}}, cache, args, 20, Client, lambda _: None)
                    self.assertEqual(result, (expected_calls, True))
                    self.assertEqual(len(calls), expected_calls)
                    self.assertEqual(cache.execute("SELECT COUNT(*) FROM translations").fetchone()[0], 0)
                    report = pipeline.read_json(Path(work) / "reports/en-pl.json")
                    self.assertIsNone(report["file"])
                    self.assertTrue(report["stopped"])
                finally:
                    cache.close()

    def test_reformatted_or_changed_release_gets_a_new_stable_revision(self):
        for edit in ("format", "content", "broken"):
            with self.subTest(edit=edit), tempfile.TemporaryDirectory() as work:
                cache = pipeline.open_cache(work)
                output = Path(work) / "out"
                try:
                    args = ("en", "pl", ["book"], {}, cache, output, {"book": ["książka"]})
                    original = pipeline.export_pair(*args)
                    path = Path(original["file"])
                    data = pipeline.read_json(path)
                    if edit == "content":
                        data["entries"]["book"][0]["translations"] = ["inna tresc"]
                    changed = b"interrupted write" if edit == "broken" else json.dumps(data, ensure_ascii=False, indent=4).encode("utf-8")
                    path.write_bytes(changed)
                    recovered = pipeline.export_pair(*args)
                    self.assertNotEqual(recovered["file"], original["file"])
                    self.assertEqual(path.read_bytes(), changed, "Existing published URLs must not be overwritten")
                    meta = pipeline.read_json(output / "catalog.json")["pairs"]["en-pl"]
                    raw = Path(recovered["file"]).read_bytes()
                    self.assertEqual(meta["sha256"], hashlib.sha256(raw).hexdigest())
                    self.assertEqual(meta["bytes"], len(raw))
                    self.assertEqual(pipeline.export_pair(*args)["file"], recovered["file"])
                    self.assertEqual(pipeline.read_json(Path(recovered["file"]))["entries"]["book"][0]["translations"], ["książka"])
                finally:
                    cache.close()

    def test_source_is_filtered_deduplicated_and_ranked(self):
        with tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
            data = pipeline.prepare_source("en", 4, work, iter(["the", "123", "i", "the", "bonjour", "www", "дом", "don't", "later"]))
            self.assertEqual(data["words"], ["the", "I", "bonjour", "don't"])
            self.assertEqual(pipeline.read_json(Path(work) / "sources/en.json")["words"], data["words"])

    def test_direct_pairs_resume_and_preserve_unchanged_translations(self):
        with tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
            args = argparse.Namespace(work=Path(work), output=Path(work) / "out", timeout=10, delay=1)
            document = {"words": ["kot", "pies", "radio"], "source": {"name": "test"}}
            calls = []
            class Client:
                def __init__(self, source, target, timeout):
                    self.languages = source, target
                def translate(self, term):
                    calls.append((*self.languages, term))
                    return {"kot": "Katze", "pies": "Hund", "radio": "radio"}[term]
                def close(self):
                    pass
            cache = pipeline.open_cache(work)
            try:
                used, stopped = pipeline.run_pair("pl", "de", document, cache, args, 1, Client, lambda _: None)
                self.assertEqual((used, stopped), (1, False))
                first = pipeline.read_json(args.output / "catalog.json")["pairs"]["pl-de"]
                used, stopped = pipeline.run_pair("pl", "de", document, cache, args, 5, Client, lambda _: None)
                self.assertEqual((used, stopped), (2, False))
                second = pipeline.read_json(args.output / "catalog.json")["pairs"]["pl-de"]
                self.assertNotEqual(first["version"], second["version"])
                self.assertTrue((args.output / first["path"]).exists())
                raw = (args.output / second["path"]).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), second["sha256"])
                self.assertEqual(len(raw), second["bytes"])
                self.assertEqual(second["entryCount"], 3)
                report = pipeline.read_json(Path(work) / "reports/pl-de.json")
                self.assertTrue(report["complete"])
                self.assertEqual(report["unchanged"], ["radio"])
                pipeline.run_pair("pl", "de", document, cache, args, 5, Client, lambda _: None)
                self.assertEqual(calls, [("pl", "de", "kot"), ("pl", "de", "pies"), ("pl", "de", "radio")])
            finally:
                cache.close()

    def test_block_stops_without_retry_or_caching_failed_word(self):
        with tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
            args = argparse.Namespace(work=Path(work), output=Path(work) / "out", timeout=10, delay=1)
            calls = []
            class Client:
                def __init__(self, *args):
                    pass
                def translate(self, term):
                    calls.append(term)
                    if term == "book":
                        return "książka"
                    raise RuntimeError("429")
                def close(self):
                    pass
            cache = pipeline.open_cache(work)
            try:
                result = pipeline.run_pair("en", "pl", {"words": ["book", "bad", "next"], "source": {}}, cache, args, 20, Client, lambda _: None)
                self.assertEqual(result, (2, True))
                self.assertEqual(calls, ["book", "bad"])
                self.assertEqual(cache.execute("SELECT term FROM translations").fetchall(), [("book",)])
                report = pipeline.read_json(Path(work) / "reports/en-pl.json")
                self.assertFalse(report["complete"])
                self.assertEqual(report["missing"], ["bad", "next"])
            finally:
                cache.close()

    def test_manual_overrides_export_without_network(self):
        with tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
            pipeline.write_json(Path(work) / "overrides/en-pl.json", {"above board": ["uczciwy", "jawny"]})
            args = argparse.Namespace(work=Path(work), output=Path(work) / "out", timeout=10, delay=1)
            cache = pipeline.open_cache(work)
            try:
                factory = lambda *args: self.fail("Export-only called Google")
                pipeline.run_pair("en", "pl", {"words": ["above board"], "source": {}}, cache, args, 0, factory, lambda _: None)
                metadata = pipeline.read_json(args.output / "catalog.json")["pairs"]["en-pl"]
                data = pipeline.read_json(args.output / metadata["path"])
                self.assertEqual(data["entries"]["above board"][0]["translations"], ["uczciwy", "jawny"])
            finally:
                cache.close()

    def test_structured_senses_keep_ids_when_reordered_and_correct_cached_errors(self):
        fixture = pipeline.read_json(Path(__file__).parent.parent / "tests/fixtures/dictionary-meanings.json")
        overrides = {term: {"senses": [{**{k: v for k, v in sense.items() if k not in {"senseId", "reviewStatus"}}, "id": sense["senseId"].split(".")[-1]} for sense in senses]} for term, senses in fixture["entries"].items()}
        with tempfile.TemporaryDirectory() as work:
            cache = pipeline.open_cache(work)
            try:
                with cache:
                    cache.execute("INSERT INTO translations VALUES (?,?,?,?,?)",
                                  (pipeline.ENGINE, "en", "pl", "I", "I"))
                    cache.execute("INSERT INTO translations VALUES (?,?,?,?,?)",
                                  (pipeline.ENGINE, "en", "pl", "radio", "RADIO"))
                report = pipeline.export_pair("en", "pl", ["I", "as", "radio"], {}, cache, Path(work)/"out", overrides)
                pack = pipeline.read_json(report["file"])
                self.assertEqual(pack["entries"]["I"][0]["translations"], ["ja"])
                self.assertGreater(len(pack["entries"]["as"]), 1)
                self.assertEqual(report["needsReview"]["radio"],
                                 ["machine-generated-without-context", "same-as-source", "all-uppercase"])
                before = {s["definition"]: s["senseId"] for s in pack["entries"]["as"]}
                overrides["as"]["senses"].reverse()
                curated = pipeline.export_pair("en", "pl", ["I", "as", "radio"], {}, cache, Path(work)/"out", overrides, True)
                result = pipeline.read_json(curated["file"])
                self.assertNotIn("radio", result["entries"])
                self.assertEqual(curated["missing"], ["radio"])
                self.assertFalse(curated["complete"])
                self.assertEqual(before, {s["definition"]: s["senseId"] for s in result["entries"]["as"]})
            finally:
                cache.close()

    def test_structured_override_rejects_duplicate_ids_and_invalid_examples(self):
        import copy
        fixture = pipeline.read_json(Path(__file__).parent.parent / "tests/fixtures/dictionary-meanings.json")
        sense = fixture["entries"]["I"][0]
        original = {"senses": [{**{k: v for k, v in sense.items() if k not in {"senseId", "reviewStatus"}}, "id": "speaker"}]}
        for corruption in ("duplicate", "example"):
            with tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
                value = copy.deepcopy(original)
                if corruption == "duplicate":
                    value["senses"].append(copy.deepcopy(value["senses"][0]))
                else:
                    value["senses"][0]["examples"] = [{"source": "test"}]
                pipeline.write_json(Path(work)/"overrides/en-pl.json", {"I": value})
                with self.assertRaises(ValueError):
                    pipeline.read_overrides("en", "pl")

    def test_progress_counts_saved_entries_not_failed_requests_and_estimates_session(self):
        import io
        output = io.StringIO()
        now = [100.0]
        progress = pipeline.TranslationProgress(100, 40, 10, stream=output, clock=lambda: now[0])
        progress.update(force=True)
        now[0] += 20
        progress.update(attempts=4, saved=3, failed=1, force=True)
        progress.close()
        last = output.getvalue().splitlines()[-1]
        self.assertIn("43.00% 43/100", last)
        self.assertIn("sesja 4/10", last)
        self.assertIn("bledy 1", last)
        self.assertIn("ETA sesji 00:00:30", last)
        self.assertNotIn("\r", output.getvalue())

    def test_terminal_progress_clears_line_for_errors_and_finishes_with_newline(self):
        import io
        class Terminal(io.StringIO):
            def isatty(self):
                return True
        output = Terminal()
        progress = pipeline.TranslationProgress(2, 1, 1, stream=output, clock=lambda: 0)
        progress.update(term="book")
        progress.log("STOP: limit")
        progress.update(attempts=1, saved=0, failed=1)
        progress.close()
        self.assertIn("\r", output.getvalue())
        self.assertIn("STOP: limit\n", output.getvalue())
        self.assertTrue(output.getvalue().endswith("\n"))
        self.assertNotIn("100.00%", output.getvalue())

    def test_google_adapter_sets_explicit_languages_timeout_and_restores_transport(self):
        import deep_translator.google as google
        original = google.requests
        with patch.object(google.GoogleTranslator, "translate", return_value="książka") as translate:
            client = pipeline.Translator("en", "he", 17)
            try:
                self.assertEqual(client.client.source, "en")
                self.assertEqual(client.client.target, "iw")
                self.assertIsNot(google.requests, original)
                with patch("requests.Session.request", return_value="response") as request:
                    self.assertEqual(client.session.get("https://example.test"), "response")
                    self.assertEqual(request.call_args.kwargs["timeout"], (10, 17))
                self.assertEqual(client.translate("book"), "książka")
                translate.assert_called_once_with("book")
            finally:
                client.close()
            self.assertIs(google.requests, original)


if __name__ == "__main__":
    unittest.main()
