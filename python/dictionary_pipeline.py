"""Frequency wordlists -> GoogleTranslator -> resumable SQLite -> Lectoro R2 packs."""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import shutil
import sys
import time
import unicodedata
from contextlib import contextmanager
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent
LANGUAGES = "en pl ja de ko fr nl he es it cs pt".split()
ENGINE = "deep-translator-google-1"
MAX_PACK_BYTES = 32 * 1024 * 1024
WORDFREQ_SOURCE = {
    "name": "wordfreq", "author": "Robyn Speer", "version": "3.1.1",
    "url": "https://github.com/rspeer/wordfreq/tree/v3.1.1",
    "dataLicense": "CC-BY-SA-4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    "upstreamAttributions": "https://github.com/rspeer/wordfreq/blob/v3.1.1/README.md#license",
    "changes": "Frequency-ranked terms filtered and selected; translations added separately with GoogleTranslator.",
}


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Powtorzony klucz JSON: {key}")
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), object_pairs_hook=unique)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encode(value))
    temporary.replace(path)


def valid_text(value, maximum=200):
    return isinstance(value, str) and bool(value.strip()) and len(value.encode("utf-16-le")) // 2 <= maximum and not any(ord(c) < 32 for c in value)


def language_list(value):
    values = LANGUAGES if value == "all" else list(dict.fromkeys(value.split(",")))
    if not values or any(lang not in LANGUAGES for lang in values):
        raise argparse.ArgumentTypeError("Jezyki: " + ",".join(LANGUAGES) + " lub all")
    return values


def clean_term(value, language):
    value = unicodedata.normalize("NFKC", value).strip().replace("’", "'")
    if not valid_text(value, 80) or not any(c.isalpha() for c in value):
        return None
    # Ignore numbers, URLs, punctuation-only strings and corpus artifacts.
    if any(not (c.isalpha() or unicodedata.category(c).startswith("M") or c in " '-") for c in value):
        return None
    if value in {"http", "https", "www", "html", "jpg", "com"}:
        return None
    if language not in {"ja", "ko", "he"} and any(c.isalpha() and "LATIN" not in unicodedata.name(c, "") for c in value):
        return None
    return "I" if language == "en" and value == "i" else value


def prepare_source(language, count, work, iterator=None):
    if iterator is None:
        from wordfreq import iter_wordlist
        iterator = iter_wordlist(language, wordlist="best")
    words, seen = [], set()
    for raw in iterator:
        term = clean_term(raw, language)
        if term and term not in seen:
            words.append(term)
            seen.add(term)
        if len(words) >= count:
            break
    if not words:
        raise ValueError(f"Brak slow dla {language}")
    extra_path = DIRECTORY / "extra" / f"{language}.txt"
    if extra_path.exists():
        for line in extra_path.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            term = clean_term(line, language)
            if not term:
                raise ValueError(f"Niepoprawne dodatkowe haslo: {line!r}")
            if term not in seen:
                words.append(term)
                seen.add(term)
    document = {"schemaVersion": 1, "language": language, "requestedCount": count,
                "words": words, "source": WORDFREQ_SOURCE, "additionalTerms": extra_path.exists()}
    write_json(Path(work) / "sources" / f"{language}.json", document)
    return document


@contextmanager
def job_lock(work):
    """OS lock automatically releases after a crash; no stale lock-file guessing."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    with (work / "run.lock").open("a+b") as handle:
        handle.seek(0, 2)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise RuntimeError("Inny skrypt juz pracuje w tym folderze. Poczekaj na jego zakonczenie.") from None
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise RuntimeError("Inny skrypt juz pracuje w tym folderze.") from None
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)


def open_cache(work):
    connection = sqlite3.connect(Path(work) / "translations.sqlite3")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("""CREATE TABLE IF NOT EXISTS translations (
        engine TEXT, source TEXT, target TEXT, term TEXT, translated TEXT NOT NULL,
        PRIMARY KEY(engine, source, target, term))""")
    connection.execute("""CREATE TABLE IF NOT EXISTS failures (
        source TEXT, target TEXT, term TEXT, error TEXT, updated_at REAL,
        PRIMARY KEY(source, target, term))""")
    return connection


class Translator:
    """Use Google's translator with a bounded HTTP timeout and a reusable connection.

    deep-translator 1.11.4's Google module has no HTTP timeout argument. Replace only
    that module's requests reference with a Session; do not mutate requests globally.
    This adapter is used sequentially by one process and restored on close.
    """
    def __init__(self, source, target, timeout):
        from deep_translator import GoogleTranslator
        import deep_translator.google as google_module
        import requests

        class TimedSession(requests.Session):
            def request(self, method, url, **kwargs):
                kwargs.setdefault("timeout", (10, timeout))
                return super().request(method, url, **kwargs)

        self.session = TimedSession()
        self.module = google_module
        self.original = google_module.requests
        # The package uses legacy iw for Hebrew; the JSON packs keep standard he.
        code = lambda lang: "iw" if lang == "he" else lang
        self.client = GoogleTranslator(source=code(source), target=code(target))
        google_module.requests = self.session

    def translate(self, term):
        value = self.client.translate(term)
        if not valid_text(value, 500) or "<html" in value.lower() or "<!doctype" in value.lower():
            raise ValueError("Google zwrocil puste lub niepoprawne tlumaczenie")
        return value.strip()

    def close(self):
        self.module.requests = self.original
        self.session.close()


def read_overrides(source, target):
    path = DIRECTORY / "overrides" / f"{source}-{target}.json"
    if not path.exists():
        return {}
    data = read_json(path)
    if not isinstance(data, dict):
        raise ValueError(f"Niepoprawny plik {path}")
    result = {}
    for term, values in data.items():
        if not valid_text(term):
            raise ValueError(f"Niepoprawne haslo w {path}: {term}")
        if isinstance(values, dict):
            senses = values.get("senses")
            if not {"senses"} <= set(values) <= {"senses", "primaryTranslation"} or not isinstance(senses, list) or not 1 <= len(senses) <= 32:
                raise ValueError(f"Niepoprawne znaczenia: {term}")
            ids = set()
            for sense in senses:
                if not isinstance(sense, dict) or set(sense) != {"id", "translations", "definition", "partOfSpeech", "examples"}:
                    raise ValueError(f"Niepoprawna struktura znaczenia: {term}")
                if not valid_text(sense["id"], 80) or sense["id"] in ids:
                    raise ValueError(f"Niepoprawny lub powtorzony identyfikator: {term}")
                ids.add(sense["id"])
                for field, limit in (("definition", 500), ("partOfSpeech", 50)):
                    if not valid_text(sense[field], limit):
                        raise ValueError(f"Niepoprawne {field}: {term}")
                validate_translations(sense["translations"], term)
                examples = sense["examples"]
                if not isinstance(examples, list) or not 1 <= len(examples) <= 4 or not all(
                    isinstance(e, dict) and set(e) == {"source", "target"} and
                    all(valid_text(e[k], 500) for k in ("source", "target")) for e in examples
                ):
                    raise ValueError(f"Niepoprawne przyklady: {term}")
            if "primaryTranslation" in values and values["primaryTranslation"] not in [t for sense in senses for t in sense["translations"]]:
                raise ValueError(f"Glowny odpowiednik nie nalezy do tlumaczen: {term}")
            result[term] = values
        else:
            values = [values] if isinstance(values, str) else values
            validate_translations(values, term)
            result[term] = values
    return result


def validate_translations(values, term):
    if not isinstance(values, list) or not 1 <= len(values) <= 16 or not all(valid_text(v, 500) for v in values):
        raise ValueError(f"Niepoprawne tlumaczenia: {term}")


def lexical_translations(values):
    """Translations contain equivalents only; grammar belongs in metadata."""
    result = []
    for value in values:
        for item in value.split("/"):
            item = item.strip()
            if re.match(r"^(czasownik pomocniczy|rodzajnik|znacznik|wykładnik|podmiot formalny|relacja przynależności|odbiorca czynności)\b", item, re.I):
                continue
            item = re.sub(r"\s*\([^)]*\)", "", item).strip()
            if item and item not in result:
                result.append(item)
    return result


def entry_senses(source, term, value, manual):
    identifier = hashlib.sha256((source + "\0" + term).encode("utf-8")).hexdigest()[:24]
    if isinstance(value, dict):
        senses = [{"senseId": f"entry.{identifier}.{sense['id']}",
                   **{k: v for k, v in sense.items() if k != "id"},
                   "reviewStatus": "manual-override" if manual else "machine-generated"}
                  for sense in value["senses"]]
    else:
        senses = [{"senseId": "entry." + identifier, "translations": value,
                   "reviewStatus": "manual-override" if manual else "machine-generated"}]
    result = []
    orphan_examples = []
    for sense in senses:
        translations = lexical_translations(sense["translations"])
        if translations:
            result.append({**sense, "translations": translations})
        else:
            orphan_examples.extend(sense.get("examples", []))
    if result and orphan_examples:
        examples = result[0].get("examples", []) + orphan_examples
        result[0]["examples"] = list({(e["source"], e["target"]): e for e in examples}.values())[:4]
    return result


def export_pair(source, target, words, source_info, connection, output, overrides, curated_only=False, engine=ENGINE):
    cached = dict(connection.execute("SELECT term, translated FROM translations WHERE engine=? AND source=? AND target=?", (engine, source, target)))
    entries = {}
    primary_translations = {}
    unchanged = []
    needs_review = {}
    for term in words:
        if term not in overrides and term not in cached:
            continue
        manual = term in overrides
        value = overrides[term] if manual else json.loads(cached[term]) if engine.startswith("ollama:") else [cached[term]]
        senses = entry_senses(source, term, value, manual)
        if not senses:
            needs_review[term] = ["no-lexical-translation"]
            continue
        translations = [t for sense in senses for t in sense["translations"]]
        flags = []
        if not manual:
            flags.append("machine-generated-without-context")
            if any(t.casefold() == term.casefold() for t in translations):
                unchanged.append(term)
                flags.append("same-as-source")
            if any(t.isupper() and len(t) > 1 for t in translations):
                flags.append("all-uppercase")
            needs_review[term] = flags
        if curated_only and not manual:
            continue
        entries[term] = senses
        primary = value.get("primaryTranslation") if isinstance(value, dict) else None
        if primary not in translations:
            primary = "wszystko" if source == "en" and target == "pl" and term == "all" and "wszystko" in translations else translations[0]
        primary_translations[term] = primary
    if not entries:
        return None
    pair = f"{source}-{target}"
    # Entry IDs are lookup identifiers, not claims that Google disambiguated senses.
    content = {"schemaVersion": 1, "sourceLanguage": source, "targetLanguage": target,
               "entries": entries, "forms": {}, "primaryTranslations": primary_translations}
    base_version = ("local-" if engine.startswith("ollama:") else "google-") + hashlib.sha256(encode(content)).hexdigest()[:16]
    # A formatter/editor may have changed a previously generated file. Preserve it:
    # that URL may already be cached in R2 or an installed extension. Use the first
    # matching or unused revision, so subsequent exports remain idempotent.
    for revision in range(1000):
        version = base_version if revision == 0 else f"{base_version}-r{revision}"
        pack = {**content, "version": version}
        raw = encode(pack)
        if len(entries) > 200000 or len(raw) > MAX_PACK_BYTES:
            raise ValueError(f"{pair}: przekroczono 200000 hasel lub 32 MiB; zmniejsz --count. Cache tlumaczen zostaje.")
        relative = f"releases/{version}/{pair}.json"
        destination = Path(output) / relative
        if not destination.exists() or destination.read_bytes() == raw:
            break
    else:
        raise ValueError(f"{pair}: zbyt wiele zmodyfikowanych wersji paczki. Sprawdz folder wyjsciowy.")
    catalog_path = Path(output) / "catalog.json"
    catalog = read_json(catalog_path) if catalog_path.exists() else {"schemaVersion": 1, "pairs": {}}
    if catalog.get("schemaVersion") != 1 or not isinstance(catalog.get("pairs"), dict):
        raise ValueError("Niepoprawny istniejacy katalog CDN")
    licenses = {"schemaVersion": 1, "pairs": {pair: {
        "wordlist": source_info, "translationProvider": engine,
        "translationRights": "No additional rights granted by this tool",
        "reviewStatus": "Local editorial overrides and optional unreviewed machine translations; no independent linguistic review",
    }}}
    if not destination.exists():
        # Content-addressed assets remain byte-for-byte immutable.
        if revision:
            print(f"Starszy plik {pair} ma zmienione bajty. Zapisuje nowa wersje: {version}.", flush=True)
        write_json(destination, pack)
    license_path = destination.parent / "licenses.json"
    if not license_path.exists():
        write_json(license_path, licenses)
    catalog["pairs"][pair] = {"path": relative, "version": version, "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(), "entryCount": len(entries)}
    write_json(catalog_path, catalog)
    return {"pair": pair, "file": str(destination), "entryCount": len(entries),
            "requestedCount": len(words), "complete": len(entries) == len(words),
            "unchanged": unchanged, "needsReview": needs_review,
            "qualityChecked": False, "curatedOnly": curated_only, "missing": [term for term in words if term not in entries]}


class TranslationProgress:
    """One live terminal line; occasional plain lines when redirected to a log."""
    def __init__(self, total, completed, requests, stream=None, clock=time.monotonic):
        self.total, self.completed, self.requests = total, completed, requests
        self.stream = stream if stream is not None else sys.stdout
        self.clock, self.started = clock, clock()
        self.tty = self.stream.isatty()
        self.attempts = self.saved = self.failed = self.width = 0
        self.last_print = -1

    def update(self, attempts=0, saved=0, failed=0, term="", force=False):
        self.attempts, self.saved, self.failed = attempts, saved, failed
        if not self.tty and not force and attempts == self.last_print:
            return
        if not self.tty and not force and attempts not in (0, 1, self.requests) and attempts % 25:
            return
        done = self.completed + saved
        fraction = done / self.total if self.total else 1
        filled = int(fraction * 20)
        elapsed = max(0, self.clock() - self.started)
        eta = "--"
        if attempts:
            seconds = round(elapsed / attempts * max(0, self.requests - attempts))
            eta = f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"
        line = (f"[{'#' * filled}{'-' * (20 - filled)}] {fraction:6.2%} "
                f"{done}/{self.total} | sesja {attempts}/{self.requests} "
                f"| bledy {failed} | ETA sesji {eta}")
        if term and self.tty:
            line += f" | {term[:24]}"
        if self.tty:
            columns = max(20, shutil.get_terminal_size(fallback=(120, 24)).columns - 1)
            if len(line) > columns:
                line = (f"[{int(fraction * 100):3d}%] {done}/{self.total} "
                        f"| sesja {attempts}/{self.requests} | bledy {failed} | ETA {eta}")
            line = line[:columns]
            self.stream.write("\r" + line.ljust(min(self.width, columns)))
            self.width = len(line)
        else:
            self.stream.write(line + "\n")
        self.stream.flush()
        self.last_print = attempts

    def log(self, message, **kwargs):
        if self.tty and self.width:
            self.stream.write("\r" + " " * self.width + "\r")
            self.width = 0
        print(message, file=self.stream, flush=True)

    def close(self):
        self.update(self.attempts, self.saved, self.failed, force=True)
        if self.tty:
            self.stream.write("\n")
            self.stream.flush()
            self.width = 0


def run_pair(source, target, document, connection, args, remaining, factory=Translator, sleep=time.sleep):
    from deep_translator.exceptions import TranslationNotFound

    engine = getattr(args, "engine_id", ENGINE)
    overrides = read_overrides(source, target)
    words = list(dict.fromkeys(document["words"] + list(overrides)))
    cached = {row[0] for row in connection.execute("SELECT term FROM translations WHERE engine=? AND source=? AND target=?", (engine, source, target))}
    missing = [term for term in words if term not in cached and term not in overrides]
    deferred = {row[0] for row in connection.execute(
        "SELECT term FROM failures WHERE source=? AND target=? AND error=?",
        (source, target, "TranslationNotFound"))}
    if engine.startswith("ollama:"):
        deferred = set()  # Google parse failures do not exclude local generation.
    retry_failed = getattr(args, "retry_failed", False)
    if engine.startswith("ollama:") and retry_failed:
        raise ValueError("Ollama: wznow bez --retry-failed; ta opcja dotyczy bledow Google")
    pending = [term for term in missing if (term in deferred) == retry_failed]
    print(f"{source}->{target}: {len(words)} hasel, pozostalo {len(missing)}; w tej kolejce {len(pending)}, odlozone {len(set(missing) & deferred)}.", flush=True)
    progress = TranslationProgress(len(words), len(words) - len(missing), min(len(pending), remaining))
    progress.update(force=True)
    client = None
    used, stopped = 0, False
    consecutive_missing, saved_count = 0, 0
    try:
        if pending and remaining > 0:
            client = factory(source, target, args.timeout)
        for term in pending:
            if used >= remaining:
                break
            progress.update(used, saved_count, used - saved_count, term=term)
            sleep(args.delay)
            used += 1
            try:
                translated = client.translate(term)
                if engine.startswith("ollama:"):
                    from local_generator import validate_generated
                    translated = json.dumps(validate_generated(translated, term), ensure_ascii=False)
                elif not valid_text(translated, 500):
                    raise ValueError("Niepoprawne tlumaczenie")
            except Exception as error:
                progress.update(used, saved_count, used - saved_count)
                with connection:
                    connection.execute("INSERT OR REPLACE INTO failures VALUES (?,?,?,?,?)", (source, target, term, type(error).__name__, time.time()))
                if isinstance(error, TranslationNotFound):
                    consecutive_missing += 1
                    progress.log(f"ODLOZONE {term!r}: nie odczytano tlumaczenia. Haslo zostaje na liscie brakow.", flush=True)
                    if consecutive_missing < 3:
                        # Try a different term after a pause, never an endless retry of
                        # this response. Repeated parse failures may be a service block.
                        if used < remaining:
                            sleep(max(5, args.delay))
                        continue
                    progress.log("STOP: 3 kolejne odpowiedzi bez tlumaczenia. Usluga moze byc niedostepna; ponow pozniej.", flush=True)
                else:
                    progress.log(f"STOP {source}->{target}, haslo {term!r}: {type(error).__name__}: {str(error)[:240]}. Postep zachowany. Ponow pozniej.", flush=True)
                stopped = True
                break
            with connection:
                connection.execute("INSERT OR REPLACE INTO translations VALUES (?,?,?,?,?)", (engine, source, target, term, translated))
                connection.execute("DELETE FROM failures WHERE source=? AND target=? AND term=?", (source, target, term))
            consecutive_missing = 0
            saved_count += 1
            progress.update(used, saved_count, used - saved_count)
    except KeyboardInterrupt:
        progress.log("Przerwano. Zapisuje paczke z ukonczonych tlumaczen.", flush=True)
        stopped = True
    finally:
        progress.close()
        if client:
            client.close()
    report = export_pair(source, target, words, document["source"], connection, args.output, overrides, getattr(args, "curated_only", False), engine)
    if report:
        progress.log(f"Paczka: {report['entryCount']}/{report['requestedCount']} hasel; {report['file']}", flush=True)
    else:
        report = {"pair": f"{source}-{target}", "file": None, "entryCount": 0,
                  "requestedCount": len(words), "complete": False, "unchanged": [], "missing": words}
    report["qualityChecked"] = False
    report.setdefault("needsReview", {})
    report["stopped"] = stopped
    failed_terms = {row[0] for row in connection.execute(
        "SELECT term FROM failures WHERE source=? AND target=? AND error=?",
        (source, target, "TranslationNotFound"))}
    report["deferred"] = [term for term in report["missing"] if term in failed_terms]
    write_json(Path(args.work) / "reports" / f"{source}-{target}.json", report)
    if report["missing"]:
        progress.log(f"Brakujace hasla: {len(report['missing'])}, w tym odlozone: {len(report['deferred'])}.", flush=True)
    if report["deferred"]:
        progress.log("Odlozone tlumaczenia ponow pozniej z --retry-failed.", flush=True)
    return used, stopped


def add_options(parser):
    parser.add_argument("--engine", choices=["google", "ollama"], default="google", help="google: same tlumaczenia; ollama: tlumaczenia i przyklady lokalnie")
    parser.add_argument("--model", help="Nazwa pobranego lokalnego modelu Ollama; wymagane dla --engine ollama")
    parser.add_argument("--count", type=int, default=50000, help="Liczba najczestszych hasel na jezyk (domyslnie 50000)")
    parser.add_argument("--work", type=Path, default=DIRECTORY / "work")
    parser.add_argument("--output", type=Path, default=DIRECTORY / "dist/dictionaries")
    parser.add_argument("--max-requests", type=int, default=50000, help="Limit zapytan do wybranego silnika na cale uruchomienie")
    parser.add_argument("--delay", type=float, default=1.5, help="Przerwa przed kazdym zapytaniem w sekundach")
    parser.add_argument("--timeout", type=float, default=30, help="Limit oczekiwania HTTP w sekundach")
    parser.add_argument("--export-only", action="store_true", help="Eksportuj zapisany postep bez zapytan do silnika")
    parser.add_argument("--curated-only", action="store_true", help="Eksportuj tylko hasla z korekt; nie wywoluj Google")
    parser.add_argument("--retry-failed", action="store_true", help="Tlumacz tylko odlozone hasla z bledem TranslationNotFound")


def run(args, sources, targets):
    if not 1 <= args.count <= 190000 or args.max_requests < 1 or args.delay < 1 or not 1 <= args.timeout <= 600:
        raise ValueError("count: 1..190000; max-requests: >0; delay: >=1; timeout: 1..600")
    factory = Translator
    if getattr(args, "engine", "google") == "ollama":
        if not args.model or not re.fullmatch(r"[A-Za-z0-9._:/-]+", args.model) or "cloud" in args.model.lower():
            raise ValueError("Podaj --model z nazwa modelu lokalnego (bez modeli cloud)")
        from local_generator import LocalGenerator
        args.engine_id = "ollama:" + args.model + ":lexical-v1"
        factory = lambda source, target, timeout: LocalGenerator(source, target, max(120, timeout), args.model)
    with job_lock(args.work):
        connection = open_cache(args.work)
        try:
            remaining = 0 if args.export_only or args.curated_only else args.max_requests
            stopped = False
            for source in sources:
                document = prepare_source(source, args.count, args.work)
                print(f"Lista {source}: {len(document['words'])} hasel.", flush=True)
                for target in targets:
                    if source == target:
                        continue
                    used, stopped = run_pair(source, target, document, connection, args, remaining, factory)
                    remaining -= used
                    if stopped:
                        return 1
                if remaining <= 0 and not (args.export_only or args.curated_only):
                    print("Limit tego uruchomienia osiagniety. Powtorz polecenie, aby wznowic.")
                    break
            return 0
        finally:
            connection.close()


def command(main):
    try:
        return main()
    except (ValueError, OSError, RuntimeError) as error:
        print(f"Blad: {error}")
        return 1
