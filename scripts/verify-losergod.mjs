import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const requestedPort = Number(process.env.PORT || 5173);
const port = await findFreePort(requestedPort);
const target = `http://127.0.0.1:${port}/`;

async function findFreePort(startPort) {
  for (let portToTry = startPort; portToTry <= startPort + 50; portToTry += 1) {
    if (await isPortFree(portToTry)) {
      return portToTry;
    }
  }

  throw new Error(`no free port found from ${startPort} to ${startPort + 50}`);
}

function isPortFree(portToTry) {
  return new Promise((resolve) => {
    const tester = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(portToTry);
  });
}

async function verifyRoute(page, events, target, route, requiredText) {
  const eventStart = events.length;
  await page.goto(new URL(route, target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const text = await page.locator('body').innerText();
  const missingText = requiredText.filter((item) => !text.includes(item));
  if (missingText.length > 0) {
    throw new Error(`${route} missing text: ${missingText.join(', ')}`);
  }

  const visibleFailures = ['获取特性类型失败', '获取策略失败', '数据加载失败', '加载失败，请刷新'].filter((item) => text.includes(item));
  if (visibleFailures.length > 0) {
    throw new Error(`${route} visible failures: ${visibleFailures.join(', ')}`);
  }

  const routeEvents = events.slice(eventStart);
  const fatalEvents = routeEvents.filter((event) => (
    event.startsWith('pageerror:') ||
    event.includes('Cannot read') ||
    event.includes('not a function') ||
    event.includes('获取') && event.includes('失败') ||
    event.includes('加载') && event.includes('失败')
  ));

  if (fatalEvents.length > 0) {
    throw new Error(`${route} browser errors: ${fatalEvents.join(' | ')}`);
  }
}

async function verifyFullPositionTrainingNextStep(page, events, target) {
  const eventStart = events.length;
  await page.goto(new URL('/full-position-training', target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);

  const strategyResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/run_strategy'),
    { timeout: 20000 },
  ).catch(() => null);
  await page.getByRole('button', { name: '下一步' }).click();
  const strategyResponse = await strategyResponsePromise;
  await page.waitForTimeout(2500);

  if (strategyResponse) {
    if (!strategyResponse.ok()) {
      throw new Error('/full-position-training next step received a failed strategy response');
    }

    const strategyPayload = await strategyResponse.json();
    const signals = strategyPayload?.data?.signals;
    if (!Array.isArray(signals) || signals.length === 0) {
      throw new Error('/full-position-training strategy response has no signals');
    }
  }

  const text = await page.locator('body').innerText();
  if (text.includes('策略信号计算失败') || text.includes('策略信号计算出错')) {
    throw new Error('/full-position-training next step still shows strategy signal failure');
  }

  const routeEvents = events.slice(eventStart);
  const fatalEvents = routeEvents.filter((event) => event.includes('策略信号计算失败') || event.includes('策略信号计算出错'));
  if (fatalEvents.length > 0) {
    throw new Error(`/full-position-training strategy browser errors: ${fatalEvents.join(' | ')}`);
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout')), 15000);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      process.stdout.write(text);
      if (text.includes('LoserGod clone running')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
}

async function verifyRealAshareData(target) {
  const response = await fetch(new URL('/api/random_data', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stock_code: '000001.SZ',
      observe_days: 200,
      train_days: 100,
    }),
  });

  if (!response.ok) {
    throw new Error(`real ashare data request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const metadata = payload.metadata || {};
  const firstDate = metadata.first_date || '';
  const totalRows = Number(metadata.total_rows || 0);
  const isEastmoney = metadata.source === 'eastmoney_push2his';
  const hasLongHistory = firstDate <= '1992-01-01' && totalRows > 5000;
  const hasTrainingRows = Array.isArray(payload.observe_data) && payload.observe_data.length === 200 &&
    Array.isArray(payload.train_data) && payload.train_data.length === 100;

  if (!payload.success || !isEastmoney || !hasLongHistory || !hasTrainingRows) {
    throw new Error(`real ashare data verification failed: ${JSON.stringify({
      success: payload.success,
      source: metadata.source,
      firstDate,
      totalRows,
      observeRows: payload.observe_data?.length,
      trainRows: payload.train_data?.length,
    })}`);
  }
}

async function verifyStrategySignalsApi(target) {
  const dataResponse = await fetch(new URL('/api/random_data', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stock_code: '000001.SZ',
      observe_days: 200,
      train_days: 100,
    }),
  });

  if (!dataResponse.ok) {
    throw new Error(`strategy data request failed: HTTP ${dataResponse.status}`);
  }

  const trainingPayload = await dataResponse.json();
  const strategyResponse = await fetch(new URL('/api/run_strategy', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      signal_type: 'ma_cross',
      signal_params: { short_window: 5, long_window: 20 },
      position_type: 'fixed',
      position_params: { ratio: 0.5 },
      observe_days: 200,
      data: [
        ...(Array.isArray(trainingPayload.observe_data) ? trainingPayload.observe_data : []),
        ...(Array.isArray(trainingPayload.train_data) ? trainingPayload.train_data : []),
      ],
    }),
  });

  if (!strategyResponse.ok) {
    throw new Error(`strategy signal request failed: HTTP ${strategyResponse.status}`);
  }

  const strategyPayload = await strategyResponse.json();
  const signals = strategyPayload?.data?.signals;
  if (!strategyPayload.success || !Array.isArray(signals) || signals.length === 0) {
    throw new Error(`strategy signal verification failed: ${JSON.stringify({
      success: strategyPayload.success,
      signalRows: signals?.length,
    })}`);
  }
}

function buildVerificationKlines(count = 40) {
  return Array.from({ length: count }, (_, index) => {
    const close = Number((10 + index * 0.08 + Math.sin(index / 4) * 0.2).toFixed(4));
    const date = `2026-04-${String((index % 28) + 1).padStart(2, '0')}`;
    return {
      index: index + 1,
      time: index + 1,
      timestamp: date,
      date,
      open: Number((close - 0.03).toFixed(4)),
      high: Number((close + 0.08).toFixed(4)),
      low: Number((close - 0.08).toFixed(4)),
      close,
      volume: 100000 + index * 1000,
    };
  });
}

async function verifyTrainingRecordPersistence(target) {
  const phone = '13800138000';
  const unique = Date.now();
  const stockName = `验证股票${unique}`;
  const klineData = buildVerificationKlines();
  const baseRecord = {
    phone,
    stock_code: '000001.SZ',
    stock_name: stockName,
    start_time: klineData[0].timestamp,
    end_time: klineData[klineData.length - 1].timestamp,
    initial_capital: 100000,
    final_capital: 108800,
    total_profit: 8800,
    stock_range_profit_rate: 0.052,
    operation_profit_rate: 0.088,
    excess_profit_rate: 0.036,
    observe_bars: 20,
    train_bars: 20,
    strategy_total_profit: 6400,
    strategy_profit_rate: 0.064,
    mode: 'Full_Position_Training_pk',
    trade_datas: [
      { trade_type: 'buy', price: 10.5, amount: 1000, total_amount: 10500, kline_index: 21, profit: 0 },
      { trade_type: 'sell', price: 11.2, amount: 1000, total_amount: 11200, kline_index: 35, profit: 700 },
    ],
    strategy_trades: [
      { trade_type: 'buy', price: 10.6, amount: 1000, total_amount: 10600, kline_index: 22, profit: 0 },
      { trade_type: 'sell', price: 11.1, amount: 1000, total_amount: 11100, kline_index: 34, profit: 500 },
    ],
    kline_data: klineData,
  };

  const createResponse = await fetch(new URL('/api/training-pk-sessions', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone,
      stock_code: baseRecord.stock_code,
      stock_name: baseRecord.stock_name,
    }),
  });
  if (!createResponse.ok) {
    throw new Error(`create training session failed: HTTP ${createResponse.status}`);
  }

  const createPayload = await createResponse.json();
  const sessionCode = createPayload.session_code || createPayload.sessionCode || createPayload.data?.session_code;
  if (!sessionCode) {
    throw new Error(`create training session did not return session code: ${JSON.stringify(createPayload)}`);
  }

  const updateResponse = await fetch(new URL(`/api/training-pk-sessions/${encodeURIComponent(sessionCode)}`, target), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone,
      operations: [{ type: 'next', kline_index: 21 }],
      trade_history: baseRecord.trade_datas,
      kline_data: klineData,
      latest_index: 35,
    }),
  });
  if (!updateResponse.ok) {
    throw new Error(`update training session failed: HTTP ${updateResponse.status}`);
  }

  const completedRecordId = `verify-session-record-${unique}`;
  const completeResponse = await fetch(new URL(`/api/training-pk-sessions/${encodeURIComponent(sessionCode)}/complete`, target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone,
      training_record: {
        ...baseRecord,
        record_id: completedRecordId,
        id: completedRecordId,
      },
    }),
  });
  if (!completeResponse.ok) {
    throw new Error(`complete training session failed: HTTP ${completeResponse.status}`);
  }

  const listResponse = await fetch(new URL(`/api/training-records?phone=${phone}&page=1&pageSize=50`, target));
  if (!listResponse.ok) {
    throw new Error(`training record list failed: HTTP ${listResponse.status}`);
  }

  const listPayload = await listResponse.json();
  const listedRecords = listPayload?.data?.records || [];
  const completedRecord = listedRecords.find((record) => record.record_id === completedRecordId);
  if (!completedRecord) {
    throw new Error(`completed training record not found in list: ${completedRecordId}`);
  }

  const requiredRecordFields = [
    'final_capital',
    'total_profit',
    'stock_range_profit_rate',
    'operation_profit_rate',
    'excess_profit_rate',
    'initial_capital',
    'strategy_total_profit',
    'user_trade_times',
    'created_at',
    'phone',
    'stock_name',
    'stock_code',
    'start_time',
    'end_time',
    'mode',
  ];
  const missingFields = requiredRecordFields.filter((field) => completedRecord[field] === undefined || completedRecord[field] === null || completedRecord[field] === '');
  if (missingFields.length > 0) {
    throw new Error(`completed training record missing fields: ${missingFields.join(', ')}`);
  }

  const recordResponse = await fetch(new URL(`/api/lookback/training-record/${encodeURIComponent(completedRecordId)}`, target));
  if (!recordResponse.ok) {
    throw new Error(`lookback training record failed: HTTP ${recordResponse.status}`);
  }

  const klineResponse = await fetch(new URL(`/api/lookback/kline-data/${encodeURIComponent(completedRecordId)}`, target));
  if (!klineResponse.ok) {
    throw new Error(`lookback kline data failed: HTTP ${klineResponse.status}`);
  }

  const klinePayload = await klineResponse.json();
  if (!Array.isArray(klinePayload?.data?.full_kline_data) || klinePayload.data.full_kline_data.length !== klineData.length) {
    throw new Error(`lookback kline data invalid: ${JSON.stringify({
      rows: klinePayload?.data?.full_kline_data?.length,
    })}`);
  }

  const directRecordId = `verify-direct-record-${unique}`;
  const directResponse = await fetch(new URL('/api/training-records', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      training_record: {
        ...baseRecord,
        record_id: directRecordId,
        id: directRecordId,
        stock_name: `直存股票${unique}`,
        final_capital: 109900,
        total_profit: 9900,
        operation_profit_rate: 0.099,
      },
    }),
  });
  if (!directResponse.ok) {
    throw new Error(`direct training record save failed: HTTP ${directResponse.status}`);
  }

  const directListResponse = await fetch(new URL(`/api/training-records?phone=${phone}&page=1&pageSize=50`, target));
  const directListPayload = await directListResponse.json();
  const directRecord = (directListPayload?.data?.records || []).find((record) => record.record_id === directRecordId);
  if (!directRecord) {
    throw new Error(`direct training record not found in list: ${directRecordId}`);
  }

  return {
    completedRecordId,
    directRecordId,
    stockName,
  };
}

async function verifyTradeHistoryPageShowsRecord(page, target, recordInfo) {
  await page.goto(new URL('/trade-history', target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const text = await page.locator('body').innerText();
  if (!text.includes(recordInfo.stockName)) {
    throw new Error(`/trade-history does not show completed training record: ${recordInfo.stockName}`);
  }

  if (text.includes('No data')) {
    throw new Error('/trade-history still shows No data after saving a completed training record');
  }

  const row = page.locator('tr').filter({ hasText: recordInfo.stockName }).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  const recordResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/lookback/training-record/${recordInfo.completedRecordId}`),
    { timeout: 20000 },
  );
  const klineResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/lookback/kline-data/${recordInfo.completedRecordId}`),
    { timeout: 20000 },
  );
  await row.getByRole('button', { name: '回看' }).click();
  const [recordResponse, klineResponse] = await Promise.all([recordResponsePromise, klineResponsePromise]);

  if (!recordResponse.ok() || !klineResponse.ok()) {
    throw new Error(`/trade-history lookback failed: record=${recordResponse.status()} kline=${klineResponse.status()}`);
  }

  const [recordPayload, klinePayload] = await Promise.all([recordResponse.json(), klineResponse.json()]);
  if (recordPayload?.data?.record_id !== recordInfo.completedRecordId) {
    throw new Error(`/trade-history lookback record mismatch: ${JSON.stringify(recordPayload?.data)}`);
  }

  if (!Array.isArray(klinePayload?.data?.full_kline_data) || klinePayload.data.full_kline_data.length === 0) {
    throw new Error('/trade-history lookback kline data is empty');
  }
}

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: rootDir,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server);
  await verifyRealAshareData(target);
  await verifyStrategySignalsApi(target);
  const trainingRecordVerification = await verifyTrainingRecordPersistence(target);

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const events = [];
    page.on('pageerror', (error) => events.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        events.push(`${message.type()}: ${message.text()}`);
      }
    });

    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const bodyText = await page.locator('body').innerText();
    const requiredText = ['逆神', '首页', 'PK模拟', '投资模拟', 'TradingView模拟', 'AI工具组', '登录', '注册', '重置密码'];
    const missing = requiredText.filter((text) => !bodyText.includes(text));

    await page.screenshot({ path: path.join(rootDir, 'losergod-local-1440.png'), fullPage: true });

    if (missing.length > 0) {
      throw new Error(`missing text: ${missing.join(', ')}`);
    }

    await page.getByPlaceholder('请输入手机号').fill('13800138000');
    await page.getByPlaceholder('请输入密码').fill('123456');
    await page.locator('input[type=checkbox]').check({ force: true });
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('**/index', { timeout: 15000 });
    await page.waitForTimeout(5000);

    const loggedInText = await page.locator('body').innerText();
    const loggedInRequiredText = ['本地用户', '虚拟总资产', '15.35万', '积分', 'VIP', '投资组合排行'];
    const loggedInMissing = loggedInRequiredText.filter((text) => !loggedInText.includes(text));
    await page.screenshot({ path: path.join(rootDir, 'losergod-local-login-1440.png'), fullPage: true });

    if (loggedInMissing.length > 0) {
      throw new Error(`missing logged-in text: ${loggedInMissing.join(', ')}`);
    }

    const unexpectedErrors = events.filter((event) => event.includes('加载排行榜失败'));
    if (unexpectedErrors.length > 0) {
      throw new Error(`unexpected browser errors: ${unexpectedErrors.join(' | ')}`);
    }

    const routeChecks = [
      ['/leaderboard', ['排名', '用户名', '本地用户']],
      ['/vip-products', ['产品名称', '注册免费1天VIP']],
      ['/payment', ['VIP状态', '支付记录', '积分记录']],
      ['/strategy-library', ['全部策略', '均线金叉']],
      ['/stock-selection', ['热门策略']],
      ['/trade-history', ['交易记录公开']],
      ['/my-portfolio', ['我的策略组合', '稳健复利组合']],
      ['/portfolio-leaderboard', ['投资组合排名', '稳健复利组合']],
      ['/compare-stocks', ['标的对比-查询条件', '已选择标的']],
      ['/pattern-search', ['AI画图选股搜索', '历史记录']],
      ['/quant-flow', ['量化策略回测', '选择标的']],
      ['/ai-stock-analysis', ['AI股票分析', '快速分析']],
      ['/full-position-training', ['模拟炒股', '可用虚拟资金']],
      ['/futures-trading-plus/params', ['商品期货（排位）', '期货品种']],
      ['/virtual_exchange/trade', ['K线', '盘口', '最近成交']],
      ['/virtual_exchange/assets', ['总资产', '持有资产']],
      ['/virtual_exchange/orders', ['当前委托', 'LGD/USDT']],
      ['/notebook', ['我的笔记', '写笔记']],
      ['/materials', ['资料领取', '平台特色']],
      ['/about', ['关于losergod', '联系我们']],
    ];

    for (const [route, texts] of routeChecks) {
      await verifyRoute(page, events, target, route, texts);
    }

    await verifyTradeHistoryPageShowsRecord(page, target, trainingRecordVerification);
    await verifyFullPositionTrainingNextStep(page, events, target);
  } finally {
    await browser.close();
  }

  console.log('verification passed');
} finally {
  server.kill();
  await once(server, 'exit').catch(() => {});
}

