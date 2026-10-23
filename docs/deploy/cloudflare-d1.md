# Cloudflare Workers + D1 部署

## 本次部署

- 网站：<https://vocabflow.cestca.workers.dev>
- 代码：`CestcaVision/words.website` 的 `feat/cloudflare-d1` 分支。
- Worker：`vocabflow`，静态前端和 `/api/*` 同域部署，自带 HTTPS。
- D1：`vocabflow`，数据库 ID `a79439ad-4455-4031-a78e-79e1bdd83fa8`，创建位置提示 APAC。
- 用户明确选择：**只导入单词与中文释义，重新注册账号**。不迁移 Google Cloud 的旧账号、密码、AI Key、学习进度或日志。

Google Cloud 的 SQLite 文件不能作为运行时数据库直接绑定到 Workers。本仓库新增 `apps/worker/` 异步 D1 后端；原 Node/SQLite 入口仍可用于本地开发和旧部署。

## 你现在如何开始

1. 在旧 Google Cloud 网站进入“设置与导出”，点击“下载词汇 CSV”，保存 `word`、`zh` 两列。
2. 打开上述新站，注册新账号，登录。
3. 进入“导入词库”，上传 CSV，创建或选择目标词库，确认字段为单词/中文释义，点击确认导入。
4. 检查数量与中文释义。新的学习进度从零开始。
5. 进入“设置与导出 → 个人 AI 服务”，重新填写自己的 Base URL、模型名、API Key，保存后开启 AI 功能。每个用户各自配置。
6. 验证新站可用后，再处理 Google Cloud 实例。此次部署不会自动关闭或删除旧实例，旧云资源仍按其原计费方式存在。

网站不需要公网 IP、80/3000 端口、防火墙入站规则或 systemd。浏览器访问 HTTPS 域名即可。

## 实现与数据边界

所有学习表以 `user_id` 隔离，跨表关联使用包含账号 ID 的外键，服务端只使用已验证会话确定账号。客户端提交的 userId 无法改变所属空间。

D1 查询是异步的。涉及多步学习更新的请求使用 D1 `batch()` 事务：第一步版本守卫检测并发写入，冲突整批回滚并有限重试；复习 eventId 保持幂等，卡片 version 与持久化 epoch 防止旧标签页覆盖进度或误操作删除后重建的卡片。每日新词配额不会因删除单词返还。

新账号密码使用带随机盐的 scrypt（N=16384、r=8、p=5），适配 Workers 内存，不导入旧密码哈希。会话仅保存 token 哈希，有期限、HttpOnly、Secure、SameSite=Strict，写操作校验 CSRF；修改密码更新凭据版本，旧会话即刻失效。注册、登录、密码修改和 AI 配额在 D1 持久化，不能通过 Worker 重启绕过。

个人 AI Key 使用 AES-256-GCM 加密，账号 ID 作为附加认证数据；主密钥是 Worker Secret `AUTH_ENCRYPTION_KEY`，不会写入前端或仓库。界面不回显密钥。

Workers 版只允许管理员批准的公网 HTTPS 服务域名，且不跟随重定向。当前 `wrangler.jsonc` 中 `AI_ALLOWED_HOSTS` 为：

```text
api.openai.com,api.deepseek.com,api.xiaomimimo.com
```

要使用其他 OpenAI 兼容服务，由管理员先确认是可信公网服务，再将**精确域名**加入该配置并重新部署。用户仍可自行填写该服务的 Base URL 路径、模型及自己的 Key；此列表不配置共享 Key，也不允许通配符。

## 本机开发

在 Mac Terminal，而非 Google Cloud 的 SSH 终端：

```bash
cd /你的项目路径/words.website
git switch feat/cloudflare-d1
npm ci
npm run build
npm run cf:local:init
npm run cf:dev
```

打开 Wrangler 输出的本地地址（通常 `http://localhost:8787`）。本地 D1 使用 `.wrangler/`，不会写线上数据库。`.dev.vars` 在初始化时生成，仅供本地开发；它与线上 Secret 分开，不能提交 Git。已有本地密钥不会自动替换。

## 重新部署当前站点

```bash
npx wrangler login
npx wrangler whoami
npm run cf:migrate:remote
npm run cf:deploy
```

确认 Wrangler 登录的是你自己的 Cloudflare 账号，且配置中的 D1 ID 是你要部署的数据库。**`--remote` 表示线上；`--local` 表示本地，两者数据互不相通。** 发布只上传 Worker 与 `dist/` 静态文件，不上传本机 SQLite、`.env` 或私有导入文件。

后续源码更新：

```bash
git status --short
git pull --ff-only origin feat/cloudflare-d1
npm ci
npm run cf:migrate:remote
npm run cf:deploy
```

每条成功后再执行下一条。不要把 Mac 的本地代理地址写到 Worker 配置中。

## 从零创建另一套部署

先修改 `wrangler.jsonc` 的 Worker 名与 D1 名，避免覆盖已有服务，然后执行：

```bash
npx wrangler login
npx wrangler d1 create 你的数据库名 --location apac
```

将输出的 `database_id` 写入 `wrangler.jsonc` 的 `d1_databases`，保留 `binding: "DB"` 与迁移目录。然后运行迁移并上传独立密钥：

```bash
npm run cf:migrate:remote
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put AUTH_ENCRYPTION_KEY
npm run cf:deploy
```

**仅在全新站点首次生成密钥，不能在已有 AI 配置的站点随意重新生成**，否则原密钥无法解密。多账号登录的电脑需核对 Wrangler 的目标账号。

## 运维与凭据恢复

本次线上加密主密钥已保存在当前 Mac 的 `.wrangler/deployment-auth-encryption.key`，文件权限 600，已被 Git 忽略。请使用自己的私密备份保存它，不要粘贴到聊天或提交 Git。该文件不随普通 clone 下载；后续部署代码不需要重新设置 Secret。

管理员重置某账号密码（操作线上 D1）：

```bash
npm run cf:account -- reset-password 用户名
```

必须在交互终端输入新密码，密码不作为命令行参数、SQL 或日志输出。检查命令最后返回的用户名，用户名不存在时不会创建新账号。

普通用户仅导出词汇 CSV。管理员如需完整灾难恢复，可使用 D1 的导出/Time Travel 工具；这类运维数据包含账号和学习信息，应私密保管，且恢复加密 AI 配置仍需要原 Secret。前端没有 SQLite 下载/恢复入口，Workers 也不提供 `/api/backup` 或 `/api/restore`。

## 限制与验证范围

- 单次 CSV/TXT/Excel 导入最多 3000 行，请求总大小最多 4 MiB；内容过大时需拆分。已在真实本地 Workers 运行时验证 1532 行 CSV 导入。
- AI 请求每日每账号最多 30 次，间隔至少 10 秒；失败请求也占用一次额度。超时 45 秒，不接受跳转，响应最大 2 MiB。
- Workers、D1 有免费额度及平台限制，超额行为取决于账号套餐，不承诺任意流量永久免费。实际调用外部 AI 的费用由用户所选服务收取。
- 本地测试使用 workerd + D1，覆盖账号隔离、加密存储、CSRF、CSV、并发复习和会话撤销。线上使用临时测试账号验证 HTTPS 注册、导入、FSRS、统计、CSV 和退出，结束后只删除这些测试账号。
- 浏览器使用现有 Chrome 无头模式验证线上 390×844 手机与 1440×900 桌面登录/注册切换、非空页面、无错误遮罩与无控制台错误；Browser 插件与 Playwright 未安装，使用 Chrome CDP。真机 Safari 未验证。
- 实际第三方 AI 服务需由用户配置自己的 Key 后验证；没有使用旧 `.env` 的 Key 发起付费测试。

## 官方参考

- [Workers 静态资源与 SPA 路由](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [D1 Worker API 与 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)
- [Workers Node.js Crypto 支持](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- [Workers Secret](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers 平台限制](https://developers.cloudflare.com/workers/platform/limits/)
