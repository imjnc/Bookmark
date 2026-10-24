// Book metadata lookup via Open Library (public, no key). Used only when the user asks for it.
export async function lookupBooks({ q, isbn }) {
  const url = new URL('https://openlibrary.org/search.json');
  if (isbn) url.searchParams.set('isbn', isbn.replace(/[^0-9Xx]/g, ''));
  else url.searchParams.set('q', q);
  url.searchParams.set('limit', '6');
  url.searchParams.set('fields', 'title,author_name,cover_i,isbn,first_publish_year');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Bookmark/0.1' } });
  if (!res.ok) throw new Error('Metadata service unavailable');
  const j = await res.json();
  return (j.docs || []).map((d) => ({
    title: d.title,
    author: (d.author_name || []).slice(0, 2).join(', ') || null,
    isbn: isbn ? isbn.replace(/[^0-9Xx]/g, '') : d.isbn?.[0] || null,
    year: d.first_publish_year || null,
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
  }));
}
