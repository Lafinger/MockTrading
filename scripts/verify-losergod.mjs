import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import * as fs from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(rootDir, 'public');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const localAssetVersion = 'lafinger-local-v6';
const requestedPort = Number(process.env.PORT || 9527);
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
  return Promise.all([
    isHostPortFree(portToTry, '0.0.0.0'),
    isHostPortFree(portToTry, '127.0.0.1'),
  ]).then((results) => results.every(Boolean));
}

function isHostPortFree(portToTry, host) {
  return new Promise((resolve) => {
    const tester = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(portToTry, host);
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

  await page.waitForFunction(() => {
    const title = document.querySelector('.stock-info .top-row h2')?.textContent?.trim();
    return Boolean(title && title !== '模拟炒股');
  }, { timeout: 20000 });
  const stockTitle = (await page.locator('.stock-info .top-row h2').first().innerText()).trim();
  if (!stockTitle || stockTitle === '模拟炒股') {
    throw new Error(`/full-position-training stock title did not show a stock name: ${stockTitle || '<empty>'}`);
  }

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

async function getActiveTopNavText(page) {
  return page.locator('.nav-item.active').evaluateAll((nodes) => nodes.map((node) => node.innerText.trim()));
}

async function verifyQuantFlowBacktest(page, events, target) {
  const eventStart = events.length;
  await page.goto(new URL('/quant-flow', target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const activeTopNav = await getActiveTopNavText(page);
  if (!activeTopNav.includes('实盘策略') || activeTopNav.includes('AI工具组')) {
    throw new Error(`/quant-flow top navigation active state is wrong: ${activeTopNav.join(', ')}`);
  }

  await page.getByRole('button', { name: '下一步' }).last().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '下一步' }).last().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '下一步' }).last().click();
  await page.waitForTimeout(800);

  const executeResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/quant_flow/execute'),
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: '执行策略' }).last().click();
  const executeResponse = await executeResponsePromise;
  if (!executeResponse.ok()) {
    throw new Error(`/quant-flow execute failed: HTTP ${executeResponse.status()}`);
  }

  const executePayload = await executeResponse.json();
  if (!executePayload.success || !Array.isArray(executePayload.positions) || executePayload.positions.length === 0) {
    throw new Error(`/quant-flow execute returned invalid payload: ${JSON.stringify(executePayload).slice(0, 500)}`);
  }

  await page.waitForFunction(() => document.body.innerText.includes('回测结果'), { timeout: 20000 });
  const text = await page.locator('body').innerText();
  const visibleFailures = ['Cannot read', '执行策略失败', '获取K线数据失败', '暂无净值数据'].filter((item) => text.includes(item));
  if (visibleFailures.length > 0) {
    throw new Error(`/quant-flow visible failures after execution: ${visibleFailures.join(', ')}`);
  }

  const fatalEvents = events.slice(eventStart).filter((event) => (
    event.startsWith('pageerror:') ||
    event.includes('Cannot read') ||
    event.includes('执行策略失败') ||
    event.includes('获取K线数据失败')
  ));
  if (fatalEvents.length > 0) {
    throw new Error(`/quant-flow browser errors: ${fatalEvents.join(' | ')}`);
  }
}

async function verifyPortfolioRankingDetail(page, events, target) {
  const eventStart = events.length;
  await page.goto(new URL('/portfolio-leaderboard', target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.getByText('详情').first().click();
  await page.waitForURL('**/users-portfolio/**', { timeout: 15000 });
  await page.waitForTimeout(3500);

  const text = await page.locator('body').innerText();
  const required = ['稳健复利组合', '净值', '累计收益率', '总资产', '持仓', '成交记录', '净值曲线'];
  const missing = required.filter((item) => !text.includes(item));
  if (missing.length > 0) {
    throw new Error(`/portfolio-leaderboard detail missing text: ${missing.join(', ')}`);
  }

  const fatalEvents = events.slice(eventStart).filter((event) => (
    event.startsWith('pageerror:') ||
    event.includes('Cannot read') ||
    event.includes('toFixed') ||
    event.includes('加载') && event.includes('失败')
  ));
  if (fatalEvents.length > 0) {
    throw new Error(`/portfolio-leaderboard detail browser errors: ${fatalEvents.join(' | ')}`);
  }
}

async function verifyAiToolPages(page, events, target) {
  const checks = [
    ['/losergod-fear-greed-index', async () => {
      await page.getByRole('button', { name: '查询数据' }).click();
      await page.waitForTimeout(2500);
      const text = await page.locator('body').innerText();
      if (!text.includes('非常贪婪') && !text.includes('恐惧')) {
        throw new Error('/losergod-fear-greed-index did not render indicator rows');
      }
    }],
    ['/compare-stocks', async () => {
      await page.getByRole('button', { name: '查询数据' }).click();
      await page.waitForTimeout(3500);
      const text = await page.locator('body').innerText();
      if (text.includes('所选标的没有共同的交易日期') || !text.includes('统计信息') || !text.includes('区间涨跌幅')) {
        throw new Error('/compare-stocks did not render comparable kline data');
      }
    }],
    ['/ai-stock-analysis', async () => {
      await page.getByPlaceholder('输入股票代码或名称搜索').fill('600519');
      await page.waitForTimeout(1200);
      await page.getByText('600519').first().click();
      await page.getByRole('button', { name: /立即分析/ }).click();
      await page.waitForTimeout(1500);
      const text = await page.locator('body').innerText();
      if (!text.includes('AI股票分析已提交成功') && !text.includes('分析任务已提交')) {
        throw new Error('/ai-stock-analysis submit did not succeed');
      }
      await page.keyboard.press('Escape').catch(() => {});
    }],
    ['/pattern-search', async () => {
      await page.getByRole('button', { name: '新建手绘任务' }).click();
      const canvas = page.locator('.ant-modal canvas').first();
      await canvas.waitFor({ state: 'visible', timeout: 10000 });
      const box = await canvas.boundingBox();
      if (!box) {
        throw new Error('/pattern-search drawing canvas is not visible');
      }

      const points = [
        [0.06, 0.72],
        [0.16, 0.64],
        [0.26, 0.68],
        [0.38, 0.48],
        [0.52, 0.36],
        [0.66, 0.44],
        [0.82, 0.25],
        [0.94, 0.31],
      ];
      await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1]);
      await page.mouse.down();
      for (const [xRatio, yRatio] of points.slice(1)) {
        await page.mouse.move(box.x + box.width * xRatio, box.y + box.height * yRatio, { steps: 8 });
      }
      await page.mouse.up();

      const searchResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/pattern_search/search'),
        { timeout: 20000 },
      );
      await page.locator('.ant-modal').getByRole('button', { name: '搜索' }).click();
      const response = await searchResponsePromise;
      if (!response.ok()) {
        throw new Error(`/pattern-search search failed: HTTP ${response.status()}`);
      }
      await page.waitForTimeout(2500);
      const text = await page.locator('body').innerText();
      if (text.includes('暂无搜索结果') || !text.includes('共找到') || !text.includes('%')) {
        throw new Error('/pattern-search did not render search results');
      }
    }],
  ];

  for (const [route, action] of checks) {
    const eventStart = events.length;
    await page.goto(new URL(route, target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await action();
    const fatalEvents = events.slice(eventStart).filter((event) => (
      event.startsWith('pageerror:') ||
      event.includes('Cannot read') ||
      event.includes('not a function') ||
      event.includes('失败')
    ));
    if (fatalEvents.length > 0) {
      throw new Error(`${route} browser errors: ${fatalEvents.join(' | ')}`);
    }
  }
}

async function verifyAboutBrandHeader(page, target) {
  await page.goto(new URL('/about', target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const headerTitle = (await page.locator('.header-title').innerText()).trim();
  if (headerTitle !== 'Lafinger') {
    throw new Error(`/about header title still shows old brand: ${headerTitle}`);
  }

  const text = await page.locator('body').innerText();
  const oldBrandText = ['逆神', 'losergod', 'LoserGod', 'LOSERGOD'].filter((item) => text.includes(item));
  if (oldBrandText.length > 0) {
    throw new Error(`/about still shows old brand text: ${oldBrandText.join(', ')}`);
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout')), 15000);
    let stdoutText = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdoutText += text;
      process.stdout.write(text);
      if (stdoutText.includes('Lafinger clone running') && stdoutText.includes('LAN access:')) {
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

function uniqueVerifyPhone(suffix = 0) {
  return `139${String(Date.now()).slice(-7)}${suffix}`;
}

function authHeaders(token) {
  return {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function formatHomeCapital(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return '';
  }

  return numberValue >= 10000
    ? `${(numberValue / 10000).toFixed(2)}万`
    : String(numberValue);
}

async function verifyBrandAssets() {
  const visibleFiles = [
    path.join(publicDir, 'index.html'),
    path.join(publicDir, 'assets/js/AboutView-FCe5Kuic.js'),
    path.join(publicDir, 'assets/js/main-Dk2YD_9z.js'),
    path.join(publicDir, 'assets/js/KLineChart-D6bwAFvw.js'),
  ];

  for (const filePath of visibleFiles) {
    const rawText = await fs.readFile(filePath, 'utf8');
    const text = stripBrandGuard(rawText);
    const forbidden = [
      '逆神',
      'LOSERGOD',
      'LoserGod',
      '关于losergod',
      'Lafinger(losergod)',
      '关于Lafinger（Lafinger）',
      'aafinger',
      'addEventaistener',
      'childaist',
      'toaowerCase',
      '于于Lafinger',
      '相于法律',
      '于键技术',
    ];
    const found = forbidden.filter((item) => text.includes(item));
    if (found.length > 0) {
      throw new Error(`old visible brand text in ${path.relative(rootDir, filePath)}: ${found.join(', ')}`);
    }
  }

  const indexHtml = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
  if (!indexHtml.includes('id="lafinger-brand-guard"')) {
    throw new Error('index.html missing Lafinger visible brand guard');
  }
  if (indexHtml.includes('lafinger-local-v5')) {
    throw new Error('index.html still references the previous local asset version');
  }
  if (indexHtml.includes('逆神') || indexHtml.includes('LOSERGOD')) {
    throw new Error('index.html still contains old visible brand literals');
  }
  if (!indexHtml.includes('CanvasRenderingContext2D') || !indexHtml.includes('rewriteText')) {
    throw new Error('index.html brand guard does not patch canvas-rendered brand text');
  }
  if (!indexHtml.includes('OffscreenCanvasRenderingContext2D')) {
    throw new Error('index.html brand guard does not patch offscreen canvas-rendered brand text');
  }
  if (!indexHtml.includes('value instanceof String')) {
    throw new Error('index.html brand guard does not rewrite String object text');
  }

  const entryAssets = [
    `/assets/js/main-Dk2YD_9z.js?v=${localAssetVersion}`,
    `/assets/js/vendor-BHBN5ZrF.js?v=${localAssetVersion}`,
    `/assets/js/echarts-L7P-wWsq.js?v=${localAssetVersion}`,
    `/assets/css/main-Bn1PmTVz.css?v=${localAssetVersion}`,
  ];
  const missingEntryAssets = entryAssets.filter((asset) => !indexHtml.includes(asset));
  if (missingEntryAssets.length > 0) {
    throw new Error(`index.html missing local cache-busted assets: ${missingEntryAssets.join(', ')}`);
  }

  const mainBundle = await fs.readFile(path.join(publicDir, 'assets/js/main-Dk2YD_9z.js'), 'utf8');
  const dynamicImports = [
    `./AboutView-FCe5Kuic.js?v=${localAssetVersion}`,
    `./senior_TrainingPk-BkGLJXH4.js?v=${localAssetVersion}`,
  ];
  const missingDynamicImports = dynamicImports.filter((asset) => !mainBundle.includes(asset));
  if (missingDynamicImports.length > 0) {
    throw new Error(`main bundle missing local cache-busted dynamic imports: ${missingDynamicImports.join(', ')}`);
  }
  if (new RegExp(`assets/css/[^"'?#]+\\.css\\?v=${localAssetVersion}`).test(mainBundle)) {
    throw new Error('main bundle incorrectly cache-busts CSS runtime dependencies as module imports');
  }

  const seniorTrainingBundle = await fs.readFile(path.join(publicDir, 'assets/js/senior_TrainingPk-BkGLJXH4.js'), 'utf8');
  if (!seniorTrainingBundle.includes(`from"./KLineChart-D6bwAFvw.js?v=${localAssetVersion}"`)) {
    throw new Error('senior training page can still load a cached KLineChart chunk with the old watermark');
  }

  const assetNames = await fs.readdir(path.join(publicDir, 'assets/js'));
  const klineChartBundles = assetNames.filter((name) => /^KLineChart-.+\.js$/.test(name));
  if (klineChartBundles.length === 0) {
    throw new Error('no KLineChart bundles found');
  }

  for (const bundleName of klineChartBundles) {
    const klineChartBundle = await fs.readFile(path.join(publicDir, 'assets/js', bundleName), 'utf8');
    if (!klineChartBundle.includes('text:"Lafinger"')) {
      throw new Error(`${bundleName} watermark is not Lafinger`);
    }
    if (klineChartBundle.includes('逆神') || klineChartBundle.includes('LOSERGOD')) {
      throw new Error(`${bundleName} still contains old watermark text`);
    }
  }
}

function stripBrandGuard(text) {
  return text.replace(/<script id="lafinger-brand-guard">[\s\S]*?<\/script>/, '');
}

async function verifyStaticCacheHeaders(target) {
  const assets = [
    `/assets/js/main-Dk2YD_9z.js?v=${localAssetVersion}`,
    `/assets/js/AboutView-FCe5Kuic.js?v=${localAssetVersion}`,
  ];

  for (const asset of assets) {
    const response = await fetch(new URL(asset, target));
    if (!response.ok) {
      throw new Error(`static asset failed: ${asset} HTTP ${response.status}`);
    }

    const cacheControl = response.headers.get('cache-control') || '';
    if (!cacheControl.includes('no-store') && !cacheControl.includes('no-cache')) {
      throw new Error(`static asset ${asset} is cacheable: ${cacheControl || '<missing>'}`);
    }
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function verifyAuthAccounts(target) {
  const password = 'Verify123456';
  const primaryPhone = uniqueVerifyPhone(1);
  const secondaryPhone = uniqueVerifyPhone(2);

  const unregisteredLogin = await fetch(new URL('/api/auth/login', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: primaryPhone, password }),
  });
  if (unregisteredLogin.ok) {
    throw new Error('unregistered account login unexpectedly succeeded');
  }

  const registerResponse = await fetch(new URL('/api/auth/register', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: primaryPhone, password }),
  });
  if (!registerResponse.ok) {
    throw new Error(`register primary account failed: HTTP ${registerResponse.status}`);
  }

  const registerPayload = await readJsonResponse(registerResponse);
  const primaryToken = registerPayload.token || registerPayload.data?.token;
  const primaryProfile = registerPayload.user_info || registerPayload.data?.user_info || registerPayload.data?.profile;
  if (!primaryToken || primaryProfile?.phone !== primaryPhone || primaryProfile?.vip_status !== 'active') {
    throw new Error(`registered account payload invalid: ${JSON.stringify(registerPayload)}`);
  }

  const duplicateRegister = await fetch(new URL('/api/auth/register', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: primaryPhone, password }),
  });
  if (duplicateRegister.ok) {
    throw new Error('duplicate account registration unexpectedly succeeded');
  }

  const wrongPasswordLogin = await fetch(new URL('/api/auth/login', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: primaryPhone, password: 'Wrong123456' }),
  });
  if (wrongPasswordLogin.ok) {
    throw new Error('wrong password login unexpectedly succeeded');
  }

  const loginResponse = await fetch(new URL('/api/auth/login', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: primaryPhone, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(`login primary account failed: HTTP ${loginResponse.status}`);
  }

  const loginPayload = await readJsonResponse(loginResponse);
  const loginToken = loginPayload.token || loginPayload.data?.token;
  if (!loginToken) {
    throw new Error(`login did not return token: ${JSON.stringify(loginPayload)}`);
  }

  const profileResponse = await fetch(new URL('/api/auth/profile', target), {
    headers: { Authorization: `Bearer ${loginToken}` },
  });
  if (!profileResponse.ok) {
    throw new Error(`profile with token failed: HTTP ${profileResponse.status}`);
  }

  const profilePayload = await readJsonResponse(profileResponse);
  if (profilePayload?.data?.phone !== primaryPhone || profilePayload?.data?.vip_status !== 'active') {
    throw new Error(`profile payload invalid: ${JSON.stringify(profilePayload)}`);
  }

  const unauthProfile = await fetch(new URL('/api/auth/profile', target));
  if (unauthProfile.ok) {
    throw new Error('profile without token unexpectedly succeeded');
  }

  const secondaryRegister = await fetch(new URL('/api/auth/register', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: secondaryPhone, password }),
  });
  if (!secondaryRegister.ok) {
    throw new Error(`register secondary account failed: HTTP ${secondaryRegister.status}`);
  }

  const secondaryPayload = await readJsonResponse(secondaryRegister);
  const secondaryToken = secondaryPayload.token || secondaryPayload.data?.token;
  if (!secondaryToken) {
    throw new Error(`secondary register did not return token: ${JSON.stringify(secondaryPayload)}`);
  }

  return {
    primary: { phone: primaryPhone, password, token: loginToken },
    secondary: { phone: secondaryPhone, password, token: secondaryToken },
  };
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

async function verifySeniorTrainingParamsPayload(target) {
  const modes = ['senior_pk', 'senior_training_pk_records'];
  for (const mode of modes) {
    await verifySeniorTrainingModePayload(target, mode);
  }
}

async function verifySeniorTrainingModePayload(target, mode) {
  const response = await fetch(new URL('/api/random_data', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode,
      observe_days: 100,
      train_days: 50,
      stock_type: '60',
      leverage_enabled: 'false',
      commission_enabled: 'true',
      buy_commission_rate: '0.0003',
      sell_commission_rate: '0.0003',
      min_commission: '5',
      stamp_duty_rate: '0.0005',
      transfer_fee_rate: '0.00002',
    }),
  });

  if (!response.ok) {
    throw new Error(`senior training params data request failed for ${mode}: HTTP ${response.status}`);
  }

  const text = await response.text();
  const payloadBytes = Buffer.byteLength(text, 'utf8');
  const payload = JSON.parse(text);
  const hasTrainingRows = Array.isArray(payload.observe_data) && payload.observe_data.length === 100 &&
    Array.isArray(payload.train_data) && payload.train_data.length === 50;
  const isRequestedStockType = /^60\d{4}\.SH$/.test(payload.stock_code);
  const dataRows = Array.isArray(payload.data) ? payload.data.length : 0;

  if (!payload.success || !hasTrainingRows || !isRequestedStockType || !payload.stock_name || dataRows !== 150 || payloadBytes > 1_000_000) {
    throw new Error(`senior training params payload verification failed: ${JSON.stringify({
      mode,
      success: payload.success,
      stockCode: payload.stock_code,
      stockName: payload.stock_name,
      observeRows: payload.observe_data?.length,
      trainRows: payload.train_data?.length,
      dataRows,
      payloadBytes,
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

function getLanUrlsForPort(portToUse) {
  const urls = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${portToUse}/`);
      }
    }
  }

  return urls;
}

async function verifyLanAccess(portToUse) {
  const urls = getLanUrlsForPort(portToUse);
  if (urls.length === 0) {
    throw new Error('no active LAN IPv4 address found for LAN access verification');
  }

  const failures = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      if (response.ok && text.includes(`v=${localAssetVersion}`) && text.includes('lafinger-brand-guard')) {
        return url;
      }
      failures.push(`${url} HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${url} ${error.message}`);
    }
  }

  throw new Error(`LAN access verification failed: ${failures.join(' | ')}`);
}

async function verifyFearGreedIndexApi(target) {
  const requestPayloads = [
    {
      code: 'SUPER_INDEX',
      data_type: 'index',
      period: 'daily',
      start_date: '2025-06-27',
      end_date: '2026-06-27',
    },
    {
      code: 'SUPER_INDEX',
      data_type: 'index',
      period: 'daily',
      start_date: '2025-06-28',
      end_date: '2026-06-28',
    },
  ];

  for (const requestPayload of requestPayloads) {
    await verifyFearGreedIndexPayload(target, requestPayload);
  }
}

async function verifyFearGreedIndexPayload(target, requestPayload) {
  const response = await fetch(new URL('/api/index_signals/super_index', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    throw new Error(`fear greed index request failed for ${requestPayload.start_date}..${requestPayload.end_date}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rows = payload.data;
  if (!payload.success || !Array.isArray(rows) || rows.length < 100) {
    throw new Error(`fear greed index response must match original array shape for ${requestPayload.start_date}..${requestPayload.end_date}: ${JSON.stringify({
      success: payload.success,
      dataIsArray: Array.isArray(rows),
      rows: Array.isArray(rows) ? rows.length : null,
      topKeys: Object.keys(payload || {}),
    })}`);
  }

  const requiredFields = ['date', 'index', 'close', 'value', 'level'];
  const missingFields = requiredFields.filter((field) => rows.some((row) => row[field] === undefined || row[field] === null || row[field] === ''));
  const values = rows.map((row) => Number(row.value)).filter(Number.isFinite);
  const hasNegativeValue = values.some((value) => value < 0);
  const hasPositiveValue = values.some((value) => value > 0);
  const outOfRange = values.filter((value) => value < -100 || value > 100);
  const levels = new Set(rows.map((row) => row.level).filter(Boolean));
  const firstRow = rows[0] || {};
  const lastRow = rows[rows.length - 1] || {};
  const hasOriginalLikeMetadata = payload.code === 'SUPER_INDEX' &&
    payload.data_type === 'index' &&
    payload.period === 'daily' &&
    payload.metadata?.original_klines === 242 &&
    payload.metadata?.total_points === 193 &&
    payload.metadata?.warmup_period === 100 &&
    payload.metadata?.super_index_info?.weights?.sh === 0.5 &&
    payload.metadata?.super_index_info?.weights?.sz === 0.5;

  if (
    rows.length !== 193 ||
    firstRow.date !== '2025-09-04' ||
    lastRow.date !== '2026-06-26' ||
    Math.abs(Number(firstRow.close) - 113.3721) > 0.02 ||
    Math.abs(Number(lastRow.close) - 134.8383) > 0.02 ||
    Math.abs(Number(firstRow.value) - 11.88) > 0.05 ||
    Math.abs(Number(lastRow.value) - (-65.49)) > 0.05 ||
    Math.abs(Math.min(...values) - (-84.64)) > 0.05 ||
    Math.abs(Math.max(...values) - 87.81) > 0.05 ||
    missingFields.length > 0 ||
    !hasNegativeValue ||
    !hasPositiveValue ||
    outOfRange.length > 0 ||
    levels.size < 4 ||
    !hasOriginalLikeMetadata
  ) {
    throw new Error(`fear greed index response invalid for ${requestPayload.start_date}..${requestPayload.end_date}: ${JSON.stringify({
      rows: rows.length,
      firstDate: firstRow.date,
      lastDate: lastRow.date,
      firstClose: firstRow.close,
      lastClose: lastRow.close,
      firstValue: firstRow.value,
      lastValue: lastRow.value,
      missingFields,
      valueMin: values.length ? Math.min(...values) : null,
      valueMax: values.length ? Math.max(...values) : null,
      outOfRange: outOfRange.length,
      levels: Array.from(levels),
      metadata: payload.metadata,
      code: payload.code,
      data_type: payload.data_type,
      period: payload.period,
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

async function verifyTrainingRecordPersistence(target, accounts) {
  const phone = accounts.primary.phone;
  const primaryToken = accounts.primary.token;
  const secondaryToken = accounts.secondary.token;
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
    headers: authHeaders(primaryToken),
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
    headers: authHeaders(primaryToken),
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
    headers: authHeaders(primaryToken),
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

  const listResponse = await fetch(new URL(`/api/training-records?phone=${phone}&page=1&pageSize=50`, target), {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });
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

  const secondaryListResponse = await fetch(new URL(`/api/training-records?phone=${phone}&page=1&pageSize=50`, target), {
    headers: { Authorization: `Bearer ${secondaryToken}` },
  });
  if (!secondaryListResponse.ok) {
    throw new Error(`secondary training record list failed: HTTP ${secondaryListResponse.status}`);
  }

  const secondaryListPayload = await secondaryListResponse.json();
  const secondaryRecords = secondaryListPayload?.data?.records || [];
  if (secondaryRecords.some((record) => record.record_id === completedRecordId)) {
    throw new Error('secondary account can see primary account training record');
  }

  const recordResponse = await fetch(new URL(`/api/lookback/training-record/${encodeURIComponent(completedRecordId)}`, target), {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });
  if (!recordResponse.ok) {
    throw new Error(`lookback training record failed: HTTP ${recordResponse.status}`);
  }

  const secondaryRecordResponse = await fetch(new URL(`/api/lookback/training-record/${encodeURIComponent(completedRecordId)}`, target), {
    headers: { Authorization: `Bearer ${secondaryToken}` },
  });
  if (secondaryRecordResponse.ok) {
    throw new Error('secondary account can open primary account lookback record');
  }

  const klineResponse = await fetch(new URL(`/api/lookback/kline-data/${encodeURIComponent(completedRecordId)}`, target), {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });
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
    headers: authHeaders(primaryToken),
    body: JSON.stringify({
      training_record: {
        ...baseRecord,
        phone: accounts.secondary.phone,
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

  const directListResponse = await fetch(new URL(`/api/training-records?phone=${phone}&page=1&pageSize=50`, target), {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });
  const directListPayload = await directListResponse.json();
  const directRecord = (directListPayload?.data?.records || []).find((record) => record.record_id === directRecordId);
  if (!directRecord) {
    throw new Error(`direct training record not found in list: ${directRecordId}`);
  }

  if (directRecord.phone !== phone) {
    throw new Error(`direct training record did not use token phone: ${directRecord.phone}`);
  }

  const secondaryDirectListResponse = await fetch(new URL(`/api/training-records?phone=${accounts.secondary.phone}&page=1&pageSize=50`, target), {
    headers: { Authorization: `Bearer ${secondaryToken}` },
  });
  const secondaryDirectListPayload = await secondaryDirectListResponse.json();
  const leakedDirectRecord = (secondaryDirectListPayload?.data?.records || []).find((record) => record.record_id === directRecordId);
  if (leakedDirectRecord) {
    throw new Error('secondary account can see a direct record saved by primary token');
  }

  const frontendRecordId = `verify-frontend-senior-record-${unique}`;
  const frontendFinalCapital = 117650;
  const { mode: omittedFrontendMode, ...frontendRecordBase } = baseRecord;
  void omittedFrontendMode;
  const frontendSaveResponse = await fetch(new URL('/api/training-records', target), {
    method: 'POST',
    headers: {
      ...authHeaders(primaryToken),
      'X-Mode': 'senior_pk',
    },
    body: JSON.stringify({
      training_record: {
        ...frontendRecordBase,
        record_id: frontendRecordId,
        id: frontendRecordId,
        stock_name: `前端排位股票${unique}`,
        final_capital: frontendFinalCapital,
        final_assets: frontendFinalCapital,
        total_profit: frontendFinalCapital - baseRecord.initial_capital,
        operation_profit_rate: (frontendFinalCapital - baseRecord.initial_capital) / baseRecord.initial_capital,
      },
    }),
  });
  if (!frontendSaveResponse.ok) {
    throw new Error(`frontend senior training record save failed: HTTP ${frontendSaveResponse.status}`);
  }

  const frontendListResponse = await fetch(new URL(`/api/training-records?phone=${phone}&page=1&pageSize=50&modes=senior_pk,Full_Position_Training_pk,full_position`, target), {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });
  if (!frontendListResponse.ok) {
    throw new Error(`frontend senior training record list failed: HTTP ${frontendListResponse.status}`);
  }

  const frontendListPayload = await frontendListResponse.json();
  const frontendRecord = (frontendListPayload?.data?.records || []).find((record) => record.record_id === frontendRecordId);
  if (!frontendRecord) {
    throw new Error(`frontend senior training record not found with senior filters: ${frontendRecordId}`);
  }

  const frontendRecordModes = [frontendRecord.mode, frontendRecord.source_mode, frontendRecord.index_mode].filter(Boolean);
  if (!frontendRecordModes.includes('senior_pk') && !frontendRecordModes.includes('Full_Position_Training_pk') && !frontendRecordModes.includes('full_position')) {
    throw new Error(`frontend senior training record mode is not compatible: ${JSON.stringify(frontendRecordModes)}`);
  }

  const updatedProfileResponse = await fetch(new URL('/api/auth/profile', target), {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });
  if (!updatedProfileResponse.ok) {
    throw new Error(`profile after frontend senior training save failed: HTTP ${updatedProfileResponse.status}`);
  }

  const updatedProfilePayload = await updatedProfileResponse.json();
  const updatedProfile = updatedProfilePayload?.data || {};
  if (updatedProfile.total_capital !== frontendFinalCapital || updatedProfile.available_capital !== frontendFinalCapital) {
    throw new Error(`frontend senior training did not sync virtual capital: ${JSON.stringify({
      total_capital: updatedProfile.total_capital,
      available_capital: updatedProfile.available_capital,
      expected: frontendFinalCapital,
    })}`);
  }

  const rawFrontendRecordId = `verify-raw-frontend-senior-record-${unique}`;
  const rawFrontendFinalCapital = 123450;
  const rawFrontendSaveResponse = await fetch(new URL('/api/training-records', target), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Mode': 'senior_pk',
    },
    body: JSON.stringify({
      training_record: {
        ...frontendRecordBase,
        phone,
        user_id: phone,
        record_id: rawFrontendRecordId,
        id: rawFrontendRecordId,
        stock_name: `裸前端排位股票${unique}`,
        final_capital: rawFrontendFinalCapital,
        final_assets: rawFrontendFinalCapital,
        total_profit: rawFrontendFinalCapital - baseRecord.initial_capital,
        operation_profit_rate: (rawFrontendFinalCapital - baseRecord.initial_capital) / baseRecord.initial_capital,
      },
    }),
  });
  if (!rawFrontendSaveResponse.ok) {
    throw new Error(`raw frontend senior training record save failed: HTTP ${rawFrontendSaveResponse.status}`);
  }

  const rawFrontendListResponse = await fetch(new URL(`/api/training-records?phone=${phone}&page=1&pageSize=50&modes=senior_pk,Full_Position_Training_pk,full_position`, target));
  if (!rawFrontendListResponse.ok) {
    throw new Error(`raw frontend senior training record list failed: HTTP ${rawFrontendListResponse.status}`);
  }

  const rawFrontendListPayload = await rawFrontendListResponse.json();
  const rawFrontendRecord = (rawFrontendListPayload?.data?.records || []).find((record) => record.record_id === rawFrontendRecordId);
  if (!rawFrontendRecord) {
    throw new Error(`raw frontend senior training record not found with senior filters: ${rawFrontendRecordId}`);
  }

  const rawUpdatedProfileResponse = await fetch(new URL('/api/auth/profile', target), {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });
  if (!rawUpdatedProfileResponse.ok) {
    throw new Error(`profile after raw frontend senior training save failed: HTTP ${rawUpdatedProfileResponse.status}`);
  }

  const rawUpdatedProfilePayload = await rawUpdatedProfileResponse.json();
  const rawUpdatedProfile = rawUpdatedProfilePayload?.data || {};
  if (rawUpdatedProfile.total_capital !== rawFrontendFinalCapital || rawUpdatedProfile.available_capital !== rawFrontendFinalCapital) {
    throw new Error(`raw frontend senior training did not sync virtual capital: ${JSON.stringify({
      total_capital: rawUpdatedProfile.total_capital,
      available_capital: rawUpdatedProfile.available_capital,
      expected: rawFrontendFinalCapital,
    })}`);
  }

  return {
    completedRecordId,
    directRecordId,
    frontendRecordId,
    frontendFinalCapital: rawFrontendFinalCapital,
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

async function verifySeniorTrainingParamsCanEnter(page, events, target) {
  const eventStart = events.length;
  await page.goto(new URL('/senior_training_pk/params', target).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '确定' }).click();
  await page.waitForURL('**/senior_training_pk/training_pk**', { timeout: 30000 });
  await page.waitForTimeout(3000);

  const text = await page.locator('body').innerText();
  if (text.includes('请求失败') || text.includes('股票数据加载失败')) {
    throw new Error('/senior_training_pk/params failed to enter training page');
  }

  await page.waitForFunction(() => {
    const title = document.querySelector('.stock-info .top-row h2, .stock-info h2')?.textContent?.trim();
    return Boolean(title && title !== '模拟炒股');
  }, { timeout: 20000 });
  const stockTitle = (await page.locator('.stock-info .top-row h2, .stock-info h2').first().innerText()).trim();
  if (!stockTitle || stockTitle === '模拟炒股') {
    throw new Error(`/senior_training_pk/training_pk stock title did not show a stock name: ${stockTitle || '<empty>'}`);
  }

  const canvasBrandProbe = await page.evaluate(() => {
    const rewritten = window.__lafingerBrandGuard?.rewriteText?.('逆神 | LOSERGOD');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = 'bold 60px Microsoft YaHei';
    const oldWidth = context.measureText('逆神 | LOSERGOD').width;
    const newWidth = context.measureText('Lafinger').width;
    return {
      rewritten,
      oldWidth,
      newWidth,
      sameWidth: Math.abs(oldWidth - newWidth) < 0.01,
    };
  });
  if (canvasBrandProbe.rewritten !== 'Lafinger' || !canvasBrandProbe.sameWidth) {
    throw new Error(`/senior_training_pk/training_pk canvas brand guard failed: ${JSON.stringify(canvasBrandProbe)}`);
  }

  const routeEvents = events.slice(eventStart);
  const fatalEvents = routeEvents.filter((event) => (
    event.startsWith('pageerror:') ||
    event.includes('QuotaExceededError') ||
    event.includes('请求失败') ||
    event.includes('股票数据加载失败')
  ));

  if (fatalEvents.length > 0) {
    throw new Error(`/senior_training_pk/params browser errors: ${fatalEvents.join(' | ')}`);
  }
}

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: rootDir,
  env: { ...process.env, PORT: String(port), HOST: '0.0.0.0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server);
  await verifyBrandAssets();
  await verifyStaticCacheHeaders(target);
  await verifyLanAccess(port);
  await verifyRealAshareData(target);
  await verifySeniorTrainingParamsPayload(target);
  await verifyStrategySignalsApi(target);
  await verifyFearGreedIndexApi(target);
  const accounts = await verifyAuthAccounts(target);
  const trainingRecordVerification = await verifyTrainingRecordPersistence(target, accounts);

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
    const requiredText = ['Lafinger', '首页', 'PK模拟', '投资模拟', 'TradingView模拟', 'AI工具组', '登录', '注册', '重置密码'];
    const missing = requiredText.filter((text) => !bodyText.includes(text));

    await page.screenshot({ path: path.join(rootDir, 'losergod-local-1440.png'), fullPage: true });

    if (missing.length > 0) {
      throw new Error(`missing text: ${missing.join(', ')}`);
    }

    const oldBrandText = ['逆神', 'losergod', 'LoserGod', 'LOSERGOD'].filter((text) => bodyText.includes(text));
    if (oldBrandText.length > 0) {
      throw new Error(`old brand text still visible on home page: ${oldBrandText.join(', ')}`);
    }

    await page.getByPlaceholder('请输入手机号').fill(accounts.primary.phone);
    await page.getByPlaceholder('请输入密码').fill(accounts.primary.password);
    await page.locator('input[type=checkbox]').check({ force: true });
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('**/index', { timeout: 15000 });
    await page.waitForTimeout(5000);

    const loggedInText = await page.locator('body').innerText();
    const expectedHomeCapital = formatHomeCapital(trainingRecordVerification.frontendFinalCapital);
    const loggedInRequiredText = ['本地用户', '虚拟总资产', expectedHomeCapital, '积分', 'VIP', '投资组合排行'];
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
      ['/losergod-fear-greed-index', ['Lafinger缠论指标', '恐惧', '贪婪']],
      ['/full-position-training', ['可用虚拟资金']],
      ['/futures-trading-plus/params', ['商品期货（排位）', '期货品种']],
      ['/virtual_exchange/trade', ['K线', '盘口', '最近成交']],
      ['/virtual_exchange/assets', ['总资产', '持有资产']],
      ['/virtual_exchange/orders', ['当前委托', 'LGD/USDT']],
      ['/notebook', ['我的笔记', '写笔记']],
      ['/materials', ['资料领取', '平台特色']],
      ['/about', ['关于Lafinger', '联系我们']],
    ];

    for (const [route, texts] of routeChecks) {
      await verifyRoute(page, events, target, route, texts);
    }

    await verifyAboutBrandHeader(page, target);
    await verifyTradeHistoryPageShowsRecord(page, target, trainingRecordVerification);
    await verifySeniorTrainingParamsCanEnter(page, events, target);
    await verifyQuantFlowBacktest(page, events, target);
    await verifyPortfolioRankingDetail(page, events, target);
    await verifyAiToolPages(page, events, target);
    await verifyFullPositionTrainingNextStep(page, events, target);
  } finally {
    await browser.close();
  }

  console.log('verification passed');
} finally {
  server.kill();
  await once(server, 'exit').catch(() => {});
}

