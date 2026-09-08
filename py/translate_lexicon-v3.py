# -*- coding: utf-8 -*-
"""
Skrypt do automatycznego tłumaczenia całego słownika na 12 języków.
Uruchom go na swoim komputerze z dostępem do internetu.

Wymaga instalacji biblioteki deep-translator:
    pip install deep-translator openpyxl tqdm

Słownik wejściowy: english_polish_lexicon-v6.json
Słownik wyjściowy: english_multilingual_lexicon.json
"""

import json
import os
import time
from tqdm import tqdm
from deep_translator import GoogleTranslator

# Języki docelowe i ich kody
# Google Translator używa kodu "iw" dla języka hebrajskiego (hebrew) zamiast "he".
# Klucz w wynikowym słowniku JSON pozostanie "he" zgodnie z Twoimi wymaganiami.
LANG_MAP = {
    "en": "en",
    "ja": "ja",
    "de": "de",
    "ko": "ko",
    "fr": "fr",
    "nl": "nl",
    "he": "iw", # Mapowanie na kod wspierany przez Google Translate API
    "pl": "pl", # Przepisywane bezpośrednio z v6.json
    "es": "es",
    "it": "it",
    "cs": "cs",
    "pt": "pt"
}

INPUT_FILE = "english_polish_lexicon-v6.json"
OUTPUT_FILE = "english_multilingual_lexicon.json"

def main():
    if not os.path.exists(INPUT_FILE):
        print(f"Błąd: Nie znaleziono pliku wejściowego {INPUT_FILE}!")
        print("Upewnij się, że pobrałeś plik english_polish_lexicon-v6.json z panelu Studio i umieściłeś go w tym samym folderze co ten skrypt.")
        return

    print("Wczytywanie słownika bazowego...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        base_lexicon = json.load(f)

    # Przygotowanie słownika wyjściowego lub wczytanie istniejącego postępu (wznowienie w razie przerwania)
    multilingual_lexicon = {}
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                multilingual_lexicon = json.load(f)
            print(f"Znaleziono istniejący plik wyjściowy. Wznawianie pracy od słowa {len(multilingual_lexicon)}...")
        except Exception:
            pass

    # Inicjalizacja translatorów dla poszczególnych języków
    translators = {}
    for lang, code in LANG_MAP.items():
        if lang not in ["en", "pl"]: # angielski jest bazą, polski bierzemy z pliku
            translators[lang] = GoogleTranslator(source='en', target=code)

    keys = sorted(list(base_lexicon.keys()))
    
    print(f"Rozpoczynanie tłumaczenia {len(keys)} haseł na 12 języków...")
    
    try:
        for idx, key in enumerate(tqdm(keys, desc="Tłumaczenie słów")):
            if key in multilingual_lexicon:
                continue # Pomiń już przetłumaczone
                
            pl_val = base_lexicon[key]
            
            # Tworzymy obiekt tłumaczeń
            translations = {
                "en": key,
                "pl": pl_val
            }
            
            # Tłumaczymy na pozostałe języki
            for lang in translators:
                retries = 3
                while retries > 0:
                    try:
                        # Pobieramy tłumaczenie i bierzemy tylko jedno słowo (przed ukośnikiem jeśli występuje)
                        translation = translators[lang].translate(key)
                        if " / " in translation:
                            translation = translation.split(" / ")[0]
                        elif "/" in translation:
                            translation = translation.split("/")[0]
                        
                        translations[lang] = translation.strip()
                        break
                    except Exception as e:
                        retries -= 1
                        if retries == 0:
                            print(f"\nBłąd podczas tłumaczenia słowa '{key}' na język '{lang}': {e}")
                            translations[lang] = "" # Wpisz puste w razie trwałego błędu
                        else:
                            time.sleep(1) # Odczekaj przed kolejną próbą
            
            # Zapisujemy do słownika pod oryginalnym kluczem (angielskim słowem)
            multilingual_lexicon[key] = translations
            
            # Zapisuj postęp co 50 słów, aby nie stracić wyników w razie przerwania
            if idx % 50 == 0:
                with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
                    json.dump(multilingual_lexicon, f, ensure_ascii=False, indent=2)
                    
    except KeyboardInterrupt:
        print("\nPrzerwano na życzenie użytkownika. Zapisywanie postępu...")
    finally:
        # Zapisujemy końcowy plik
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(multilingual_lexicon, f, ensure_ascii=False, indent=2)
        print(f"\nGotowe! Słownik został zapisany w pliku: {OUTPUT_FILE}")
        print(f"Przetłumaczono łącznie: {len(multilingual_lexicon)} z {len(keys)} haseł.")

if __name__ == "__main__":
    main()
