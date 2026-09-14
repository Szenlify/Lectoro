# Chrome Web Store — Lectoro AI Publication Specifications

## General Information

- **Last Updated:** 2026-09-14

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

Master new languages naturally while enjoying videos and browsing the web. Lectoro AI seamlessly transforms YouTube, Netflix, and any webpage into an interactive, bilingual learning environment.

**Key Features:**
- **Dual Bilingual Subtitles:** Watch YouTube and Netflix with consecutive subtitle fragments grouped in pairs in both languages. Long fragments appear individually to keep subtitles readable.
- **Word-by-Word Translation Clouds:** Instantly hover or tap shortcut keys to see translations above unfamiliar words without pausing your flow.
- **AI Context Explanations:** Get instant, in-depth breakdowns of complex sentences, idioms, and grammar structures directly in the video player or reading pane.
- **Natural Voice Pronunciation:** Listen to crystal-clear speech pronunciation powered by advanced speech synthesis tuned to your learning language.
- **Spaced Repetition (SRS) Flashcards:** Save vocabulary and context sentences with a single click. Daily review sessions help you retain words in long-term memory.
- **Flexible Vocabulary Export:** Export your saved cards to Anki decks or Excel spreadsheets, or take interactive AI-generated quizzes to test your mastery.
- **Cross-Device Cloud Sync:** Optionally connect your account to keep your vocabulary, learning history, and flashcards synchronized across all your devices.

---

## Permissions Justifications (CWS Compliance)

Every permission declared in `manifest.json` serves a specific, user-facing function:

| Permission | Plain-English User Benefit Justification |
| --- | --- |
| `storage` | Saves user language preferences, custom subtitle appearance, and SRS vocabulary flashcards locally on your computer. |
| `alarms` | Schedules daily spaced repetition review notifications to remind you when saved vocabulary is ready for review, without running continuously in the background. |
| `identity` | Allows optional Google Sign-in to sync your saved vocabulary and learning progress across your devices. |
| `scripting` | Coordinates subtitle display and playback bridges when watching videos on supported streaming platforms. |
| `activeTab` | Accesses the active video or article when you click the extension icon or trigger a reading shortcut, ensuring features activate only on request. |

### Host Permissions Justifications

| Host Permission Pattern | User Benefit Justification |
| --- | --- |
| `https://*.youtube.com/*`, `https://youtube.com/*` | Renders dual subtitles, word clouds, and interactive controls on YouTube video players. |
| `https://www.netflix.com/*`, `https://netflix.com/*` | Displays synchronized dual bilingual subtitles on Netflix video content. |
| `https://*.nflxvideo.net/*`, `https://*.nflxso.net/*`, `https://*.nflximg.net/*`, `https://*.nflxext.com/*` | Loads official video caption data for Netflix titles in the user's selected languages. |
| `https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/*` | Delivers pre-compiled phrase dictionary packages and audio pronunciation caches quickly and reliably. |
| `https://identitytoolkit.googleapis.com/*`, `https://securetoken.googleapis.com/*`, `https://firestore.googleapis.com/*` | Provides secure account authentication and encrypted cloud synchronization for saved vocabulary flashcards. |
| `https://europe-west1-extension-eng.cloudfunctions.net/*`, `https://geminiproxy-gyagzflbra-ew.a.run.app/*` | Processes AI-assisted sentence breakdowns, linguistic explanations, and dynamic vocabulary queries. |
| `https://translate.googleapis.com/*`, `https://translate.google.com/*` | Fallback text translation provider for web articles and user-selected sentences. |

---

## Privacy & Data Use Disclosures

- **Personally Identifiable Information:** Only collected if the user explicitly signs in via Google OAuth (email address used solely for cross-device synchronization).
- **User Vocabulary & Flashcards:** Stored locally in browser storage by default; synchronized to private user records only upon explicit account sign-in.
- **Web Content:** Webpage text is processed strictly on-demand in response to user text selection or video playback. Browsing history is never stored, tracked, or sold to third parties.
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

---

## Version History

- **Unreleased (2026-09-14):**
  - Match complete sentences across YouTube automatic captions and translations before grouping them in pairs.
  - Keep translations with their timed subtitle fragments instead of moving names and sentence parts into the next subtitle.
  - Group consecutive subtitle fragments in pairs on YouTube and Netflix, checking length in both languages.
  - Keep pairs stable when changing the translation language or retrying on YouTube.
  - Refresh the YouTube and Netflix subtitle screenshots to show paired fragments.

- **1.0.0 (Current):**
  - Initial Manifest V3 release for Chrome Web Store.
  - Dual bilingual subtitles with smart single-line length bounding.
  - Native YouTube XHR transport with signed caption fallback.
  - High-performance static phrase dictionary lookup.
  - Spaced Repetition System (SRS) with multi-direction reviews.
  - Interactive AI Quiz generator and Anki deck exporter.
