import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from dictionary_common import import_legacy, publish_pack, read_json, json_bytes
from translate_dictionary import make_rows, validate_response, assemble, main


class DictionaryToolsTest(unittest.TestCase):
    def test_build_preserves_unicode_and_catalog_integrity(self):
        pack = import_legacy({"book": "książka / rezerwować", "apple": {"en": "apple", "pl": "jabłko"}}, "v1")
        with tempfile.TemporaryDirectory() as directory:
            path = publish_pack(pack, directory, {"license": "UNVERIFIED"})
            raw = path.read_bytes()
            meta = read_json(Path(directory) / "catalog.json")["pairs"]["en-pl"]
            self.assertEqual(meta["bytes"], len(raw))
            self.assertEqual(meta["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(read_json(path)["entries"]["book"][0]["translations"], ["książka / rezerwować"])
            publish_pack(pack, directory, {})  # Idempotent rebuilding.
            pack["entries"]["book"][0]["translations"] = ["zmiana"]
            with self.assertRaises(ValueError):
                publish_pack(pack, directory, {})

    def test_invalid_legacy_and_duplicate_json_are_rejected(self):
        for data in ({"apple": ""}, {"apple": {"de": "Apfel"}}, ["apple"]):
            with self.assertRaises(ValueError):
                import_legacy(data, "v1")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.json"
            path.write_text('{"book":"one","book":"two"}')
            with self.assertRaises(ValueError):
                read_json(path)

    def test_response_alignment_and_directed_pair(self):
        rows = make_rows(import_legacy({"book": "książka"}, "v1"))
        senses = [{"definition": "printed publication", "partOfSpeech": "noun", "sourceTerms": ["książka"], "sourceForms": ["książki"], "translations": ["Buch"]}]
        result = {"items": [{"id": rows[0]["id"], "senses": senses}]}
        completed = validate_response(result, rows)
        pack = assemble(rows, completed, "pl", "de", "v1")
        self.assertEqual(pack["forms"]["książki"], ["książka"])
        self.assertEqual(pack["entries"]["książka"][0]["translations"], ["Buch"])
        for invalid in ({"items": []}, {"items": result["items"] * 2}, {"items": [{"id": "wrong", "senses": senses}]}):
            with self.assertRaises(ValueError):
                validate_response(invalid, rows)

    def test_dry_run_and_resume_never_repeat_completed_batches(self):
        base = import_legacy({"apple": "jabłko", "book": "książka"}, "v1")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.json"
            source.write_bytes(json_bytes(base))
            args = ["translate_dictionary.py", "--input", str(source), "--target-language", "de", "--version", "v2",
                    "--output", str(root / "output"), "--checkpoint-dir", str(root / "checkpoint"), "--batch-size", "1", "--max-requests", "1"]
            def fake_generate(batch, *unused):
                return {row["id"]: [{"definition": "test sense", "partOfSpeech": "noun", "sourceTerms": [row["term"]], "sourceForms": [], "translations": ["Test"]}] for row in batch}, {"totalTokenCount": 10}
            with patch("translate_dictionary.generate", side_effect=fake_generate) as generate, patch.dict("os.environ", {"GEMINI_API_KEY": "test"}):
                with patch("sys.argv", args):
                    main()
                generate.assert_not_called()
                with patch("sys.argv", args + ["--execute"]):
                    main()
                    self.assertFalse((root / "output/catalog.json").exists())
                    main()
                    self.assertTrue((root / "output/catalog.json").exists())
                    main()
                self.assertEqual(generate.call_count, 2)


if __name__ == "__main__":
    unittest.main()
