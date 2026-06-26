import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = 'https://www.losergod.com';
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(rootDir, 'public');

const queue = ['/'];
const queued = new Set(queue);
const seen = new Set();
const downloaded = [];
const failed = [];

function enqueue(rawUrl, basePath = '/') {
  if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('#')) {
    return;
  }

  let normalized = rawUrl.trim();
  if (normalized.includes('${')) {
    return;
  }

  if (normalized.startsWith('assets/')) {
    normalized = `/${normalized}`;
  }

  try {
    const baseUrl = new URL(basePath.endsWith('/') ? basePath : `${path.posix.dirname(basePath)}/`, origin);
    const url = new URL(normalized, baseUrl);
    if (url.origin !== origin) {
      return;
    }

    const pathname = url.pathname;
    if (
      pathname === '/' ||
      pathname === '/favicon.ico' ||
      (
        pathname.startsWith('/assets/') &&
        /\.(js|css|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|json)$/i.test(pathname)
      )
    ) {
      if (!queued.has(pathname)) {
        queued.add(pathname);
        queue.push(pathname);
      }
    }
  } catch {
    // Ignore malformed strings found in minified bundles.
  }
}

function extractReferences(text, currentPath) {
  const patterns = [
    /\b(?:src|href)\s*=\s*["']([^"']+)["']/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
    /["'`]((?:\/?assets\/)[^"'`?#)]+(?:\?[^"'`]*)?)["'`]/g,
    /["'`](\.\/[^"'`?#)]+\.(?:js|css|png|jpg|jpeg|webp|gif|svg|ico)(?:\?[^"'`]*)?)["'`]/g,
    /["'`](\/favicon\.ico)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      enqueue(match[1], currentPath);
    }
  }
}

function toDiskPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  return path.join(publicDir, relativePath);
}

function isTextAsset(pathname, contentType) {
  return (
    contentType.includes('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('json') ||
    contentType.includes('svg') ||
    /\.(html|js|css|json|svg)$/i.test(pathname)
  );
}

async function download(pathname) {
  const url = `${origin}${pathname}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 LoserGodLocalMirror/1.0',
    },
  });

  if (!response.ok) {
    failed.push({ pathname, status: response.status });
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const diskPath = toDiskPath(pathname);
  await mkdir(path.dirname(diskPath), { recursive: true });
  await writeFile(diskPath, buffer);
  downloaded.push(pathname);

  const contentType = response.headers.get('content-type') || '';
  if (isTextAsset(pathname, contentType)) {
    extractReferences(buffer.toString('utf8'), pathname);
  }
}

async function* walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else {
      yield fullPath;
    }
  }
}

async function localizeMirroredFiles() {
  const textExtensions = new Set(['.html', '.js', '.css', '.json', '.svg']);
  for await (const filePath of walkFiles(publicDir)) {
    if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
      continue;
    }

    const originalText = await readFile(filePath, 'utf8');
    const localizedText = originalText
      .replaceAll('https://www.losergod.com', '')
      .replaceAll('https://losergod.com', '');

    if (localizedText !== originalText) {
      await writeFile(filePath, localizedText);
    }
  }
}

while (queue.length > 0) {
  const pathname = queue.shift();
  if (!pathname || seen.has(pathname)) {
    continue;
  }

  seen.add(pathname);
  try {
    await download(pathname);
    console.log(`downloaded ${pathname}`);
  } catch (error) {
    failed.push({ pathname, error: error.message });
    console.warn(`failed ${pathname}: ${error.message}`);
  }
}

await localizeMirroredFiles();
console.log(`mirror complete: ${downloaded.length} downloaded, ${failed.length} failed`);
if (failed.length > 0) {
  console.log(JSON.stringify(failed, null, 2));
}

