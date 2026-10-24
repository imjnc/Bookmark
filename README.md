# Bookmark
Your entire reading library. One search bar. (Full product spec: [SPEC.md](SPEC.md))

## Run it
```
npm install
npm start          # http://localhost:3000
```
Needs Node 22.5+ (uses the built-in `node:sqlite`). Open the URL on your phone (same network) for the mobile layout; the upload button opens the camera/gallery.

First run downloads, once, into `data/`: the English OCR data (~10 MB) and the semantic-search model (~25 MB). If the model can't be downloaded the app falls back to a built-in hashed-word embedding, so search keeps working (weaker on paraphrases). `POST /api/reindex` re-embeds saved passages after the model becomes available.

## What's built (phases 1-3 of the spec, plus parts of 4)
| Spec | Implementation |
|---|---|
| Auth, per-user isolation | scrypt passwords, HttpOnly cookie sessions; every query is scoped by `user_id` |
| Books + metadata | add/edit/delete, status, dates, tags, notes, cover upload; title/ISBN lookup via Open Library |
| Image storage | originals saved untouched under `data/uploads/<user>/`, served only to the owner |
| OCR + positions | tesseract.js (offline), paragraph/line boxes stored as image fractions, confidence per line |
| Async processing | in-process queue, one image at a time; unfinished jobs resume on restart |
| Mark detection | `server/highlight.js`: colour highlights, underlines/black lines, side brackets (plain pixel analysis, no AI cost) |
| Manual correction | edit OCR text (re-indexed), drag a rectangle to mark/unmark, set page number, mark important |
| Hybrid search | SQLite FTS5 (porter stemming) + MiniLM embeddings, combined score + boosts for marked/important passages |
| Query understanding | optional: set `ANTHROPIC_API_KEY` and a model expands questions into search terms (`BOOKMARK_QUERY_MODEL` to override). Never answers from its own knowledge |
| Screens | Home, Library (sortable), Book details, Search results (filters), Image/passage viewer |
| Notes | per book, per image, per passage |

Page numbers are never guessed: unknown shows "Page unknown" until you set one.

## Books (PDF reader)
Sidebar, Books: upload a PDF (up to 200 MB) and read it in the app. pdf.js renders pages in the browser and is served locally from `node_modules` (no CDN).
Page or continuous-scroll view, Text view (reflowed text with size and spacing controls), zoom, fit width or page, Light/Sepia/Dark reading themes, brightness, full-screen focus mode, swipe or arrow keys, chapters from the PDF outline, highlights in four colours, notes on any page (also scanned pages), and your place saved per book. Settings, progress and annotations live in the same SQLite database; PDFs live in `data/uploads/<user>/ebooks/`.
Limits: highlights need a text layer, so scanned PDFs get page notes only; password-protected PDFs are not supported; Text view shows one page at a time.

## Tests
```
python test/make-fixtures.py %TEMP%\bm-fixtures
node test/smoke.js %TEMP%\bm-fixtures
node test/ui.mjs %TEMP%\bm-fixtures   # browser test: headless Chrome, no extra packages
```
Generates synthetic pages (highlight, underline, plain, equation) and checks OCR, keyword/semantic search, mark detection, corrections and privacy end to end.

## Known limits / next steps
- Mark detection is heuristic; tune on real photos (shadows, curved pages, dark-mode screenshots). Dark-mode ebooks are not handled specially.
- Handwriting and equations use plain OCR; a math-OCR model would improve equations.
- Cover-image-based book recognition is not implemented (title/ISBN lookup is).
- Single-process SQLite is fine for personal/small libraries. For the spec's cloud stack, the schema maps directly to Supabase (Postgres + pgvector + Storage) and the pipeline in `server/ocr.js` becomes a worker.
- Not hardened for public hosting: add HTTPS (`Secure` cookie), rate limiting and per-user upload quotas first.
