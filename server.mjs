import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');
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

function getIndexRows() {
  return [
    { index_code: '000001.SH', index_name: '上证指数', code: '000001.SH', name: '上证指数' },
    { index_code: '000300.SH', index_name: '沪深300', code: '000300.SH', name: '沪深300' },
    { index_code: '399001.SZ', index_name: '深证成指', code: '399001.SZ', name: '深证成指' },
    { index_code: '399006.SZ', index_name: '创业板指', code: '399006.SZ', name: '创业板指' },
    { index_code: 'IXIC', index_name: '纳斯达克综合指数', code: 'IXIC', name: '纳斯达克综合指数' },
  ];
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

function getTrainingPayload(kind = 'stock') {
  const rows = getMarketRows(320, kind === 'etf' ? 3.8 : 108);
  const observeData = rows.slice(0, 200);
  const trainData = rows.slice(200, 300);
  const stockInfo = {
    code: kind === 'etf' ? '510300.SH' : '600519.SH',
    name: kind === 'etf' ? '沪深300ETF' : '贵州茅台',
    stock_code: kind === 'etf' ? '510300.SH' : '600519.SH',
    stock_name: kind === 'etf' ? '沪深300ETF' : '贵州茅台',
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
    metadata: { period: 'day', source: 'local mock' },
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
    sendJson(res, 200, {
      success: true,
      data: {
        records: [
          { id: 1, created_at: '2026-06-01', final_assets: 106800, total_profit_rate: 6.8, mode: 'stock' },
          { id: 2, created_at: '2026-06-10', final_assets: 112400, total_profit_rate: 12.4, mode: 'stock' },
          { id: 3, created_at: '2026-06-20', final_assets: 153500, total_profit_rate: 53.5, mode: 'stock' },
        ],
        total: 3,
      },
      records: [],
      total: 3,
    });
    return true;
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
    sendJson(res, 200, {
      success: true,
      data: [
        { stock_code: '600519.SH', stock_name: '贵州茅台' },
        { stock_code: '000001.SZ', stock_name: '平安银行' },
      ],
    });
    return true;
  }

  if (pathname === '/api/search/etfs') {
    sendJson(res, 200, {
      success: true,
      data: [
        { etf_code: '510300.SH', etf_name: '沪深300ETF' },
        { etf_code: '159915.SZ', etf_name: '创业板ETF' },
      ],
    });
    return true;
  }

  if (pathname === '/api/stock_feature_types/feature_types') {
    sendJson(res, 200, { success: true, data: getFeatureTypes() });
    return true;
  }

  if (
    pathname === '/api/random_data' ||
    pathname === '/api/futures/random_data' ||
    pathname === '/api/etf/random_data' ||
    pathname === '/api/options/random_data' ||
    pathname === '/api/simulated_range/stock' ||
    pathname === '/api/simulated_range/etf' ||
    pathname === '/api/data/historical_range'
  ) {
    const kind = pathname.includes('/etf') ? 'etf' : 'stock';
    sendJson(res, 200, getTrainingPayload(kind));
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
    sendJson(res, 200, { success: true, data: getMarketRows(240, 3.5) });
    return true;
  }

  if (pathname === '/api/quant_index/overlay_data') {
    sendJson(res, 200, {
      success: true,
      data: [
        { date: '2026-06-01', signal: 'buy', value: 1 },
        { date: '2026-06-18', signal: 'sell', value: -1 },
      ],
      signals: [],
    });
    return true;
  }

  if (pathname === '/api/index_signals/super_index' || pathname === '/api/index_signals/fear_greed_index') {
    sendJson(res, 200, {
      success: true,
      data: {
        code: 'SUPER_INDEX',
        name: '逆神恐惧贪婪指数',
        items: [
          { date: '2026-06-24', value: 42 },
          { date: '2026-06-25', value: 48 },
          { date: '2026-06-26', value: 55 },
          { date: '2026-06-27', value: 59 },
        ],
      },
    });
    return true;
  }

  if (pathname === '/api/stock-selection/search') {
    sendJson(res, 200, {
      success: true,
      data: {
        results: [
          { stock_code: '600519.SH', stock_name: '贵州茅台', score: 91, reason: '趋势强、量价配合' },
          { stock_code: '000001.SZ', stock_name: '平安银行', score: 84, reason: '低位放量' },
        ],
      },
      results: [
        { stock_code: '600519.SH', stock_name: '贵州茅台', score: 91, reason: '趋势强、量价配合' },
        { stock_code: '000001.SZ', stock_name: '平安银行', score: 84, reason: '低位放量' },
      ],
    });
    return true;
  }

  if (pathname === '/api/compare/kline/batch') {
    sendJson(res, 200, {
      success: true,
      data: [
        { code: '000001.SH', name: '上证指数', klines: getMarketRows(120, 3100) },
        { code: '000300.SH', name: '沪深300', klines: getMarketRows(120, 3600) },
      ],
    });
    return true;
  }

  if (pathname === '/api/run_strategy') {
    sendJson(res, 200, {
      success: true,
      data: {
        trades: [],
        equity_curve: getMarketRows(80, 1).map((row, index) => ({ date: row.date, value: Number((1 + index * 0.004).toFixed(4)) })),
        total_return: 0.328,
        max_drawdown: 0.084,
      },
    });
    return true;
  }

  if (pathname === '/api/strategy_statistics/all_strategies' || pathname === '/api/training-pk-sessions') {
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

    await handleMockApi(req, res, requestUrl);
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

