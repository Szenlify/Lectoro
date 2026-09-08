"""Shared, dependency-free dictionary format and publication helpers (Python 3.10+)."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = "en pl ja de ko fr nl he es it cs pt".split()
MAX_BYTES = 32 * 1024 * 1024


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key!r}")
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), object_pairs_hook=unique)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def text(value, maximum=200):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and not any(ord(c) < 32 for c in value)


def validate_pack(pack):
    if not isinstance(pack, dict) or pack.get("schemaVersion") != 1:
        raise ValueError("Expected dictionary schemaVersion 1")
    for field in ("sourceLanguage", "targetLanguage"):
        if pack.get(field) not in LANGUAGES:
            raise ValueError(f"Unsupported {field}")
    if pack["sourceLanguage"] == pack["targetLanguage"]:
        raise ValueError("Source and target must differ")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", pack.get("version", "")):
        raise ValueError("Invalid release version")
    entries, forms = pack.get("entries"), pack.get("forms", {})
    if not isinstance(entries, dict) or not 1 <= len(entries) <= 200_000:
        raise ValueError("Expected 1..200000 entries")
    for term, senses in entries.items():
        if not text(term) or not isinstance(senses, list) or not 1 <= len(senses) <= 32:
            raise ValueError(f"Invalid entry: {term!r}")
        for sense in senses:
            if not isinstance(sense, dict) or not text(sense.get("senseId")):
                raise ValueError(f"Missing senseId: {term!r}")
            translations = sense.get("translations")
            if not isinstance(translations, list) or not 1 <= len(translations) <= 16 or not all(text(t, 500) for t in translations):
                raise ValueError(f"Invalid translations: {term!r}")
    if not isinstance(forms, dict) or len(forms) > 400_000:
        raise ValueError("Invalid forms")
    for form, lemmas in forms.items():
        if not text(form) or not isinstance(lemmas, list) or not 1 <= len(lemmas) <= 16 or not all(isinstance(k, str) and k in entries for k in lemmas):
            raise ValueError(f"Invalid form or missing lemma: {form!r}")
    if len(json_bytes(pack)) > MAX_BYTES:
        raise ValueError("Pack exceeds the extension's 32 MiB per-pair limit")
    return pack


def import_legacy(data, version):
    """Preserve glosses verbatim. A legacy ID is an entry ID, not a verified sense."""
    if isinstance(data, dict) and data.get("schemaVersion") == 1:
        pack = {**data, "version": version}
        if (pack.get("sourceLanguage"), pack.get("targetLanguage")) != ("en", "pl"):
            raise ValueError("The base pack must be en -> pl")
        return validate_pack(pack)
    if not isinstance(data, dict):
        raise ValueError("Expected an English-to-Polish JSON object")
    entries = {}
    for term, value in data.items():
        # Also accept the user's multilingual source format, keeping only Polish.
        gloss = value.get("pl") if isinstance(value, dict) else value
        if not text(term) or not text(gloss, 500):
            raise ValueError(f"Missing/invalid Polish translation for {term!r}")
        identifier = hashlib.sha256(term.encode("utf-8")).hexdigest()[:24]
        entries[term] = [{"senseId": "legacy." + identifier, "translations": [gloss], "reviewStatus": "imported"}]
    return validate_pack({"schemaVersion": 1, "version": version, "sourceLanguage": "en", "targetLanguage": "pl", "entries": entries, "forms": {}})


def publish_pack(pack, output, provenance):
    """Write immutable release artifacts, then the catalog. Never upload anything."""
    validate_pack(pack)
    output = Path(output)
    pair = pack["sourceLanguage"] + "-" + pack["targetLanguage"]
    relative = f"releases/{pack['version']}/{pair}.json"
    raw = json_bytes(pack)
    destination = output / relative
    if destination.exists() and destination.read_bytes() != raw:
        raise ValueError(f"Release already exists with different content: {destination}. Use a new --version.")
    catalog_path = output / "catalog.json"
    catalog = read_json(catalog_path) if catalog_path.exists() else {"schemaVersion": 1, "pairs": {}}
    if catalog.get("schemaVersion") != 1 or not isinstance(catalog.get("pairs"), dict):
        raise ValueError("Invalid existing catalog")
    license_path = output / "releases" / pack["version"] / "licenses.json"
    licenses = read_json(license_path) if license_path.exists() else {"schemaVersion": 1, "pairs": {}}
    licenses["pairs"][pair] = provenance
    catalog["pairs"][pair] = {
        "path": relative, "version": pack["version"], "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(), "entryCount": len(pack["entries"]),
    }
    atomic_write(destination, raw)
    atomic_write(license_path, json_bytes(licenses))
    atomic_write(catalog_path, json_bytes(catalog))
    return destination
