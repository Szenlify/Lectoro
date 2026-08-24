# Start

# Stripe live

# Klucze do zmiany przy produkcji
- LECTORO_GEMINI_API_KEY
- ELEVENLABS_API_KEY
- STRIPE_SECRET_KEY
- R2_SECRET_ACCESS_KEY

## .env w functions do zmiany

- STRIPE_BASIC_PRICE_ID=price_1U45bvPWye8UyAN8xKC8ista
- STRIPE_PRO_PRICE_ID=price_1U46tdPWye8UyAN8jN2EpPxa

## Cloudflare R2 - Konfiguracja Magazynu Mediów
- R2_ACCOUNT_ID=94b9a2de404c8e3f8efa532d0607b5f1
- R2_BUCKET_NAME=lectoro-media
- R2_PUBLIC_URL=https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev
- R2_ACCESS_KEY_ID=75713468bf056703eec66c5821e564f5


po zmianie - R2_PUBLIC_URL=https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev
musisz zmienic w calym projekcie bo sa dynamiczne URL audio i images