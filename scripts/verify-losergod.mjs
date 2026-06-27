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

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: rootDir,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server);
  await verifyRealAshareData(target);

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
  } finally {
    await browser.close();
  }

  console.log('verification passed');
} finally {
  server.kill();
  await once(server, 'exit').catch(() => {});
}

