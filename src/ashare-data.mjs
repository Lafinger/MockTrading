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

const stockTypeFallbacks = {
  60: [
    { code: '600000.SH', name: '浦发银行', quoteId: '1.600000' },
    { code: '600036.SH', name: '招商银行', quoteId: '1.600036' },
    { code: '600519.SH', name: '贵州茅台', quoteId: '1.600519' },
    { code: '601318.SH', name: '中国平安', quoteId: '1.601318' },
  ],
  '00': [
    { code: '000001.SZ', name: '平安银行', quoteId: '0.000001' },
    { code: '000002.SZ', name: '万科A', quoteId: '0.000002' },
    { code: '000858.SZ', name: '五粮液', quoteId: '0.000858' },
  ],
  30: [
    { code: '300059.SZ', name: '东方财富', quoteId: '0.300059' },
    { code: '300750.SZ', name: '宁德时代', quoteId: '0.300750' },
  ],
  68: [
    { code: '688981.SH', name: '中芯国际', quoteId: '1.688981' },
    { code: '688599.SH', name: '天合光能', quoteId: '1.688599' },
  ],
  92: [
    { code: '920002.BJ', name: '万达轴承', quoteId: '0.920002' },
    { code: '920116.BJ', name: '星图测控', quoteId: '0.920116' },
  ],
};

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

function normalizeStockType(value = '') {
  const text = String(value || '').trim();
  if (text === 'random') {
    return 'random';
  }

  if (['60', '00', '30', '68', '92'].includes(text)) {
    return text;
  }

  return '';
}

function stockTypeFs(stockType) {
  const normalized = normalizeStockType(stockType);
  if (normalized === '60') {
    return 'm:1+t:2,m:1+t:23';
  }

  if (normalized === '00') {
    return 'm:0+t:6';
  }

  if (normalized === '30') {
    return 'm:0+t:80';
  }

  if (normalized === '68') {
    return 'm:1+t:23';
  }

  if (normalized === '92') {
    return 'm:0+t:81';
  }

  return 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81';
}

function codeMatchesStockType(code = '', stockType = '') {
  const normalized = normalizeStockType(stockType);
  if (!normalized || normalized === 'random') {
    return true;
  }

  return String(code).startsWith(normalized);
}

function pickRandomItem(items = []) {
  return items[Math.floor(Math.random() * items.length)];
}

async function resolveRandomStockByType(stockType = '') {
  const normalized = normalizeStockType(stockType);
  const fallbackPool = normalized && normalized !== 'random'
    ? stockTypeFallbacks[normalized] || defaultStocks
    : Object.values(stockTypeFallbacks).flat();

  try {
    const list = await getAshareMarketList('stock', 200, stockTypeFs(normalized));
    const candidates = list.filter((item) => codeMatchesStockType(item.code, normalized));
    if (candidates.length > 0) {
      return pickRandomItem(candidates);
    }
  } catch {
    // Use the local fallback pool when the market list endpoint is unavailable.
  }

  return pickRandomItem(fallbackPool);
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
  const begin = body.begin || body.start || body.start_date || searchParams.get('begin') || searchParams.get('start_date') || '19900101';
  const end = body.end || body.end_date || searchParams.get('end') || searchParams.get('end_date') || '20500101';
  const observeCount = Number(body.observe_days || body.observe_bars || searchParams.get('observe_days') || searchParams.get('observe_bars') || 200);
  const trainCount = Number(body.train_days || body.train_bars || searchParams.get('train_days') || searchParams.get('train_bars') || 100);
  const explicitCode = body.stock_code || body.stockCode || body.symbol || body.code || body.asset_code ||
    searchParams.get('stock_code') || searchParams.get('stockCode') || searchParams.get('symbol') ||
    searchParams.get('code') || searchParams.get('asset_code');
  const isSeniorParamsRequest = String(body.mode || searchParams.get('mode') || '') === 'senior_pk' && !explicitCode;
  const stockType = body.stock_type || body.stockType || searchParams.get('stock_type') || searchParams.get('stockType');
  const asset = isSeniorParamsRequest && kind === 'stock'
    ? await resolveRandomStockByType(stockType)
    : assetFromRequest({ body, searchParams, kind });
  const { asset: resolvedAsset, rows, metadata } = await getAshareKlines({ code: asset.code, kind, begin, end });
  const stockInfo = {
    code: resolvedAsset.code,
    name: resolvedAsset.name,
    stock_code: resolvedAsset.code,
    stock_name: resolvedAsset.name,
  };
  const rowsWithStockInfo = rows.map((row) => ({
    ...row,
    stock_code: stockInfo.stock_code,
    stock_name: stockInfo.stock_name,
  }));
  const segmentSize = Math.min(rowsWithStockInfo.length, Math.max(1, observeCount + trainCount));
  const segment = rowsWithStockInfo.slice(-segmentSize);
  const observeData = segment.slice(0, Math.min(observeCount, segment.length));
  const trainData = segment.slice(observeData.length);
  const responseRows = isSeniorParamsRequest ? segment : rowsWithStockInfo;

  return {
    success: true,
    source: metadata.source,
    data_source: metadata.source_name,
    metadata,
    data: responseRows,
    stock_data: responseRows,
    stockData: responseRows,
    kline_data: responseRows,
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

export async function getAshareMarketList(kind = 'stock', limit = 20, fsOverride = '') {
  const fs = fsOverride || (kind === 'etf'
    ? 'b:MK0021,b:MK0022,b:MK0023,b:MK0024'
    : 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23');
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

function rowsFromStrategyBody(body = {}) {
  const directRows = [
    body.data,
    body.stock_data,
    body.stockData,
    body.kline_data,
    body.klines,
    body.rows,
  ].find((items) => Array.isArray(items) && items.length > 0);

  if (directRows) {
    return directRows;
  }

  if (Array.isArray(body.observe_data) || Array.isArray(body.train_data)) {
    return [
      ...(Array.isArray(body.observe_data) ? body.observe_data : []),
      ...(Array.isArray(body.train_data) ? body.train_data : []),
    ];
  }

  return [];
}

function normalizeStrategyRows(rows = []) {
  return rows
    .map((row, index) => ({
      ...row,
      close: Number(row.close),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      volume: Number(row.volume ?? row.vol ?? 0),
      date: row.date || row.timestamp || row.time_str || String(index + 1),
      strategyIndex: Number.isInteger(row.index) ? row.index : index,
    }))
    .filter((row) => Number.isFinite(row.close));
}

function normalizeWindow(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
}

function normalizePositionPercent(positionParams = {}) {
  const rawRatio = positionParams.ratio ?? positionParams.position ?? positionParams.position_ratio ??
    positionParams.max_ratio ?? positionParams.min_ratio ?? 0.5;
  const ratio = Number(rawRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 50;
  }

  return Math.max(1, Math.min(100, ratio <= 1 ? ratio * 100 : ratio));
}

function averageClose(rows, endIndex, window) {
  const startIndex = endIndex - window + 1;
  if (startIndex < 0) {
    return null;
  }

  let total = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    total += rows[index].close;
  }

  return total / window;
}

function createSignal(row, type, strategy, positionPercent) {
  return {
    index: row.strategyIndex,
    type,
    signal: type,
    strategy,
    position: positionPercent,
    position_ratio: positionPercent,
    price: row.close,
    date: row.date,
    timestamp: row.timestamp || row.date,
  };
}

function buildMaCrossSignals(rows, signalParams, strategy, positionPercent) {
  let shortWindow = normalizeWindow(signalParams.short_window ?? signalParams.short_period ?? signalParams.fast_period, 5);
  let longWindow = normalizeWindow(signalParams.long_window ?? signalParams.long_period ?? signalParams.slow_period, 20);

  if (shortWindow >= longWindow) {
    [shortWindow, longWindow] = [Math.max(1, Math.min(shortWindow, longWindow - 1)), Math.max(shortWindow + 1, longWindow)];
  }

  const signals = [];
  for (let index = longWindow; index < rows.length; index += 1) {
    const previousShort = averageClose(rows, index - 1, shortWindow);
    const previousLong = averageClose(rows, index - 1, longWindow);
    const currentShort = averageClose(rows, index, shortWindow);
    const currentLong = averageClose(rows, index, longWindow);
    if ([previousShort, previousLong, currentShort, currentLong].some((value) => value === null)) {
      continue;
    }

    if (previousShort <= previousLong && currentShort > currentLong) {
      signals.push(createSignal(rows[index], 'buy', strategy, positionPercent));
    } else if (previousShort >= previousLong && currentShort < currentLong) {
      signals.push(createSignal(rows[index], 'sell', strategy, positionPercent));
    }
  }

  return signals;
}

function buildBreakoutSignals(rows, signalParams, strategy, positionPercent) {
  const lookback = normalizeWindow(signalParams.lookback ?? signalParams.window ?? signalParams.period, 20);
  const signals = [];

  for (let index = lookback; index < rows.length; index += 1) {
    const previousRows = rows.slice(index - lookback, index);
    const highestClose = Math.max(...previousRows.map((row) => row.close));
    const lowestClose = Math.min(...previousRows.map((row) => row.close));
    if (rows[index].close > highestClose) {
      signals.push(createSignal(rows[index], 'buy', strategy, positionPercent));
    } else if (rows[index].close < lowestClose) {
      signals.push(createSignal(rows[index], 'sell', strategy, positionPercent));
    }
  }

  return signals;
}

function buildFallbackSignals(rows, body, strategy, positionPercent) {
  if (rows.length === 0) {
    return [];
  }

  const requestedStart = normalizeWindow(body.current_index ?? body.start_index ?? body.observe_days ?? body.observe_bars, Math.floor(rows.length * 0.67));
  const buyIndex = Math.min(rows.length - 1, Math.max(1, requestedStart + 1));
  const sellIndex = Math.min(rows.length - 1, Math.max(buyIndex, buyIndex + Math.floor((rows.length - buyIndex) / 2)));
  const signals = [createSignal(rows[buyIndex], 'buy', strategy, positionPercent)];

  if (sellIndex > buyIndex) {
    signals.push(createSignal(rows[sellIndex], 'sell', strategy, positionPercent));
  }

  return signals;
}

function buildStrategySignals(rows, body = {}) {
  const signalParams = body.signal_params || body.parameters || {};
  const positionPercent = normalizePositionPercent(body.position_params || {});
  const strategy = body.signal_type || body.strategy_type || body.strategy || 'ma_cross';
  const rawSignals = strategy === 'breakout'
    ? buildBreakoutSignals(rows, signalParams, strategy, positionPercent)
    : buildMaCrossSignals(rows, signalParams, strategy, positionPercent);
  const trainStart = normalizeWindow(body.current_index ?? body.start_index ?? body.observe_days ?? body.observe_bars, Math.floor(rows.length * 0.67));
  const trainSignals = rawSignals.filter((signal) => signal.index > trainStart);
  const signals = trainSignals.length > 0 ? trainSignals : rawSignals;

  return (signals.length > 0 ? signals : buildFallbackSignals(rows, body, strategy, positionPercent)).slice(0, 80);
}

export async function buildSimpleStrategyResult(body = {}) {
  const code = body.code || body.stock_code || body.symbol || '000001.SZ';
  const providedRows = normalizeStrategyRows(rowsFromStrategyBody(body));
  const marketData = providedRows.length > 0
    ? { rows: providedRows, metadata: body.metadata || { source: 'request_kline_data' } }
    : await getAshareKlines({ code, kind: 'stock' });
  const recentRows = marketData.rows.slice(-Math.min(260, marketData.rows.length));
  const equityCurve = recentRows.map((row, index) => ({
    date: row.date,
    value: Number((1 + (row.close - recentRows[0].close) / (recentRows[0].close || 1)).toFixed(4)),
    close: row.close,
    index,
  }));
  const signals = buildStrategySignals(marketData.rows, body);

  return {
    signals,
    trades: [],
    equity_curve: equityCurve,
    total_return: Number((equityCurve[equityCurve.length - 1].value - 1).toFixed(4)),
    max_drawdown: 0,
    metadata: marketData.metadata,
  };
}
