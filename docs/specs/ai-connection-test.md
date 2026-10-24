# AI 连接诊断与服务兼容

线上排查发现已保存 DeepSeek 配置的账号 `settings.ai` 为 false，因此生成请求会在调用服务商前被拒绝。AI 开关与密钥保存独立；连接测试不受开关影响，成功后明确提示仍需开启 AI。

设置页面新增“测试连接”：使用当前输入的地址和模型，密钥留空时使用本账号保存的密钥；如果更换域名，必须重新输入密钥。测试不自动保存、不改变学习记录；每个账号限流，发送一条简短真实请求，可能消耗服务商额度。

生成与测试复用请求实现。小米官方域名使用 api-key 和 max_completion_tokens，其他服务继续使用 Bearer 和 max_tokens。MiMo、DeepSeek 显式关闭默认深度思考，避免简短词汇生成的输出预算被推理耗尽或导致长时间等待。

返回安全诊断（HTTP 状态、鉴权、权限、路径/模型、额度、超时、空响应及 JSON 格式），不把上游原始响应或密钥返回浏览器。Worker 保留精确域名白名单与禁止重定向，Node 保留 DNS 固定及 SSRF 检查。

参考：

- https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access
- https://mimo.mi.com/docs/en-US/quick-start/usage-guide/other/deep-thinking
- https://api-docs.deepseek.com/guides/thinking_mode/

验证：共享请求及 Worker 配置探针测试、真实本地服务浏览器成功/401 流程、未保存配置不被改变、AI 关闭时仍可独立测试、移动端显示及无运行时异常。浏览器插件不可用，使用临时目录安装的 Playwright 与系统 Chrome 验证；不连接生产服务商或使用真实密钥。
