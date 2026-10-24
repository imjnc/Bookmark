# BOOKMARK
### Your Entire Reading Library. One Search Bar.

**Product vision:** Build an AI-powered utility app that helps users find any concept, highlighted passage, quote, equation, or piece of information they have encountered in their books, even when they only remember a few words about it.

## 1. The Problem We Are Solving

Imagine I have read 100 books.

While reading, I regularly:
- Highlight important sentences and paragraphs.
- Take screenshots of important pages.
- Save pictures of equations, diagrams, and explanations.
- Mark important passages using brackets, underlines, or black lines.
- Forget which book contained a particular piece of information.

A few weeks later, I want to find something I read about costing.

I remember the concept, but I don't remember:
- Which book contained it.
- Which page it appeared on.
- The exact words used in the passage.
- Whether I saved it as a screenshot or highlighted it in the original book.

Currently, I have to search through books, screenshots, and notes manually.

**Bookmark eliminates this problem by making everything I have saved searchable from a single place.**

## 2. The Core Product Concept

Bookmark is a personal library where users can add books, upload images of important pages, and search across their entire collection using natural language.

The user should not need to remember where they saved something. They should only need to remember what they are looking for.

For example: "I am looking for a line about the cost of acquiring a customer."

Bookmark should search through all the user's saved content and return relevant results, including:
- The original image or page.
- The book's title.
- The author's name.
- The page number, if available.
- The relevant text highlighted in the result.
- The user's reading information.

The goal is to make finding previously encountered knowledge as easy as searching Google, but exclusively within the user's personal reading library.

---

# 3. The Main Features

## Feature 1: Add a Book

Users should be able to add a new book to their personal library with:

- Book title.
- Author's name.
- Cover image.
- Date started.
- Reading status: Want to Read, Reading, or Completed.
- Optional notes or tags.

The app should also support automatically retrieving book metadata from a book title, ISBN, or cover image where possible. The user can edit all information manually.

Example: Zero to One, Peter Thiel, Started Reading: October 22, 2026, Status: Reading.

Once the book is added, the user can upload screenshots or photographs of its pages.

## Feature 2: Upload Images and Screenshots

Every book has a dedicated space where users can save images. Bookmark should then:

1. Store the original image.
2. Extract readable text from the image using OCR.
3. Identify the text's position within the image.
4. Detect potentially highlighted, underlined, or marked passages where possible.
5. Save the extracted text and its connection to the original image.
6. Make the content searchable.

The image must remain available because the user may want to revisit the original page, not just read extracted text.

Supported image types: screenshots of ebook pages; photographs of physical book pages; images containing highlighted text; images with underlined or bracketed passages; images containing equations; images containing diagrams and text; notes or handwritten annotations, where recognition is supported.

Users can upload individual images or multiple images at once.

**Important:** Every image must remain linked to its book. The app should never return an image without knowing which book it came from, whenever that information is available.

## Feature 3: One Universal Search Bar

The most important feature of Bookmark. The home screen has a prominent search bar. Examples: "Costing", "Customer acquisition cost", "A line about building a startup", "The equation for calculating profit", "What did I read about hiring?", "The passage about compound interest", "A quote about consistency", "The page where the author discusses pricing strategy".

Three types of search:

**A. Exact Keyword Search** - "costing" returns images and passages containing that word, even if the user did not manually highlight them.

**B. Semantic Search** - "How do companies calculate the cost of acquiring a customer?" should find "Customer acquisition cost represents the total sales and marketing expenditure required to acquire a new customer." Uses text embeddings.

**C. Natural Language Search** - Users describe what they remember in their own words ("Find the page about pricing a product.", "Show me the equation related to profit margins.", "I remember a book discussing why startups fail.").

Search spans all books and images belonging to that user. It does not search the public internet by default.

---

# 4. How Search Results Should Look

Each result card contains:

1. A preview of the original image.
2. The book title.
3. The author's name.
4. The relevant extracted passage.
5. The matching words highlighted in the result.
6. The page number, if known.
7. The relevance of the result to the query.

The user can tap the result to open the complete image and read the surrounding text. Where technically possible the relevant passage is highlighted in the preview.

Ranking combines: exact keyword matches; semantic relevance; strength of the match within the passage; whether the content was explicitly highlighted or marked by the user.

The system must not invent quotations, page numbers, or book references. If a page number cannot be determined, show "Page unknown" instead of guessing.

---

# 5. Detecting Highlighted Text and Marked Passages

- **Case A: Coloured highlights** - detect coloured regions and associate them with the text underneath.
- **Case B: Underlines and brackets** - computer vision detects visible underlines, brackets and similar annotations and associates them with nearby text where confidence is sufficient.
- **Case C: Black lines** - a black line beneath or around a sentence is identified and associated with text. Harder than OCR; develop and test separately.
- **Case D: No highlighting** - still extract and index all readable text. **The user should never need to highlight a passage for it to become searchable.** Record separately which passages appear marked.

Users can manually correct extracted text or select a passage themselves if automatic detection fails.

---

# 6. Screens

1. **Home** - logo, prominent universal search bar, Add Book, Upload Images, recently added books, recently saved images, recent searches.
2. **My Library** - book cards (cover, title, author, status, date started, image count); sort by title, author, date added, status.
3. **Book Details** - title/author, reading info, all uploaded images, extracted text per image, highlighted passages, notes and tags; upload more images.
4. **Search Results** - all matches across the library; filters: book, author, highlighted passages, images, equations, reading status. Original image next to the relevant text.
5. **Image and Passage Viewer** - original image at readable size with matching passage highlighted; extracted text; copy passage, add note, edit incorrect OCR text, mark important, open book, view other matches from same book. The original image is never modified.

---

# 7. Architecture

1. **Image storage** - originals in object storage, unique id, linked to user and book.
2. **OCR engine** - Google Cloud Vision / AWS Textract / PaddleOCR, selected after benchmarking real pages.
3. **Text and annotation processing** - text blocks and paragraphs, positions preserved, linked to image and book, highlight/mark detection, confidence scores, manual correction.
4. **Search engine** - keyword (PostgreSQL full-text) + semantic (pgvector) = hybrid search.
5. **AI query understanding** - an LLM turns natural language into effective search terms (e.g. "customer acquisition cost", "CAC", "cost per customer"). It must not invent answers; the user's saved passage is the source of truth.
6. **Result presentation** - passages, images, book metadata and page info; original image reachable from every result.

# 8. Recommended Stack (starting point, not a requirement)

React Native + Expo; Supabase (PostgreSQL, Storage, Auth); OCR after benchmarking; FTS + pgvector; API-based LLM only where it adds value; async queue/worker for OCR, image processing, indexing (users must not wait for processing).

# 9. Database Structure

- **Users**
- **Books**: id, user id, title, author, cover, ISBN, start date, completion date, reading status, timestamps.
- **Images**: id, user id, book id, original location, upload date, page number, OCR status, dimensions.
- **Passages**: id, image id, extracted text, text block coordinates, paragraph boundaries, highlight/annotation status, OCR confidence, embedding, user corrections.
- **Notes**: id, user id, book id, image/passage id, content, created timestamp.

User-level access controls: one user's data must never be accessible to another.

# 10. User Journey

Add "The Psychology of Money" -> upload five photographed pages -> automatic OCR / mark detection / indexing -> three weeks later search "How does compounding increase wealth over time?" -> results show the passage, original page image, book title and author -> open the image and read surrounding context.

# 11. MVP Phases

**Phase 1 - Core:** authentication; add/edit books; book metadata; upload images to a book; OCR; keyword search; results linked to original images; book title and author in every result; basic image viewer; reading dates and status.

**Phase 2 - Better search:** semantic search; natural language queries; hybrid search; relevant passage extraction; highlighted matching words; filters; OCR text correction.

**Phase 3 - Intelligent highlight detection:** coloured highlight, underline, bracket/marked-region detection; association between marks and text; confidence scores and manual correction; better handling of diagrams and equations.

**Phase 4 - Personal knowledge layer:** searchable notes; tags and collections; saved important passages; related passage recommendations; questions answered from retrieved passages with references; export.

# 12. Product Decisions

1. Every image must be searchable (not only highlighted text).
2. Preserve the original source; extracted text is only an index.
3. Keep search private to the current user.
4. Avoid unnecessary AI costs: OCR for text, conventional image processing for annotations, embeddings for retrieval, LLMs selectively.
5. Make uncertainty visible; let users correct text.
6. Build for the user's actual workflow: adding a book and uploading must be fast; search is most prominent.

# 13. Success Metrics

Time to add a book and upload images; % images processed successfully; OCR accuracy on real pages; search success rate; % searches returning a useful passage; time to find a passage; returning users; saved images searched per active user. Test with real user questions about previously saved passages.

# 14. In One Sentence

Bookmark is an AI-powered personal knowledge search engine that turns your books, highlighted passages, and saved page images into a searchable library.

**Product principle: Never lose an idea just because you forgot where you read it.**
