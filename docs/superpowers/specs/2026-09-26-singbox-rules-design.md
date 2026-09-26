# singbox-rules 设计文档

日期：2026-09-26
状态：待用户审阅

## 1. 目标

建立一个公开 GitHub 仓库 `singbox-rules`，以 [echs-top/proxy](https://github.com/echs-top/proxy) 为上游，
产出 **sing-box `.srs`** 规则集，并跟随上游自动同步更新。

本轮范围（用户明确限定）：**仅直连（direct）规则**，含域名规则与 IP 规则。
代理规则、去广告规则不在本轮范围内，但架构必须为其预留扩展点。

## 2. 已确认的客观事实（取证结论）

### 2.1 上游只产出 MRS，不产出 SRS

| 上游路径 | 内容 |
|---|---|
| `work/domain/*.list`、`work/ip/*.list` | 配方文件（`+`/`-` 运算符 + 信源 URL） |
| `list/domain/*.list`、`list/ip/*.list` | 编译后的扁平规则文本 |
| `mrs/domain/*.mrs`、`mrs/ip/*.mrs` | 由 **mihomo `convert-ruleset`** 生成 |

上游 `.github/scripts/update-mrs-rules.sh` 下载 **mihomo** 内核做转换，因此**不存在可直接复用的 srs**，
必须自行用 sing-box 编译。

### 2.2 上游 direct 配方原文

`work/domain/direct.list`（8 行）：
```
+ list .../mihomo-ruleset/private.list            <- DustinWin
+ list .../mihomo-ruleset/cn-lite.list            <- DustinWin
+ yaml https://static-file-global.353355.xyz/rules/cn-additional-list-clash.yaml
+ list .../mihomo-ruleset/apple-cn.list
+ list .../mihomo-ruleset/microsoft-cn.list
+ list .../mihomo-ruleset/games-cn.list
+ list /work/list/direct_add_domain.list
- list /work/list/direct_del_domain.list
```

`work/ip/direct.list`（7 行）：privateip.list + 5 个 CN IP 源 + enhanced-FaaS-in-China。

**结论：`private` 与 `privateip` 确为上游自身引用 DustinWin 的产物**（`work/domain/direct.list:1`、
`work/ip/direct.list:1`），本项目沿用同名来源，未引入额外信源。

### 2.3 各信源实际格式（逐行统计）

| 源 | 行数 | 构成 |
|---|---|---|
| `list/domain/cn.list` | 32,232 | `+.`×32,213、裸域×19 |
| `list/domain/proxy@direct.list` | 291 | `+.`×203、裸域×87、`*.`×1 |
| `list/ip/direct.list` | 9,971 | 全 CIDR，已合并排序 |
| DustinWin `private.list` | 140 | `+.`×123、裸域×16、`*`×1 |
| v2fly `data/spotify` | 31 | 裸域×17、`full:`×11、3 条带 `@ads` |

### 2.4 sing-box 行为实测（v1.14.2）

| 实测项 | 结果 |
|---|---|
| `rule-set compile src.json -o out.srs` | 成功；源 JSON 需 `{"version":3,"rules":[...]}`，产物二进制 version 2 |
| `domain_suffix: ["example.com"]` | 命中 `example.com` 与 `www.example.com`（含 apex） |
| `domain: ["exact.test"]` | 只命中 `exact.test`，不命中 `sub.exact.test` |
| `ip_cidr: ["1.2.3.0/24"]` | 命中 `1.2.3.4`，不命中 `9.9.9.9` |
| `domain_suffix: ["*"]` | **不命中任何域名**（死规则，实测 `www.google.com`/`claude.ai` 全部 NO-MATCH） |
| `domain: ["*"]` | 仅命中字面量 `*` |
| `rule-set match` 退出码 | **命中与未命中退出码均为 0**，断言必须解析 stdout |
| PowerShell `Set-Content -Encoding UTF8` | 写入 BOM，sing-box 报 `invalid character 'ï'` 拒绝解析 |

> 勘误：设计初稿曾推测 `domain_suffix: "*"` 会「吞掉全部流量」。实测证伪，该担忧不成立。
> 因此 `private.list` 的 `*` 行按用户指示映射为 `domain_suffix: "*"`，保留上游保真度，不丢弃。

## 3. 方案选型

| | A：消费上游产物（**采用**） | B：submodule 引入上游 | C：复刻上游配方引擎 |
|---|---|---|---|
| 同步成本 | 极低 | 低，但被上游 `img/`（200MB+）拖累 | 高，上游改配方即漂移 |
| 继承上游增删逻辑 | 直接继承编译产物 | 继承 | 需自行复刻 |
| 仓库体积 | 小 | 巨大 | 小 |

采用 **方案 A**：直接消费上游已编译的 `list/**` 产物，继承其 `cn-lite + cn-additional` 合并逻辑，
不落地上游源文件。

## 4. 架构

### 4.1 目录结构

```
singbox-rules/
├─ .github/workflows/build.yml   # 定时 + 手动 + push 触发
├─ config/rulesets.json          # 声明式规则集定义（扩展点）
├─ scripts/
│  ├─ build.mjs                  # 编排：拉取→解析→合成→编译→校验
│  └─ lib/{fetch,parse,compose,compile,verify}.mjs
├─ custom/
│  ├─ direct-add-domain.list     # 用户追加（默认空）
│  └─ direct-del-domain.list     # 用户删除（默认空）
├─ rule/{domain,ip}/direct.srs   # 交付产物
├─ test/                         # node --test 单元测试
└─ README.md
```

技术栈选 **Node.js (ESM)**，纯标准库零依赖（内置 `fetch`、`node:test`）。
不用 YAML 改用 JSON 配置，以避免引入 YAML 解析器依赖。

### 4.2 规则集定义

**domain/direct** = `cn.list` + `proxy@direct.list` + v2fly `spotify` + DustinWin `private.list`
+ `custom/direct-add-domain.list` − `custom/direct-del-domain.list`

**ip/direct** = 上游 `list/ip/direct.list`

### 4.3 格式转换表（核心逻辑）

Clash/mihomo 文本：

| 源语法 | sing-box 字段 | 依据 |
|---|---|---|
| `+.example.com` | `domain_suffix: example.com` | 含子域与自身（实测） |
| `*.example.com` | `domain_regex: ^.+\.example\.com$` | 仅子域、不含自身 |
| `example.com`（裸域） | `domain: example.com` | 精确匹配（实测不含子域） |
| `*` | `domain_suffix: "*"` | 用户指定；实测为死规则，保留上游保真 |

v2fly `domain-list-community` 格式（**裸域语义与 clash 相反**）：

| 源语法 | sing-box 字段 | 依据 |
|---|---|---|
| `spotify.com`（裸域） | `domain_suffix: spotify.com` | v2fly 裸域 = 含子域 |
| `full:xxx` | `domain: xxx` | 精确 |
| 带 `@ads` 属性 | **跳过** | 广告/埋点，留给后续去广告规则 |
| `include:`/`keyword:`/`regexp:` | **显式报错中止** | 宁可失败也不静默漏规则 |

IP：每行 CIDR → `ip_cidr`；去重、排序；非法行报错。

### 4.4 合成规则

1. `+` 追加 → 去重
2. `-` 删除 → 前缀覆盖语义：`+.foo.com` 删除所有被 `foo.com` 覆盖的条目；裸域仅删精确条目
3. 后缀包含消除：若 `a.example.com` 已被 `+.example.com` 覆盖则丢弃
4. 精确域被同域后缀覆盖则丢弃

### 4.5 构建流水线

`fetch`（重试 + SHA256 留痕）→ `parse` → `compose` → 写临时源 JSON（**无 BOM**）→
`sing-box rule-set compile` → `verify` → 落盘 `rule/**/*.srs`。
**任一环节失败即整次失败，不覆盖既有产物**（临时目录构建 + 原子替换）。

## 5. CI 与同步策略

- `schedule`：`43 18 * * *`（对齐上游 02:43 CST，滞后一步取到新数据）
- `workflow_dispatch`：手动触发
- `push`（仅 `config/`、`scripts/`、`custom/`、workflow 变更时）
- 产物无变化则不提交（`git diff --cached --quiet` 判定）
- sing-box 追踪最新 stable，版本号写入 commit message
- 使用原生 `git` + `GITHUB_TOKEN`，不引入第三方 commit action（供应链最小化）

## 6. 验证金字塔

| 层级 | 内容 |
|---|---|
| 单元测试 | 解析器对各前缀/属性/directive 的映射；`@ads` 跳过；非法行报错 |
| 编译门禁 | `sing-box rule-set compile` 必须成功 |
| 语义冒烟 | `www.baidu.com` 命中；**`claude.ai` 必须不命中**（防误并 ai.list 回归护栏）；`spotify.com` 命中；`223.5.5.5` 命中；`8.8.8.8` 不命中；`www.google.com` 不命中（证明 `*` 非 catch-all） |
| 产物完整性 | srs 可 `rule-set decompile` 回读；规模落在合理区间 |
| 端到端 | 本机跑通全链路后再交给 CI |

## 7. 明确不做（YAGNI / 本轮范围外）

- 不产出源 JSON、文本 list、MRS（用户选定「只产出 .srs」）
- README 不含 sing-box 配置示例（用户明确不需要）
- 不做代理规则、去广告规则（下一轮）
- 不引入 Git submodule
- 不做 IP CIDR 跨源合并压缩（当前仅单一上游源，已合并排序）

## 8. 风险与未决

| 风险 | 处置 |
|---|---|
| 上游产物路径变更导致构建失败 | 构建失败即中止、不覆盖旧产物；README 记录数据源 |
| sing-box 升级导致 srs version 变化，旧客户端读不了 | README 标注最低 sing-box 版本；commit message 记录构建版本 |
| 上游 `cn.list` 体量增长 | 每次构建实测规模并断言区间，异常即失败 |
