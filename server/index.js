import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes } from './auth.js';
import { bookRoutes } from './books.js';
import { ebookRoutes } from './ebooks.js';
import { searchRoutes } from './search.js';
import { resumePending, shutdownOcr } from './ocr.js';
import { bad } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

// Feature routes (single-line toggle modularity)
authRoutes(app);
bookRoutes(app);
ebookRoutes(app);
searchRoutes(app);

// pdf.js vendor static assets
const pdfjs = path.join(here, '..', 'node_modules', 'pdfjs-dist');
app.use('/vendor/pdfjs', express.static(path.join(pdfjs, 'build'), { maxAge: '7d' }));
app.use('/vendor/pdfjs-web', express.static(path.join(pdfjs, 'web'), { maxAge: '7d' }));
app.use('/vendor/pdfjs-cmaps', express.static(path.join(pdfjs, 'cmaps'), { maxAge: '7d' }));
app.use('/vendor/pdfjs-fonts', express.static(path.join(pdfjs, 'standard_fonts'), { maxAge: '7d' }));

app.use(express.static(path.join(here, '..', 'public')));
app.use('/api', (_req, res) => bad(res, 'Not found', 404));
app.use((err, _req, res, _next) => { console.error(err); bad(res, err.message || 'Server error', 500); });

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`Bookmark running at http://localhost:${port}`);
  resumePending();
});
process.on('SIGINT', async () => { await shutdownOcr(); server.close(); process.exit(0); });
