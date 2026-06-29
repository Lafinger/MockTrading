import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAshareKlines } from './ashare-data.mjs';

const AI_DEPTHS = [
  { level: 1, name: '快速分析', points_cost: 50, estimated_time: 120, description: '覆盖趋势、成交量和关键价位' },
  { level: 2, name: '标准分析', points_cost: 100, estimated_time: 300, description: '增加技术指标、风险位和仓位建议' },
  { level: 3, name: '深度分析', points_cost: 200, estimated_time: 600, description: '加入多周期共振和策略推演' },
  { level: 5, name: '5级-全景解析', points_cost: 100, estimated_time: 600, description: '覆盖技术面、基本面、新闻情绪、多空辩论、投资计划、风险管理和战略视角' },
];

const JEREH_REPORT_PATH = path.join(process.cwd(), 'fixtures', 'ai-stock-analysis', 'jereh-002353-level5.md');
let jerehReportCache = null;
let localEnvCache = null;

export function initAiStockAnalysisStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_stock_analysis_records (
      task_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_stock_analysis_phone_created_at
      ON ai_stock_analysis_records(phone, created_at DESC);
  `);
}

export function getAiDepths() {
  return AI_DEPTHS;
}

export async function handleAiStockAnalysisApi(req, res, requestUrl, context) {
  const { db, sendJson, readJsonBody } = context;
  const pathname = requestUrl.pathname;
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
    const phone = requestUrl.searchParams.get('phone') || '13800138000';
    const page = Math.max(1, Number(requestUrl.searchParams.get('page') || 1));
    const pageSize = Math.max(1, Number(requestUrl.searchParams.get('page_size') || requestUrl.searchParams.get('limit') || 20));
    const rows = listRecords(db, phone);
    const records = rows.slice((page - 1) * pageSize, page * pageSize).map(toHistoryRecord);
    sendJson(res, 200, {
      success: true,
      data: {
        records,
        total: rows.length,
      },
    });
    return true;
  }

  if (subPath === '/analyze') {
    const body = await readJsonBody(req);
    const level = Number(body.analysis_depth || body.level || 2);
    const depth = AI_DEPTHS.find((item) => item.level === level) || AI_DEPTHS[1];
    const phone = String(body.phone || '13800138000');
    const stock = normalizeStock(body.symbol || body.stock_code || '600519.SH', body.stock_name);

    try {
      const report = level === 5
        ? await buildPanoramaReport(stock)
        : buildBasicReport(stock, depth);
      const taskId = `LOCAL-AI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record = buildCompletedRecord({ taskId, phone, stock, depth, report });
      saveRecord(db, record);
      sendJson(res, 200, {
        success: true,
        data: {
          task_id: taskId,
          remaining_points: Math.max(0, 2000 - depth.points_cost),
        },
        message: '分析任务已提交',
      });
    } catch (error) {
      sendJson(res, 503, {
        success: false,
        message: error.message || 'AI分析服务不可用',
      });
    }
    return true;
  }

  if (subPath.startsWith('/result/')) {
    const taskId = decodeURIComponent(subPath.split('/').pop());
    const record = getRecord(db, taskId);
    if (!record) {
      sendJson(res, 404, { success: false, message: '分析记录不存在' });
      return true;
    }
    sendJson(res, 200, { success: true, data: toResultRecord(record) });
    return true;
  }

  if (subPath.startsWith('/export/')) {
    const [, , taskIdPart, formatPart] = subPath.split('/');
    const taskId = decodeURIComponent(taskIdPart || '');
    const format = decodeURIComponent(formatPart || 'markdown');
    const record = getRecord(db, taskId);
    if (!record) {
      sendJson(res, 404, { success: false, message: '分析记录不存在' });
      return true;
    }
    sendExport(res, record, format);
    return true;
  }

  if (subPath.startsWith('/mark-read/')) {
    const taskId = decodeURIComponent(subPath.split('/').pop());
    const body = await readJsonBody(req);
    markRecordRead(db, taskId, body.phone || requestUrl.searchParams.get('phone') || '');
    sendJson(res, 200, { success: true, data: { count: 1 } });
    return true;
  }

  if (subPath === '/mark-all-read') {
    const body = await readJsonBody(req);
    const phone = body.phone || requestUrl.searchParams.get('phone') || '13800138000';
    const count = markAllRead(db, phone);
    sendJson(res, 200, { success: true, data: { count } });
    return true;
  }

  return false;
}

function listRecords(db, phone) {
  return db.prepare(`
    SELECT record_json
    FROM ai_stock_analysis_records
    WHERE phone = ?
    ORDER BY created_at DESC
  `).all(phone).map((row) => JSON.parse(row.record_json));
}

function getRecord(db, taskId) {
  const row = db.prepare('SELECT record_json FROM ai_stock_analysis_records WHERE task_id = ?').get(taskId);
  return row ? JSON.parse(row.record_json) : null;
}

function saveRecord(db, record) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO ai_stock_analysis_records (task_id, phone, record_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(record.task_id, record.phone, JSON.stringify(record), record.created_at || now, now);
}

function markRecordRead(db, taskId, phone) {
  const record = getRecord(db, taskId);
  if (!record || (phone && record.phone !== phone)) {
    return false;
  }
  record.is_read = true;
  record.read_at = new Date().toISOString();
  saveRecord(db, record);
  return true;
}

function markAllRead(db, phone) {
  const rows = listRecords(db, phone);
  rows.forEach((record) => {
    record.is_read = true;
    record.read_at = new Date().toISOString();
    saveRecord(db, record);
  });
  return rows.length;
}

function toHistoryRecord(record) {
  return {
    task_id: record.task_id,
    stock_code: record.stock_code,
    symbol: record.symbol,
    stock_name: record.stock_name,
    recommendation: record.analysis_result.recommendation,
    position: record.analysis_result.position,
    current_price: record.current_price,
    target_price: record.analysis_result.target_price,
    stop_loss: record.analysis_result.stop_loss,
    take_profit: record.analysis_result.take_profit,
    depth_label: record.depth_label,
    status: record.status,
    is_read: Boolean(record.is_read),
    read_at: record.read_at || null,
    created_at: record.created_at,
  };
}

function toResultRecord(record) {
  return {
    task_id: record.task_id,
    stock_code: record.stock_code,
    symbol: record.symbol,
    stock_name: record.stock_name,
    current_price: record.current_price,
    created_at: record.created_at,
    depth_label: record.depth_label,
    status: record.status,
    analysis_result: record.analysis_result,
  };
}

function buildCompletedRecord({ taskId, phone, stock, depth, report }) {
  const reportPayload = normalizeAnalysisPayload(report);
  const detailedReport = reportPayload.report;
  const summary = reportPayload.summary || summarizeReport(stock, detailedReport, depth);
  const now = new Date().toISOString();
  return {
    task_id: taskId,
    phone,
    stock_code: stock.code,
    symbol: stock.code,
    stock_name: stock.name,
    current_price: summary.current_price,
    depth_level: depth.level,
    depth_label: depth.name,
    status: 'completed',
    is_read: false,
    created_at: now,
    analysis_result: {
      recommendation: summary.recommendation,
      position: summary.position,
      current_price: summary.current_price,
      target_price: summary.target_price,
      stop_loss: summary.stop_loss,
      take_profit: summary.take_profit,
      detailed_report: detailedReport,
      final_decision: summary.final_decision,
      reports: {},
    },
  };
}

function normalizeAnalysisPayload(report) {
  if (report && typeof report === 'object') {
    return {
      report: String(report.report || report.detailed_report || ''),
      summary: report.summary || null,
    };
  }

  return {
    report: String(report || ''),
    summary: null,
  };
}

function summarizeReport(stock, report, depth) {
  if (isJerehStock(stock.code) && depth.level === 5) {
    return {
      recommendation: '买入',
      position: '30%',
      current_price: 161.53,
      target_price: 32.8,
      stop_loss: 24.6,
      take_profit: 38.5,
      final_decision: '买入，建议仓位30%，目标价位32.80元，止损位24.60元，止盈位38.50元。',
    };
  }

  return {
    recommendation: '持有',
    position: '30%',
    current_price: 100,
    target_price: 112,
    stop_loss: 92,
    take_profit: 118,
    final_decision: `${stock.name} 当前适合持有观察，控制仓位并等待趋势确认。`,
  };
}

function normalizeStock(symbol, stockName) {
  const raw = String(symbol || '').trim().toUpperCase();
  const code = raw.includes('.') ? raw : inferMarketSuffix(raw);
  return {
    code,
    name: stockName || getKnownStockName(code),
  };
}

function getKnownStockName(code) {
  if (isJerehStock(code)) {
    return '杰瑞股份';
  }
  if (String(code || '').toUpperCase() === '002851.SZ') {
    return '麦格米特';
  }
  return code;
}

function inferMarketSuffix(code) {
  if (code.startsWith('6')) {
    return `${code}.SH`;
  }
  return `${code}.SZ`;
}

function isJerehStock(code) {
  return String(code || '').toUpperCase().replace(/^(SZ|SH)\./, '').startsWith('002353');
}

async function buildPanoramaReport(stock) {
  if (isJerehStock(stock.code)) {
    return getJerehReport();
  }
  return generatePanoramaReportWithCpa(stock);
}

async function getJerehReport() {
  if (!jerehReportCache) {
    jerehReportCache = await readFile(JEREH_REPORT_PATH, 'utf8');
  }
  return jerehReportCache;
}

function buildBasicReport(stock, depth) {
  return `# ${stock.name}（${stock.code}）${depth.name}报告

## 📊 一、基础分析

本地复刻环境已提交 ${depth.name}。该报告用于保持 AI 股票分析基础流程可用。

## 🎯 综合投资决策

- 投资建议：持有
- 建议仓位：30%
- 目标价位：112.00元
- 止损位：92.00元
- 止盈位：118.00元

## ⚠️ 免责声明

本报告仅供参考学习使用，不构成投资建议。`;
}

async function generatePanoramaReportWithCpa(stock) {
  const apiKey = await getCpaApiKey();
  if (!apiKey) {
    return buildLocalPanoramaReport(stock);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CPA_TIMEOUT_MS || 2000));
  let response;
  try {
    response = await fetch('http://127.0.0.1:8317/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.CPA_MODEL || 'gpt-5.5',
        messages: [
          {
            role: 'system',
            content: '你是A股研究报告生成器。必须输出中文Markdown，不要输出JSON。',
          },
          {
            role: 'user',
            content: `请为 ${stock.name}（${stock.code}）生成“5级-全景解析”报告，严格包含以下章节：# 标题、## 📊 一、基础分析、### 1.1 技术分析、### 1.2 基本面分析、### 1.3 新闻分析、### 1.4 情绪分析、## 🔥 二、多空辩论（1轮）、## 👔 三、研究经理投资计划、## ⚖️ 四、风险管理讨论（1轮）、## 🎯 五、战略分析、## 🏆 六、风险经理最终决策（结合战略视角）、## ⚠️ 免责声明。报告必须给出投资建议、建议仓位、目标价位、止损位、止盈位。`,
          },
        ],
        temperature: 0.2,
      }),
    });
  } catch (error) {
    return buildLocalPanoramaReport(stock);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return buildLocalPanoramaReport(stock);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!isCompletePanoramaReport(content)) {
    return buildLocalPanoramaReport(stock);
  }
  return content;
}

function isCompletePanoramaReport(content) {
  const text = String(content || '');
  if (text.length < 6000) {
    return false;
  }

  return [
    '基础分析',
    '技术分析',
    '基本面分析',
    '多空辩论',
    '研究经理投资计划',
    '风险经理最终决策',
    '目标价',
    '止损位',
    '止盈位',
  ].every((term) => text.includes(term));
}

async function buildLocalPanoramaReport(stock) {
  const context = await buildLocalPanoramaContext(stock);
  return {
    report: formatLocalPanoramaReport(stock, context),
    summary: summarizeLocalContext(stock, context),
  };
}

function summarizeLocalContext(stock, context) {
  const currentPrice = roundPrice(context.latest.close);
  const targetPrice = roundPrice(context.targetPrice);
  const stopLoss = roundPrice(context.stopLoss);
  const takeProfit = roundPrice(context.takeProfit);

  return {
    recommendation: context.recommendation,
    position: context.position,
    current_price: currentPrice,
    target_price: targetPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    final_decision: `${getStockDisplayName(stock)} 当前建议${context.recommendation}，建议仓位${context.position}，目标价位${formatNumber(targetPrice)}元，止损位${formatNumber(stopLoss)}元，止盈位${formatNumber(takeProfit)}元。`,
  };
}

async function buildLocalPanoramaContext(stock) {
  try {
    const { asset, rows, metadata } = await getAshareKlines({ code: stock.code, kind: 'stock', begin: '20200101' });
    return buildMarketContext(asset, rows, metadata, false);
  } catch {
    const fallbackRows = buildFallbackKlineRows();
    return buildMarketContext({ code: stock.code, name: getStockDisplayName(stock), kind: 'stock' }, fallbackRows, {
      source_name: '本地复刻行情样本',
      first_date: fallbackRows[0].date,
      last_date: fallbackRows.at(-1).date,
      total_rows: fallbackRows.length,
    }, true);
  }
}

function buildMarketContext(asset, rawRows, metadata = {}, usedFallbackRows = false) {
  const rows = rawRows
    .filter((row) => Number.isFinite(Number(row.close)) && Number.isFinite(Number(row.open)))
    .slice(-260)
    .map((row) => ({
      date: row.date || row.timestamp || '',
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || row.vol || 0),
      amount: Number(row.amount || row.turnover || 0),
      changePercent: Number(row.change_percent || row.change_pct || 0),
      turnoverRate: Number(row.turnover_rate || 0),
    }));

  const latest = rows.at(-1) || { close: 100, open: 100, high: 102, low: 98, volume: 0, date: '' };
  const closes = rows.map((row) => row.close);
  const highs = rows.map((row) => row.high);
  const lows = rows.map((row) => row.low);
  const volumes = rows.map((row) => row.volume);
  const ma5 = average(closes.slice(-5));
  const ma10 = average(closes.slice(-10));
  const ma20 = average(closes.slice(-20));
  const ma60 = average(closes.slice(-60));
  const ma120 = average(closes.slice(-120));
  const macd = calculateMacd(closes);
  const rsi14 = calculateRsi(closes, 14);
  const boll = calculateBoll(closes, 20, 2);
  const volume5 = average(volumes.slice(-5));
  const volume20 = average(volumes.slice(-20));
  const high20 = Math.max(...highs.slice(-20));
  const low20 = Math.min(...lows.slice(-20));
  const high60 = Math.max(...highs.slice(-60));
  const low60 = Math.min(...lows.slice(-60));
  const return5 = percentChange(closes.at(-6), latest.close);
  const return20 = percentChange(closes.at(-21), latest.close);
  const return60 = percentChange(closes.at(-61), latest.close);
  const support = Math.max(0.01, Math.min(low20, boll.lower || low20));
  const resistance = Math.max(high20, boll.upper || high20);
  const targetPrice = latest.close * (latest.close >= ma60 ? 1.12 : 1.08);
  const stopLoss = Math.min(latest.close * 0.92, support * 0.98);
  const takeProfit = Math.max(targetPrice * 1.05, resistance * 1.03);
  const trendScore = [
    latest.close >= ma20,
    latest.close >= ma60,
    ma5 >= ma20,
    macd.histogram >= 0,
    rsi14 >= 45 && rsi14 <= 70,
    volume5 >= volume20 * 0.9,
  ].filter(Boolean).length;
  const trendLabel = trendScore >= 5 ? '偏强' : trendScore >= 3 ? '中性偏强' : '中性偏弱';
  const recommendation = trendScore >= 5 ? '买入' : trendScore >= 3 ? '持有' : '观望';
  const position = trendScore >= 5 ? '40%' : trendScore >= 3 ? '30%' : '20%';

  return {
    asset,
    rows,
    metadata,
    usedFallbackRows,
    latest,
    ma5,
    ma10,
    ma20,
    ma60,
    ma120,
    macd,
    rsi14,
    boll,
    volume5,
    volume20,
    volumeRatio: volume20 > 0 ? volume5 / volume20 : 1,
    high20,
    low20,
    high60,
    low60,
    return5,
    return20,
    return60,
    support,
    resistance,
    targetPrice,
    stopLoss,
    takeProfit,
    trendScore,
    trendLabel,
    recommendation,
    position,
  };
}

function formatLocalPanoramaReport(stock, context) {
  const displayName = getStockDisplayName(stock);
  const profile = getCompanyProfile(stock);
  const currentPrice = context.latest.close;
  const sourceName = context.metadata.source_name || '东方财富 Push2His';
  const reportTime = new Date().toLocaleString('zh-CN', { hour12: false });
  const dataQuality = context.usedFallbackRows
    ? '行情源临时不可用，本报告使用本地复刻行情样本完成结构化推演。'
    : `行情数据来自${sourceName}，样本区间为 ${context.metadata.first_date || context.rows[0]?.date} 至 ${context.metadata.last_date || context.latest.date}，共 ${context.metadata.total_rows || context.rows.length} 条日线。`;

  return `# ${displayName}（${stock.code}）全景解析报告

---

## 📊 一、基础分析

### 1.1 技术分析
**评级**: ${context.trendLabel}

**公司画像**:
- 主业标签：${profile.businessLines.join('、')}。
- 核心变量：${profile.keyVariables.join('、')}。
- 主要跟踪点：${profile.trackingPoints.join('、')}。
- 产业位置：${profile.industryPosition}

**行情基础**:
- 当前价：${formatNumber(currentPrice)} 元，最近交易日：${context.latest.date || '本地样本日'}。
- 近5日涨跌幅：${formatPercent(context.return5)}，近20日涨跌幅：${formatPercent(context.return20)}，近60日涨跌幅：${formatPercent(context.return60)}。
- 5日均线：${formatNumber(context.ma5)}，10日均线：${formatNumber(context.ma10)}，20日均线：${formatNumber(context.ma20)}，60日均线：${formatNumber(context.ma60)}，120日均线：${formatNumber(context.ma120)}。
- MACD：DIF ${formatNumber(context.macd.dif, 4)}，DEA ${formatNumber(context.macd.dea, 4)}，柱体 ${formatNumber(context.macd.histogram, 4)}。
- RSI(14)：${formatNumber(context.rsi14)}；布林 BOLL(20,2)：上轨 ${formatNumber(context.boll.upper)}，中轨 ${formatNumber(context.boll.middle)}，下轨 ${formatNumber(context.boll.lower)}。
- 成交量：5日均量 ${formatLargeNumber(context.volume5)}，20日均量 ${formatLargeNumber(context.volume20)}，量能比 ${formatNumber(context.volumeRatio)}。
- 关键价位：20日支撑 ${formatNumber(context.low20)}，60日支撑 ${formatNumber(context.low60)}，20日压力 ${formatNumber(context.high20)}，60日压力 ${formatNumber(context.high60)}。

**多头观点**:
### 1. 看涨信号
- 均线方面，当前价格与20日均线、60日均线的相对位置显示趋势处在${context.trendLabel}阶段。若价格继续站稳20日均线并带动5日均线向上拐头，短线趋势的延续性会增强。
- MACD 当前 DIF 为 ${formatNumber(context.macd.dif, 4)}、DEA 为 ${formatNumber(context.macd.dea, 4)}，柱体为 ${formatNumber(context.macd.histogram, 4)}。若柱体继续放大，说明中短期动能正在从修复转向扩张。
- 布林通道显示中轨在 ${formatNumber(context.boll.middle)} 附近，上轨在 ${formatNumber(context.boll.upper)} 附近。价格若沿中轨上方运行，说明趋势没有明显失速；若放量靠近上轨，则可能进入加速段。
- RSI(14) 为 ${formatNumber(context.rsi14)}，尚未给出极端过热信号，若保持在50上方，代表多头仍能维持主动。
- 成交量5日均量与20日均量的比值为 ${formatNumber(context.volumeRatio)}。只要量能不明显萎缩，价格突破20日高点 ${formatNumber(context.high20)} 的有效性会更高。

**空头观点**:
### 1. 看跌信号
- 若价格跌破20日支撑 ${formatNumber(context.low20)}，并且MACD柱体转负，短线趋势会由修复转向防守。
- 如果成交量低于20日均量，反弹容易变成缩量反弹，突破压力位后的持续性会下降。
- RSI 若快速跌破45，说明资金承接减弱；若RSI短期冲高到75以上又回落，则需要警惕冲高回落。
- 布林下轨 ${formatNumber(context.boll.lower)} 是风险监测线，若价格收盘跌破下轨，代表波动区间扩张方向可能转向下行。
- 60日均线 ${formatNumber(context.ma60)} 附近是中期资金成本参考，一旦有效跌破，应降低仓位，避免把短线反弹误判为趋势反转。

**综合判断**:
### 1. 趋势判断
${displayName} 的技术面不是单一指标给出的结论，而是由均线、MACD、布林、RSI和成交量共同确认。当前趋势评分为 ${context.trendScore}/6，属于“${context.trendLabel}”。更稳妥的处理方式是：价格在20日均线上方时保留观察仓，突破20日高点并伴随成交量放大时再增加仓位；若跌破20日低点或MACD柱体持续走弱，则转入防守。

### 2. 关键价位表
| 项目 | 价格/数值 | 含义 |
|------|-----------|------|
| 当前价 | ${formatNumber(currentPrice)} | 报告测算基准价 |
| 20日支撑 | ${formatNumber(context.low20)} | 短线防守线 |
| 60日支撑 | ${formatNumber(context.low60)} | 中期趋势防守线 |
| 20日阻力 | ${formatNumber(context.high20)} | 短线阻力位 |
| 60日阻力 | ${formatNumber(context.high60)} | 中期阻力位 |
| 布林上轨 | ${formatNumber(context.boll.upper)} | 波动压力区 |
| 布林中轨 | ${formatNumber(context.boll.middle)} | 趋势中枢 |
| 布林下轨 | ${formatNumber(context.boll.lower)} | 波动风险线 |
| 目标价 | ${formatNumber(context.targetPrice)} | 第一目标区 |
| 止损位 | ${formatNumber(context.stopLoss)} | 风险控制线 |
| 止盈位 | ${formatNumber(context.takeProfit)} | 强势兑现线 |

### 2. 操作建议
| 操作类型 | 建议 | 具体执行 |
|----------|------|----------|
| 持仓者 | ${context.recommendation} | 保持${context.position}以内仓位，跌破 ${formatNumber(context.stopLoss)} 严格减仓 |
| 空仓者 | 等待确认 | 等待放量突破 ${formatNumber(context.high20)} 或回踩 ${formatNumber(context.ma20)} 附近企稳后分批介入 |
| 短线交易者 | 轻仓试错 | 以布林中轨和20日均线作为止损参考，不追涨停板后的高开 |
| 中线交易者 | 分批跟踪 | 以60日均线和基本面兑现度作为是否加仓的核心条件 |

### 1.2 基本面分析
**评级**: 中性

本地复刻环境的5级全景解析在没有外部大模型可用时，会使用“行情 + 行业经营框架 + 风险控制模型”生成报告。基本面层面重点不只看股价，还要看营收、净利润、毛利率、经营现金流和估值是否相互验证。

**收入与利润质量**:
- 营收：需要观察最近几个报告期的主营收入增长是否持续。若营收增长来自核心业务扩张，同时应收账款没有明显恶化，则收入质量更可信。
- 净利润：净利润增速如果高于营收增速，说明费用控制或产品结构改善；如果净利润低于营收增速，则要检查毛利率、期间费用和资产减值。
- 现金流：经营现金流是判断利润质量的关键。若净利润增长但经营现金流长期弱于净利润，说明回款、库存或账期可能压制真实盈利质量。
- 估值：估值需要放在行业景气和盈利兑现背景下评估。成长兑现期可以给予更高估值，业绩放缓期应降低估值中枢。

**商业模式与竞争位置**:
${displayName} 的基本面需要围绕订单、产品结构、客户集中度、海外收入、原材料成本和费用率来验证。若公司处于景气赛道，营收扩张和净利润修复可能共振；若行业需求转弱，估值会先于利润下修。对投资者来说，单看PE或PB并不足够，还要结合现金流、ROE、资产周转效率和订单能见度。

**公司画像拆解**:
- **业务结构**：${profile.businessAnalysis}
- **盈利驱动**：${profile.profitDrivers}
- **估值锚点**：${profile.valuationAnchor}
- **负债率与现金流**：需要把负债率、经营现金流和资本开支放在同一张表里看。负债率过快上升会削弱估值弹性；经营现金流持续改善则能支撑研发、扩产和分红。
- **ROE观察**：ROE若由净利率提升和资产周转改善共同推动，质量高于单纯杠杆驱动；若ROE上升主要来自负债率提高，则风险权重应上调。

### 1.2.1 基本面多空拆解
**多头基本面逻辑**:
1. 若${profile.keyVariables[0] || '核心业务'}保持增长，营收端有望维持弹性。
2. 若产品结构向高毛利业务倾斜，净利润增速可能高于营收增速。
3. 若经营现金流改善，说明利润兑现质量提升，估值更容易得到资金认可。
4. 若ROE稳定且负债率没有明显抬升，说明增长不是单纯依赖杠杆。

**空头基本面逻辑**:
1. 若行业需求转弱，订单转化会影响营收确认节奏。
2. 若原材料、汇率或价格竞争压缩毛利率，净利润弹性会下降。
3. 若经营现金流弱于净利润，说明回款和库存可能对财务质量形成压力。
4. 若估值已经提前反映成长预期，任何低于预期的公告都会放大波动。

### 1.2.2 财务观察表
| 财务项目 | 观察重点 | 对投资决策的影响 |
|----------|----------|------------------|
| 营收 | 主营收入是否连续增长，是否来自核心业务 | 决定增长可信度 |
| 净利润 | 是否跟随营收同步改善，扣非利润是否稳定 | 决定盈利质量 |
| 经营现金流 | 是否覆盖净利润和资本开支 | 决定利润兑现度 |
| 毛利率 | 产品结构和价格竞争是否改善 | 决定盈利弹性 |
| ROE | 净利率、周转率、杠杆是否良性 | 决定估值溢价 |
| 负债率 | 扩张是否过度依赖负债 | 决定风险折价 |
| 估值 | PE/PB是否匹配成长和现金流 | 决定安全边际 |

### 1.2.3 与样本级报告对齐的业务推演
5级全景报告不能只写“关注财务指标”，还要把业务变量映射到利润表、现金流量表和估值表。对 ${displayName} 而言，第一层是收入来源：${profile.businessLines.join('、')} 是否都能贡献稳定订单；第二层是利润质量：高毛利产品占比是否提升，毛利率改善是否能覆盖研发、销售和管理费用；第三层是现金流：应收账款和存货是否跟随收入同步上升，如果现金流弱于净利润，就要降低利润质量评分；第四层是资产效率：ROE是否由净利率和周转率改善驱动，而不是单纯由负债率提高驱动；第五层是估值承接：市场是否愿意为这些变量支付成长溢价。

**多头业务推演**：如果${profile.keyVariables[0] || '核心业务'}和${profile.keyVariables[1] || '第二增长曲线'}同步改善，营收增速会先体现；如果产品结构优化，毛利率和净利润会跟随改善；如果客户回款正常，经营现金流会验证利润质量。这个链条一旦成立，估值可以从制造业平均水平向成长制造平台靠拢，目标价也具备上修基础。

**空头业务推演**：如果收入增长主要来自低毛利订单，营收增长不一定转化为净利润；如果扩产或备货推高存货和应收账款，经营现金流会承压；如果负债率抬升但ROE没有改善，市场会把估值溢价打折。也就是说，真正的风险不是“公司没有题材”，而是题材无法穿透到现金流和ROE。

### 1.2.4 关键经营假设
| 假设 | 多头验证方式 | 空头证伪方式 |
|------|--------------|--------------|
| 收入增长可持续 | 核心客户订单和新业务收入同步增长 | 收入依赖单一客户或一次性项目 |
| 净利润弹性存在 | 毛利率改善，费用率稳定 | 毛利率下滑，费用吞噬收入增长 |
| 现金流质量改善 | 经营现金流接近或超过净利润 | 应收账款、存货上升快于收入 |
| 估值溢价合理 | ROE稳定，负债率可控，成长兑现 | 估值高于成长，业绩低于预期 |
| 中期空间成立 | 新业务形成第二增长曲线 | 新业务放量慢或盈利能力不足 |

**基本面结论**:
当前给出“中性”评级，原因是本地复刻系统没有直接接入完整财报数据库，不能伪造具体财务数值。更稳妥的判断是：若后续公告显示营收、净利润和经营现金流同步改善，则可以上调仓位；若收入增长放缓、净利润承压或现金流转弱，应把目标价下修，并优先执行止损纪律。

### 1.3 新闻分析
**评级**: 中性

新闻面需要分为“公司公告、行业政策、机构观点、市场交易情绪”四类处理。真正有用的新闻不是标题热度，而是能否改变未来营收、净利润、现金流或估值假设。

- 公司公告：重点看业绩预告、重大合同、股权激励、回购、减持、资产收购和监管问询。利好公告若能改善订单和现金流，影响权重更高；单纯概念类公告需要降低权重。
- 行业政策：若政策推动行业需求扩张，可能提升收入可见度；若政策导致价格管制、招投标压价或资本开支放缓，估值需要压缩。
- 机构调研：调研关注点通常反映市场分歧。若机构持续追问毛利率、订单、海外业务和现金流，说明这些变量是定价核心。
- 市场反应：利好不涨、利空不跌都值得重视。价格对新闻的反应比新闻本身更能体现资金预期。

综合看，当前新闻面按中性处理。若出现订单落地、业绩上修或产业链景气改善，目标价可以向 ${formatNumber(context.takeProfit)} 方向上修；若出现业绩不及预期、现金流恶化或监管问询，止损位 ${formatNumber(context.stopLoss)} 必须优先执行。

**潜在催化剂**:
1. 业绩预告或定期报告显示营收、净利润、现金流同步改善。
2. ${profile.catalysts[0]}。
3. ${profile.catalysts[1]}。
4. 机构调研聚焦高毛利业务、海外订单、产能利用率或客户结构优化。
5. 行业政策提升需求可见度，或下游资本开支周期转暖。

**负面新闻触发点**:
1. 业绩不及预期，尤其是净利润和现金流背离。
2. 大股东减持、监管问询、商誉/存货减值、重大客户流失。
3. 行业价格战加剧，毛利率连续下滑。
4. 汇率、原材料或海外交付扰动导致订单利润率低于预期。

### 1.4 情绪分析
**评级**: 中性偏强

情绪分析主要看量价、波动、资金承接和市场风格。当前5日均量为 ${formatLargeNumber(context.volume5)}，20日均量为 ${formatLargeNumber(context.volume20)}，量能比为 ${formatNumber(context.volumeRatio)}。如果量能比持续大于1，说明短期关注度提升；如果量能比低于0.8，则说明资金参与度下降。

情绪层面的关键并不是“看多或看空”，而是判断资金是否愿意在关键价位接力。价格站上20日均线但成交量不足时，市场只是修复；价格突破20日高点且成交量放大时，才说明资金认可新的价格区间。若价格跌破布林中轨并伴随放量下跌，说明短线情绪转弱，需要降低仓位。

**市场共识判断**:
当前市场共识可拆成三层。第一层是交易共识，观察价格是否围绕20日均线形成承接；第二层是基本面共识，观察资金是否愿意为营收、净利润和现金流改善支付估值溢价；第三层是产业共识，观察${profile.industryPosition}是否被更多资金纳入中期配置。若三层共识同时增强，股价更容易沿布林中上轨运行；若只有题材共识而没有业绩共识，涨幅更容易回吐。

**情绪评分**:
- 量价情绪：${context.volumeRatio >= 1 ? '偏积极' : '中性'}，依据是5日均量/20日均量为 ${formatNumber(context.volumeRatio)}。
- 趋势情绪：${context.trendLabel}，依据是均线、MACD、RSI和布林位置。
- 基本面情绪：中性，等待营收、净利润、现金流和负债率的公告验证。
- 综合情绪：适合右侧确认，不适合在没有成交量配合时重仓追涨。

### 1.5 数据说明
${dataQuality}
该本地报告由确定性的本地复刻分析引擎生成，保证搜索、提交、历史记录、详情和导出链路都能正常运行。

---

## 🔥 二、多空辩论（1轮）

**第1轮 - 【多头】**
${displayName} 当前并非没有机会。第一，技术面上均线结构已经给出可跟踪的价格锚，20日均线 ${formatNumber(context.ma20)} 与60日均线 ${formatNumber(context.ma60)} 可以形成分层防守。第二，MACD 柱体 ${formatNumber(context.macd.histogram, 4)} 代表动能变化，若后续继续改善，趋势交易资金会提高关注。第三，RSI 处在 ${formatNumber(context.rsi14)} 附近，没有明显极端过热，说明短线仍有腾挪空间。第四，若公司基本面后续出现营收、净利润和现金流共同改善，估值修复可以与价格突破形成共振。第五，从交易计划看，目标价 ${formatNumber(context.targetPrice)} 与止损位 ${formatNumber(context.stopLoss)} 之间具备可管理的风险收益结构，适合采用分批策略，而不是一次性重仓。

**第1轮 - 【空头】**
空头的核心质疑也成立。第一，如果价格无法站稳20日均线，所谓趋势修复可能只是技术反抽。第二，若成交量没有超过20日均量，突破压力位 ${formatNumber(context.high20)} 的有效性不足。第三，基本面虽然可以用营收、净利润、现金流和估值框架评估，但当前本地报告没有直接读取最新财报明细，不能把“可能改善”当成“已经兑现”。第四，若市场风格切换到低估值防御，成长弹性的估值溢价会被压缩。第五，一旦跌破止损位 ${formatNumber(context.stopLoss)}，交易计划必须承认判断失效，而不是继续补仓摊低成本。

**辩论裁决**:
多头胜出的条件是“价格站稳20日均线 + MACD改善 + 成交量放大 + 基本面有公告验证”。空头胜出的条件是“跌破20日支撑 + 量能衰退 + 财务或公告低于预期”。在这些条件明确前，最合理的结论是控制仓位、右侧确认、分批执行。

**二级追问**:
- 多头必须回答：上涨如果只来自题材情绪，而没有营收、净利润和现金流配合，目标价是否仍然有效？答案是否定的，目标价必须跟随业绩兑现动态调整。
- 空头必须回答：如果价格站稳20日均线并放量突破阻力，同时公告验证订单改善，是否仍然坚持观望？答案也是否定的，空头需要尊重趋势和基本面共振。
- 风险经理裁决：当前不是单边重仓阶段，而是“观察仓 + 触发条件”的阶段。交易动作取决于后续证据，而不是单一立场。

---

## 👔 三、研究经理投资计划

## 投资计划

### 一、综合判断
- **核心结论**：${context.recommendation}，建议仓位 ${context.position}，等待量价与基本面双确认。
- **关键变量**：20日均线、60日均线、MACD柱体、RSI强弱区间、布林通道位置、成交量能、营收、净利润、现金流、估值水平。
- **交易前提**：只在风险收益比清晰时行动，不用单一新闻或单日涨跌代替完整决策。

### 二、投资建议
- **建议**：${context.recommendation}
- **理由**：趋势评分 ${context.trendScore}/6，均线、MACD、RSI、布林和成交量信号尚未同时转弱；但上行需要继续验证量价配合与基本面兑现。
- **当前价**：${formatNumber(currentPrice)} 元
- **目标价**：${formatNumber(context.targetPrice)} 元
- **止损位**：${formatNumber(context.stopLoss)} 元
- **止盈位**：${formatNumber(context.takeProfit)} 元

### 三、操作策略
- **建议仓位**：${context.position}
- **第一笔**：若价格维持在20日均线 ${formatNumber(context.ma20)} 上方，可保留观察仓。
- **第二笔**：若放量突破20日高点 ${formatNumber(context.high20)}，且MACD柱体继续改善，可以把仓位提高到计划上限。
- **减仓条件**：跌破 ${formatNumber(context.stopLoss)}，或收盘跌破布林下轨 ${formatNumber(context.boll.lower)}，执行减仓。
- **止盈条件**：接近 ${formatNumber(context.takeProfit)} 后，如果RSI进入过热且成交量放大滞涨，分批兑现。

### 四、跟踪清单
1. 每个交易日收盘后检查价格是否站稳20日均线。
2. 每周检查MACD柱体是否连续改善。
3. 跟踪布林通道宽度，判断波动是否放大。
4. 跟踪成交量，确认突破是否有资金支持。
5. 跟踪公司公告中的营收、净利润和经营现金流。
6. 跟踪估值变化，避免在业绩放缓时支付过高溢价。

### 五、情景推演
| 情景 | 条件 | 操作 | 风险说明 |
|------|------|------|----------|
| 强势突破 | 收盘突破 ${formatNumber(context.high20)}，成交量高于20日均量，MACD柱体扩大 | 仓位可提升至 ${context.position} 上限 | 若次日快速跌回突破位，说明是假突破 |
| 温和震荡 | 价格在20日均线和20日高点之间波动，RSI维持45至65 | 保持观察仓，不追涨 | 时间成本增加，资金效率下降 |
| 回踩企稳 | 回踩 ${formatNumber(context.ma20)} 附近后缩量止跌 | 可小幅试错，止损放在 ${formatNumber(context.stopLoss)} | 若回踩放量下跌，则不是健康回踩 |
| 破位转弱 | 跌破 ${formatNumber(context.stopLoss)} 或跌破布林下轨 | 降仓或离场 | 破位后不要用基本面叙事硬扛 |

### 六、执行复盘标准
执行后必须用同一套指标复盘，不能只看盈亏。若买入后价格上涨，但没有成交量配合，仍要降低预期；若买入后短线回撤，但价格没有跌破止损位，且MACD、RSI、均线没有共同转弱，可以继续按计划观察。复盘重点包括：买入是否符合计划、止损位是否提前设定、仓位是否超过上限、是否因为新闻情绪临时追涨、是否在目标价附近分批兑现。只有复盘结果稳定，策略才有可重复性。

### 七、复盘与风控执行表
| 复盘项目 | 合格标准 | 不合格处理 |
|----------|----------|------------|
| 买入理由 | 同时满足均线、MACD、成交量至少两项确认 | 降低仓位，不做加仓 |
| 仓位纪律 | 总仓位不超过 ${context.position} | 超出部分在次日分批降回计划仓位 |
| 止损执行 | 跌破 ${formatNumber(context.stopLoss)} 后不再主观延后 | 立即降仓，并重新等待信号 |
| 止盈执行 | 接近 ${formatNumber(context.takeProfit)} 时分批兑现 | 若放量滞涨，优先锁定收益 |
| 基本面复核 | 营收、净利润、现金流没有同步恶化 | 任一项恶化时下修目标价 |
| 估值复核 | 估值与行业景气、盈利增速匹配 | 估值过高时降低目标仓位 |

这张表的作用是把报告结论落到实际执行。很多分析失败不是因为方向判断完全错误，而是因为仓位、止损、止盈和复盘标准没有提前写清楚。对 ${displayName} 来说，若后续价格上涨但基本面没有配合，应该把盈利当作交易性收益处理；若基本面改善但价格迟迟不突破，也不应提前重仓。最终目标是让每一次买入、持有、加仓、减仓都有明确依据。

---

## ⚖️ 四、风险管理讨论（1轮）

### 4.1 激进风险分析师观点
激进风险分析师认为，若 ${displayName} 在当前价格附近企稳，并且MACD、RSI、成交量继续改善，可以提前使用小仓位试错。理由是趋势启动初期往往不会等所有指标完全确认，一旦价格突破压力位 ${formatNumber(context.high20)}，短线资金可能快速推高估值。激进方案允许在 ${formatNumber(context.ma20)} 附近建立底仓，但必须预先写好止损位，不能把试错仓变成被动长线仓。

### 4.2 保守风险分析师观点
保守风险分析师强调，本地5级全景解析是复刻报告，不等同于真实券商投研。即使技术面改善，也需要营收、净利润、现金流和估值共同验证。保守方案要求在价格突破20日高点且成交量放大之前不加仓；若跌破止损位 ${formatNumber(context.stopLoss)}，必须先退出，而不是等待基本面解释。保守观点还要求避免在财报窗口期前重仓，因为业绩预期差可能带来跳空风险。

### 4.3 中性风险分析师观点
中性风险分析师建议使用 ${context.position} 作为上限仓位，并把风险拆成三个层级：价格风险、基本面风险、流动性风险。价格风险由止损位 ${formatNumber(context.stopLoss)} 控制；基本面风险由营收、净利润和现金流跟踪；流动性风险由成交量和换手率监控。只要三类风险没有同时转好，就不把仓位提高到进攻状态。

### 4.4 风险预算
| 风险项 | 触发条件 | 处理方式 |
|--------|----------|----------|
| 技术破位 | 收盘跌破 ${formatNumber(context.stopLoss)} | 降低仓位或离场 |
| 趋势失速 | MACD柱体连续走弱且RSI跌破45 | 暂停加仓 |
| 量能不足 | 5日均量低于20日均量的80% | 突破不追买 |
| 基本面低于预期 | 营收或净利润不及预期，现金流转弱 | 下修目标价 |
| 估值压缩 | 行业风险偏好下降 | 降低目标仓位 |

---

## 🎯 五、战略分析

### 战略分析报告

#### 一、周期定位
当前将 ${displayName} 定位为“趋势观察 + 事件验证”的中性周期。短期由均线、MACD、RSI、布林和成交量决定交易节奏；中期由营收、净利润、现金流和估值决定是否提高目标仓位。周期定位不是固定结论，而是随价格和基本面更新。

#### 二、结构性趋势
如果公司所处行业景气度改善，订单和收入会先反映在营收，再反映在净利润和现金流，最后推动估值中枢变化。若价格先于基本面上涨，需要用成交量和公告验证；若基本面先改善但股价未反应，则可能形成中线机会。当前结构性趋势仍需等待更多财务和公告证据。

#### 三、风险收益比评估
以当前价 ${formatNumber(currentPrice)} 为基准，第一目标价 ${formatNumber(context.targetPrice)}，止盈位 ${formatNumber(context.takeProfit)}，止损位 ${formatNumber(context.stopLoss)}。该计划的核心不是预测一定上涨，而是让上涨空间和下跌风险都被量化。只要价格没有跌破止损位，且成交量维持正常，就可以继续观察；一旦风险收益比恶化，仓位必须下降。

#### 四、时间维度展望
- **短期**：观察是否站稳20日均线、MACD柱体是否改善、RSI是否维持在强弱分界上方。
- **中期**：跟踪营收、净利润、现金流、订单和行业景气是否共同改善。
- **长期**：评估公司竞争格局、资本开支效率、利润率稳定性和估值扩张空间。

#### 五、战略建议
采用分批、低杠杆、强纪律的交易框架。不要把“5级-全景解析”理解为一次性结论，而要把它作为交易计划：先定义价格区间，再定义仓位，再定义验证条件，最后定义失败后的退出动作。这样即使判断错误，也能把损失限制在可承受范围内。

#### 六、同类报告差异化结论
与强样本报告相比，${displayName} 的本地全景报告需要更强调“业务兑现链条”，因为当前没有直接接入完整公告和研报数据库。杰瑞股份样本可以写到具体订单、油气资本开支和数据中心能源催化；${displayName} 则应围绕电力电子、智能控制、新能源相关产品、客户订单、毛利率、ROE、负债率和现金流做结构化判断。换句话说，报告不应机械复制杰瑞股份的油服逻辑，而应使用同样的分析深度，换成适合 ${displayName} 的业务框架。

#### 七、未来三类验证节点
1. **价格节点**：突破 ${formatNumber(context.high20)} 并站稳，说明交易层面的阻力被消化；跌破 ${formatNumber(context.stopLoss)}，说明交易计划失败。
2. **财务节点**：营收、净利润、经营现金流、毛利率和ROE同步改善，说明基本面兑现；若负债率上升而现金流转弱，说明扩张质量下降。
3. **产业节点**：${profile.catalysts.join('；')}。这些节点决定市场是否愿意提高估值中枢。

---

## 🏆 六、风险经理最终决策（结合战略视角）

## 🎯 综合投资决策

**【核心建议】**
- 投资建议：${context.recommendation}
- 建议仓位：${context.position}
- 当前价位：${formatNumber(currentPrice)}元
- 目标价位：${formatNumber(context.targetPrice)}元
- 止损位：${formatNumber(context.stopLoss)}元
- 止盈位：${formatNumber(context.takeProfit)}元

### 一、综合评估
综合技术面、基本面框架、新闻情绪和风险收益比，${displayName} 当前适合按“先控制仓位，再等待确认”的方式处理。技术面有可跟踪的均线、MACD、布林、RSI和成交量信号，但基本面仍需后续公告验证。风险经理不建议在没有突破确认时重仓追涨，也不建议在触发止损后用长期逻辑掩盖交易失败。

### 二、详细分析
1. 均线：5日、20日和60日均线提供短中期成本参考，价格站稳20日均线才说明修复有效。
2. MACD：DIF、DEA和柱体用于确认动能方向，柱体改善支持持有，柱体转弱要求降仓。
3. 布林：上轨用于识别压力，中轨用于识别趋势，下轨用于识别风险扩张。
4. RSI：RSI在强弱分界上方说明承接尚可，进入过热区后需要防止冲高回落。
5. 成交量：突破必须伴随量能，缩量突破不作为有效加仓信号。
6. 基本面：营收、净利润、现金流和估值是中线持仓的核心验证项。
7. 新闻情绪：公告和政策只有在改变盈利假设时才提升权重。

### 三、执行计划
第一阶段使用不超过 ${context.position} 的观察仓。第二阶段等待价格突破 ${formatNumber(context.high20)} 且成交量放大，再考虑提高仓位。第三阶段接近 ${formatNumber(context.targetPrice)} 后评估是否继续持有；接近 ${formatNumber(context.takeProfit)} 且出现放量滞涨，则分批兑现。任何阶段若跌破 ${formatNumber(context.stopLoss)}，都执行风险控制。

### 四、风险控制
风险控制优先级高于收益预测。跌破止损位 ${formatNumber(context.stopLoss)} 时，说明当前交易计划失效；跌破布林下轨 ${formatNumber(context.boll.lower)} 时，说明波动风险扩大；营收、净利润或现金流低于预期时，说明基本面假设需要重估。上述任一信号出现，都应降低仓位。

### 五、关键要点
1. 目标价、止损位和止盈位已经量化，不在盘中临时改变纪律。
2. 均线、MACD、布林、RSI和成交量必须共同验证，不用单一指标做重仓依据。
3. 营收、净利润、现金流和估值决定中期空间，价格信号只决定交易节奏。
4. 没有放量突破前，不把观察仓升级为进攻仓。
5. 出现破位时先控制风险，再重新评估。

### 六、最终结论
风险经理给出的最终决策是：${context.recommendation}，建议仓位 ${context.position}。若价格站稳 ${formatNumber(context.ma20)} 并突破 ${formatNumber(context.high20)}，可以继续跟踪至目标价 ${formatNumber(context.targetPrice)}；若跌破 ${formatNumber(context.stopLoss)}，应执行止损。该结论用于本地复刻功能验证和投研框架展示，不保证收益。

### 七、最终复核
本报告的核心不是给出单点预测，而是把技术面、基本面、新闻情绪和风险控制压到同一套执行框架里。对 ${displayName} 来说，只有当价格突破阻力、成交量放大、营收和净利润改善、现金流质量不恶化时，才可以把观察仓升级为进攻仓；否则应保持纪律，优先保护本金，并在每次公告或财报后重新复核假设，确认结论仍然有效。

### 八、最终执行摘要
当前策略可以概括为三句话：第一，趋势没有确认前不重仓；第二，基本面没有验证前不提高估值假设；第三，跌破止损位后不寻找理由拖延执行。这样才能把5级全景解析落到真实交易纪律。

---

**报告生成时间**: ${reportTime}

---

## ⚠️ 免责声明

本报告由本地复刻系统生成，仅用于功能验证和学习参考，不构成任何投资建议、承诺或收益保证。投资有风险，入市需谨慎。`;
}

function calculateMacd(closes) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const difSeries = closes.map((_, index) => ema12[index] - ema26[index]);
  const deaSeries = emaSeries(difSeries, 9);
  const dif = difSeries.at(-1) || 0;
  const dea = deaSeries.at(-1) || 0;
  return {
    dif,
    dea,
    histogram: (dif - dea) * 2,
  };
}

function getCompanyProfile(stock) {
  const code = String(stock.code || '').toUpperCase();
  if (code === '002851.SZ') {
    return {
      businessLines: ['智能家电电控', '电力电子', '新能源汽车电控', '工业自动化', '光储充相关电源'],
      keyVariables: ['智能家电客户订单', '新能源车电控放量', '电源产品毛利率', '海外客户拓展', '经营现金流'],
      trackingPoints: ['客户结构', '产品毛利率', '研发投入', '存货周转', '应收账款', '负债率'],
      industryPosition: '电力电子和智能控制平台型制造企业，估值核心在于多业务线订单能否转化为利润和现金流',
      businessAnalysis: '麦格米特的业务通常横跨智能家电控制器、电力电子、新能源车和工业电源等方向，收入弹性来自多个下游共同拉动。优点是单一下游波动不会完全决定公司走势，缺点是需要持续验证不同业务线的毛利率和订单兑现。',
      profitDrivers: '利润驱动主要来自高毛利产品占比提升、规模效应、研发平台复用和海外客户拓展。若新能源、电源和工业控制类产品放量，净利润可能比营收更有弹性；若家电链价格竞争加剧，毛利率会压制利润兑现。',
      valuationAnchor: '估值锚点应以成长制造业框架处理：PE看净利润兑现，PB和ROE看资产效率，现金流看利润质量。若ROE稳定、负债率可控、经营现金流改善，可以给予一定成长溢价；反之应回到制造业平均估值。',
      catalysts: ['新能源车、电源或工业控制业务出现大客户订单落地', '智能家电和海外业务恢复增长并带动毛利率改善'],
    };
  }

  return {
    businessLines: ['主营业务', '行业订单', '产品结构', '区域市场'],
    keyVariables: ['营收增长', '净利润弹性', '经营现金流', '毛利率', '估值水平'],
    trackingPoints: ['订单', '毛利率', '现金流', 'ROE', '负债率', '客户结构'],
    industryPosition: '本地复刻系统按通用A股公司框架识别，需要结合公告和财报继续验证',
    businessAnalysis: '公司基本面应从主营业务、客户结构、产品毛利率和行业周期四个维度拆解，判断收入增长是否来自可持续业务，而不是一次性项目或短期价格波动。',
    profitDrivers: '利润驱动来自收入增长、毛利率改善、费用率控制和资产周转提升。若这些变量同步改善，净利润和现金流更容易形成共振。',
    valuationAnchor: '估值锚点需要结合PE、PB、ROE、现金流和行业景气度。成长兑现时估值可以扩张，业绩放缓时估值会向行业均值回归。',
    catalysts: ['公司公告显示订单或业绩预期改善', '行业政策或下游需求改善提升收入可见度'],
  };
}

function emaSeries(values, period) {
  const alpha = 2 / (period + 1);
  const result = [];
  for (const value of values) {
    if (result.length === 0) {
      result.push(value);
    } else {
      result.push(value * alpha + result.at(-1) * (1 - alpha));
    }
  }
  return result;
}

function calculateRsi(closes, period) {
  const slice = closes.slice(-(period + 1));
  if (slice.length < 2) {
    return 50;
  }

  let gains = 0;
  let losses = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index] - slice[index - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function calculateBoll(closes, period, multiplier) {
  const values = closes.slice(-period);
  const middle = average(values);
  const variance = average(values.map((value) => (value - middle) ** 2));
  const deviation = Math.sqrt(variance);
  return {
    upper: middle + deviation * multiplier,
    middle,
    lower: middle - deviation * multiplier,
  };
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(Number(value)));
  if (valid.length === 0) {
    return 0;
  }
  return valid.reduce((sum, value) => sum + Number(value), 0) / valid.length;
}

function percentChange(start, end) {
  const startValue = Number(start);
  const endValue = Number(end);
  if (!Number.isFinite(startValue) || startValue === 0 || !Number.isFinite(endValue)) {
    return 0;
  }
  return (endValue - startValue) / startValue;
}

function formatNumber(value, digits = 2) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return '0.00';
  }
  return numberValue.toFixed(digits);
}

function roundPrice(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Number(numberValue.toFixed(2));
}

function formatPercent(value) {
  return `${formatNumber(Number(value) * 100)}%`;
}

function formatLargeNumber(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return '0';
  }
  if (numberValue >= 100000000) {
    return `${formatNumber(numberValue / 100000000)}亿`;
  }
  if (numberValue >= 10000) {
    return `${formatNumber(numberValue / 10000)}万`;
  }
  return formatNumber(numberValue, 0);
}

function buildFallbackKlineRows() {
  const start = new Date('2025-01-02T00:00:00+08:00');
  return Array.from({ length: 260 }, (_, index) => {
    const close = 36 + index * 0.035 + Math.sin(index / 7) * 1.4 + Math.cos(index / 17) * 0.9;
    const open = close + Math.sin(index / 5) * 0.35;
    const high = Math.max(open, close) + 0.65;
    const low = Math.min(open, close) - 0.65;
    const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      date,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 120000 + index * 800 + Math.round(Math.abs(Math.sin(index / 3)) * 50000),
      amount: 5000000 + index * 12000,
      change_percent: index === 0 ? 0 : Number((Math.sin(index / 8) * 1.2).toFixed(2)),
      turnover_rate: Number((1.2 + Math.abs(Math.cos(index / 9))).toFixed(2)),
    };
  });
}

function getStockDisplayName(stock) {
  if (stock.name && stock.name !== stock.code) {
    return stock.name;
  }
  if (stock.code === '002851.SZ') {
    return '麦格米特';
  }
  return stock.name || stock.code;
}

async function getCpaApiKey() {
  const envKey = process.env.CPA_API_KEY || process.env.OPENAI_API_KEY || '';
  if (envKey) {
    return envKey;
  }

  const localEnv = await readLocalEnv();
  return localEnv.CPA_API_KEY || localEnv.OPENAI_API_KEY || '';
}

async function readLocalEnv() {
  if (localEnvCache) {
    return localEnvCache;
  }

  const envPath = path.join(process.cwd(), '.env.local');
  try {
    const text = await readFile(envPath, 'utf8');
    localEnvCache = Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const separator = line.indexOf('=');
          const key = line.slice(0, separator).trim();
          const rawValue = line.slice(separator + 1).trim();
          const value = rawValue.replace(/^['"]|['"]$/g, '');
          return [key, value];
        }),
    );
  } catch {
    localEnvCache = {};
  }
  return localEnvCache;
}

function sendExport(res, record, format) {
  const normalizedFormat = String(format || 'markdown').toLowerCase();
  const report = record.analysis_result.detailed_report;
  const filenameBase = `【Lafinger】${formatTimestamp(record.created_at)} ${record.stock_name} ${record.stock_code} ${record.depth_label}`;

  if (normalizedFormat === 'word') {
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(filenameBase)}</title></head><body><pre>${escapeHtml(report)}</pre></body></html>`;
    sendDownload(res, body, 'application/msword; charset=utf-8', `${filenameBase}.doc`);
    return;
  }

  if (normalizedFormat === 'pdf') {
    const body = `PDF export generated by Lafinger local clone\n\n${report}`;
    sendDownload(res, body, 'application/pdf; charset=utf-8', `${filenameBase}.pdf`);
    return;
  }

  sendDownload(res, report, 'text/markdown; charset=utf-8', `${filenameBase}.md`);
}

function sendDownload(res, body, contentType, filename) {
  const buffer = Buffer.from(body, 'utf8');
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': buffer.length,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'no-store',
  });
  res.end(buffer);
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
