# 1490钓鱼天气与潮汐预测系统

钓鱼天气、海况、潮汐、作钓指数和钓点社区的前端原型。

当前版本是单页原型：

- 地图：Leaflet + OpenStreetMap
- 天气：Open-Meteo Weather API
- 海况：Open-Meteo Marine API
- 潮汐：NOAA CO-OPS
- 数据保存：浏览器 `localStorage`
- 部署：Node 静态服务器，可用于 Railway

## 本地运行

```bash
npm start
```

默认地址：

```text
http://localhost:4173
```

如果端口被占用：

```bash
HOST=127.0.0.1 PORT=4180 npm start
```

## Railway 部署

1. 把本项目推到 GitHub 仓库。
2. 登录 Railway。
3. New Project -> Deploy from GitHub repo。
4. 选择这个仓库。
5. Railway 会读取 `package.json` 和 `railway.toml`。
6. 部署完成后访问 Railway 生成的域名。

Railway 启动命令：

```bash
npm start
```

健康检查：

```text
/health
```

管理员账号：

- 默认管理员邮箱：`61654733@qq.com`
- 可在 Railway Variables 里设置 `ADMIN_EMAILS` 追加管理员，多个邮箱用英文逗号分隔。
- 管理员仍需正常注册/登录；后端会按邮箱识别管理员权限。

## 当前限制

- 用户、钓点、钓获日志仍保存在浏览器本地，不是服务器数据库。
- 正式产品需要增加账号系统、数据库、权限控制、支付订阅和后端 API。
- 浏览器定位需要 `localhost` 或 HTTPS，`file://` 下可能被限制。
- 商业 API key 不应放在前端，应通过后端代理调用。

## 下一步后端建议

- PostgreSQL：用户、钓点、关注、订阅、钓获日志。
- Redis 或内存缓存：天气、海况、潮汐接口缓存。
- API 路由：统一代理 Open-Meteo、NOAA、Stormglass 等外部数据。
- 鉴权：邮箱/手机登录，后续可接 Google/Apple。
- 支付：Stripe，后续按地区扩展微信/支付宝。
