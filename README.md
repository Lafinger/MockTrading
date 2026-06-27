# MockTrading
模拟交易

## 逆神站点复刻

本项目当前包含一个 `https://www.losergod.com` 的本地前端镜像：

- `npm run mirror`：递归抓取原站首页、Vite chunk、CSS、图片和图标到 `public/`。
- `npm start`：启动本地静态服务，默认地址 `http://localhost:5173`。
- `npm run verify`：用本机 Chrome 打开本地站点，校验未登录首屏、登录后首页、关键路由，以及真实 A 股历史行情来源。

### A 股真实历史数据

本地 mock API 中的 A 股/ETF/指数历史行情已替换为东方财富公开行情接口：

- 数据源：东方财富 `push2his.eastmoney.com` 历史 K 线接口。
- 选型原因：无需密钥、可直接 HTTP 调用、A 股覆盖较全、日线历史足够长；实测 `000001.SZ` 可追溯到 1991-04-03，上证指数可追溯到 1990-12-19。
- 覆盖接口：`/api/random_data`、`/api/simulated_range/stock`、`/api/simulated_range/etf`、`/api/data/historical_range`、`/api/compare/kline/batch`、`/api/quant_index/overlay_data`、`/api/index_signals/*`、`/api/search/stocks`、`/api/search/etfs`、`/api/stock-selection/search`。
- 缓存目录：`.losergod-cache/ashare/`，缓存的是已从东方财富拉取过的真实数据。
- 默认复权：前复权。可在 PowerShell 中设置 `$env:ASHARE_ADJUST='none'` 使用不复权，或 `$env:ASHARE_ADJUST='hfq'` 使用后复权。

本地 mock 登录可使用任意手机号和密码，例如：

- 手机号：`13800138000`
- 密码：`123456`

默认 API 模式是本地 mock，不会把业务接口转发到外部。需要联通原站后端时，可在 PowerShell 中运行：

```powershell
$env:LOSERGOD_API='proxy'
npm start
```

`/api/time` 已按原站格式本地返回：`{"timestamp": 秒级时间戳}`。
镜像脚本会把前端资源里的原站绝对域名改成相对路径，便于本地 API 接管。
