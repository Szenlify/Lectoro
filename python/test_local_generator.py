import argparse
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import dictionary_pipeline as pipeline
from local_generator import LocalGenerator, validate_generated


def entry():
    return {"primaryTranslation": "wszystko", "senses": [{"id": "whole", "translations": ["wszystko", "całość"],
        "definition": "The whole amount", "partOfSpeech": "pronoun",
        "examples": [{"source": "That is all.", "target": "To wszystko."}]}]}


class LocalGeneratorTest(unittest.TestCase):
    def test_rejects_prose_missing_term_and_invalid_primary(self):
        for modify in [lambda v: v.update(primaryTranslation="nic"),
                       lambda v: v["senses"][0].update(translations=["czasownik pomocniczy (bez tłumaczenia)"]),
                       lambda v: v["senses"][0].update(examples=[]),
                       lambda v: v["senses"][0]["examples"][0].update(source="No target word here.")]:
            value = entry()
            modify(value)
            with self.assertRaises(ValueError):
                validate_generated(value, "all")

    def test_local_request_uses_schema_no_cloud_and_checks_completion(self):
        for done in [True, False]:
            raw = json.dumps({"done": done, "message": {"content": json.dumps(entry())}}).encode()
            with patch("urllib.request.urlopen", return_value=io.BytesIO(raw)) as request:
                if done:
                    self.assertEqual(LocalGenerator("en", "pl", 120, "test-local").translate("all"), entry())
                else:
                    with self.assertRaises(ValueError):
                        LocalGenerator("en", "pl", 120, "test-local").translate("all")
                req = request.call_args.args[0]
                self.assertEqual(req.full_url, "http://127.0.0.1:11434/api/chat")
                self.assertFalse(json.loads(req.data)["stream"])
                self.assertEqual(json.loads(req.data)["format"]["type"], "object")

    def test_generated_examples_resume_without_reusing_google_only_cache(self):
        with tempfile.TemporaryDirectory() as work, patch.object(pipeline, "DIRECTORY", Path(work)):
            args = argparse.Namespace(work=Path(work), output=Path(work)/"out", timeout=120, delay=1, engine_id="ollama:test:lexical-v1")
            cache = pipeline.open_cache(work)
            calls=[]
            class Client:
                def __init__(self,*args): pass
                def translate(self,term): calls.append(term); return entry()
                def close(self): pass
            try:
                with cache:
                    cache.execute("INSERT INTO translations VALUES (?,?,?,?,?)", (pipeline.ENGINE,"en","pl","all","Wszystko"))
                document={"words":["all"],"source":{}}
                self.assertEqual(pipeline.run_pair("en","pl",document,cache,args,1,Client,lambda _:None),(1,False))
                self.assertEqual(pipeline.run_pair("en","pl",document,cache,args,1,Client,lambda _:None),(0,False))
                report=pipeline.read_json(Path(work)/"reports/en-pl.json")
                pack=pipeline.read_json(report["file"])
                self.assertEqual(pack["primaryTranslations"]["all"],"wszystko")
                self.assertEqual(pack["entries"]["all"][0]["examples"][0]["target"],"To wszystko.")
                self.assertEqual(pack["entries"]["all"][0]["reviewStatus"],"machine-generated")
                self.assertEqual(calls,["all"])
            finally:
                cache.close()

    def test_export_filters_grammar_without_losing_its_example(self):
        fixture=pipeline.read_json(Path(__file__).parent.parent/"tests/fixtures/dictionary-meanings.json")
        senses=[{**{k:v for k,v in s.items() if k not in {"senseId","reviewStatus"}}, "id":s["senseId"].split('.')[-1]} for s in fixture["entries"]["is"]]
        result=pipeline.entry_senses("en","is",{"senses":senses},True)
        self.assertEqual([t for s in result for t in s["translations"]],["jest"])
        self.assertEqual(len(result[0]["examples"]),2)
