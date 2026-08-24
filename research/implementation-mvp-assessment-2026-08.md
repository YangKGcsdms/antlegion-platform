# 实现是否达到 MVP 级别：把 §10.2 的 MUST 逐条对照代码（2026-08）

「MVP 级别」在这里的判据不是「能跑 demo」，而是：**规范里每一条 MUST，代码里有没有对应的
一行，以及有没有一条测试在守着它。** 一条只写在文档里的 MUST 等于没有。

对照对象：`PROTOCOL.md` v3.0 §10.2（M1–M15，总线必须做的）、§10.3（R1–R7，可选但一旦
采用就必须暴露）、§7.5（INFO）、§8.1–§8.4（读者侧折叠，规范性）、附录 A（一致性目标）。

---

## 一、§10.2 的 15 条 MUST

| # | 规则 | 落点 | 守它的测试 | 判定 |
|---|---|---|---|---|
| M1 | 拒绝违反 §5 值域的事实 → 400 | `types.ts:validateFactInput`，`bus.ts:append` 第一行 | `v3-storage-validation` 前 4 条（非有限 ts / 非对象 payload / 非法 type / 空 refs 值） | ✅ |
| M2 | 拒绝多于一个生命周期 ref → 400 | 同上 | `v3-storage-validation`「at most one lifecycle ref」 | ✅ |
| M3 | 超 §B 上限 → 413 | `types.ts` + `DEFAULT_LIMITS` | `v3-storage-validation`「413 与 400 分开」 | ✅ |
| M4 | 复算 `id`，拒绝客户端不匹配值 | `bus.ts:append`（`input.id !== id` → 400） | `core.test` | ✅ |
| M5 | 因果深度超限 → 400 | `bus.ts:depthOf` + 拒绝分支 | `core.test`（深度上限） | ✅ |
| M6 | 稠密、严格递增、永不复用的 `seq` | `bus.ts:++seqCounter`；恢复取最大值 | `adversarial-v3`「撕裂尾部的 seq 被重发」 | ⚠️ **有条件成立** —— 见下 |
| M7 | `recv` 随 `seq` 单调不减 | `bus.ts:Math.max(now, lastRecv)` | `core.test` | ✅ |
| M8 | 对 `id\|author\|type\|ts\|recv\|seq` 签名 | `hash.ts:computeSig` | `safety-sig` | ✅ |
| M9 | 返回 201 前按策略落盘 | `bus.ts` 先 `log.append` 后 return；`log.ts` 按 `fsyncPolicy` | `info-persistence` | ✅ |
| M10 | 恢复时复验 `id` 与 `sig`，分别计数 | `bus.ts:recover` | `safety-sig`、`info-persistence` | ✅ |
| M11 | 日志内部损坏时拒绝启动 | `log.ts:LogCorrupt` | `v3-storage-validation` | ✅ |
| M12 | **Δ 记进日志；冲突 Δ 拒绝服务** | `log.ts:readMeta/writeMeta`，`bus.ts:pinClaimTimeout` | `adversarial-v3` 4 条 | ✅ **本轮新增** |
| M13 | 接受未知 `refs` 键且不解释 | `bus.ts` 整体复制 `input.refs`，只有已知键进折叠 | `fold-*` 间接 | ✅ |
| M14 | 不存储未知顶层字段 | `bus.ts` 逐字段构造 `Fact`，其余丢弃 | `v3-storage-validation`「M14」（本轮补） | ✅ |
| M15 | 除压缩外不改不删已存事实 | 结构使然（只有 `log.compact` 会重写） | `info-persistence`（压缩保留骨架） | ✅ |

### M6 的条件

`seq` 对日志仍持有的每一条事实都不复用。被撕裂尾部截断掉的那个号会被重发。逐条 `fsync`
下这是安全的（那个号从未被 `201` 确认过）；放宽策略下不是。规范原本两句话自相矛盾，本轮
按实际交互重写了 §11.1，代码注释也从「永不复用，包括截断之后」改成了事实描述。

**这是「规范订正到与实现一致」，不是「实现修到与规范一致」** —— 因为正确的行为无法在不加
一个每次追加都 fsync 的 seq 高水位文件的前提下实现，而那正是放宽策略要避免的成本。

### M14 原本的缺口（本轮已补）

代码一直是对的（`Fact` 逐字段构造），但没有测试钉住它 —— 属于「今天成立，明天有人写成
`...input` 就悄悄不成立」那类，而且失败是静默的：一个能来回穿越的未知字段，就是读者开始
依赖的字段，协议就是这么长出来的。已补一条：追加带 `evil` 顶层字段的事实，断言它既不在
内存投影里也不在 journal 里。

---

## 二、§10.3 的 R1–R7

| # | 规则 | 状态 |
|---|---|---|
| R1 | 不可信网络上认证写者 | ❌ 未实现，规范允许（SHOULD）。这是 §12.2 那条边界的实现面 |
| R2 | 每作者令牌桶 + 全局准入 | ❌ 未实现（MAY，无默认值） |
| R3 | 默认绑回环 | ✅ `config.ts` HOST 默认 `127.0.0.1`；非回环时启动打警告 |
| R4 | **MUST** 通过 `/info` 报告密钥不稳定 | ✅ `secret_stable` |
| R5 | 默认逐条 fsync；可提供放宽策略并报告 | ⚠️ **偏离**：`config.ts` 默认 `everysec`，规范说 SHOULD 默认 per-append。已通过 `/info` 的 `fsync` 报告，所以不违反「MUST 报告」那半 |
| R6 | `sig` 各字段长度前缀 | ❌ 未实现，`hash.ts` 用 `\|` 拼接 |
| R7 | 过大 `limit` 夹取而非拒绝 | ✅ `bus.ts:read` 夹取 |

### R5 的偏离值得单说

规范 R5 说「SHOULD 默认逐条 fsync」，`BusV2` 构造函数默认确实是 `always`，但
`loadConfig()`（也就是命令行跑起来的那条路）默认 `everysec`。于是**库的默认合规、
可执行文件的默认不合规**，而且没有任何地方说过为什么。

不是纯粹的疏漏：`everysec` 正是 Redis 的 `appendfsync` 默认，而这个项目通篇按 Redis 形状
做取舍。但 Redis 丢的是缓存，这里丢的是一条别人可能已经折进世界观的事实 —— 所以这个类比
不是免费的。见第七节，这一条留给作者拍板。

### R6 的实际风险

`author` 是无结构的 UTF-8，可以含 `|`。所以 `author="a|b", type="c"` 与
`author="a", type="b|c"` 拼出同一条签名消息。但 `sig` 只由总线自己验，而同一对事实的
`id` 不同（`id` 覆盖 author 与 type），恢复时的 `id` 复验会抓住任何这种调换。所以这是
**规范已知、当前被 `id` 挡住**的问题，不是可利用的洞。R6 该做，优先级不高。

---

## 三、§7.5 INFO

规范要求暴露：协议版本、`head_seq`、fsync 策略、密钥是否稳定、`sig` 与 `id` 失败计数、Δ。
实现全给了，另外还给了 `facts` / `log_entries` / `log_bytes` / `dedup_hits` /
`truncated_at` / `max_depth` / `limits` / `uptime_seconds`。✅ 超额。

---

## 四、读者侧（§8.1–§8.4，规范性）

四条折叠全部在 `fold.ts` 里，是对事实流的纯函数，没有隐藏状态：

| 折叠 | 函数 | 测试 |
|---|---|---|
| §8.1 寄存器 | `history` / `current` / `supersededBy` / `isSuperseded` / `retracted` | `fold-world-state` 16 条 |
| §8.2 踪迹 | `causationChain` / `descendants` / `depth`（含显式 gap 标记） | `fold-trust-causation` |
| §8.3 信任 | `trust`（quorum 可配，自票排除） | `fold-trust-causation` |
| §8.4 所有权 | `lifecycle` / `claimWinner` / `didIWin` | `fold-lifecycle` 11 条 + `adversarial-v3` |
| §8.5 可选约定 | `colony` / `orphanReport` / `contextGaps` | `fold-colony` 10 条 |

一个仍在的形状问题：**`FoldOpts.claimTimeout` 可以省略，省略时默认 600。** 也就是说
「不合规」是这个 API 的默认路径 —— `lifecycle(stream, F)` 编译得过、跑得通、答案可能是错的。
`ClientV2` 会在第一次 sync 时从 `/info` 采用 Δ（`adoptClaimTimeout`），所以走 SDK 的人是
安全的；直接调 `fold.ts` 的人不是。

把 `claimTimeout` 改成必填是「构造上不可能不合规」的做法，代价是 ant/dsh/cli 全线签名变更。
本轮没做 —— 它是 API 破坏性变更，该和一次版本变更一起走。**记录为已知形状问题。**

---

## 五、附录 A 一致性

`conformance/vectors.json` 是散文之外的契约，两侧独立复现：

- TS：`test/conformance.test.ts`，90 条。
- Python：`conformance/verify.py`，独立实现，**204 条断言，0 失败**（不只复现哈希，
  也复现折叠输出）。

CI 里还有一道 `vectors-guard`：向量文件改动而提交信息里没有 `[protocol-change]` 就红。
✅ 这一项做得比大多数协议实现都实。

---

## 六、卫星包

| 包 | 状态 |
|---|---|
| `ant`（DCU 舰队） | `tsc --noEmit` 干净，119 测试通过，对着本提交的总线跑 `mvp --reqs N` 全链路闭合、`double executions 0` |
| `dsh-antlegion`（dsh 插件） | 5 测试通过；本轮补了安装脚本与端到端验证（见 `verify-loop.sh`），修了 peer 范围、`--roster` 漏报、resident 启动失败导致 patrol 永不启动 |
| `antlegion-alias` | 只是 `npx antlegion` 的转发壳，无逻辑 |

CI 已经把两个卫星包都接到**本提交的总线**（pack 成 tgz 装过去），而不是 npm 上那个 ——
这一点很关键，否则卫星包测的是三个版本之前的语义。

---

## 七、判定

**是 MVP 级别，而且比多数「MVP」扎实。** 依据：

1. §10.2 的 15 条 MUST，14 条有代码 + 有测试；M6 有条件成立，条件已写进规范。
2. 规范性折叠全在纯函数里，一致性契约由两种语言独立复现，向量改动有 CI 护栏。
3. 崩溃恢复、撕裂尾部截断、内部损坏拒绝启动、压缩保留骨架 —— 这些「没人看的路径」
   都有测试，这是 MVP 与 demo 的分界线。

**两个待办 + 一个要你拍板的：**

1. **`FoldOpts.claimTimeout` 改必填**，随下一次版本变更走。让「不合规」在构造上不可能，
   而不是靠文档提醒。这是 API 破坏性变更，本轮没动。
2. **R6 的长度前缀签名**，规范已写明「未来版本会要求」。当前被 `id` 复验挡住，不紧急。
3. **fsync 默认要不要统一（需要你决定）。** `BusV2` 默认 `always`，`loadConfig()` 默认
   `everysec`，所以库合规、命令行不合规（R5 说 SHOULD 默认逐条）。但 `everysec` 正是
   Redis 的默认，而这个项目是照 Redis 形状做的 —— 所以这可能是有意的产品取舍，而不是
   疏漏。本轮**没有改**：改一个持久化默认值会改变 `201` 的含义，那是你的决定不是我的。
   两条路都行得通 —— 把 `config.ts` 改成 `always`，或者在 §10.3 R5 里写明「本实现按
   Redis 形状默认 everysec，并通过 `/info` 报告」。目前的状态是两个默认值不一致且没人
   说过为什么，那是唯一不该保留的选项。

R1/R2/R6 未实现是规范允许的部署选择，不影响 MVP 判定 —— 但 R1（写者认证）决定了这东西
能不能离开信任边界，见 `protocol-v3-audit-2026-08.md` 第五节。
