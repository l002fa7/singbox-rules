# singbox-rules

以 [echs-top/proxy](https://github.com/echs-top/proxy) 为上游，产出 **sing-box `.srs` 规则集** 并自动跟随上游更新。

当前范围：**直连（direct）** 与 **去广告（ads）** 两类规则。直连含域名与 IP，去广告为域名。

## 产物

| 规则集 | 文件 | 说明 | 订阅直链 |
|---|---|---|---|
| 直连域名 | `rule/domain/direct.srs` | `cn` + `proxy@direct` + `spotify` + `private` | `https://raw.githubusercontent.com/l002fa7/singbox-rules/main/rule/domain/direct.srs` |
| 直连 IP | `rule/ip/direct.srs` | 同上游 `list/ip/direct.list` | `https://raw.githubusercontent.com/l002fa7/singbox-rules/main/rule/ip/direct.srs` |
| 去广告域名 | `rule/domain/ads.srs` | 同上游 `list/domain/ads.list` | `https://raw.githubusercontent.com/l002fa7/singbox-rules/main/rule/domain/ads.srs` |

jsDelivr 镜像（国内更快）：

- `https://cdn.jsdelivr.net/gh/l002fa7/singbox-rules@main/rule/domain/direct.srs`
- `https://cdn.jsdelivr.net/gh/l002fa7/singbox-rules@main/rule/ip/direct.srs`
- `https://cdn.jsdelivr.net/gh/l002fa7/singbox-rules@main/rule/domain/ads.srs`

## 数据来源

| 规则集 | 信源 |
|---|---|
| 直连域名 | 上游 `list/domain/cn.list`（已含上游 `cn-lite` + `cn-additional` 合并结果） |
| 直连域名 | 上游 `list/domain/proxy@direct.list`（直连场景下需要放行的域名） |
| 直连域名 | [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community) `data/spotify` |
| 直连域名 | [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata) `private.list` —— 与上游 `work/domain/direct.list` 第 1 行同源 |
| 直连 IP | 上游 `list/ip/direct.list` |
| 去广告域名 | 上游 `list/domain/ads.list`（其上游为 AWAvenue-Ads-Rule、217heidai/adblockfilters、peter 列表及上游自身的增删） |

上游自身只产出 MRS（用 mihomo 内核转换），本仓库用 **sing-box 官方 CLI** 编译出 SRS。

## 格式转换规则

Clash/mihomo 文本：

| 源语法 | sing-box 字段 |
|---|---|
| `+.example.com` | `domain_suffix`（含子域与自身） |
| `*.example.com` | `domain_regex: ^.+\.example\.com$`（仅子域） |
| `example.com`（裸域） | `domain`（精确匹配） |
| `*` | `domain_suffix: "*"`（实测为不命中任何域名的死规则，保留上游保真） |

v2fly `domain-list-community` 文本（裸域语义与 clash 相反）：

| 源语法 | sing-box 字段 |
|---|---|
| `spotify.com`（裸域） | `domain_suffix`（含子域） |
| `full:xxx` | `domain`（精确） |
| 带 `@ads` 属性 | 跳过（**不并入任何规则集**，包括 ads） |

## 自定义增删

每组规则各有一对增删文件：

| 规则集 | 追加 | 删除 |
|---|---|---|
| 直连域名 | `custom/direct-add-domain.list` | `custom/direct-del-domain.list` |
| 去广告域名 | `custom/ads-add-domain.list` | `custom/ads-del-domain.list` |

追加在合并上游数据之后执行；删除在追加之后执行，可用作误杀白名单。
两者语法与 clash domain 文本一致（`+.x` / `*.x` / 裸域）。删除采用覆盖语义，详见各文件内注释。
改动后 push 即会触发重建。

## 自动同步

`.github/workflows/build.yml`：

- 每天 UTC 18:43（北京时间 02:43）定时运行，滞后上游一步以取到当日新数据
- 支持 `workflow_dispatch` 手动触发
- 修改 `config/`、`scripts/`、`custom/`、`test/` 时自动重建
- 产物无变化则不产生提交
- sing-box 追踪最新 stable，版本号写入 commit message

## 本地构建与验证

需要 Node.js 18+ 与 sing-box CLI。

```bash
node --test "test/*.test.mjs"
node scripts/build.mjs --singbox /path/to/sing-box
```

构建流水线：拉取 → 解析 → 合成（追加/删除/去冗余）→ 写无 BOM 源 JSON → `sing-box rule-set compile` → 冒烟断言 → 落盘。
任一环节失败即整次构建失败，不会覆盖已有产物。

## 构建校验

`test/cases.json` 中的语义断言每次构建都会执行：

| 规则集 | 断言 |
|---|---|
| 直连域名 | `www.baidu.com` 必须命中 |
| 直连域名 | **`claude.ai` / `chatgpt.com` 必须不命中**（防止内容被误并入直连） |
| 直连域名 | `www.google.com` 必须不命中（证明 `*` 不是 catch-all） |
| 直连 IP | `223.5.5.5` 命中，`8.8.8.8` 不命中 |
| 去广告域名 | `doubleclick.net`、`ad.cyapi.cn` 必须命中 |
| 去广告域名 | **`adeventtracker.spotify.com` 必须不命中**（v2fly spotify 的 `@ads` 行不得被并入） |
| 去广告域名 | `a0.app.xiaomi.com` 必须不命中（上游删除项生效），`www.baidu.com` 必须不命中 |

## 致谢

- [echs-top/proxy](https://github.com/echs-top/proxy)：上游规则仓库
- [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata)：private 规则来源
- [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community)：spotify 规则来源
- [SagerNet/sing-box](https://github.com/SagerNet/sing-box)：SRS 编译器

