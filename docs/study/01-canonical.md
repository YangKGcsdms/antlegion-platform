# canonical.ts 学习笔记(第 1 天 · 2026-08-24)

> 整理自当晚的辅导对话。**第 8 节是空的**——那是今晚要亲手交的门票,不代填。
> 复习时先合上本文,试着把第 0 节那句话和第 2/3 节的伪代码默写出来,再对照。

---

## 0. 这个文件在协议里的位置(一句话)

> **规范化保证同一内容只有唯一的规范串 → 哈希的原像唯一 → 内容寻址成立。**

三个"于是"环环相扣,左边塌一环,右边全塌。

寻址是三段流水线,`canonical.ts` 只是第一段:

```
内容(JSON 对象) ──canonical.ts──→ 唯一的字符串 ──hash.ts──→ id(地址) ──bus.byId──→ 事实
                    「正字法」          「取地址」            「查地址」
```

它对协议负的责任:**把同一内容的一万种写法收敛成唯一一种**,而且是**跨语言的合同**——协议规定的是"字符串长什么样",不是"调用哪段 TS 代码"。`conformance/verify.py` 用 Python 独立复算出同一个 id,证明的就是这份合同。合同(规范化)和章(哈希)拆成两个文件,别的语言才接得上。

---

## 1. 谁在调用它(入口)

这个文件自己没有入口,是叶子工具库(≈ Java 的 `Objects`/`Collections`),谁 import 谁就是入口。

- **`stableJsonStringify` 只有一个调用者**:`hash.ts:18`。它存在的唯一理由就是给 `computeId` 供货。
- **`globMatch`** 有两个调用者:`bus.ts:127`(读日志时 `type=note.*` 过滤)、`fold.ts:336/346/357`(注册表"谁关心哪类事实"的匹配)。和寻址无关,只是顺路住在同一个文件里。
- `FLOAT_KEYS = new Set(["ts"])` 定义在 **`hash.ts:15`**,全项目只有这一处传入。决定"哪些字段按 float 渲染"的是 `hash.ts`(协议方),`canonical.ts` 只是执行。

从你第一天的 curl 实验追到这里的完整调用链:

```
curl POST /facts
  → server.ts:78   bus.append(body)
    → bus.ts:80    computeId(input)
      → hash.ts:18 stableJsonStringify(canonicalRecord(input), {"ts"})
        → sha256 → 这就是响应里那串 id
```

顺带钉住的三个 bus 事实(第一天 curl 实验的结论):
- `id` 只哈希你发出的内容(`type/author/ts/payload/refs/nonce`),**不含** bus 盖的 `seq/recv/sig`。
- `ts` 是作者的证词(谁控制它 → 不可信);`recv` 是 bus 的钟(`bus.ts:98`,全系统唯一被信任的一方 → 可信)。时间判定只看 `recv`。
- 同内容重发 → `byId.get(id)` 命中即判同一条,**不做内容比对**(`bus.ts:86-90`)。HashMap 需要 `equals()` 兜底是因为 32 位哈希常碰撞;SHA-256 的碰撞在算力上不可构造,所以 id 就是身份本身。想再发一条同内容的新事实 → 换 `nonce`。

---

## 2. 第一趟:`sortKeys`(只管键序)

```
函数 sortKeys(value):
    如果 value 是 null/undefined:      返回 value                # 出口 A
    如果 value 是 数组:
        新数组 = 空数组
        对于 每个元素 v:
            新数组.追加( sortKeys(v) )                          # 派分身,原地等
        返回 新数组
    如果 value 是 对象:
        新对象 = 空对象
        对于 (键名按字典序排好) 的每个 key:
            新对象[key] = sortKeys(value[key])                  # 派分身
        返回 新对象
    否则(数字/字符串/布尔):            返回 value                # 出口 B
```

源码里的 `value.map(sortKeys)` 就是数组分支那 4 行循环的缩写;裸写 `sortKeys` 不带括号 = 传函数本身(≈ Java 方法引用 `Canonical::sortKeys`)。

**三个 if 的先后顺序本身就是逻辑**,一行不能换位:
1. `typeof null === "object"`(历史 bug,永不修复)→ null 判断必须第一。
2. 数组的 `typeof` 也是 `"object"` → `Array.isArray` 必须抢在 object 前,否则 `[1,2]` 变 `{"0":1,"1":2}`。
3. 剩下才是真正的键值对象。

**全函数最深的一行**:`sorted[key] = ...` 按排好的顺序逐个插入新对象。它依赖 **JS 对象记住键的插入顺序**(规范保证,≈ `LinkedHashMap`),所以"按序插入"造出来的对象,遍历顺序就是字典序——下游 `jsonSerialize` 信任的就是这一点。

**纯函数**:返回新对象,入参一个字节没动。因为调用方是 `computeId`,算个哈希就把人家的原始数据改了顺序是不可接受的副作用。

### 你的原话(留着,面试能用)

> **"顺序本身就是数组想表达的东西。"**

数组的顺序是数据(`[1,2]≠[2,1]`),动它就是改内容;对象的键序不是数据(`{a,b}={b,a}`),不钉死它就是留皱褶。**排不排,只看"这个顺序有没有语义"。**

### 熨斗机比喻(自己提的,已校准)

熨斗去掉的是**皱褶**(无语义的书写差异),不改**版型**(嵌套结构、数组顺序)。"拉平/压扁"是剪开衬衫摊成布——这台机器绝不做。`sortKeys` 只是机器里专熨键序的一根滚筒;整台机器是 `canonical.ts`,对外一个进料口 `stableJsonStringify`。

---

## 3. 第二趟:`jsonSerialize`(把树拼成字符串)

```
函数 jsonSerialize(value, floatKeys):        # 永远返回:字符串
    # 四个出口(叶子)
    如果 null/undefined:   返回 "null"
    如果 布尔:             返回 "true"/"false"
    如果 字符串:           返回 加引号并转义后的它        # 借原生 JSON.stringify
    如果 数字:             -0 → "0";否则 String(value)
    # 两个容器(派分身,拼片段)
    如果 数组:
        片段列表 = 每个元素的 jsonSerialize(v, floatKeys)
        返回 "[" + 片段列表 用 ", " 连接 + "]"
    如果 对象:
        对于 每对 (k, v),按当前键序:                       # 序已由 sortKeys 排好
            如果 k ∈ floatKeys 且 v 是有限的整数: 值串 = v 补 ".0"   # 特殊通道,不派分身
            否则:                                  值串 = jsonSerialize(v, floatKeys)
            片段 = 加引号的 k + ": " + 值串
        返回 "{" + 片段列表 用 ", " 连接 + "}"
    否则: 返回 String(value)                                  # 兜底,正常事实不会到
```

和 `sortKeys` 同一个骨架,区别在交回来的货:`sortKeys` 交回同形状的新对象,这里交回**字符串片段**,由上一层拼进自己的括号里。拼接方向**自底向上**。

**分隔符 `", "` 和 `": "`**(逗号/冒号后有空格)= Python `json.dumps` 默认;JS 原生 `JSON.stringify` 是紧凑的。这是"为什么必须自己写、不能用原生"的核心原因之一。

### floatKeys 四关漏斗

```ts
floatKeys?.has(k) && typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)
  ? v.toFixed(1)
  : jsonSerialize(v, floatKeys)
```

整条 `&&` 链是三元表达式的条件位,从宽到严,**从左到右短路**——哪关先 false,后面的关卡看都不看。

| 关 | 判什么 | 防什么 |
|---|---|---|
| `floatKeys?.has(k)` | 键名在不在集合里 | 不传 floatKeys 时 `?.` 得 undefined → 全走普通通道 |
| `typeof v === "number"` | 是数字类型 | 字符串 `"5"` 混入 |
| `Number.isFinite(v)` | 不是 Infinity/NaN | 毒值持证混入 → `toFixed` 吐出 `"Infinity"` 毒化规范串 |
| `Number.isInteger(v)` | 这个 double 的值是整数 | `1.5` 本来就带小数点,不需要补 |

`toFixed(1)` 返回**字符串**(≈ `String.format("%.1f")`)。能走到这一步的 v 已被第四关保证是整数值,所以效果精确等于"补一个 `.0`",四舍五入永远不会真的发生。

### 运行时的值 vs 文本里的记号

整个输出是一个大字符串,**你看到的每个引号都是被故意拼进去的普通字符**:
- JS 字符串 `"a"` → `JSON.stringify("a")` → 三个字符的片段 `"a"`(引号是内容的一部分,因为 JSON 语法规定字符串记号带引号)
- JS 数字 `1756000000` → `toFixed(1)` → 十二个字符的片段 `1756000000.0`(没人加引号,因为 JSON 数字记号不带引号)

两个片段在运行时都是 string 类型(都是待拼的文本),区别只在**内容里有没有引号字符**。`console.log` 打印字符串从不加引号。

---

## 4. 昨晚判过的题(你的答案,全部已过)

实验:`stableJsonStringify({ ts: 1756000000, tags: ["a", "b"], meta: { n: 1 } }, new Set(["ts"]))`
输出:`{"meta": {"n": 1}, "tags": ["a", "b"], "ts": 1756000000.0}`

- **a. 键序 `meta → tags → ts`**:`sortKeys` 干的。它是全函数**唯一**的排序动作,且只排对象自己的键名;数组分支没有任何排序,只是把元素原位转交、原位放回。
- **b. `tags` 顺序没动**:数组分支只是把单个元素丢给函数,不是对数组的值排序。
- **c. `ts` 带 `.0`**:`floatKeys` 含 `"ts"` → 第一关过;`1756000000` 是数字、有限、整数 → 二三四关全过 → `toFixed(1)`。
- **d. `n: 1` 没变 `1.0`**:挂在**第一关**(`"n"` 不在集合里),因短路后面三关**根本没执行**——不是"没通过四关",是"第一关就被拦下"。
- **e. `meta: { ts: 5 }` → `"5.0"`**:`floatKeys` 在两个递归调用点原样随行,每层拿到同一个集合;`has(k)` 只认键名,不知深浅。**这条推理是你自己推出来的。**

---

## 5. 发现:注释与实现不一致(第一次抓到)

`hash.ts` 注释写 `/** Top-level canonical fields that are floats ... */`——**"Top-level" 是错的**,实现是任意层级(e 题证明)。

- **破不破跨语言互操作?** 不破。`verify.py` 的 `ser(value, key=None)` 递归时同样带着键名逐层判,两个实现行为一致,哈希照样对齐。
- **能"修"吗?** 两条路分量天差地别:
  - 改注释 → 纯文档修正,安全。
  - 改行为(真的只对顶层生效)→ 规范串变 → **所有既有事实的 id 全变** → conformance vectors 全崩 → 这正是 CI `vectors-guard` 拦着、非要 `[protocol-change]` 才放行的那类改动。**wire-breaking 从此是体感,不是概念。**
- **行动项**:过完 `hash.ts` 后,自己把那行注释改准、自己写 commit message 提交——对这个仓库的第一个亲手 commit。

同一条定律的另外两次现身:Java 8 宁可给 HashMap 桶加红黑树也不改 `String.hashCode`(算法写进了规范,几十年代码依赖其数值);`ts`/`recv` 谁可信只看谁控制它 ⇔ HashMap 被 hash-flooding 打爆是因为攻击者控制了键。**被依赖的公开行为动不得;一个值可不可信,只看谁控制它。**

---

## 6. 词汇卡

| 你当时的说法 | 正式名字 |
|---|---|
| "前身算法" | **规范化(canonicalization)**。业界标准化版本:RFC 8785(JCS)。本仓库用的是"与 Python `json.dumps(sort_keys=True)` 逐字节兼容"的自定方言 |
| "前身"(哈希之前的串) | **规范串(canonical form)**;作为哈希的输入叫**原像(preimage)** |
| "对不同写法算出同一个" | **内容寻址(content addressing)**。Git commit id、Docker digest、IPFS、Nix 全是同一思想——fact id 和 git commit id 是亲兄弟 |
| "内部的变量/成员" | JSON/JS 语境叫**属性 / 键值对**;被排序的是**键(key)**,所以叫"钉死**键序**" |

哈希的四档光谱(挑哈希像挑锁:先问贼是谁,再问开锁频率,最后问价钱):
`hashCode`(便宜,无对手,`equals` 兜底)→ SipHash(带密钥,有对手但求快,Python/Rust 字典)→ **SHA-256**(身份,无兜底,本仓库 `id`)→ **HMAC-SHA256**(身份 + 钥匙,本仓库 `sig`)。

---

## 7. 顺路捡到的 JS/TS(以后读别的文件会反复用到)

- **类型长在值上,不在变量上**;`typeof` 问的是此刻手里的值。number 统一是 double,**没有 int**。
- **两种"没有"**:`undefined`(没人赋过值/没这个键)、`null`(故意放的空)。检查时两个都防。
- **毒值**:JS 出错首选不是抛异常,是塞给你 `Infinity`/`NaN`/`undefined` 继续跑。它们持证上岗(`typeof NaN === "number"`),所以要 `Number.isFinite`、`Array.isArray`、`===`、`?.` 这些边界检查。`NaN !== NaN`。
- **异常**:有 `throw`/`try-catch`,无 checked exception;留给"明确拒绝"(参数非法、协议违规)。
- **后置类型** `名: 类型`;`unknown` = 顶层类型,先证明后使用,证明方式是**类型收窄**(分支内自动升级,无需强转);`as` 是编译期断言,运行时不检查、不抛。
- **`?` 两种**:参数声明里 `x?: T` = 可选参数;调用处 `x?.f()` = 可选链(左边空则整个表达式为 undefined)。声明了可选,使用就必须防空,TS 用类型系统锁死这个因果。
- **TS 类型编译后全部擦除**,运行时验身只能靠 JS 原生手段——两层各管各的。
- **函数是值**:传递 ≠ 执行,执行权在接收方(回调)。`map(f)` 逐元素调用 f,返回新数组。
- `` `[${x}]` `` 模板串 = 拼接;`.join(", ")` ≈ `String.join`;`for (const [k, v] of Object.entries(o))` ≈ 遍历 entrySet。
- **ESM import 写 `.js` 不写 `.ts`**(全仓库约定)。
- **vitest**:`describe`(分组)/`it`(用例,回调存着不跑)/`expect().toBe()`(严格同一;对象用 `toEqual`)。两阶段:收集 → 运行。**没有 `expect` 的测试永远不会红。** 命令必须站在 `package.json` 所在目录跑。

实验台:`antlegion-bus/test/carter_test/canonical.test.ts`
```bash
cd antlegion-bus && npx vitest run test/carter_test/canonical.test.ts   # 断言
npx tsx test/carter_test/poke.ts                                        # 脚本 + console.log
npx vitest run test/conformance.test.ts                                 # 动过 src 后必跑,55 绿
```
规矩:**先把猜的输出写进 `toBe`,再跑。**

---

## 8. 今晚要交的(`hash.ts` 的门票)——空着,自己填

### ② 闭卷清单:这台熨斗机一共熨掉哪几种皱?
(= 把 JSON 的哪几种"同内容不同写法"钉死成唯一写法。逐条,每条一句话。辅导方数过是四五件。)

-
-
-
-

### ③ 空格题
假设实现漏掉了冒号后的空格(`{"a":1}` 而非 `{"a": 1}`)。conformance 55 个测试里**最先爆的是哪一批**?链条:

> 字符串差一个空格 → ______ → ______ → 测试断言在比对 ______ 时红掉

(三批:§4 哈希向量 7 条 / stream ids 自洽 24 条 / §3 折叠语义 24 条。)

### ④ recv 题
假设 `recv` 也参与哈希。"断网重发不会造成重复"这条保证会怎样?推演:客户端重发同一内容 → bus 这次盖的 `recv` 是 ______ → 算出的 id 与上次 ______ → `byId` 查重结果 ______ → 日志里最终有 ______ 条。

### ① 一页笔记:这个文件对协议负什么责任?
(可以用第 0 节那句话当骨架,但要用自己的话重写一遍,合上本文写。)

### 附加(有余力再答,第一天留下的两问,从未讨论过)
- `Object.is(value, -0) ? "0"`:为什么要专门处理负零?提示:先在实验台试 `String(-0)` 是什么,再想 Python 那边 `-0.0` 会渲染成什么——这一处是不是真的跨语言一致?
- `globMatch` 里先转义正则元字符、再翻译 `*`/`?`,顺序反过来会怎样?
