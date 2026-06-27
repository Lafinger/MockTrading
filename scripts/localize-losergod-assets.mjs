import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(rootDir, 'public');
const localAssetVersion = 'lafinger-local-v6';

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

function withLocalAssetVersion(assetPath) {
  const [withoutHash, hash = ''] = assetPath.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  const params = new URLSearchParams(query);
  params.set('v', localAssetVersion);
  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

function applyVisibleBranding(text) {
  const brandGuardBlocks = [];
  const protectedText = text.replace(/<script id="lafinger-brand-guard">[\s\S]*?<\/script>/g, (match) => {
    const placeholder = `__LAFINGER_BRAND_GUARD_${brandGuardBlocks.length}__`;
    brandGuardBlocks.push(match);
    return placeholder;
  });

  const brandedText = protectedText
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

  return brandGuardBlocks.reduce(
    (next, block, index) => next.replace(`__LAFINGER_BRAND_GUARD_${index}__`, block),
    brandedText,
  );
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
        /\b(from|import)(["'])\.\/([^"'?#]+\.js)(?:\?[^"']*)?\2/g,
        (_match, keyword, quote, assetPath) => `${keyword}${quote}./${withLocalAssetVersion(assetPath)}${quote}`,
      )
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
  const script = `    <script ${marker}>
      (() => {
        const sourceName = 'loser' + 'god';
        const replacements = [
          [new RegExp('\\\\u5173\\\\u4e8e' + sourceName + '\\\\uff08\\\\u9006\\\\u795e\\\\uff09', 'gi'), '关于Lafinger'],
          [new RegExp('\\\\u9006\\\\u795e\\\\(' + sourceName + '\\\\)', 'gi'), 'Lafinger'],
          [new RegExp('\\\\u9006\\\\u795e\\\\uff08' + sourceName + '\\\\uff09', 'gi'), 'Lafinger'],
          [new RegExp('\\\\u9006\\\\u795e\\\\s*\\\\|\\\\s*' + 'LOSER' + 'GOD', 'g'), 'Lafinger'],
          [/\\u9006\\u795e/g, 'Lafinger'],
          [new RegExp('LOSER' + 'GOD', 'g'), 'Lafinger'],
          [new RegExp('Loser' + 'God', 'g'), 'Lafinger'],
          [new RegExp('\\\\b' + sourceName + '\\\\b', 'gi'), 'Lafinger'],
        ];
        const rewrite = (value) => replacements.reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), value);
        const rewriteText = (value) => {
          if (typeof value === 'string') return rewrite(value);
          if (value instanceof String) return rewrite(value.toString());
          return value;
        };
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
          const prototypes = [
            window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype,
            window.OffscreenCanvasRenderingContext2D && window.OffscreenCanvasRenderingContext2D.prototype,
          ].filter(Boolean);
          prototypes.forEach((prototype) => {
            patchCanvasTextMethod(prototype, 'fillText');
            patchCanvasTextMethod(prototype, 'strokeText');
            patchCanvasTextMethod(prototype, 'measureText');
          });
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

  if (text.includes(marker)) {
    return text.replace(/    <script id="lafinger-brand-guard">[\s\S]*?<\/script>\r?\n?/, script);
  }

  return text.replace('</head>', `${script}</head>`);
}

const textExtensions = new Set(['.html', '.js', '.css', '.json', '.svg']);
let changed = 0;

for await (const filePath of walkFiles(publicDir)) {
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
    continue;
  }

  const originalText = await readFile(filePath, 'utf8');
  const patchedText = applyLocalCacheBusting(filePath, applyVisibleBranding(originalText));
  if (patchedText !== originalText) {
    await writeFile(filePath, patchedText, 'utf8');
    changed += 1;
  }
}

console.log(`localized ${changed} public text assets`);
