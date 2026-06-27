import { mkdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(rootDir, '.losergod-cache', 'ashare');
const eastmoneyKlineOrigin = 'https://push2his.eastmoney.com';
const eastmoneyQuoteOrigin = 'https://80.push2.eastmoney.com';
const eastmoneySearchOrigin = 'https://searchapi.eastmoney.com';
const eastmoneyToken = 'D43BF722C8E33BD2E445C8B9AC57C2E9';
const cacheTtlMs = 12 * 60 * 60 * 1000;
const userAgent = 'Mozilla/5.0 LoserGodLocalClone/1.0';

const defaultStocks = [
  { code: '000001.SZ', name: '平安银行', quoteId: '0.000001' },
  { code: '600519.SH', name: '贵州茅台', quoteId: '1.600519' },
  { code: '600000.SH', name: '浦发银行', quoteId: '1.600000' },
  { code: '000002.SZ', name: '万科A', quoteId: '0.000002' },
  { code: '600036.SH', name: '招商银行', quoteId: '1.600036' },
  { code: '000858.SZ', name: '五粮液', quoteId: '0.000858' },
  { code: '601318.SH', name: '中国平安', quoteId: '1.601318' },
];

const defaultEtfs = [
  { code: '510300.SH', name: '沪深300ETF', quoteId: '1.510300' },
  { code: '510050.SH', name: '上证50ETF', quoteId: '1.510050' },
  { code: '159915.SZ', name: '创业板ETF', quoteId: '0.159915' },
];

const defaultIndices = [
  { code: '000001.SH', name: '上证指数', quoteId: '1.000001' },
  { code: '000300.SH', name: '沪深300', quoteId: '1.000300' },
  { code: '399001.SZ', name: '深证成指', quoteId: '0.399001' },
  { code: '399006.SZ', name: '创业板指', quoteId: '0.399006' },
];

function cachePath(cacheKey) {
  const hash = crypto.createHash('sha1').update(cacheKey).digest('hex');
  return path.join(cacheDir, `${hash}.json`);
}

async function readCache(cacheKey, allowExpired = false) {
  try {
    const text = await readFile(cachePath(cacheKey), 'utf8');
    const record = JSON.parse(text);
    if (!record.savedAt || !record.payload) {
      return null;
    }

    if (!allowExpired && Date.now() - record.savedAt > cacheTtlMs) {
      return null;
    }

    return record.payload;
  } catch {
    return null;
  }
}

async function writeCache(cacheKey, payload) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath(cacheKey), JSON.stringify({ savedAt: Date.now(), payload }));
}

async function fetchJsonWithCache(url, cacheKey) {
  const freshCache = await readCache(cacheKey);
  if (freshCache) {
    return freshCache;
  }

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': userAgent,
        referer: 'https://quote.eastmoney.com/',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    await writeCache(cacheKey, payload);
    return payload;
  } catch (error) {
    const staleCache = await readCache(cacheKey, true);
    if (staleCache) {
      return staleCache;
    }

    throw error;
  }
}

function normalizeSymbol(rawCode = '', fallbackKind = 'stock') {
  const value = String(rawCode || '').trim();
  if (!value || value.toLowerCase() === 'random') {
    return getDefaultAsset(fallbackKind).code;
  }

  const withoutPrefix = value
    .replace(/^sh/i, '')
    .replace(/^sz/i, '')
    .replace(/^bj/i, '')
    .replace(/^(0|1)\./, '');
  const match = withoutPrefix.match(/(\d{6})(?:\.(SH|SZ|BJ))?/i);
  if (!match) {
    return getDefaultAsset(fallbackKind).code;
  }

  const code = match[1];
  const suffix = match[2]?.toUpperCase() || inferSuffix(code);
  return `${code}.${suffix}`;
}

function inferSuffix(code) {
  if (/^(5|6|9)/.test(code)) {
    return 'SH';
  }

  if (/^(4|8)/.test(code)) {
    return 'BJ';
  }

  return 'SZ';
}

function getDefaultAsset(kind = 'stock') {
  if (kind === 'etf') {
    return defaultEtfs[0];
  }

  if (kind === 'index') {
    return defaultIndices[0];
  }

  return defaultStocks[0];
}

function marketIdFromSymbol(symbol) {
  if (symbol.endsWith('.SH')) {
    return '1';
  }

  return '0';
}

function quoteIdFromSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  return `${marketIdFromSymbol(normalized)}.${normalized.slice(0, 6)}`;
}

function codeFromQuoteId(quoteId, name = '') {
  const [market, code] = String(quoteId || '').split('.');
  const suffix = market === '1' ? 'SH' : 'SZ';
  return {
    code: `${code}.${suffix}`,
    name,
    quoteId,
  };
}

function adjustFlag() {
  const adjust = (process.env.ASHARE_ADJUST || 'qfq').toLowerCase();
  if (['none', 'raw', '0'].includes(adjust)) {
    return '0';
  }

  if (['hfq', '2'].includes(adjust)) {
    return '2';
  }

  return '1';
}

function compactDate(value, fallback) {
  const text = String(value || '').replaceAll('-', '');
  return /^\d{8}$/.test(text) ? text : fallback;
}

function normalizeKlineRow(rowText) {
  const [
    date,
    open,
    close,
    high,
    low,
    volume,
    amount,
    amplitude,
    changePercent,
    changeAmount,
    turnoverRate,
  ] = rowText.split(',');
  const timestamp = new Date(`${date}T00:00:00+08:00`).getTime();

  return {
    date,
    time: timestamp,
    timestamp: date,
    time_str: date,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    vol: Number(volume),
    amount: Number(amount),
    turnover: Number(amount),
    amplitude: Number(amplitude),
    change_percent: Number(changePercent),
    change_pct: Number(changePercent),
    change_amount: Number(changeAmount),
    turnover_rate: Number(turnoverRate),
  };
}

function assetFromRequest({ body = {}, searchParams = new URLSearchParams(), kind = 'stock' } = {}) {
  const candidates = [
    body.stock_code,
    body.stockCode,
    body.symbol,
    body.code,
    body.asset_code,
    body.index_code,
    body.etf_code,
    searchParams.get('stock_code'),
    searchParams.get('stockCode'),
    searchParams.get('symbol'),
    searchParams.get('code'),
    searchParams.get('asset_code'),
    searchParams.get('index_code'),
    searchParams.get('etf_code'),
  ].filter(Boolean);

  const symbol = normalizeSymbol(candidates[0], kind);
  const defaults = kind === 'etf' ? defaultEtfs : kind === 'index' ? defaultIndices : defaultStocks;
  const known = defaults.find((item) => item.code === symbol);

  return known || {
    code: symbol,
    name: symbol,
    quoteId: quoteIdFromSymbol(symbol),
  };
}

export function getDefaultIndexRows() {
  return defaultIndices.map((item) => ({
    index_code: item.code,
    index_name: item.name,
    code: item.code,
    name: item.name,
  }));
}

export async function getAshareKlines({
  code,
  kind = 'stock',
  begin = '19900101',
  end = '20500101',
  klt = '101',
  fqt = adjustFlag(),
} = {}) {
  const asset = assetFromRequest({ body: { code }, kind });
  const secid = asset.quoteId || quoteIdFromSymbol(asset.code);
  const url = new URL('/api/qt/stock/kline/get', eastmoneyKlineOrigin);
  url.searchParams.set('secid', secid);
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
  url.searchParams.set('klt', klt);
  url.searchParams.set('fqt', fqt);
  url.searchParams.set('beg', compactDate(begin, '19900101'));
  url.searchParams.set('end', compactDate(end, '20500101'));
  url.searchParams.set('lmt', '1000000');

  const payload = await fetchJsonWithCache(url.toString(), `eastmoney:kline:${url.search}`);
  const klines = payload?.data?.klines;
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error(`东方财富没有返回历史行情: ${asset.code}`);
  }

  const rows = klines.map(normalizeKlineRow);
  const name = payload.data.name || asset.name || asset.code;

  return {
    asset: {
      code: asset.code,
      name,
      quoteId: secid,
      kind,
    },
    rows,
    metadata: {
      source: 'eastmoney_push2his',
      source_name: '东方财富 Push2His',
      quote_id: secid,
      adjusted: fqt === '1' ? 'qfq' : fqt === '2' ? 'hfq' : 'none',
      period: klt === '101' ? 'day' : klt,
      first_date: rows[0].date,
      last_date: rows[rows.length - 1].date,
      total_rows: rows.length,
      fetched_at: new Date().toISOString(),
    },
  };
}

export async function buildAshareTrainingPayload({ body = {}, searchParams = new URLSearchParams(), kind = 'stock' } = {}) {
  const asset = assetFromRequest({ body, searchParams, kind });
  const begin = body.begin || body.start || body.start_date || searchParams.get('begin') || searchParams.get('start_date') || '19900101';
  const end = body.end || body.end_date || searchParams.get('end') || searchParams.get('end_date') || '20500101';
  const observeCount = Number(body.observe_days || body.observe_bars || searchParams.get('observe_days') || searchParams.get('observe_bars') || 200);
  const trainCount = Number(body.train_days || body.train_bars || searchParams.get('train_days') || searchParams.get('train_bars') || 100);
  const { asset: resolvedAsset, rows, metadata } = await getAshareKlines({ code: asset.code, kind, begin, end });
  const segmentSize = Math.min(rows.length, Math.max(1, observeCount + trainCount));
  const segment = rows.slice(-segmentSize);
  const observeData = segment.slice(0, Math.min(observeCount, segment.length));
  const trainData = segment.slice(observeData.length);
  const stockInfo = {
    code: resolvedAsset.code,
    name: resolvedAsset.name,
    stock_code: resolvedAsset.code,
    stock_name: resolvedAsset.name,
  };

  return {
    success: true,
    source: metadata.source,
    data_source: metadata.source_name,
    metadata,
    data: rows,
    stock_data: rows,
    stockData: rows,
    kline_data: rows,
    current_stock: stockInfo,
    stock: stockInfo,
    stock_info: stockInfo,
    code: stockInfo.code,
    name: stockInfo.name,
    stock_code: stockInfo.stock_code,
    stock_name: stockInfo.stock_name,
    observe_data: observeData,
    train_data: trainData,
    initial_funds: Number(body.amount || body.initial_funds || searchParams.get('amount') || 100000),
    amount: Number(body.amount || searchParams.get('amount') || 100000),
    observe_days: observeData.length,
    train_days: trainData.length,
    observe_bars: observeData.length,
    train_bars: trainData.length,
    period: 'day',
    start_index: observeData.length,
    end_index: observeData.length + trainData.length,
  };
}

export async function searchAshareAssets(keyword = '', kind = 'stock', limit = 10) {
  const input = String(keyword || '').trim();
  if (!input) {
    const list = await getAshareMarketList(kind, limit);
    return list.slice(0, limit);
  }

  const url = new URL('/api/suggest/get', eastmoneySearchOrigin);
  url.searchParams.set('input', input);
  url.searchParams.set('type', '14');
  url.searchParams.set('token', eastmoneyToken);
  url.searchParams.set('count', String(limit));

  const payload = await fetchJsonWithCache(url.toString(), `eastmoney:search:${kind}:${input}:${limit}`);
  const items = payload?.QuotationCodeTable?.Data || [];
  return items
    .filter((item) => {
      if (kind === 'etf') {
        return /ETF|基金/.test(item.SecurityTypeName || item.Name || '');
      }

      if (kind === 'index') {
        return /指数/.test(item.SecurityTypeName || item.Name || '');
      }

      return item.Classify === 'AStock' || /[AB]股|沪A|深A|京A/.test(item.SecurityTypeName || '');
    })
    .map((item) => {
      const asset = codeFromQuoteId(item.QuoteID || `${item.MktNum}.${item.Code}`, item.Name);
      return {
        code: asset.code,
        name: asset.name,
        stock_code: asset.code,
        stock_name: asset.name,
        etf_code: asset.code,
        etf_name: asset.name,
        asset_type: kind,
        quote_id: asset.quoteId,
      };
    })
    .slice(0, limit);
}

export async function getAshareMarketList(kind = 'stock', limit = 20) {
  const fs = kind === 'etf'
    ? 'b:MK0021,b:MK0022,b:MK0023,b:MK0024'
    : 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
  const url = new URL('/api/qt/clist/get', eastmoneyQuoteOrigin);
  url.searchParams.set('pn', '1');
  url.searchParams.set('pz', String(limit));
  url.searchParams.set('po', '1');
  url.searchParams.set('np', '1');
  url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('invt', '2');
  url.searchParams.set('fid', 'f3');
  url.searchParams.set('fs', fs);
  url.searchParams.set('fields', 'f12,f13,f14,f2,f3,f4,f5,f6');

  const payload = await fetchJsonWithCache(url.toString(), `eastmoney:clist:${kind}:${limit}`);
  const items = payload?.data?.diff || [];
  return items.map((item) => {
    const suffix = String(item.f13) === '1' ? 'SH' : 'SZ';
    const code = `${item.f12}.${suffix}`;
    return {
      code,
      name: item.f14,
      stock_code: code,
      stock_name: item.f14,
      etf_code: code,
      etf_name: item.f14,
      latest_price: Number(item.f2),
      change_percent: Number(item.f3),
      change_amount: Number(item.f4),
      volume: Number(item.f5),
      amount: Number(item.f6),
      asset_type: kind,
      quote_id: `${item.f13}.${item.f12}`,
    };
  });
}

export async function buildCompareKlineRows(body = {}) {
  const requested = [
    ...(Array.isArray(body.codes) ? body.codes : []),
    ...(Array.isArray(body.symbols) ? body.symbols : []),
    ...(Array.isArray(body.assets) ? body.assets.map((asset) => asset.code || asset.symbol || asset.stock_code) : []),
  ].filter(Boolean);
  const codes = requested.length > 0 ? requested : ['000001.SH', '000300.SH'];
  const rows = [];

  for (const code of codes.slice(0, 8)) {
    const { asset, rows: klines, metadata } = await getAshareKlines({ code, kind: code.startsWith('399') || code.startsWith('000') && code.endsWith('.SH') ? 'index' : 'stock' });
    rows.push({
      code: asset.code,
      name: asset.name,
      klines,
      metadata,
    });
  }

  return rows;
}

export async function buildOverlayData({ code = '000001.SH', kind = 'index' } = {}) {
  const { rows, metadata } = await getAshareKlines({ code, kind });
  const recentRows = rows.slice(-240);
  return {
    metadata,
    klines: recentRows,
    signals: recentRows
      .filter((_, index) => index % 60 === 0)
      .map((row, index) => ({
        date: row.date,
        signal: index % 2 === 0 ? 'buy' : 'sell',
        value: index % 2 === 0 ? 1 : -1,
      })),
  };
}

export async function buildFearGreedData() {
  const { rows, metadata } = await getAshareKlines({ code: '000001.SH', kind: 'index' });
  const items = rows.slice(-240).map((row) => ({
    date: row.date,
    value: Math.max(0, Math.min(100, Math.round(50 + row.change_percent * 8))),
    close: row.close,
    change_percent: row.change_percent,
  }));

  return {
    code: '000001.SH',
    name: '上证指数情绪代理',
    metadata,
    items,
  };
}

export async function buildSimpleStrategyResult(body = {}) {
  const code = body.code || body.stock_code || body.symbol || '000001.SZ';
  const { rows, metadata } = await getAshareKlines({ code, kind: 'stock' });
  const recentRows = rows.slice(-260);
  const equityCurve = recentRows.map((row, index) => ({
    date: row.date,
    value: Number((1 + (row.close - recentRows[0].close) / recentRows[0].close).toFixed(4)),
    close: row.close,
    index,
  }));

  return {
    trades: [],
    equity_curve: equityCurve,
    total_return: Number((equityCurve[equityCurve.length - 1].value - 1).toFixed(4)),
    max_drawdown: 0,
    metadata,
  };
}
