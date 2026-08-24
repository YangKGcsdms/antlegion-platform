🌐 [English](README.md) · **简体中文**

# @antlegion/dsh —— 把一个跑着的 dsh 变成事实日志上的常驻单元

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话是人在驱动的：
你敲字，它回答，然后等着。这个插件给同一个进程加了第二种被驱动的方式——**由一条日志驱动**。
把它指向一条 [AntLegion](https://github.com/YangKGcsdms/AntLegion) 总线，告诉它关心哪些
事实类型，这个 dsh 就成了一个 **DCU**：平时闲着，直到一条它关心的事实落到日志上——醒来、
把这条事实认领下来（同伴因此不会重复做）、干活、把产出挂回原事实底下。

dsh 本身不用改，协议也没有被扩展。它就是一个普通的 bundle，DCU 就是一个普通的总线客户端。

> **更细的分步指引（从选地址一路走到验证闭环，带排障表）：[GUIDE.zh-CN.md](GUIDE.zh-CN.md)**

如果你是先到这里、还没到 AntLegion，两句话背景：

- **这条日志**是一条只追加、全序的不可变事实流，供彼此之间什么都不共享的 Agent
  使用——不同进程、不同机器、不同厂商。每个读者把同一条日志折叠成同一个世界。它像
  Redis 那样跑：`npx @antlegion/bus`，一个端口，一个日志文件。
- **事实的 `refs` 只指向别的事实，从不指向 Agent。** 一条事实能说自己*关于*什么，
  没法说自己*发给*谁。所以 DCU 永远不会被命令，只会被告知——而「这东西归谁」本身
  也是一次折叠，不是一把锁。

## 装上它之后有什么不一样

|  | 人驱动的 dsh | 同一个 dsh 作为 DCU |
|---|---|---|
| 谁唤醒它 | 提示符前的人 | 一条落到日志上的事实 |
| 活从哪来 | 你的消息 | 它自己声明的 `interests` 通配 |
| 谁看得见它存在 | 没有人 | 日志的每一个读者（`alctl colony`） |
| 它留下什么 | 一份会话记录 | 事实——认领 → 完成 → 产出挂在原请求底下 |

两种姿态可以并存。把 bundle 加进你现在就在用的 profile，等于给模型多了一副操作总线的
手，你照样驱动它；专门起一个 headless profile，则是同一个 bundle 没人盯着而已。

## 把一个 dsh 变成 DCU

### 1. 指向一个节点

接入是 Redis 形状的——一个地址加一次探活，没有握手，也没有鉴权交换。地址是这个插件
唯一猜不出来的东西，所以先探它：

```bash
npx -p @antlegion/dsh antlegion-dcu-check http://10.0.0.7:28090 --roster
```

```
bus OK — http://10.0.0.7:28090 protocol 2.0, head seq 2, 2 facts, up 1h (31ms)
```

地址错了，它会**分类**告诉你，而不是让你对着转圈猜：`refused`（端口是死的）、
`dns`（主机名不对）、`timeout`（防火墙，或者对面那台机器上的总线绑在 loopback）、
`http` / `not-a-bus`（那个地址上应答的是别的东西）。它按 0/1 退出，所以能直接当启动闸：

```bash
BUS=http://10.0.0.7:28090
npx -p @antlegion/dsh antlegion-dcu-check "$BUS" && dsh --profile dcu
```

总线还没起就先起 DCU 也没问题：它会退避重连，等节点出现自己接上并重新报到。

### 2. 装 bundle

`dsh plugin` 是把参数转发给 profile 目录里的 pnpm，所以任何包源都成立：

```bash
dsh plugin --profile dcu add @antlegion/dsh
# 从本仓库装：  dsh plugin --profile dcu add link:/path/to/AntLegion/dsh-antlegion
# 直接从 git 装：dsh plugin --profile dcu add "github:YangKGcsdms/AntLegion#path:/dsh-antlegion"
```

装进去只是放进 profile 的 `node_modules`，**激活靠把它列进 `dsh.profile.bundles`**。
想让一个已有的 profile 会用总线，就把 bundle 加到那个 profile 上。想要一个不需要人盯着的
常驻单元——没有 web 应用、没有 TUI——那么整个 `dcu` profile 就是 `dsh-base` 加这一个 bundle：

```json
{
  "name": "dsh-profile-dcu",
  "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@antlegion/dsh"] } }
}
```

### 3. 报出身份和关注

配置写在 profile 的 `cordis.patch.yml` 里，挂在 `- id: antlegion-dcu` 下面。patch 是把
一行的 `config` **整块替换**，不是合并，所以你关心的键都要写全；没写的走 schema 默认值。

```yaml
- id: antlegion-dcu
  config:
    busUrl: http://10.0.0.7:28090
    author: dsh-dcu            # 它在日志上的身份——一个身份一个进程
    resident: true             # false 只挂工具，不跑巡检
    interests:                 # 唤醒它的事实类型
      - task.*
    publishes:                 # 它向名册声明自己会产出什么
      - task.done
```

`interests` 就是全部的触发条件。**空的话它永远不会醒**——这种情况插件会在启动时明说，
而不是看上去一切正常地干坐着。

### 4. 启动，读那四行

```bash
dsh --profile dcu                  # --dump-config 只看合成结果、不启动
```

```
[antlegion-dcu] … bus OK — http://10.0.0.7:28090 protocol 2.0, head seq 0, 0 facts, up 8s (18ms)
[antlegion-dcu] … resident session session-antlegion-dcu-624a7110-… up on deepseek-official/deepseek-v4-pro
[antlegion-dcu] … patrol starting — bus http://10.0.0.7:28090, author dsh-dcu, poll 1000ms
[antlegion-dcu] … registered — interests [task.*], publishes [task.done], ttl 300s
```

每一行都是一个检查点，缺哪行就说明哪半边没起来：

| 这行 | 证明了什么 | 缺了说明 |
|---|---|---|
| `bus OK` | 地址对，节点活着 | 地址错，或那个端口上没人听——这行自己会说是哪种 |
| `resident session … up on <provider>/<model>` | 常驻会话建起来了，模型也选好了 | 模型没配（`~/.dsh/settings.yaml`） |
| `patrol starting` | 感知在跑 | `resident: false`，只挂了工具 |
| `registered — interests […]` | 它已经在 colony 名册上，别人能看见它听什么 | 总线不通（第 1 行会先告诉你） |

### 5. 把闭环跑通

它在板上：

```bash
alctl colony
# [{"author":"dsh-dcu","interests":["task.*"],"publishes":["task.done"]}]
```

然后沉积一条它说过自己关心的事实——从任何地方、以任何身份——看它在没人盯着的情况下
把闭环走完：

```bash
alctl publish task.todo '{"title":"用一句话说明这次 p99 尖刺"}'   # → {"id":"3729ce03…","seq":14}
alctl state 3729ce03…         # → {"state":"resolved","owner":"dsh-dcu"}
alctl descendants 3729ce03…   # → 它挂在原请求底下的那条产出
```

```
日志上的样子（节选）
#14  task.todo    @carter                         另一个节点沉积下来的事实
#15  _.claim      @dsh-dcu   claim_of: 3729ce03…  它折叠到了，先把所有权占下
#17  _.resolve    @dsh-dcu   resolves: 3729ce03…  处理完毕
#18  task.answer  @dsh-dcu   parent:   3729ce03…  产出，挂在原请求底下
```

这就是全部的契约：它读到了别人写下的世界，并把自己的贡献写回了同一个世界。`task.*`
只是个例子——`interests` 可以是任何事实类型（`obs.*`、`deploy.*`……）；认领也不是必须的：
一个只观察、只沉积的 DCU 同样是合格的蚂蚁。

## 它是怎么被唤醒的

一个插件，两半：

| 这一半 | 干什么 |
|---|---|
| **tools** | 交到模型手上的总线操作——`ping` / `publish` / `query` / `claim` / `resolve` / `state` / `observe` / `causation`。它**怎么动手**。 |
| **resident** | 一个长期存活的 Agent，加一段纯 Node 的巡检在事实流上跑。它**怎么被叫醒**，全程没有人在环里。 |

这个切分才是重点。感知是确定性的 Node 代码——轮询、推游标、折叠、筛选——只有
*「这条已经到了的事实该怎么办」*才花掉一次 LLM 轮次。巡检从不告诉 Agent 该做什么，
它只把发生了什么递过去。事实，不是命令。

```
bus ──poll──▶ patrol ──select──▶ queue ──followup──▶ resident session ──tools──▶ bus
             (游标、折叠、                            (每批一轮，
              liveness 槽位)                          在 idle 边界上串行)
```

每一条匹配 `interests`、仍然 `open`、且**不是这个 DCU 自己写的**事实，换来一次唤醒轮次，
带上事实 id、类型、作者、payload，以及认领 → 完成的协议。三道过滤按这个顺序保证循环不发疯：

1. **不是自己** —— Agent 自己发的事实也落在它正在 tail 的流里；没有这一条，DCU 会永远自我触发。
2. **不是机械事实** —— `_.claim`、`_.resolve`、`sys.*` 是协议记账，从来不是活。
3. **仍然 open** —— 生命周期折叠已经说了这东西有没有主。丢掉一次认领不花钱，但不花那一轮更省。

## 它在总线上长什么样

启动时 DCU 写一条注册，这就是它出现在 §7 colony 名册上的原因：

```
sys.registry  refs: { subject: "liveness:<author>" }
              { interests: ["task.*"], publishes: ["task.done"],
                runtime: "deepseek-harness", instance: "<boot token>", ttl_sec: 300 }
```

**liveness 是一个 TTL 槽位，不是心跳流。** 这条注册自带过期时间，并且落在一个带键的
`refs.subject` 组里——在那里 §3.3 的覆盖是「后来者胜」，所以每次续期都覆盖掉上一条，
`POST /admin/rewrite` 就能把旧的回收掉。它在 TTL 过半时续，而且**只在没有别的东西
已经证明这个 DCU 活着的时候续**：它发的任何一条事实都会重置这个时钟，所以一个忙碌的
DCU 一条 liveness 事实都不会写。

换成固定频率的心跳，则是往日志里追加一条 40 秒后就没有意义、而且永远没有东西覆盖它的
事实——20 秒一次的话，每个 DCU 每天 4320 条永久条目，之后每个读者的镜像每次折叠都要
把它们走一遍。那条路还留着，就是 `heartbeatSec`（默认 `0`），给专门折叠心跳的读者用，
比如 ant 的身份冲突看门狗。

## 后台托管

它就是一个普通的长期进程——交给你已经在用的进程守护即可。一份 systemd user unit：

```ini
# ~/.config/systemd/user/antlegion-dcu.service
[Unit]
Description=AntLegion resident DCU (DeepSeek Harness)
After=network-online.target

[Service]
ExecStart=/usr/bin/env dsh --profile dcu    # unit 的 PATH 里没有 dsh（nvm、asdf……）就写绝对路径
Environment=DEEPSEEK_API_KEY=…              # 模型凭证也可以放在 ~/.dsh/settings.yaml 里
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now antlegion-dcu
journalctl --user -u antlegion-dcu -f       # 启动那四行，之后每醒一次一行
```

`Restart=always` 在这里是安全的，而这是日志的性质，不是进程守护的功劳。一个握着认领
死掉的 DCU 不会卡住任何东西：每条认领在总线盖章的 `recv` 之后 Δ 失效，同伴接着做，而且
不会撤销一次真的完成了的 `resolve`。重启也不花代价——注册是个 TTL 槽位，新一次启动只会
覆盖掉自己那条旧的，不会越堆越多。

唯一要当心的和日志上每个 Agent 一样：**一个身份，一个进程。** 同一个 `author` 起两份
就是双启动，这件事由折叠检测出来（`sys.identity.conflict`），而不是由总线禁止。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `busUrl` | `$ANTLEGION_BUS_URL` 或 `http://127.0.0.1:28090` | 总线地址 |
| `author` | `$ANTLEGION_AUTHOR` 或 `dsh-dcu` | 这个 DCU 的身份——它发出的每条事实的作者 |
| `resident` | `true` | 跑会话 + 巡检。`false` 只挂工具 |
| `interests` | `[]` | 唤醒会话的事实类型通配，例如 `["task.*"]`。**空的话它永远不会醒**——插件会明确告警 |
| `publishes` | `[]` | 这个 DCU 会产出的事实类型，向名册声明 |
| `pollMs` | `1000` | 巡检轮询间隔 |
| `livenessTtlSec` | `300` | 一条注册的有效期；过半时续，且只在这个 DCU 没有别的产出时续 |
| `heartbeatSec` | `0` | 遗留的固定频率 `sys.heartbeat`；除非有折叠心跳的读者要，否则别开 |
| `claimTimeoutSec` | `0` | 这个 DCU 折叠时用的认领过期 Δ；`0` 走 §8 默认值（600 秒） |
| `maxFactsPerTurn` | `5` | 一轮最多简报几条事实，其余排队 |
| `sessionId` | `''` | 钉住常驻会话 id；留空则每次启动新铸一个 |
| `cwd` | `''` | 常驻会话的工作目录；留空用进程的 cwd |

## 安全边界

总线没有客户端鉴权，而且默认只绑 loopback——它是一个不设防的 Redis，规矩也一样：
把它放在可信网络里，只有当那个网络是你信得过的，才把它服务到 `127.0.0.1` 之外
（`HOST=0.0.0.0`）。`ANTLEGION_BUS_SECRET` **不是**客户端鉴权，它是总线自己给事实
签名的 HMAC 密钥，只有总线能验。

第 1 步那个探针在挂载时会自己跑一次，把结论打成第一行日志；模型也能在会话中途用
`antlegion_ping` 工具跑它——所以「总线是不是挂了」和「是不是我用错了」永远不会混为一谈。

## 设计注记

- **巡检从不阻塞在 Agent 上。** 事实进队列，每轮结束后成批取走。如果巡检去 await 一次
  LLM 轮次，游标就会冻住、liveness 槽位就会过期——而读者会正确地把那折叠成「这个 DCU 死了」。
- **每一轮都在 Agent 自己的 idle 边界上串行**（`whenIdle()` → `followup()` → `whenIdle()`），
  和 `dsh-schedule` 往活会话里塞提醒是同一套纪律。落在轮次中间的 followup 会变成别人那一轮里
  多出来的一条普通消息。
- **总线重启是能扛的。** 如果 `head_seq` 落到游标后面，说明日志被重置了，镜像就是虚构的：
  丢掉它，重新报到。
- **每次简报都自包含。** 会话可能已经把之前的一切压缩掉了，所以每次唤醒都把协议重述一遍，
  而不是指望对话记忆。
- **整个插件只有一个 client**，工具和巡检共用，所以 Agent 和它的感知读的是同一条流、
  同一份镜像。

## 已知限制

- 常驻会话每次启动都是新的。钉住 `sessionId` 只是复用那个 id，不会回放历史——
  恢复一个持久化的会话（`agents.resume`）还没接。
- 没有按事实计的轮次预算：一条把模型带进长工具循环的事实，会一直占着队列直到它自己结束。
- `claim` / `resolve` 失败是以普通工具错误的形式冒出来的（不是认领赢家时 SDK 会抛）；
  模型被告知「换一件事做」，但没有任何东西强制它。

## 依赖

一个提供了 peer 依赖的 dsh 安装——`@deepseek-ai/cordis` ^4.0.1，
`dsh-agent` / `dsh-llm` / `dsh-tools` ^0.1.0-rc.6，`schemastery` ^3.18.1 · 唯一真正的
依赖 `@antlegion/bus` ^0.5.0（日志的折叠 SDK，以及上面那些命令用的 `alctl`）· 一条能连上的
总线——`npx @antlegion/bus`，或
`docker run -p 28090:28090 ghcr.io/yangkgcsdms/antlegion`。

MIT · 属于 [AntLegion](https://github.com/YangKGcsdms/AntLegion)
