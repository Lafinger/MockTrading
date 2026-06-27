import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAshareTrainingPayload,
  buildCompareKlineRows,
  buildFearGreedData,
  buildOverlayData,
  buildSimpleStrategyResult,
  getAshareMarketList,
  getDefaultIndexRows,
  searchAshareAssets,
} from './src/ashare-data.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');
const cacheDir = path.join(rootDir, '.losergod-cache');
const trainingStorePath = path.join(cacheDir, 'training-records.json');
const port = Number(process.env.PORT || 5173);
const apiMode = process.env.LOSERGOD_API || 'mock';
const upstreamOrigin = 'https://www.losergod.com';
const sessions = new Map();

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function createUserProfile(phone = '13800138000') {
  return {
    _id: 'local-user-001',
    user_id: 'local-user-001',
    public_id: 'LG-LOCAL-001',
    phone,
    username: '本地用户',
    userName: '本地用户',
    total_capital: 153500,
    available_capital: 125000,
    stock_market_value: 28500,
    level: '韭菜根',
    training_count: 36,
    training_win_rate: 58.3,
    training_all_history_count: 36,
    training_count_pk: 8,
    training_count_senior_pk: 4,
    future_count: 3,
    futures_win_rate: 66.7,
    points: 2000,
    reset_num: 1,
    losergod_times: 2,
    last_reset_date: '2026-06-27',
    pk_win_rate: 55.5,
    senior_pk_win_rate: 50,
    total_win_count: 21,
    training_profit_count: 19,
    training_profit_rate: 52.8,
    pvp_match_count: 8,
    pvp_win_rate: 55.5,
    guess_next_match_count: 12,
    guess_next_win_count: 7,
    guess_next_win_rate: 58.3,
    vip_expire: '2099-12-31T23:59:59+08:00',
    vip_product_id: 'vip-local',
    vip_total_spent: 0,
    vip_status: 'active',
    user_source: 'local-clone',
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (body.length === 0) {
    return {};
  }

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return {};
  }
}

function getSessionProfile(req) {
  const authorization = req.headers.authorization || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  return sessions.get(token) || createUserProfile();
}

function getVipStatus(profile = createUserProfile()) {
  return {
    is_vip: true,
    status: 'active',
    vip_status: 'active',
    vip_expire: profile.vip_expire,
    vip_product_id: profile.vip_product_id,
    product_id: profile.vip_product_id,
  };
}

function getPortfolioRows() {
  return [
    {
      portfolio_id: 'local-alpha',
      name: '稳健复利组合',
      username: '本地用户',
      net_value: 2.1688,
      return_1d: 0.0124,
      return_1m: 0.1862,
      max_drawdown: 0.085,
      sharpe_ratio: 2.42,
      profit_rate: 1.1688,
      total_assets: 21688000,
      available_cash: 5800000,
      current_cash: 5800000,
      daily_profit_rate: 0.0124,
      positions: [{ stock_code: '000001.SH', quantity: 10000 }],
      created_at: '2026-06-01T09:30:00+08:00',
      updated_at: '2026-06-27T15:00:00+08:00',
    },
    {
      portfolio_id: 'local-beta',
      name: '趋势突破组合',
      username: '逆神训练员',
      net_value: 1.7562,
      return_1d: -0.0035,
      return_1m: 0.1108,
      max_drawdown: 0.122,
      sharpe_ratio: 1.86,
      profit_rate: 0.7562,
      total_assets: 17562000,
      available_cash: 4200000,
      current_cash: 4200000,
      daily_profit_rate: -0.0035,
      positions: [{ stock_code: '000300.SH', quantity: 8000 }],
      created_at: '2026-05-18T09:30:00+08:00',
      updated_at: '2026-06-27T15:00:00+08:00',
    },
    {
      portfolio_id: 'local-gamma',
      name: '低回撤组合',
      username: '模拟交易者',
      net_value: 1.4296,
      return_1d: 0.0048,
      return_1m: 0.0792,
      max_drawdown: 0.057,
      sharpe_ratio: 1.55,
      profit_rate: 0.4296,
      total_assets: 14296000,
      available_cash: 7600000,
      current_cash: 7600000,
      daily_profit_rate: 0.0048,
      positions: [{ stock_code: '399006.SZ', quantity: 6000 }],
      created_at: '2026-04-20T09:30:00+08:00',
      updated_at: '2026-06-27T15:00:00+08:00',
    },
  ];
}

function getSeedTrainingRecords() {
  return [
    createTrainingRecord({
      record_id: 'local-seed-training-001',
      id: 'local-seed-training-001',
      phone: '13800138000',
      stock_code: '000001.SZ',
      stock_name: '平安银行',
      start_time: '2026-01-02',
      end_time: '2026-05-29',
      created_at: '2026-06-01T10:00:00+08:00',
      initial_capital: 100000,
      final_capital: 106800,
      total_profit: 6800,
      stock_range_profit_rate: 0.0412,
      operation_profit_rate: 0.068,
      excess_profit_rate: 0.0268,
      strategy_total_profit: 5200,
      strategy_profit_rate: 0.052,
      mode: 'stock',
      trade_datas: [],
      strategy_trades: [],
    }),
    createTrainingRecord({
      record_id: 'local-seed-training-002',
      id: 'local-seed-training-002',
      phone: '13800138000',
      stock_code: '600000.SH',
      stock_name: '浦发银行',
      start_time: '2026-02-03',
      end_time: '2026-06-12',
      created_at: '2026-06-10T10:00:00+08:00',
      initial_capital: 100000,
      final_capital: 112400,
      total_profit: 12400,
      stock_range_profit_rate: 0.086,
      operation_profit_rate: 0.124,
      excess_profit_rate: 0.038,
      strategy_total_profit: 9800,
      strategy_profit_rate: 0.098,
      mode: 'stock',
      trade_datas: [],
      strategy_trades: [],
    }),
    createTrainingRecord({
      record_id: 'local-seed-training-003',
      id: 'local-seed-training-003',
      phone: '13800138000',
      stock_code: '600519.SH',
      stock_name: '贵州茅台',
      start_time: '2026-03-02',
      end_time: '2026-06-26',
      created_at: '2026-06-20T10:00:00+08:00',
      initial_capital: 100000,
      final_capital: 153500,
      total_profit: 53500,
      stock_range_profit_rate: 0.432,
      operation_profit_rate: 0.535,
      excess_profit_rate: 0.103,
      strategy_total_profit: 41800,
      strategy_profit_rate: 0.418,
      mode: 'stock',
      trade_datas: [],
      strategy_trades: [],
    }),
  ];
}

async function readTrainingStore() {
  try {
    const text = await readFile(trainingStorePath, 'utf8');
    const store = JSON.parse(text);
    return {
      records: Array.isArray(store.records) ? store.records : [],
      sessions: store.sessions && typeof store.sessions === 'object' ? store.sessions : {},
      klineData: store.klineData && typeof store.klineData === 'object' ? store.klineData : {},
    };
  } catch {
    return { records: [], sessions: {}, klineData: {} };
  }
}

async function writeTrainingStore(store) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(trainingStorePath, JSON.stringify(store, null, 2), 'utf8');
}

function numberOr(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function stringOr(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function createRecordId(prefix = 'local-training') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTradeItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const tradeType = item.trade_type || (String(item.type || '').includes('sell') ? 'sell' : 'buy');
    const price = numberOr(item.price, 0);
    const amount = numberOr(item.amount, item.quantity || 0);
    return {
      ...item,
      trade_type: tradeType,
      price,
      amount,
      total: numberOr(item.total ?? item.total_amount, price * amount),
      total_amount: numberOr(item.total_amount ?? item.total, price * amount),
      kline_index: numberOr(item.kline_index ?? item.index ?? item.time, index),
      profit: numberOr(item.profit, 0),
      commission: numberOr(item.commission, 0),
    };
  });
}

function firstKlineTimestamp(rows = []) {
  const row = rows.find((item) => item?.timestamp || item?.date || item?.trade_date || item?.time_str);
  return String(row?.timestamp || row?.date || row?.trade_date || row?.time_str || '');
}

function lastKlineTimestamp(rows = []) {
  const row = [...rows].reverse().find((item) => item?.timestamp || item?.date || item?.trade_date || item?.time_str);
  return String(row?.timestamp || row?.date || row?.trade_date || row?.time_str || '');
}

function normalizeKlineRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    ...row,
    index: row.index ?? index + 1,
    time: row.time ?? index + 1,
    open: numberOr(row.open, row.close),
    high: numberOr(row.high, row.close),
    low: numberOr(row.low, row.close),
    close: numberOr(row.close, row.open),
    volume: numberOr(row.volume ?? row.vol, 0),
    timestamp: String(row.timestamp || row.date || row.trade_date || row.time_str || index + 1),
  }));
}

function createTrainingRecord(rawRecord = {}, session = {}) {
  const now = new Date().toISOString();
  const klineRows = normalizeKlineRows(rawRecord.kline_data || rawRecord.full_kline_data || session.kline_data || []);
  const recordId = stringOr(rawRecord.record_id || rawRecord.id || rawRecord._id, createRecordId());
  const initialCapital = numberOr(rawRecord.initial_capital ?? rawRecord.initial_funds ?? rawRecord.initialAmount, 100000);
  const totalProfit = numberOr(rawRecord.total_profit, numberOr(rawRecord.final_capital ?? rawRecord.final_assets, initialCapital) - initialCapital);
  const finalCapital = numberOr(rawRecord.final_capital ?? rawRecord.final_assets, initialCapital + totalProfit);
  const operationProfitRate = numberOr(rawRecord.operation_profit_rate ?? rawRecord.total_profit_rate, initialCapital ? totalProfit / initialCapital : 0);
  const stockRangeProfitRate = numberOr(rawRecord.stock_range_profit_rate, 0);
  const excessProfitRate = numberOr(rawRecord.excess_profit_rate, operationProfitRate - stockRangeProfitRate);
  const strategyTotalProfit = numberOr(rawRecord.strategy_total_profit, 0);
  const strategyProfitRate = numberOr(rawRecord.strategy_profit_rate, initialCapital ? strategyTotalProfit / initialCapital : 0);
  const phone = stringOr(rawRecord.phone || session.phone, '13800138000');
  const stockCode = stringOr(rawRecord.stock_code || rawRecord.code || session.stock_code, '000001.SZ');
  const stockName = stringOr(rawRecord.stock_name || rawRecord.name || session.stock_name, stockCode);
  const startTime = stringOr(rawRecord.start_time, firstKlineTimestamp(klineRows) || '2026-01-02');
  const endTime = stringOr(rawRecord.end_time, lastKlineTimestamp(klineRows) || now);
  const rawMode = stringOr(rawRecord.mode || rawRecord.index_mode || session.mode, 'stock');
  const mode = rawMode === 'Full_Position_Training_pk' ? 'full_position' : rawMode;
  const tradeDatas = normalizeTradeItems(rawRecord.trade_datas || rawRecord.trade_data || rawRecord.trades || session.trade_history || []);
  const strategyTrades = normalizeTradeItems(rawRecord.strategy_trades || rawRecord.strategyTrades || []);
  const sessionKey = stringOr(rawRecord.sessionKey || rawRecord.session_key || session.session_code || session.sessionCode, recordId);

  return {
    ...rawRecord,
    id: recordId,
    _id: recordId,
    record_id: recordId,
    phone,
    user_id: stringOr(rawRecord.user_id || rawRecord.userId, phone),
    stock_code: stockCode,
    stock_name: stockName,
    start_time: startTime,
    end_time: endTime,
    created_at: stringOr(rawRecord.created_at || rawRecord.create_time, now),
    updated_at: now,
    initial_capital: initialCapital,
    final_capital: finalCapital,
    final_assets: finalCapital,
    total_profit: totalProfit,
    stock_range_profit_rate: stockRangeProfitRate,
    operation_profit_rate: operationProfitRate,
    total_profit_rate: operationProfitRate,
    excess_profit_rate: excessProfitRate,
    strategy_total_profit: strategyTotalProfit,
    strategy_profit_rate: strategyProfitRate,
    strategy_trade_times: numberOr(rawRecord.strategy_trade_times, strategyTrades.length),
    user_trade_times: numberOr(rawRecord.user_trade_times, tradeDatas.length),
    trade_times: numberOr(rawRecord.trade_times, tradeDatas.length),
    observe_bars: numberOr(rawRecord.observe_bars ?? rawRecord.observe_days, 200),
    train_bars: numberOr(rawRecord.train_bars ?? rawRecord.train_days, 100),
    mode,
    period: stringOr(rawRecord.period, 'day'),
    pk_result: stringOr(rawRecord.pk_result, '平'),
    position_strategy: stringOr(rawRecord.position_strategy, rawRecord.strategy_name || '固定仓位'),
    signals_strategy: stringOr(rawRecord.signals_strategy, rawRecord.strategy_type || '均线金叉'),
    strategy_name: stringOr(rawRecord.strategy_name, rawRecord.position_strategy || '固定仓位'),
    strategy_type: stringOr(rawRecord.strategy_type, rawRecord.signals_strategy || '均线金叉'),
    source_mode: stringOr(rawRecord.source_mode, rawMode),
    trade_datas: tradeDatas,
    strategy_trades: strategyTrades,
    sessionKey,
    session_key: sessionKey,
  };
}

function createKlineLookbackData(record, rawRecord = {}, session = {}) {
  const rows = normalizeKlineRows(
    rawRecord.kline_data ||
    rawRecord.full_kline_data ||
    rawRecord.stock_data ||
    rawRecord.stockData ||
    session.kline_data ||
    [],
  );
  const observeBars = numberOr(record.observe_bars, 200);
  const trainBars = numberOr(record.train_bars, Math.max(0, rows.length - observeBars));

  return {
    record_id: record.record_id,
    stock_code: record.stock_code,
    stock_name: record.stock_name,
    start_time: record.start_time,
    end_time: record.end_time,
    observe_bars: observeBars,
    train_bars: trainBars,
    total_bars: rows.length || observeBars + trainBars,
    period: record.period || 'day',
    full_kline_data: rows,
    kline_data: rows,
  };
}

async function saveTrainingRecord(rawRecord = {}, session = {}) {
  const store = await readTrainingStore();
  const record = createTrainingRecord(rawRecord, session);
  const klineData = createKlineLookbackData(record, rawRecord, session);
  const existingIndex = store.records.findIndex((item) => (
    item.record_id === record.record_id ||
    item.session_key && item.session_key === record.session_key
  ));

  if (existingIndex >= 0) {
    store.records[existingIndex] = { ...store.records[existingIndex], ...record };
  } else {
    store.records.unshift(record);
  }

  store.klineData[record.record_id] = klineData;
  await writeTrainingStore(store);
  return { record, klineData, store };
}

function getTrainingModeAliases(mode) {
  const aliases = new Set([mode]);
  if (mode === 'Full_Position_Training_pk' || mode === 'full_position' || mode === 'full-position') {
    aliases.add('Full_Position_Training_pk');
    aliases.add('full_position');
    aliases.add('full-position');
  }

  return aliases;
}

function filterTrainingRecords(records, requestUrl) {
  const phone = requestUrl.searchParams.get('phone') || requestUrl.searchParams.get('user_id') || '';
  const modes = (requestUrl.searchParams.get('modes') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const afterTime = requestUrl.searchParams.get('after_time') || '';

  return records.filter((record) => {
    if (phone && record.phone !== phone && record.user_id !== phone) {
      return false;
    }

    const recordModes = getTrainingModeAliases(record.mode);
    if (modes.length > 0 && !modes.some((mode) => recordModes.has(mode))) {
      return false;
    }

    if (afterTime && String(record.created_at) <= afterTime) {
      return false;
    }

    return true;
  });
}

async function getAllTrainingRecords() {
  const store = await readTrainingStore();
  const recordsById = new Map();
  for (const record of [...store.records, ...getSeedTrainingRecords()]) {
    recordsById.set(record.record_id || record.id, createTrainingRecord(record));
  }

  return Array.from(recordsById.values()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function handleTrainingRecordsApi(req, res, requestUrl) {
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const rawRecord = body.training_record || body.record || body;
    const { record } = await saveTrainingRecord(rawRecord);
    sendJson(res, 200, {
      success: true,
      message: '训练记录保存成功',
      data: record,
      record,
      record_id: record.record_id,
      id: record.id,
    });
    return true;
  }

  const page = Math.max(1, numberOr(requestUrl.searchParams.get('page'), 1));
  const pageSize = Math.max(1, numberOr(requestUrl.searchParams.get('pageSize') || requestUrl.searchParams.get('limit'), 20));
  const records = filterTrainingRecords(await getAllTrainingRecords(), requestUrl);
  const start = (page - 1) * pageSize;
  const pageRecords = records.slice(start, start + pageSize);

  sendJson(res, 200, {
    success: true,
    data: {
      records: pageRecords,
      total: records.length,
      page,
      pageSize,
      filter_info: {
        returned: pageRecords.length,
        total: records.length,
      },
    },
    records: pageRecords,
    total: records.length,
  });
  return true;
}

async function handleTrainingPkSessionsApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;
  const store = await readTrainingStore();

  if (pathname === '/api/training-pk-sessions/check' || pathname === '/api/training-pk-sessions/check-latest-index') {
    const phone = requestUrl.searchParams.get('phone') || '13800138000';
    const latestSession = Object.values(store.sessions)
      .filter((session) => session.phone === phone && session.status !== 'completed')
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] || null;
    sendJson(res, 200, {
      success: true,
      has_unfinished: Boolean(latestSession),
      has_session: Boolean(latestSession),
      latest_index: latestSession?.latest_index ?? latestSession?.operations?.length ?? 0,
      session_code: latestSession?.session_code || null,
      sessionCode: latestSession?.session_code || null,
      data: latestSession,
      session: latestSession,
    });
    return true;
  }

  if (pathname === '/api/training-pk-sessions' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const sessionCode = createRecordId('local-pk-session');
    const now = new Date().toISOString();
    const session = {
      session_code: sessionCode,
      sessionCode,
      phone: stringOr(body.phone, '13800138000'),
      stock_code: stringOr(body.stock_code || body.code, '000001.SZ'),
      stock_name: stringOr(body.stock_name || body.name, body.stock_code || '000001.SZ'),
      mode: stringOr(body.mode, 'Full_Position_Training_pk'),
      status: 'active',
      operations: [],
      trade_history: [],
      kline_data: [],
      latest_index: 0,
      created_at: now,
      updated_at: now,
    };
    store.sessions[sessionCode] = session;
    await writeTrainingStore(store);
    sendJson(res, 200, {
      success: true,
      message: '会话创建成功',
      data: session,
      session,
      session_code: sessionCode,
      sessionCode,
    });
    return true;
  }

  if (pathname === '/api/training-pk-sessions' && req.method === 'GET') {
    const sessionsList = Object.values(store.sessions);
    sendJson(res, 200, { success: true, data: sessionsList, list: sessionsList, total: sessionsList.length });
    return true;
  }

  const match = pathname.match(/^\/api\/training-pk-sessions\/([^/]+)(?:\/(complete))?$/);
  if (!match) {
    return false;
  }

  const sessionCode = decodeURIComponent(match[1]);
  const action = match[2] || '';
  const session = store.sessions[sessionCode] || {
    session_code: sessionCode,
    sessionCode: sessionCode,
    phone: requestUrl.searchParams.get('phone') || '13800138000',
    stock_code: '000001.SZ',
    stock_name: '000001.SZ',
    mode: 'Full_Position_Training_pk',
    status: 'active',
    operations: [],
    trade_history: [],
    kline_data: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (req.method === 'GET') {
    sendJson(res, 200, { success: true, data: session, session });
    return true;
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req);
    const updatedSession = {
      ...session,
      phone: stringOr(body.phone || session.phone, '13800138000'),
      operations: Array.isArray(body.operations) ? body.operations : session.operations,
      trade_history: Array.isArray(body.trade_history) ? body.trade_history : session.trade_history,
      kline_data: Array.isArray(body.kline_data) ? body.kline_data : session.kline_data,
      latest_index: numberOr(body.current_index ?? body.latest_index, session.latest_index || 0),
      updated_at: new Date().toISOString(),
    };
    store.sessions[sessionCode] = updatedSession;
    await writeTrainingStore(store);
    sendJson(res, 200, { success: true, message: '会话更新成功', data: updatedSession, session: updatedSession });
    return true;
  }

  if (req.method === 'POST' && action === 'complete') {
    const body = await readJsonBody(req);
    const rawRecord = body.training_record || body.record || {};
    const completedSession = {
      ...session,
      phone: stringOr(body.phone || rawRecord.phone || session.phone, '13800138000'),
      status: 'completed',
      updated_at: new Date().toISOString(),
    };
    const recordInput = {
      ...rawRecord,
      phone: completedSession.phone,
      stock_code: rawRecord.stock_code || completedSession.stock_code,
      stock_name: rawRecord.stock_name || completedSession.stock_name,
      kline_data: rawRecord.kline_data || completedSession.kline_data,
      trade_datas: rawRecord.trade_datas || completedSession.trade_history,
      session_key: sessionCode,
      sessionKey: sessionCode,
    };
    const { record, klineData } = await saveTrainingRecord(recordInput, completedSession);
    completedSession.record_id = record.record_id;
    completedSession.kline_data = klineData.full_kline_data;
    store.sessions[sessionCode] = completedSession;
    store.klineData[record.record_id] = klineData;
    const recordIndex = store.records.findIndex((item) => item.record_id === record.record_id);
    if (recordIndex >= 0) {
      store.records[recordIndex] = record;
    } else {
      store.records.unshift(record);
    }
    await writeTrainingStore(store);
    sendJson(res, 200, {
      success: true,
      message: 'PK记录保存成功',
      data: record,
      record,
      record_id: record.record_id,
      session_code: sessionCode,
    });
    return true;
  }

  return false;
}

async function handleLookbackApi(req, res, requestUrl) {
  const recordMatch = requestUrl.pathname.match(/^\/api\/lookback\/training-record\/([^/]+)$/);
  const klineMatch = requestUrl.pathname.match(/^\/api\/lookback\/kline-data\/([^/]+)$/);
  if (!recordMatch && !klineMatch) {
    return false;
  }

  const recordId = decodeURIComponent((recordMatch || klineMatch)[1]);
  const store = await readTrainingStore();
  const record = [...store.records, ...getSeedTrainingRecords()].find((item) => item.record_id === recordId || item.id === recordId);

  if (!record) {
    sendJson(res, 404, { success: false, message: '训练记录不存在' });
    return true;
  }

  if (recordMatch) {
    sendJson(res, 200, { success: true, data: createTrainingRecord(record) });
    return true;
  }

  sendJson(res, 200, {
    success: true,
    data: store.klineData[record.record_id] || createKlineLookbackData(createTrainingRecord(record), record),
  });
  return true;
}

function getIndexRows() {
  return getDefaultIndexRows();
}

function getStrategyDescriptions() {
  const signal = [
    {
      type: 'ma_cross',
      name: '均线金叉',
      description: '短期均线上穿长期均线时买入',
      default_params: { short_window: 5, long_window: 20 },
      param_ranges: {
        short_window: { min: 3, max: 20, step: 1 },
        long_window: { min: 10, max: 120, step: 1 },
      },
    },
    {
      type: 'breakout',
      name: '趋势突破',
      description: '价格突破阶段高点时买入',
      default_params: { lookback: 20 },
      param_ranges: {
        lookback: { min: 10, max: 120, step: 1 },
      },
    },
  ];
  const position = [
    {
      type: 'fixed',
      name: '固定仓位',
      description: '每次使用固定比例仓位',
      default_params: { ratio: 0.5 },
      param_ranges: {
        ratio: { min: 0.1, max: 1, step: 0.1 },
      },
    },
    {
      type: 'dynamic',
      name: '动态仓位',
      description: '按信号强度动态调整仓位',
      default_params: { min_ratio: 0.2, max_ratio: 0.8 },
      param_ranges: {
        min_ratio: { min: 0.1, max: 0.5, step: 0.1 },
        max_ratio: { min: 0.5, max: 1, step: 0.1 },
      },
    },
  ];
  const signals = Object.fromEntries(signal.map((item) => [item.type, item]));
  const positions = Object.fromEntries(position.map((item) => [item.type, item]));

  return {
    signal,
    position,
    signals,
    positions,
    strategies: [...signal, ...position],
  };
}

function getMarketRows(count = 260, basePrice = 100) {
  const start = Date.UTC(2025, 0, 2);
  const dayMs = 24 * 60 * 60 * 1000;

  return Array.from({ length: count }, (_, index) => {
    const time = start + index * dayMs;
    const trend = index * 0.035;
    const wave = Math.sin(index / 6) * 2.4;
    const open = basePrice + trend + wave;
    const close = open + Math.sin(index / 3) * 1.2;
    const high = Math.max(open, close) + 1.4;
    const low = Math.min(open, close) - 1.2;
    const volume = 800000 + index * 3500;

    return {
      date: new Date(time).toISOString().slice(0, 10),
      time,
      timestamp: time,
      time_str: new Date(time).toLocaleString('zh-CN', { hour12: false }),
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      change_amount: Number((close - open).toFixed(4)),
      change_percent: Number((((close - open) / open) * 100).toFixed(4)),
      change_pct: Number((((close - open) / open) * 100).toFixed(4)),
      turnover_rate: Number((1.2 + (index % 20) * 0.08).toFixed(4)),
      amplitude: Number((((high - low) / low) * 100).toFixed(4)),
      volume,
      vol: volume,
      amount: Number((volume * close).toFixed(2)),
      turnover: Number((volume * close).toFixed(2)),
    };
  });
}

function getSyntheticFuturesPayload() {
  const rows = getMarketRows(320, 3650);
  const observeData = rows.slice(0, 200);
  const trainData = rows.slice(200, 300);
  const stockInfo = {
    code: 'SHFE_rb9999',
    name: '螺纹钢主连',
    stock_code: 'SHFE_rb9999',
    stock_name: '螺纹钢主连',
  };

  return {
    success: true,
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
    initial_funds: 100000,
    amount: 100000,
    observe_days: 200,
    train_days: 100,
    observe_bars: 200,
    train_bars: 100,
    period: 'day',
    metadata: { period: 'day', source: 'synthetic futures mock' },
    start_index: 200,
    end_index: 300,
  };
}

function getFeatureTypes() {
  return [
    { type: 'first_limit_up', name: '首次涨停', description: '首次涨停后的走势训练' },
    { type: 'first_limit_down', name: '首次跌停', description: '首次跌停后的走势训练' },
    { type: 'break_ma20', name: '突破20日均线', description: '股价突破20日均线后的走势训练' },
  ];
}

function getAiDepths() {
  return [
    { level: 1, name: '快速分析', points_cost: 50, estimated_time: 120, description: '覆盖趋势、成交量和关键价位' },
    { level: 2, name: '标准分析', points_cost: 100, estimated_time: 300, description: '增加技术指标、风险位和仓位建议' },
    { level: 3, name: '深度分析', points_cost: 200, estimated_time: 600, description: '加入多周期共振和策略推演' },
  ];
}

function getVirtualCoins() {
  return [
    {
      symbol: 'LGD/USDT',
      coin_symbol: 'LGD',
      base_symbol: 'USDT',
      name: '逆神币',
      init_price: 12.35,
      base_scale: 4,
      min_volume: 1,
      balance: 0,
      frozen_balance: 0,
      ticker: { open: 12.1, close: 12.35, high: 12.88, low: 11.96, chg: 0.0207, volume: 128800, turnover: 1590680 },
    },
    {
      symbol: 'MOCK/USDT',
      coin_symbol: 'MOCK',
      base_symbol: 'USDT',
      name: '模拟股份',
      init_price: 5.68,
      base_scale: 4,
      min_volume: 1,
      balance: 0,
      frozen_balance: 0,
      ticker: { open: 5.72, close: 5.68, high: 5.91, low: 5.51, chg: -0.007, volume: 98600, turnover: 560048 },
    },
  ];
}

function normalizeVirtualSymbol(rawSymbol = 'LGD-USDT') {
  return decodeURIComponent(rawSymbol).replace('-', '/').toUpperCase();
}

function findVirtualCoin(rawSymbol) {
  const symbol = normalizeVirtualSymbol(rawSymbol);
  return getVirtualCoins().find((coin) => coin.symbol === symbol) || getVirtualCoins()[0];
}

function getVirtualTrades(symbol = 'LGD/USDT', count = 30) {
  const coin = findVirtualCoin(symbol);
  const price = coin.ticker.close;

  return Array.from({ length: count }, (_, index) => {
    const direction = index % 2 === 0 ? 'BUY' : 'SELL';
    const amount = Number((10 + index * 0.8).toFixed(4));
    const tradePrice = Number((price + Math.sin(index / 3) * 0.08).toFixed(4));

    return {
      _id: `local-trade-${index + 1}`,
      trade_id: `local-trade-${index + 1}`,
      symbol: coin.symbol,
      direction,
      price: tradePrice,
      amount,
      turnover: Number((tradePrice * amount).toFixed(2)),
      time: new Date(Date.now() - index * 60000).toISOString(),
      created_at: new Date(Date.now() - index * 60000).toISOString(),
    };
  });
}

function getVirtualOrders(symbol = 'LGD/USDT') {
  const coin = findVirtualCoin(symbol);

  return [
    {
      order_id: 'LOCAL-VX-ORDER-001',
      symbol: coin.symbol,
      direction: 'BUY',
      type: 'LIMIT',
      price: coin.ticker.close,
      amount: 20,
      traded_amount: 0,
      status: 'TRADING',
      time: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ];
}

function getVirtualWallets() {
  const lgd = getVirtualCoins()[0];
  return {
    wallets: [
      { coin_symbol: 'USDT', balance: 50000, frozen_balance: 0 },
      { coin_symbol: 'LGD', balance: 120, frozen_balance: 5 },
      { coin_symbol: 'MOCK', balance: 300, frozen_balance: 0 },
    ],
    total_usdt: Number((50000 + 125 * lgd.ticker.close + 300 * getVirtualCoins()[1].ticker.close).toFixed(2)),
  };
}

async function handleMockApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
    });
    res.end();
    return true;
  }

  if (pathname === '/api/auth/login' || pathname === '/api/auth/register') {
    const body = await readJsonBody(req);
    const phone = body.phone || '13800138000';
    const token = `local-token-${phone}-${Date.now()}`;
    const profile = createUserProfile(phone);
    sessions.set(token, profile);
    sendJson(res, 200, {
      success: true,
      message: pathname.endsWith('/register') ? '注册成功' : '登录成功',
      token,
      user_info: profile,
      data: { token, user_info: profile },
    });
    return true;
  }

  if (pathname === '/api/auth/profile') {
    const profile = getSessionProfile(req);
    sendJson(res, 200, { success: true, data: profile });
    return true;
  }

  if (pathname === '/api/auth/logout') {
    sendJson(res, 200, { success: true, message: '退出成功' });
    return true;
  }

  if (pathname === '/api/auth/send-code') {
    sendJson(res, 200, { success: true, message: '验证码已发送', code: '123456' });
    return true;
  }

  if (pathname === '/api/auth/reset-password') {
    sendJson(res, 200, { success: true, message: '密码重置成功' });
    return true;
  }

  if (pathname === '/api/auth/reset-capital') {
    sendJson(res, 200, {
      success: true,
      message: '重置成功',
      data: { is_vip: true, points_used: 0, total_capital: 100000 },
    });
    return true;
  }

  if (pathname === '/api/payment/user/vip_status') {
    sendJson(res, 200, { success: true, data: getVipStatus(getSessionProfile(req)) });
    return true;
  }

  if (pathname === '/api/payment/products') {
    sendJson(res, 200, {
      success: true,
      data: [
        { id: 'vip-1day', title: '注册免费1天VIP', description: '新用户体验', price: 0, original_price: 9.9, days: 1, is_free: true, status: 'active', icon: 'gift', popular: false },
        { id: 'vip-30days', title: '30天VIP', description: '月度VIP会员', price: 30, original_price: 30, days: 30, is_free: false, status: 'active', icon: 'star', popular: true },
      ],
    });
    return true;
  }

  if (pathname === '/api/payment/user/orders' || pathname === '/api/payment/user/payment_records') {
    sendJson(res, 200, {
      success: true,
      data: {
        records: [
          {
            order_id: 'LOCAL-ORDER-001',
            paid_at: '2026-06-27T10:18:00+08:00',
            created_at: '2026-06-27T10:16:00+08:00',
            product_info: { title: '30天VIP', icon: 'VIP' },
            product_price: 30,
            cash_amount: 30,
            points_used: 0,
            points_discount: 0,
            final_amount: 30,
            payment_type: 'wechat',
            status: 'completed',
            phone: getSessionProfile(req).phone,
          },
        ],
        pagination: { total: 1, page: 1, limit: 10 },
      },
      records: [
        {
          order_id: 'LOCAL-ORDER-001',
          paid_at: '2026-06-27T10:18:00+08:00',
          created_at: '2026-06-27T10:16:00+08:00',
          product_info: { title: '30天VIP', icon: 'VIP' },
          product_price: 30,
          cash_amount: 30,
          points_used: 0,
          points_discount: 0,
          final_amount: 30,
          payment_type: 'wechat',
          status: 'completed',
          phone: getSessionProfile(req).phone,
        },
      ],
      pagination: { total: 1, page: 1, limit: 10 },
    });
    return true;
  }

  if (pathname.startsWith('/api/points/') || pathname.startsWith('/api/user/points/') || pathname.startsWith('/api/users/points/')) {
    if (pathname.includes('/history')) {
      sendJson(res, 200, {
        success: true,
        history: [
          {
            timestamp: '2026-06-27T10:18:00+08:00',
            transaction_type: 'vip_purchase',
            points_changed: 200,
            current_total_points: 2000,
            description: '本地复刻积分记录',
          },
        ],
        total_records: 1,
        current_page: 1,
        data: { history: [], total_records: 0, current_page: 1 },
      });
      return true;
    }

    sendJson(res, 200, {
      success: true,
      current_points: 2000,
      points: 2000,
      balance: 2000,
      data: { current_points: 2000, points: 2000, balance: 2000 },
    });
    return true;
  }

  if (pathname === '/api/notifications/unread-count') {
    sendJson(res, 200, { success: true, unread_count: 0, data: { unread_count: 0 } });
    return true;
  }

  if (pathname === '/api/notifications/list' || pathname === '/api/notifications/admin/list') {
    sendJson(res, 200, { success: true, list: [], total: 0, data: { list: [], total: 0 } });
    return true;
  }

  if (pathname === '/api/training-records') {
    return handleTrainingRecordsApi(req, res, requestUrl);
  }

  if (pathname.startsWith('/api/training-pk-sessions')) {
    return handleTrainingPkSessionsApi(req, res, requestUrl);
  }

  if (pathname.startsWith('/api/lookback/')) {
    return handleLookbackApi(req, res, requestUrl);
  }

  if (pathname === '/api/users/leaderboard') {
    sendJson(res, 200, {
      success: true,
      data: [
        { user_id: 'local-user-001', username: '本地用户', phone: '13800138000', total_capital: 153500, training_all_history_count: 36, level: '韭菜根', losergod_times: 2, training_count_pk: 8, pk_win_rate: 55.5 },
        { user_id: 'local-user-002', username: '逆神训练员', phone: '13800138001', total_capital: 126800, training_all_history_count: 58, level: '牛散', losergod_times: 4, training_count_pk: 12, pk_win_rate: 61.2 },
        { user_id: 'local-user-003', username: '模拟交易者', phone: '13800138002', total_capital: 113200, training_all_history_count: 42, level: '韭菜花', losergod_times: 1, training_count_pk: 6, pk_win_rate: 50 },
      ],
      total: 3,
    });
    return true;
  }

  if (pathname === '/api/portfolio/leaderboard') {
    const rows = getPortfolioRows();
    sendJson(res, 200, {
      success: true,
      data: rows,
      total: rows.length,
    });
    return true;
  }

  if (pathname === '/api/portfolio/my') {
    sendJson(res, 200, { success: true, data: getPortfolioRows().slice(0, 1), total: 1 });
    return true;
  }

  if (/^\/api\/portfolio\/[^/]+\/net-value-history$/.test(pathname)) {
    sendJson(res, 200, {
      success: true,
      data: [
        { date: '2026-06-01', net_value: 1.88 },
        { date: '2026-06-07', net_value: 1.96 },
        { date: '2026-06-14', net_value: 2.04 },
        { date: '2026-06-21', net_value: 2.1 },
        { date: '2026-06-27', net_value: 2.1688 },
      ],
    });
    return true;
  }

  if (pathname === '/api/indexs/list' || pathname === '/api/quant_index/index_list') {
    sendJson(res, 200, { success: true, data: getIndexRows(), total: getIndexRows().length });
    return true;
  }

  if (pathname === '/api/search/stocks') {
    const keyword = requestUrl.searchParams.get('keyword') || requestUrl.searchParams.get('q') || requestUrl.searchParams.get('query') || requestUrl.searchParams.get('search') || requestUrl.searchParams.get('input') || '';
    const rows = await searchAshareAssets(keyword, 'stock', 20);
    sendJson(res, 200, {
      success: true,
      data: rows,
    });
    return true;
  }

  if (pathname === '/api/search/etfs') {
    const keyword = requestUrl.searchParams.get('keyword') || requestUrl.searchParams.get('q') || requestUrl.searchParams.get('query') || requestUrl.searchParams.get('search') || requestUrl.searchParams.get('input') || '';
    const rows = await searchAshareAssets(keyword, 'etf', 20);
    sendJson(res, 200, {
      success: true,
      data: rows,
    });
    return true;
  }

  if (pathname === '/api/stock_feature_types/feature_types') {
    sendJson(res, 200, { success: true, data: getFeatureTypes() });
    return true;
  }

  if (pathname === '/api/random_data' || pathname === '/api/simulated_range/stock' || pathname === '/api/data/historical_range') {
    const body = await readJsonBody(req);
    const payload = await buildAshareTrainingPayload({ body, searchParams: requestUrl.searchParams, kind: 'stock' });
    sendJson(res, 200, payload);
    return true;
  }

  if (pathname === '/api/etf/random_data' || pathname === '/api/options/random_data' || pathname === '/api/simulated_range/etf') {
    const body = await readJsonBody(req);
    const payload = await buildAshareTrainingPayload({ body, searchParams: requestUrl.searchParams, kind: 'etf' });
    sendJson(res, 200, payload);
    return true;
  }

  if (pathname === '/api/futures/random_data') {
    sendJson(res, 200, getSyntheticFuturesPayload());
    return true;
  }

  if (pathname === '/api/futures/list') {
    sendJson(res, 200, {
      success: true,
      data: [
        { futures_code: 'SHFE_rb9999', futures_name: '螺纹钢主连', code: 'SHFE_rb9999', name: '螺纹钢主连', exchange: 'SHFE' },
        { futures_code: 'SHFE_au9999', futures_name: '沪金主连', code: 'SHFE_au9999', name: '沪金主连', exchange: 'SHFE' },
        { futures_code: 'DCE_m9999', futures_name: '豆粕主连', code: 'DCE_m9999', name: '豆粕主连', exchange: 'DCE' },
      ],
    });
    return true;
  }

  if (pathname === '/api/options/etf/index_kline') {
    const payload = await buildAshareTrainingPayload({ searchParams: requestUrl.searchParams, kind: 'etf' });
    sendJson(res, 200, { success: true, data: payload.data, metadata: payload.metadata });
    return true;
  }

  if (pathname === '/api/quant_index/overlay_data') {
    const code = requestUrl.searchParams.get('code') || requestUrl.searchParams.get('index_code') || '000001.SH';
    const overlay = await buildOverlayData({ code, kind: 'index' });
    sendJson(res, 200, {
      success: true,
      data: overlay,
      klines: overlay.klines,
      signals: overlay.signals,
      metadata: overlay.metadata,
    });
    return true;
  }

  if (pathname === '/api/index_signals/super_index' || pathname === '/api/index_signals/fear_greed_index') {
    const fearGreed = await buildFearGreedData();
    sendJson(res, 200, {
      success: true,
      data: fearGreed,
      items: fearGreed.items,
    });
    return true;
  }

  if (pathname === '/api/stock-selection/search') {
    const rows = await getAshareMarketList('stock', 50);
    sendJson(res, 200, {
      success: true,
      data: {
        results: rows.map((row) => ({
          ...row,
          score: Number((50 + Math.max(-10, Math.min(10, row.change_percent || 0)) * 4).toFixed(2)),
          reason: `东方财富实时榜单，涨跌幅 ${row.change_percent ?? 0}%`,
        })),
      },
      results: rows,
    });
    return true;
  }

  if (pathname === '/api/compare/kline/batch') {
    const body = await readJsonBody(req);
    const rows = await buildCompareKlineRows(body);
    sendJson(res, 200, {
      success: true,
      data: rows,
    });
    return true;
  }

  if (pathname === '/api/run_strategy') {
    const body = await readJsonBody(req);
    const result = await buildSimpleStrategyResult(body);
    sendJson(res, 200, {
      success: true,
      data: result,
    });
    return true;
  }

  if (pathname === '/api/strategy_statistics/all_strategies') {
    sendJson(res, 200, { success: true, data: [], list: [], total: 0 });
    return true;
  }

  if (pathname === '/api/strategy_descriptions') {
    const descriptions = getStrategyDescriptions();
    sendJson(res, 200, { success: true, ...descriptions, data: descriptions });
    return true;
  }

  if (pathname === '/api/quant_flow/nodes') {
    const nodes = getStrategyDescriptions();
    sendJson(res, 200, { success: true, nodes, data: nodes });
    return true;
  }

  if (pathname === '/api/quant_flow/data/list') {
    sendJson(res, 200, {
      success: true,
      data: getIndexRows().map((row) => ({
        code: row.index_code,
        name: row.index_name,
        type: requestUrl.searchParams.get('type') || 'index',
      })),
      total: getIndexRows().length,
    });
    return true;
  }

  if (pathname === '/api/pattern_search/history') {
    sendJson(res, 200, {
      success: true,
      data: { records: [], pagination: { total: 0, page: 1, pageSize: 20 } },
      records: [],
      pagination: { total: 0, page: 1, pageSize: 20 },
    });
    return true;
  }

  if (pathname === '/api/pattern_search/search') {
    sendJson(res, 200, {
      success: true,
      data: {
        results: [],
        search_time_ms: 120,
      },
      results: [],
      search_time_ms: 120,
    });
    return true;
  }

  if (pathname === '/api/my_favorites_stocks') {
    sendJson(res, 200, {
      success: true,
      data: {
        index: [{ code: '000001.SH', name: '上证指数', asset_type: 'index' }],
        etf: [{ code: '510300.SH', name: '沪深300ETF', asset_type: 'etf' }],
        stock: [{ code: '600519.SH', name: '贵州茅台', asset_type: 'stock' }],
      },
    });
    return true;
  }

  if (
    pathname === '/api/my_favorites_stocks/tags' ||
    pathname === '/api/my_favorites_stocks/update' ||
    pathname === '/api/my_favorites_stocks/batch' ||
    pathname === '/api/my_favorites_stocks/clear' ||
    pathname.startsWith('/api/my_favorites_stocks/check/') ||
    pathname.startsWith('/api/my_favorites_stocks/')
  ) {
    sendJson(res, 200, { success: true, data: ['价值投资', '蓝筹股'], favorited: true, message: 'local mock api' });
    return true;
  }

  if (pathname.startsWith('/api/ai-stock-analysis')) {
    const subPath = pathname.slice('/api/ai-stock-analysis'.length) || '/';

    if (subPath === '/depths') {
      sendJson(res, 200, { success: true, data: getAiDepths() });
      return true;
    }

    if (subPath === '/points') {
      sendJson(res, 200, { success: true, data: { points: 2000 }, points: 2000 });
      return true;
    }

    if (subPath === '/history') {
      sendJson(res, 200, {
        success: true,
        data: {
          records: [
            {
              task_id: 'LOCAL-AI-001',
              stock_code: '600519.SH',
              symbol: '600519.SH',
              stock_name: '贵州茅台',
              recommendation: '持有',
              position: '30%',
              current_price: 1688.5,
              target_price: 1780,
              stop_loss: 1580,
              take_profit: 1800,
              depth_label: '标准分析',
              status: 'completed',
              is_read: false,
              created_at: '2026-06-27T09:30:00+08:00',
            },
          ],
          total: 1,
        },
      });
      return true;
    }

    if (subPath === '/analyze') {
      sendJson(res, 200, {
        success: true,
        data: { task_id: `LOCAL-AI-${Date.now()}`, remaining_points: 1900 },
        message: '分析任务已提交',
      });
      return true;
    }

    if (subPath.startsWith('/result/')) {
      sendJson(res, 200, {
        success: true,
        data: {
          task_id: subPath.split('/').pop(),
          stock_code: '600519.SH',
          stock_name: '贵州茅台',
          recommendation: '持有',
          summary: '本地复刻环境提供的模拟 AI 分析报告。',
        },
      });
      return true;
    }

    if (subPath.startsWith('/mark-read/') || subPath === '/mark-all-read') {
      sendJson(res, 200, { success: true, data: { count: 1 } });
      return true;
    }
  }

  if (pathname.startsWith('/api/virtual_exchange')) {
    const subPath = pathname.slice('/api/virtual_exchange'.length) || '/';

    if (subPath === '/coins') {
      sendJson(res, 200, { success: true, data: getVirtualCoins() });
      return true;
    }

    if (subPath.startsWith('/ticker/')) {
      const coin = findVirtualCoin(subPath.split('/').pop());
      sendJson(res, 200, { success: true, data: coin.ticker });
      return true;
    }

    if (subPath.startsWith('/orderbook/')) {
      const coin = findVirtualCoin(subPath.split('/').pop());
      const close = coin.ticker.close;
      sendJson(res, 200, {
        success: true,
        data: {
          asks: Array.from({ length: 10 }, (_, index) => ({ price: Number((close + (index + 1) * 0.03).toFixed(4)), amount: Number((80 - index * 4).toFixed(4)) })),
          bids: Array.from({ length: 10 }, (_, index) => ({ price: Number((close - (index + 1) * 0.03).toFixed(4)), amount: Number((75 - index * 3).toFixed(4)) })),
        },
      });
      return true;
    }

    if (subPath.startsWith('/kline/')) {
      const coin = findVirtualCoin(subPath.split('/').pop());
      sendJson(res, 200, { success: true, data: getMarketRows(300, coin.ticker.close) });
      return true;
    }

    if (subPath.startsWith('/recent-trades/') || subPath.startsWith('/trades/')) {
      const symbol = subPath.split('/').pop();
      sendJson(res, 200, { success: true, data: getVirtualTrades(symbol) });
      return true;
    }

    if (subPath === '/trades/my') {
      sendJson(res, 200, { success: true, data: { trades: getVirtualTrades('LGD/USDT', 5) } });
      return true;
    }

    if (subPath === '/orders/current' || subPath === '/orders/history' || subPath === '/orders/today' || subPath === '/orders/all') {
      sendJson(res, 200, {
        success: true,
        data: { orders: subPath === '/orders/current' || subPath === '/orders/today' ? getVirtualOrders() : [], total: 1 },
      });
      return true;
    }

    if (subPath === '/wallet/balance') {
      sendJson(res, 200, { success: true, data: getVirtualWallets() });
      return true;
    }

    if (subPath === '/wallet/records') {
      sendJson(res, 200, {
        success: true,
        data: {
          records: [
            { _id: 'LOCAL-VX-REC-001', coin_symbol: 'USDT', type: 'recharge', amount: 50000, remark: '本地初始化资产', created_at: '2026-06-27T10:00:00+08:00' },
          ],
        },
      });
      return true;
    }

    if (subPath === '/wallet/recharge' || subPath === '/init') {
      sendJson(res, 200, { success: true, data: getVirtualWallets(), message: '初始化成功' });
      return true;
    }

    if (subPath === '/points/info' || subPath === '/points/balance') {
      sendJson(res, 200, {
        success: true,
        data: { points: 2000, usdt_equivalent: 2000, description: '1 积分 = 1 虚拟资金' },
      });
      return true;
    }

    if (subPath === '/points/calculate') {
      const body = await readJsonBody(req);
      const points = Number(body.points || 0);
      sendJson(res, 200, { success: true, data: { usdt_amount: points, usdt: points } });
      return true;
    }

    if (subPath === '/points/exchange') {
      const body = await readJsonBody(req);
      const points = Number(body.points || 0);
      sendJson(res, 200, { success: true, data: { usdt_amount: points, usdt: points }, message: '兑换成功' });
      return true;
    }

    if (subPath === '/order') {
      const body = await readJsonBody(req);
      sendJson(res, 200, {
        success: true,
        data: { order_id: `LOCAL-VX-ORDER-${Date.now()}`, ...body, status: 'TRADING' },
        message: '下单成功',
      });
      return true;
    }

    if (subPath.startsWith('/cancel/')) {
      sendJson(res, 200, { success: true, message: '撤单成功' });
      return true;
    }

    sendJson(res, 200, {
      success: true,
      data: { list: [], records: [], orders: [], trades: [], total: 0 },
      list: [],
      records: [],
      orders: [],
      trades: [],
      total: 0,
      message: 'local virtual exchange mock api',
    });
    return true;
  }

  if (pathname.includes('/leaderboard')) {
    sendJson(res, 200, { success: true, data: { list: [], total: 0 }, list: [], total: 0 });
    return true;
  }

  if (pathname.includes('/notebook/')) {
    sendJson(res, 200, { success: true, data: { list: [], total: 0 }, message: 'local mock api' });
    return true;
  }

  sendJson(res, 200, {
    code: 200,
    success: true,
    data: {},
    list: [],
    total: 0,
    message: 'local mock api',
    timestamp: Math.floor(Date.now() / 1000),
  });
  return true;
}

async function proxyApi(req, res, requestUrl) {
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRequestBody(req);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  delete headers.origin;
  delete headers.referer;

  const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, upstreamOrigin);
  const response = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = {};
  for (const [key, value] of response.headers.entries()) {
    if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  }

  res.writeHead(response.status, responseHeaders);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

async function resolveFile(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.normalize(path.join(publicDir, relativePath));

  if (!candidate.startsWith(publicDir)) {
    return null;
  }

  try {
    const info = await stat(candidate);
    if (info.isFile()) {
      return candidate;
    }
  } catch {
    return null;
  }

  return null;
}

async function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': mimeTypes.get(ext) || 'application/octet-stream',
    'cache-control': req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/time') {
    sendJson(res, 200, { timestamp: Math.floor(Date.now() / 1000) });
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    if (apiMode === 'proxy') {
      try {
        await proxyApi(req, res, requestUrl);
      } catch (error) {
        sendJson(res, 502, {
          code: 502,
          success: false,
          data: null,
          message: `upstream proxy failed: ${error.message}`,
        });
      }
      return;
    }

    try {
      await handleMockApi(req, res, requestUrl);
    } catch (error) {
      sendJson(res, 502, {
        code: 502,
        success: false,
        data: null,
        message: `real market data fetch failed: ${error.message}`,
      });
    }
    return;
  }

  const filePath = await resolveFile(requestUrl.pathname);
  if (filePath) {
    await sendFile(req, res, filePath);
    return;
  }

  const indexPath = await resolveFile('/');
  if (indexPath && !path.extname(requestUrl.pathname)) {
    await sendFile(req, res, indexPath);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`LoserGod clone running at http://localhost:${port}`);
  console.log(`API mode: ${apiMode}`);
});

