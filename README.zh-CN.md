<div align="center">

[English](README.md) · 🌐 **简体中文**

# AntLegion

**AntLegion 是为智能体共享世界状态的事实日志。** 跨机器、跨运行时、跨厂商的智能体各自把观察写进同一条全序、只追加的日志，各自读日志、算出同一个世界——发生了什么、现在是什么、因何而起、引出了什么、可信与否。不发命令，不靠人转述。本地部署，可内嵌，像 Redis，不是 SaaS。

![npx @antlegion/bus demo——隔离进程、同一个世界、字节级重放](deploy/media/demo.gif)

[![npm](https://img.shields.io/npm/v/%40antlegion%2Fbus?style=flat-square&label=%40antlegion%2Fbus&color=CB3837&logo=npm)](https://www.npmjs.com/package/@antlegion/bus)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](antlegion-bus/tsconfig.json)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-405%20passing-brightgreen?style=flat-square)](antlegion-bus/test/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange?style=flat-square)]()

</div>

---

## 它解决什么

几个互不共享进程的智能体——本机的 Claude Code、CI 里的 Codex、服务器上的常驻 Agent、厂商托管的 Agent——之间唯一的状态通道是人：从一个窗口复制到另一个窗口。同一进程树内有子 Agent、有共享内存；物理隔离的智能体之间没有，只有人肉中继。

AntLegion 用一条日志取代这个中继。蚂蚁不下命令，只在地面留信息素，同伴读地面即知全局。这里的地面是一条**全序、只追加、内容寻址的事实日志**，"读地面"是一个确定性**折叠**：任何读者、任何节点、任何时刻、任何一次回放，算出的都是同一个答案。

## 核心思想

**只有事实，没有命令。**

"deploy:prod 现在是 v42"是事实，上日志。
"worker-3 去部署 v42"是命令，有收件人——日志里没有收件人。

事实的 `refs` 只指向**一条事实，或世界的一部分——绝不指向任何一方**：一条事实能说自己关于什么，说不了给谁。这就是"没有命令"的结构原因，也是它不是工作流引擎的原因——日志里没有步骤、没有指派、没有调度器。

总线只管一件事：**全序**。关于这个世界你想知道的一切，都是对全序的折叠（`PROTOCOL.md` §8，规范性）：

| 问题 | 折叠 |
|---|---|
| **X 现在是什么** | `subject` 寄存器——seq 最高者胜出；撤回后折叠为「一无所知」，绝不回到旧值 |
| **它是怎么来的 · 它引发了什么** | 因果踪迹——沿 `parent` 向后走到根，或向前走到每一个后代 |
| **它可不可信** | corroborate / contradict 投票，quorum 是读者的策略 |
| **谁对它负责** | seq 最小的存活 `claim_of`——所有权也是世界状态，恰好一次是全序的定理 |

这个顺序是有意的：它就是一个孤立 Agent 真正发问的顺序，而最后一问是**推论，不是目的**。一条流里一个 claim 都没有，它照样是个好世界。

同一条流，两个读者，答案必然相同——两台机器上的智能体之间只有这条日志，却算出同一个世界，这就是全部要点。它**不是**消息队列（事实不被消费）、**不是**编排器（没人派活）、**不是**工作流引擎（就算你搭出一条流水线，那也是读者事后从踪迹里折出来的形状，不是谁持有的状态）。

## 事实

一个本原，不可变、内容寻址、位于单一全序中的唯一位置：

```jsonc
{
  "seq":    1337,           // 总线分配的全序位置（可信）
  "recv":   1748300000.4,   // 总线盖章的可信接收时间——折叠用它，不用 ts
  "id":     "b3f1…",        // sha256(记录的 RFC 8785 JCS 规范串)——内容地址
  "type":   "deploy.status",// 点分类型；保留类型以 "_." 开头
  "author": "ci@build-7",   // 谁追加的
  "ts":     1748300000.0,   // 作者自报的时间（仅供参考——可伪造，永远别拿它折叠）
  "payload": { "…": "…" },  // 任意 JSON
  "refs": {                 // 唯一的关系机制——每个值命名一条事实或世界的
    "subject": "deploy:prod",  // 一部分，绝不命名任何一方。这就是没有命令的
    "parent":  "<id>",         // 结构性原因。（还有：tombstones · vote ·
    "supersedes": "<id>"       //  claim_of · resolves · release_of · about · answers）
  },
  "sig": "hmac…"            // 总线签的 HMAC-SHA256
}
```

**两个操作，这就是全部线面**：`POST /facts` 追加，`GET /facts?since=N` 读取。寄存器、踪迹、信任、所有权都是*关于事实的事实*，由读者折叠——见 [PROTOCOL.md](PROTOCOL.md)。

但不是每条链接都照单全收。`claim_of`／`resolves`／`release_of`／`tombstones` 是**生命周期 ref**——一条事实最多只能带一个——而且读者在采信之前要过几道门：你只能取代或撤回**你自己**的事实，只有当前 claim 胜出者才能 resolve，你也不能给自己的事实投票（[§10.1](PROTOCOL.md)，v3.0 新增）。

## 快速上手

**需要 Node.js ≥ 20。** 最快看一眼，零配置、零 API key、约 15 秒：

```bash
npx @antlegion/bus demo
```

真正的路径是一条总线加一个 shell。启动一次总线，然后让任何 Agent——这台机器上的或另一台上的——沉积与读取：

```bash
npx @antlegion/bus                                                # 1. 一条事实日志在 :28090（HOST=0.0.0.0 即可跨机共享）

# 机器 A
alctl publish deploy.status '{"v":42}' --subject deploy:prod      # 2. 沉积你观察到的

# 机器 B——另一个 Agent、另一种运行时，除了日志没有任何通道
alctl current deploy:prod                                         # 3. prod 现在是什么？→ 那条 v42 事实
alctl causation <id>                                              #    它是怎么来的？
alctl descendants <id>                                            #    它引发了什么？
```

杀掉总线，从日志重启，在任何地方再跑一遍第 3 步：同样的事实、同样的答案，逐字节一致。

想让它一直跑着，就按跑 Redis 的方式跑 —— 一个容器、一个卷、一个稳定的密钥：

```bash
docker run -d --name antlegion -p 28090:28090 \
  -v antlegion-data:/data -e ANTLEGION_BUS_SECRET=change-me \
  ghcr.io/yangkgcsdms/antlegion
```

镜像在容器内绑 `0.0.0.0` —— docker 网络就是信任边界，所以只把端口发布到你信任调用方的地方。
那个卷就是全部的持久化：一个只追加的日志，外加（在 v3.0 这条线上）把 Δ 钉在它身上的
`log-meta.json`，这也是为什么重启后的容器折出的是同一段历史而不是被重新解释过的历史。
`ANTLEGION_BUS_SECRET` 要设一个稳定值并留着：不设的话总线每次启动都会新铸一把 HMAC 密钥，
重启前写下的签名就验不过了。

> [!NOTE]
> `ghcr.io/yangkgcsdms/antlegion:latest` 和 `npx @antlegion/bus` 目前仍是 **0.4.1 / 协议 2.0**
> 那条线，0.5.0 尚未发布（见[当前状态](#当前状态)）。今天想要一条 v3.0 总线，就从这份 checkout
> 自己构建：仓库根执行 `docker build -t antlegion .`，然后跑那个 tag。v2.0 的日志在 v3.0 读者
> 下读不了，所以在开始写你想留下的事实之前先定好用哪一条。

→ **守护进程模式、从源码跑、完整环境变量表**：[docs/CONFIGURATION.md](docs/CONFIGURATION.md) · **分步导览**：[docs/QUICKSTART.md](docs/QUICKSTART.md)

## 从代码里用

折叠 SDK 吸收了「追加—读回—折叠」的工作（`npm i @antlegion/bus`）：

```typescript
import { ClientV2, httpTransport } from "@antlegion/bus/client";

// 两个除了总线地址什么都不共享的 Agent
const sensor  = new ClientV2(httpTransport("http://10.0.0.7:28090"), "sensor@node-a");
const watcher = new ClientV2(httpTransport("http://10.0.0.7:28090"), "watcher@node-b");

// A 沉积它看到的，然后修订——一个用普通字符串命名的寄存器
const r1 = await sensor.publish("deploy.status", { v: 41 }, { refs: { subject: "deploy:prod" } });
const r2 = await sensor.supersede(r1.id, "deploy.status", { v: 42 });
await sensor.publish("alarm.raised", { why: "p99 up" }, { refs: { parent: r2.id } });

// B 稍后在另一台机器上，折叠出同一个世界
await watcher.currentOf("deploy:prod");     // → 那条 v42 事实（r1 折叠为 superseded）
await watcher.historyOf("deploy:prod");     // → [r1, r2]——关于 prod 曾说过的一切
await watcher.descendants(r2.id);           // → [alarm.raised]——v42 引发了什么

// 所有权也是世界状态：两个 Agent 都想拥有某件事，
// seq 最小者胜出，两边从同一条流算出同一个赢家
const { id } = await sensor.publish("incident.open", { sev: 1 });
const [a, b] = await Promise.all([sensor.claim(id), watcher.claim(id)]);
console.log(a.won !== b.won, await watcher.state(id)); // true, { state: "claimed", owner: … }
```

→ 信任折叠、因果、撤回、以及进程内嵌入：[docs/QUICKSTART.md](docs/QUICKSTART.md)

## 接上你已经在用的 Agent

任何能跑 shell 命令的 Agent——Claude Code、Cursor、Codex CLI、一个 cron 任务、另一台机器上的常驻守护进程——都通过 **`alctl` CLI**（`redis-cli` 的对应物）接入同一条日志。每条命令输出机器可读的 JSON。

```bash
export ANTLEGION_AUTHOR=my-agent@my-host      # 稳定身份；一个身份 = 一个进程

alctl publish obs.metric '{"cpu":91}' --subject host:web-3     # 写下发生了什么
alctl current host:web-3                                       # 读世界
alctl read --type 'deploy.*' --since "$CURSOR"                  # 或从游标处 tail
alctl claim <id> && alctl resolve <id>                          # 拥有一条事实（恰好一次），然后关闭它
```

→ 完整动词参考、贴给 Agent 的第一条 prompt、`CLAUDE.md` / `.cursorrules` 规则片段、5 分钟双窗口实验：[docs/AGENT-CLI.md](docs/AGENT-CLI.md)

## 把 Agent 托管成常驻单元（DCU 模式）

上面全都是有人在驱动的 Agent。**DCU** 是另一种姿态：没有人驱动它 —— 日志驱动它。它平时闲着，
当一条匹配它所声明关注的事实落下时被唤醒，认领这条事实（于是没有兄弟单元会重做同一件事），
干活，再把产出挂回原事实底下。没有队列、没有调度器、没有人守在提示符前。

`@antlegion/dsh` 就是 **DeepSeek Harness** 的这种姿态 —— 一个没有界面、没有任何需要人照看的
东西的 dsh profile，所以进程能跑的地方它就能跑。

### 装上

```bash
cd dsh-antlegion
./setup-dcu-profile.sh                            # 从这份 checkout 建出一个能 boot 的 "dcu" profile
./.dsh-launcher/node_modules/.bin/dsh --profile dcu   # 若 dsh 已在 PATH 上，直接 `dsh --profile dcu`
```

然后打开 **http://127.0.0.1:28092** 填总线地址。**Check** 跑的就是 `check.js` 那个探测，
地址不对回来的是分类（`refused` / `dns` / `timeout` / `not-a-bus`）而不是一个转圈；**Save**
把运行中的客户端、绑在它上面的工具、巡检和会话整体换到新地址上，不需要重启任何东西。
地址是这个插件唯一猜不出来的东西，而在它填对之前 DCU 什么也做不了 —— 所以只有这一件事配了界面。

之所以要这个脚本，是因为 `dsh plugin --profile dcu add @antlegion/dsh` 今天还跑不通：
`@antlegion/bus@0.5.0` 尚未发布、`@deepseek-ai` 的 latest 标签指向一个自身依赖 404 的版本、
peer 图在可接受时间内解析不完。它把三个都绕开了 —— [各自是怎么失败的](dsh-antlegion/README.md)。

### 让它一直跑着

它就是一个普通的长生命周期进程，交给你已经在用的进程守护即可。一份 systemd 用户单元：

```ini
# ~/.config/systemd/user/antlegion-dcu.service
[Unit]
Description=AntLegion DCU (DeepSeek Harness)
After=network-online.target

[Service]
# 用绝对路径 —— setup-dcu-profile.sh 把启动器留在 checkout 里
ExecStart=/srv/AntLegion/dsh-antlegion/.dsh-launcher/node_modules/.bin/dsh --profile dcu
Environment=DEEPSEEK_API_KEY=…
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now antlegion-dcu
journalctl --user -u antlegion-dcu -f          # 启动那四行，之后每唤醒一次一行
```

`Restart=always` 在这里是安全的，而通常它并不安全 —— 这正是日志带来的：session id 由
（身份，主题）**派生**，所以重启后的 DCU 回到它原来那几段对话而不是从空白开始；而一个握着
认领死掉的 DCU 不会把活卡住，因为每条认领在自己的 `recv` 之后 Δ 就失效，兄弟单元会接手，
同时**不会撤销**一次真的完成了的 resolve（[§8.4](PROTOCOL.zh-CN.md)）。有一条注意事项它和
日志上的每个 Agent 一样：**一个身份一个进程**。同一个 `author` 起两个单元就是双启动，
而这件事是被折叠**检测**出来的，不是被总线禁止的。

### 在板上看见它

```bash
alctl colony
# [{"author":"dsh-dcu","interests":["task.*"],"publishes":["task.done"]}]
```

然后丢一条它说过自己关心的事实进去，看它自己把闭环走完：

```bash
alctl publish task.request '{"title":"看一下 p99 尖刺"}' --subject incident:42
alctl state <id>          # → {"state":"resolved","owner":"dsh-dcu"}
alctl descendants <id>    # → 它挂在这条请求底下的 task.done
```

两条主题无关的事实会得到两段对话而不是一段 —— 「相关」是从流里折出来的（`refs.subject`、
因果踪迹），从不去问模型，所以读同一条日志的两个 DCU 会切得一模一样。上下文压力交给 harness
自己的压缩，压的是真的填满了的那段会话。

→ 配置键、主题会话规则、以及 `verify-loop.sh`（没有模型 key 也能把整条链路跑完）：
[dsh-antlegion/README.md](dsh-antlegion/README.md) · 同一种姿态但用自己的运行时而不是 harness：
`@antlegion/ant`（`ant start --daemon`，macOS 上 `ant launchd`）。

## 这东西真的成立吗？

可运行的场景会启动真实服务器、拉起彼此独立的 Agent、断言一个可度量的通过门槛：

- **共享视图**——6 个传感器节点沉积并修订读数，其中一个中途被杀；8 个冷读者在随机时刻醒来，各自把整个世界（每个 subject 的当前值、历史、踪迹、后代）折叠成一个 sha256。同一 head ⇒ 每个读者同一哈希；杀掉并回放总线 ⇒ 同一哈希；被撤回的寄存器处处折叠为「一无所知」；**流中零个 claim**——这个场景什么都不协调，只共享一个世界。
- **争用下的所有权**——来自 4 个「框架」的 8 个进程争抢 400 条事实，`dupes=0`；一个进程持有认领时被 `SIGKILL`，其所有权确定性地过期；总线从日志重启，逐字节一致地回来。
- 另有 16 个 worker 的扇出/扇入、崩溃重派、共识门控决策、带取代的因果流水线。

```bash
npx tsx examples/scenario-shared-view.ts    # 隔离节点 · 一个世界 · 零 claim
npx tsx examples/demo-killer.ts             # 三幕所有权 demo
```

→ 完整表格、争用下的数字、设计理由：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 项目结构

三个已发布的包，加上文档、demo 和一个落地页。每个顶层条目都列在这里——不在这张图里的，就不该在仓库里。

```
AntLegion/
├── PROTOCOL.md             ← 线协议规范——§8 折叠规则是规范性的
├── CLAUDE.md               ← 给在本仓库工作的编码 Agent 的定向说明
├── Dockerfile              ← 构建总线镜像；构建上下文是仓库根
│
│   ── 包（已发布到 npm）──
├── antlegion-bus/          ← @antlegion/bus——日志、折叠 SDK、alctl CLI
├── ant/                    ← @antlegion/ant——住在日志上的常驻 Agent（镜像 → 折叠 → 行动）；
│                             附带一条 dev-chain 作为*工作流客户端示例*，不是产品本身
├── antlegion-alias/        ← antlegion——20 行别名，让 `npx antlegion` 启动总线
├── dsh-antlegion/          ← @antlegion/dsh——把 DeepSeek Harness 跑成日志上的常驻 Agent
│
│   ── 其它 ──
├── docs/                   ← QUICKSTART · AGENT-CLI · ARCHITECTURE · CONFIGURATION ·
│                             FACT-MODEL · EVOLUTION · DOCKER-VERIFY · protocol/ · proposals/
├── research/               ← 上文数字引用的第一手测量
├── deploy/                 ← mvp/（docker-compose 运行）· media/ · 校验脚本
├── toys/                   ← 小型可运行用例：hr-colony、pi-duo、pi-agent
├── site/                   ← antlegion.dev 落地页（静态）
└── dcu-workspace/          ← `ant` 默认监视的运行时工作区（仅本地）
```

有两样东西故意**不在**树里：`.data-v2/`（日志本体）和 `.ant/`（常驻 Agent 的 pid、日志、工作记忆）。两者都是运行时状态，在任意层级被 gitignore。

## 当前状态

**Alpha**——参考实现与单节点运维故事都是扎实的。尚不建议用于不可信的公网（没有网络层鉴权；总线信任它的调用者，和 Redis 一样）。

> [!IMPORTANT]
> **v3.0 破坏 wire，而且已经落地。** 规范、总线、折叠 SDK 与[合规向量](antlegion-bus/conformance/vectors.json)现在说的都是 v3.0；规范化改成了 **RFC 8785（JCS）**，这改掉了每一个 `id`。v3.0 的读者读一条 v2.0 日志，每条记录的 `id` 验证都会失败 —— 没有迁移路径，也不提供。请开一条新日志；要保留的 v2.0 日志请归档，并用 v2.0 的读者去读。完整变更清单：[§C](PROTOCOL.md)。

两个卫星包也已经说 v3.0：`ant` 与 `@antlegion/dsh` 都改用总线发布的 Δ 折叠、把踪迹缺口显式呈现而不是藏起来，并且在「被取代」不再构成压缩依据之后，改用撤回来退役自己的注册。CI 会用被测提交里的总线源码构建，再让两个包对着它跑。它们的 `package.json` 要的是 `@antlegion/bus@^0.5.0`，等该版本发布后即可正常从 npm 解析；在那之前，照 CI 的方式装：

```bash
cd antlegion-bus && npm ci && npm run build && npm pack --pack-destination /tmp
cd ../ant && npm install --no-save /tmp/antlegion-bus-0.5.0.tgz
```

对 `@antlegion/dsh` 来说这只是三个安装陷阱之一（另两个：`@deepseek-ai` 的 `latest` 标签指向一个自身依赖 404 的版本；peer 图在合理时间内解析不完）。`dsh-antlegion/setup-dcu-profile.sh` 三个一起处理，直接建出能 boot 的 profile；`dsh-antlegion/verify-loop.sh` 再把整条链路走完 —— 注册上册、被别人写的事实唤醒、claim、resolve、发布产物 —— 全程不需要模型 key。

### 它不做什么

三条在动手之前值得知道的边界，都是设计的推论而不是缺口：

- **读者的内存随日志年龄增长，而且没有上界。** §8.0 要求完整前缀，§11.2 禁止压缩回收骨架，于是每个合规读者都要永久持有整条日志的 `{id, seq, recv, author, refs, sig}`，回答一个问题是 O(N)。10⁵ 条事实时参考实现的折叠仍是毫秒级；跑上几年的日志需要增量折叠、给派生状态打检查点、或按 subject 空间切成多条日志（[§2.3](PROTOCOL.md)）。这是「总线无状态、含义住在读者里」这笔交易的价钱，不是 bug。
- **`author` 是自称的，所以 §10.1 的门是给诚实参与者防手滑的，不是给对手防越权的。** 每一道门 —— 只有作者能撤回或取代自己的事实、只有领取胜出者能 resolve —— 比的都是一个没人认证过的 `author`。在可信网络内这恰恰对；在开放网络上，除了 §9.1 的排序结果，§8 的每一条保证都相对于 `author` 诚实（[§12.2](PROTOCOL.md)）。
- **一条日志就是一个世界。** `seq` 只在一条日志内有意义，折叠不跨日志（[§2.4](PROTOCOL.md)）。只读副本、按 subject 空间分片都行；两个写者共用一条日志是另一个协议。总线的可用性就是这个世界的可用性。

`research/protocol-v3-audit-2026-08.md` 完整论证了这三条，以及它们之后还剩下什么。

已完成：无状态可信核心 · 带 `appendfsync`、撕裂尾恢复与「不改变折叠结果」压缩的只追加日志 · 读者折叠 SDK（寄存器、踪迹、信任、所有权）含 §10.1 授权门控 · `alctl` CLI · 跨语言合规向量，其独立 Python 校验器检查的是**折叠而不只是哈希**（204 条断言）· 共享视图 + 所有权场景 · Docker 镜像 · 进程内约 160k 追加/秒 · Δ 被钉进日志，重启不再能悄悄重折它的历史 · 三个包共 405 个测试（bus 263 · ant 119 · dsh 23）· npm 包 · 常驻 Agent（`ant init` / `ant start`、`@antlegion/dsh`）。

下一步：多语言客户端 SDK（Go、Python、Rust——[合规向量](antlegion-bus/conformance/vectors.json)是测试目标）· 面向暴露部署的鉴权与限流（[§10.3](PROTOCOL.md)）· 复制/高可用（[§11.3](PROTOCOL.md)）· 给 `sig` 的字段加长度前缀（[§5.10](PROTOCOL.md)）。

## 文档

| | |
|---|---|
| [PROTOCOL.md](PROTOCOL.md) | 线协议——权威；§8 折叠规则是规范性的。**v3.0，草案** |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | 分步：线面、CLI、SDK、持久化与恢复 |
| [docs/AGENT-CLI.md](docs/AGENT-CLI.md) | 从已有 Agent 驱动日志，以及如何让它采用 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 各部分如何拼合、什么被证明了、为什么长这样 |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | 环境变量、运行方式、运维速查、排障 |
| [docs/FACT-MODEL.md](docs/FACT-MODEL.md) | 板上有谁、孤儿事实、上下文充分性闭环 |
| [docs/EVOLUTION.md](docs/EVOLUTION.md) | v0 → v1 → v2：试过什么、为什么变 |
| [docs/protocol/](docs/protocol/) | v3.0 工作区——诊断、推导、骨架 |
| [research/](research/) | 第一手测量、十二进程可行性验证、对抗性协议审计、以及 MUST 逐条对照实现的评估 |
| [ant/README.md](ant/README.md) | 日志上的常驻 Agent；dev-chain 作为工作流客户端示例 |
| [dsh-antlegion/README.md](dsh-antlegion/README.md) | DeepSeek Harness 作为常驻单元：安装、配置页、一个主题一段会话 |

每份文档都有 `.zh-CN.md` 伴生版，`PROTOCOL.zh-CN.md` 也在内——两份协议文本都对应 v3.0，且逐节保持对齐。

## 参与贡献

欢迎贡献。**协议变更是线上破坏性的**：对事实形状、`id` 计算（§5.9）或 §8 折叠规则的任何改动，必须同时落到 `PROTOCOL.md`、`PROTOCOL.zh-CN.md`、`conformance/vectors.json`（用 `npx tsx conformance/generate.ts` 重新生成）和跨语言校验器——在一个声明 `[protocol-change]` 的提交里一起落地。

这条规则有用的另一半是反过来的，也是这里最便宜的一件审阅工具：**一次只重述规范的改动，必须让每一个向量逐字节不变。** 如果你只改了文字而 `vectors.json` 动了，说明你在无意中改了语义。

```bash
npm test                      # 总线 263 个测试，约 2 秒
npx tsc --noEmit              # 类型检查
python3 conformance/verify.py # 跨语言证明：204 条断言，含折叠
```

先读 [docs/EVOLUTION.md](docs/EVOLUTION.md)——它能帮你避免重新发明已被放弃的方案。

## 许可证

MIT——见 [LICENSE](LICENSE)。

---

<div align="center">
  <sub>AntLegion Protocol v3.0（草案）· Carter.Yang 设计 · 2026 年从第一性原理推导。</sub>
</div>
