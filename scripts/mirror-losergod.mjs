import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = 'https://www.losergod.com';
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(rootDir, 'public');
const localAssetVersion = 'lafinger-local-v2';

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
    const localizedText = applyLocalCacheBusting(filePath, applyVisibleBranding(filePath, originalText
      .replaceAll('https://www.losergod.com', '')
      .replaceAll('https://losergod.com', '')));

    if (localizedText !== originalText) {
      await writeFile(filePath, localizedText);
    }
  }
}

function applyVisibleBranding(filePath, text) {
  const relativePath = path.relative(publicDir, filePath).replaceAll(path.sep, '/');
  let brandedText = text
    .replaceAll('关于losergod（逆神）', '关于Lafinger')
    .replaceAll('逆神(losergod)', 'Lafinger')
    .replaceAll('逆神（losergod）', 'Lafinger')
    .replaceAll('逆神 | LOSERGOD', 'Lafinger')
    .replaceAll('逆神', 'Lafinger')
    .replaceAll('LOSERGOD', 'Lafinger')
    .replaceAll('LoserGod', 'Lafinger')
    .replaceAll('关于losergod', '关于Lafinger')
    .replaceAll('Lafinger(losergod)', 'Lafinger')
    .replaceAll('Lafinger（losergod）', 'Lafinger')
    .replaceAll('losergod专注于', 'Lafinger专注于')
    .replaceAll('如在手机或平板体验不佳，建议使用电脑访问：losergod.com', '如在手机或平板体验不佳，建议使用电脑访问：Lafinger');

  if (relativePath === 'index.html' || relativePath.includes('AboutView-')) {
    brandedText = brandedText.replaceAll('losergod', 'Lafinger');
  }

  return patchTradingPanelStockTitle(brandedText);
}

function withLocalAssetVersion(assetPath) {
  const [withoutHash, hash = ''] = assetPath.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  const params = new URLSearchParams(query);
  params.set('v', localAssetVersion);
  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

function applyLocalCacheBusting(filePath, text) {
  const relativePath = path.relative(publicDir, filePath).replaceAll(path.sep, '/');
  let patchedText = text;

  if (relativePath === 'index.html') {
    patchedText = patchedText.replace(
      /\b(src|href)=(["'])(\/assets\/(?:js|css)\/[^"'?#]+\.(?:js|css))(?:\?[^"']*)?\2/g,
      (_match, attribute, quote, assetPath) => `${attribute}=${quote}${withLocalAssetVersion(assetPath)}${quote}`,
    );
    patchedText = injectBrandGuard(patchedText);
  }

  if (relativePath.endsWith('.js')) {
    patchedText = patchedText
      .replace(
        /import\((["'])\.\/([^"'?#]+\.js)(?:\?[^"']*)?\1\)/g,
        (_match, quote, assetPath) => `import(${quote}./${withLocalAssetVersion(assetPath)}${quote})`,
      )
      .replace(
        /(["'])(assets\/js\/[^"'?#]+\.js)(?:\?[^"']*)?\1/g,
        (_match, quote, assetPath) => `${quote}${withLocalAssetVersion(assetPath)}${quote}`,
      );
  }

  return patchedText;
}

function injectBrandGuard(text) {
  const marker = 'id="lafinger-brand-guard"';
  if (text.includes(marker)) {
    return text;
  }

  const script = `    <script ${marker}>
      (() => {
        const sourceName = 'loser' + 'god';
        const replacements = [
          [new RegExp('\\\\u5173\\\\u4e8e' + sourceName + '\\\\uff08\\\\u9006\\\\u795e\\\\uff09', 'gi'), '关于Lafinger'],
          [new RegExp('\\\\u9006\\\\u795e\\\\(' + sourceName + '\\\\)', 'gi'), 'Lafinger'],
          [new RegExp('\\\\u9006\\\\u795e\\\\uff08' + sourceName + '\\\\uff09', 'gi'), 'Lafinger'],
          [/\\u9006\\u795e\\s*\\|\\s*LOSERGOD/g, 'Lafinger'],
          [/\\u9006\\u795e/g, 'Lafinger'],
          [new RegExp('LOSER' + 'GOD', 'g'), 'Lafinger'],
          [new RegExp('Loser' + 'God', 'g'), 'Lafinger'],
          [new RegExp('\\\\b' + sourceName + '\\\\b', 'gi'), 'Lafinger'],
        ];
        const rewrite = (value) => replacements.reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), value);
        const rewriteText = (value) => typeof value === 'string' ? rewrite(value) : value;
        const patchCanvasTextMethod = (prototype, methodName) => {
          const original = prototype && prototype[methodName];
          if (typeof original !== 'function' || original.__lafingerPatched) return;
          const patched = function(text, ...args) {
            return original.call(this, rewriteText(text), ...args);
          };
          patched.__lafingerPatched = true;
          prototype[methodName] = patched;
        };
        const patchCanvasText = () => {
          const prototype = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
          patchCanvasTextMethod(prototype, 'fillText');
          patchCanvasTextMethod(prototype, 'strokeText');
          patchCanvasTextMethod(prototype, 'measureText');
        };
        const rewriteAttribute = (element, attribute) => {
          if (!element.hasAttribute(attribute)) return;
          const current = element.getAttribute(attribute) || '';
          const next = rewrite(current);
          if (next !== current) element.setAttribute(attribute, next);
        };
        const rewriteNode = (node) => {
          if (!node) return;
          if (node.nodeType === Node.TEXT_NODE) {
            const current = node.nodeValue || '';
            const next = rewrite(current);
            if (next !== current) node.nodeValue = next;
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const tagName = node.tagName;
          if (tagName === 'SCRIPT' || tagName === 'STYLE') return;
          ['title', 'alt', 'aria-label', 'placeholder', 'content'].forEach((attribute) => rewriteAttribute(node, attribute));
          Array.from(node.childNodes).forEach(rewriteNode);
        };
        const rewriteDocument = () => {
          const nextTitle = rewrite(document.title || '');
          if (nextTitle !== document.title) document.title = nextTitle;
          document.querySelectorAll('meta[content]').forEach((element) => rewriteAttribute(element, 'content'));
          if (document.body) rewriteNode(document.body);
        };
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
              rewriteNode(mutation.target);
            } else if (mutation.type === 'childList') {
              mutation.addedNodes.forEach(rewriteNode);
            } else if (mutation.type === 'attributes') {
              rewriteNode(mutation.target);
            }
          }
        });
        rewriteDocument();
        patchCanvasText();
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['title', 'alt', 'aria-label', 'placeholder', 'content'],
        });
        window.__lafingerBrandGuard = { rewrite: rewriteDocument, rewriteText };
      })();
    </script>
`;

  return text.replace('</head>', `${script}</head>`);
}

function patchTradingPanelStockTitle(text) {
  if (!text.includes('stock-info') || !text.includes('currentStock') || !text.includes('stockData') || !text.includes('"模拟炒股"')) {
    return text;
  }

  const staticTitlePattern = /([A-Za-z_$][\w$]*)\[15\]\|\|\(\1\[15\]=([A-Za-z_$][\w$]*)\("h2",null,"模拟炒股",-1\)\)/g;
  return text.replace(staticTitlePattern, (match, _cacheArg, createElementName, offset) => {
    const functionStart = text.lastIndexOf('function ', offset);
    if (functionStart < 0) {
      return match;
    }

    const openParen = text.indexOf('(', functionStart);
    const closeParen = text.indexOf(')', openParen);
    if (openParen < 0 || closeParen < 0 || closeParen > offset) {
      return match;
    }

    const args = text.slice(openParen + 1, closeParen).split(',').map((item) => item.trim());
    const propsArg = args[2];
    if (!propsArg) {
      return match;
    }

    const stockTitle = `String((${propsArg}.currentStock&&(${propsArg}.currentStock.name||${propsArg}.currentStock.stock_name||${propsArg}.currentStock.fullName||${propsArg}.currentStock.code))||(${propsArg}.stockData&&${propsArg}.stockData[0]&&(${propsArg}.stockData[0].stock_name||${propsArg}.stockData[0].name||${propsArg}.stockData[0].fullName||${propsArg}.stockData[0].stock_code||${propsArg}.stockData[0].code))||"模拟炒股")`;
    return `${createElementName}("h2",null,${stockTitle},1)`;
  });
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

