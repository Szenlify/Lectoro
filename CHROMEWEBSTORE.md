# Chrome Web Store — Lectoro AI Publication Specifications

## General Information

- **Last Updated:** 2026-09-20
- **Extension Name:** Lectoro AI - Language Learning & Subtitles
- **Short Name:** Lectoro AI
- **Current Version:** 1.0.0
- **Manifest Version:** 3
- **Primary Category:** Productivity / Education
- **Supported Languages:** English, Polish, German, Spanish, French, Italian, Japanese, Korean, Dutch, Czech, Portuguese
- **Official Website:** https://lectoroai.vercel.app
- **Privacy Policy URL:** https://lectoroai.vercel.app/privacy
- **Terms of Service URL:** https://lectoroai.vercel.app/terms
- **Support Contact:** support@lectoroai.com

---

## Store Listing Metadata

### Short Summary (max 132 chars)
Learn languages faster with smart video subtitles, instant web translation, SRS flashcards, and AI explanations.

### Detailed Description (User-benefit focused)

Master new languages naturally while watching your favorite videos and reading articles online. Lectoro AI transforms YouTube, Netflix, and any webpage into an interactive, bilingual learning environment.

**Key Features:**
- **Dual Bilingual Subtitles:** Watch YouTube and Netflix with synchronized dual-language subtitles. Consecutive short fragments are paired together for effortless reading.
- **Word-by-Word Translation Clouds:** Press S for contextual word and phrase translations above subtitles, with automatic fallback when the primary service is unavailable. Repeated subtitles load from saved results.
- **AI Context Explanations:** Receive in-depth breakdowns of complex sentences, idioms, and grammar structures directly in the video player or reading pane.
- **Natural Speech Pronunciation:** Listen to crystal-clear speech pronunciation tuned to your learning language.
- **Spaced Repetition (SRS) Flashcards:** Save words and context sentences with a single shortcut or click. Daily review reminders help you retain vocabulary in long-term memory.
- **Flexible Vocabulary Export:** Export your saved cards to Anki decks or Excel spreadsheets, or take interactive AI-generated quizzes to test your mastery.
- **Cross-Device Cloud Sync:** Optionally connect your account to keep your vocabulary, learning history, and flashcards synchronized across all your devices.

---

## Permissions Justifications (CWS Compliance)

Every permission declared in `manifest.json` adheres to the Principle of Least Privilege and serves a specific, user-facing function:

| Permission | Plain-English User Benefit Justification |
| --- | --- |
| `storage` | Saves user language preferences, custom subtitle appearance, and SRS vocabulary flashcards locally on your device. |
| `alarms` | Schedules daily spaced repetition review reminders to alert you when saved words are due for review, without running continuously in the background. |
| `identity` | Enables optional Google Sign-in to sync your saved vocabulary and learning progress securely across your devices. |
| `scripting` | Dynamically injects subtitle overlays and caption bridges into nested video iframes on supported streaming platforms. |
| `activeTab` | Temporarily accesses the active page to capture a cropped context screenshot when you save a vocabulary flashcard from a video or article. |

### Host Permissions Justifications

| Host Permission Pattern | Plain-English User Benefit Justification |
| --- | --- |
| `https://*.youtube.com/*`, `https://youtube.com/*` | Renders dual subtitles, word clouds, and playback navigation controls on YouTube video players. |
| `https://www.netflix.com/*`, `https://netflix.com/*` | Displays synchronized dual bilingual subtitles on Netflix video content. |
| `https://*.nflxvideo.net/*`, `https://*.nflxso.net/*`, `https://*.nflximg.net/*`, `https://*.nflxext.com/*` | Loads official video caption data for Netflix titles in the user's selected languages. |
| `https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/*` | Delivers pre-compiled phrase dictionary packages and audio pronunciation caches quickly and reliably. |
| `https://identitytoolkit.googleapis.com/*`, `https://securetoken.googleapis.com/*`, `https://firestore.googleapis.com/*` | Provides secure account authentication and encrypted cloud synchronization for saved vocabulary flashcards. |
| `https://europe-west1-extension-eng.cloudfunctions.net/*`, `https://geminiproxy-gyagzflbra-ew.a.run.app/*` | Processes AI-assisted sentence breakdowns, linguistic explanations, and Stripe subscription portal returns. |
| `https://translate.googleapis.com/*`, `https://translate.google.com/*` | Fallback text translation provider for web articles and user-selected sentences. |

### Content Scripts Justification (`*://*/*`)

- **Web Reading & Translation:** Allows users to select words or phrases on any educational article or website to view instant dictionary definitions and save flashcards.
- **Embedded HTML5 Videos:** Detects video elements on educational platforms and video embeds to render dual subtitles and playback shortcuts.

---

## Privacy & Data Use Disclosures

- **Personally Identifiable Information:** Only collected if the user explicitly signs in via Google OAuth (email address used solely for cross-device synchronization).
- **User Vocabulary & Flashcards:** Stored locally in browser storage by default; synchronized to private user records only upon explicit account sign-in.
- **Web Content:** Webpage text is processed strictly on-demand in response to user text selection or video playback. Browsing history is never stored, tracked, or sold to third parties.
- **Optional natural voices:** Text selected for cloud pronunciation is sent to Google Gemini through our backend. Generated recordings are cached locally and on Cloudflare for reuse; shared audio-cache URLs are publicly retrievable. See [Google’s privacy policy](https://policies.google.com/privacy) and [Cloudflare’s privacy policy](https://www.cloudflare.com/privacypolicy/).
- **Advertising & Trackers:** The extension contains zero advertising, trackers, analytics beacons, or data broker integrations.

---

## Store Assets Checklist

- [x] Extension Icon 16×16 px (`icons/icon16.png`)
- [x] Extension Icon 48×48 px (`icons/icon48.png`)
- [x] Extension Icon 128×128 px (`icons/icon128.png`)
- [ ] Promotional Tile (Small: 440×280 px)
- [ ] Store Screenshots (1280×800 px or 640×400 px, 16:10 aspect ratio)
  - 1. Dual Subtitles on YouTube / Netflix
  - 2. Word-by-Word Translation Clouds
  - 3. In-Video AI Explanations
  - 4. SRS Review & Vocabulary Cards
  - 5. Anki / Quiz Export
  - Refresh the review voice-picker screenshot to show Sulafat and Algieba.

---

## Version History

- **1.0.0 (Current):**
  - Natural pronunciation with two multilingual voices, Sulafat and Algieba; saved recordings remain available for Anki export. The Review voice choices appear without a separate voice-list download.
  - Stable Netflix subtitles when skipping forward or backward between dialogue lines.
  - Contextual word and phrase translations on S, with fast automatic fallback and reusable results.
  - Initial Manifest V3 release for Chrome Web Store.
  - Paired consecutive subtitle fragments on YouTube and Netflix with length validation in both languages.
  - Multi-platform caption timing alignment and official format parsing.
  - Offline-first spaced repetition reviews with optional cloud sync.
  - Sandboxed interactive AI quiz generator and Anki exporter.
