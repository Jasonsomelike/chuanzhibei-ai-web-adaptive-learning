# 外部端点验证记录（2026-10-29）

- 环境：Windows 10.0.26300 / Git Bash / Node v24.15.0 / 仓库 `E:\传智杯`
- 脚本：`scripts/probe-external.ts`，入口 `npm run probe:external`
- 输出纪律：只打印 status、content-type、顶层 keys、结果数、音频字节数与首 4 字节；不打印密钥、Authorization、base64 或完整响应正文。
- 凭据检查方式：只检查 `.env.local` 中变量**是否存在**；为判断能否复用，额外读取了 `ALP_E2E_LLM_BASE_URL` 的 host 与模型名。没有打印任何密钥值。

## 1. 结论汇总

| 端点 | 本次结论 | 依据 |
| --- | --- | --- |
| DeepSeek 搜索 `https://api.deepseek.com/v1/tools/search` | **未验证**：缺 DeepSeek 官方凭据 | 见 §2.1、§2.3 |
| MiMo TTS `{baseUrl}/chat/completions` | **未验证**：缺 `MIMO_*` | 见 §2.2 |
| Embedding `{baseUrl}/embeddings` | **未验证**：缺 `ALP_EMBED_*` | 见 §2.1 |
| Tavily `https://api.tavily.com/search` | **未验证**：无 Tavily 密钥 | 见 §2.4 |
| 维基百科 `https://zh.wikipedia.org/w/api.php` | **未验证**：本机网络无法完成 TLS 握手 | 见 §2.5 |

本次没有任何端点完成「带凭据的成功调用」。下面所有「通过」字样只出现在单元测试段落，且已明确标注不是真机。

## 2. 实际命令与脱敏输出

### 2.1 全量探测

```bash
npm run probe:external
```

实际输出：

```text
外部端点真机探测
════════════════════════════════════════════════════════════════════════
只打印 status / content-type / 顶层 keys / 结果数 / 音频头；不打印密钥与正文。

== DeepSeek 搜索 ==
POST https://api.deepseek.com/v1/tools/search
未验证：缺少 DeepSeek 官方搜索凭据：ALP_E2E_LLM_BASE_URL 的主机是 api.jasonsome.cn，不是 api.deepseek.com；也没有 DEEPSEEK_API_KEY

== MiMo 语音合成 ==
端点：<未配置>
未验证：缺少 MIMO_BASE_URL / MIMO_API_KEY / MIMO_MODEL

== Embedding 向量 ==
端点：<未配置>
未验证：缺少 ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL

────────────────────────────────────────────────────────────────────────
汇总：通过 0 / 失败 0 / 未验证 3
```

说明：

- `.env.local` 里有 `ALP_E2E_LLM_BASE_URL / ALP_E2E_LLM_API_KEY / ALP_E2E_LLM_MODEL`，但 base_url 是 `https://api.jasonsome.cn/v1`（中转），不是 DeepSeek 官方域。脚本坚持「只有 base_url 主机是 api.deepseek.com 才把该 key 当 DeepSeek 搜索密钥」，因此不拿中转密钥去请求官方端点。
- `MIMO_BASE_URL / MIMO_API_KEY / MIMO_MODEL` 与 `ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL` 均未设置。
- 未验证时脚本退出码为 0：没测就是没测，不伪装成失败，也不伪装成通过。

### 2.2 单端点开关

```bash
npm run probe:external -- --deepseek-search
npm run probe:external -- --mimo
```

实际输出（两次都只到「未验证」）：

```text
== DeepSeek 搜索 ==
POST https://api.deepseek.com/v1/tools/search
未验证：缺少 DeepSeek 官方搜索凭据：ALP_E2E_LLM_BASE_URL 的主机是 api.jasonsome.cn，不是 api.deepseek.com；也没有 DEEPSEEK_API_KEY
```

```text
== MiMo 语音合成 ==
端点：<未配置>
未验证：缺少 MIMO_BASE_URL / MIMO_API_KEY / MIMO_MODEL
```

### 2.3 DeepSeek 端点可达性（无凭据）

```bash
curl -sS -m 20 -o /dev/null \
  -w "status=%{http_code} content-type=%{content_type}\n" \
  -X POST "https://api.deepseek.com/v1/tools/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"probe","count":1,"need_content":true}'
```

实际输出：

```text
status=401 content-type=application/json
```

结论：域名、路径与 TLS 可达，端点要求鉴权。**这不等于搜索功能已验证**——带正确密钥时的 `results` 形状、`rerank_score` 排序与 `need_content` 效果仍未验证。

### 2.4 Tavily 端点可达性（无凭据）

```bash
curl -sS -m 20 -o /dev/null \
  -w "status=%{http_code} content-type=%{content_type}\n" \
  -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"probe"}'
```

实际输出：

```text
status=401 content-type=application/json
```

结论：端点可达且要求鉴权；带密钥的成功响应未验证。

### 2.5 维基百科（免密钥，但本机不可达）

```bash
curl -4 -sS -m 20 -o /dev/null \
  -w "ipv4 status=%{http_code} content-type=%{content_type}\n" \
  "https://zh.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo"
```

实际输出：

```text
ipv4 status=000 content-type=
curl: (35) schannel: failed to receive handshake, SSL/TLS connection failed
```

改用应用同款 Node fetch 复测，同样失败：

```text
fetch_error=TypeError
```

结论：本机网络无法与 `zh.wikipedia.org` 完成 TLS 握手，维基百科供应商**未做真机验证**。代码里的请求参数与归一化只在单测中用固定响应验证过。

### 2.6 失败分支的脱敏检查（假凭据，不是端点验证）

```bash
MIMO_BASE_URL="https://mimo.invalid/v1" \
MIMO_API_KEY="<FAKE-KEY>" \
MIMO_MODEL="fake-model" \
npx tsx scripts/probe-external.ts --mimo
```

实际输出：

```text
== MiMo 语音合成 ==
POST https://mimo.invalid/v1/chat/completions
请求路径：chat/completions（不是 /audio/speech）
结论：失败（TypeError，未打印响应正文）

────────────────────────────────────────────────────────────────────────
汇总：通过 0 / 失败 1 / 未验证 0
```

脚本退出码 1；对输出做 `grep` 假密钥无命中。这只证明失败路径不会打印密钥，**不构成 MiMo 端点验证**。

## 3. 已用单元测试验证的部分（不是真机）

```bash
npx vitest run \
  src/lib/serverSearch.test.ts \
  src/lib/serverTts.test.ts \
  src/lib/search-tts-route.test.ts
```

2026-10-29 实际结果：

```text
Test Files  3 passed (3)
     Tests  47 passed (47)
```

覆盖内容：

- 三家搜索的固定端点、请求方法、Authorization、请求体字段与 15 秒超时；
- `auth / rate-limit / timeout / http / parse / empty` 六类错误，以及错误信息里的密钥脱敏；
- MiMo 只请求 `{baseUrl}/chat/completions`，测试显式断言 URL 不含 `/audio/speech`；
- TTS 的 60 秒超时、10MB 上限被传给 `ssrfGuard.guardedRequest`；3xx 不跟随；
- 路由层：未登录 401、匿名维基可用、deepseek 缺密钥 404、llm 行仅官方域回退、TTS 超长 400、非 JSON 415、mimo 解析失败 502。

未覆盖：

- 任何真实供应商的成功响应；真实音频能否播放；真实 embedding 维度；
- 维基百科真实响应（本机不可达）；
- 真实 DNS 解析与 SSRF 拦截链路（`ssrfGuard.test.ts` 是独立文件，不在本次三条命令内）。

## 4. 复验方法

1. 在 `.env.local` 里补：
   - `DEEPSEEK_API_KEY`（或把 `ALP_E2E_LLM_BASE_URL` 指向 `https://api.deepseek.com` 并共用其 key）；
   - `MIMO_BASE_URL / MIMO_API_KEY / MIMO_MODEL`（可选 `MIMO_VOICE`）；
   - `ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL`。
2. 运行 `npm run probe:external`（或带 `--deepseek-search` / `--mimo` / `--embedding`）。
3. 只有看到 `status: 2xx`、`results ≥ 1` 或 `audio 字节数 > 0`，才可以把本文件对应行从「未验证」改成「已实测」，并附上这次输出。
4. 维基百科需要在能访问 `zh.wikipedia.org` 的网络里重跑 §2.5；本机当前无法握手，不代表代码不可用。

## 5. 结论

截至 2026-10-29，DeepSeek 搜索、MiMo TTS、Embedding 三个端点都没有完成带凭据的真机验证；Tavily 与维基百科同样没有成功响应记录。本文只记录实际跑出的状态码与「未验证」原因，不写「已实测」。生产实现已按固定端点/协议落地，真实响应形状待凭据补齐后按 §4 复验。
