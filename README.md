# MockTrading
模拟交易

## 逆神站点复刻

本项目当前包含一个 `https://www.losergod.com` 的本地前端镜像：

- `npm run mirror`：递归抓取原站首页、Vite chunk、CSS、图片和图标到 `public/`。
- `npm start`：启动本地静态服务，默认地址 `http://localhost:5173`。
- `npm run verify`：用本机 Chrome 打开本地站点，校验未登录首屏和本地 mock 登录后的首页。

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
