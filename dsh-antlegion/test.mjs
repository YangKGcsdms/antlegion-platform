// test.mjs —— 证明 DCU 原语确实在代码里，而不是在提示词里。
//
//   node test.mjs            （自己起一条测试总线，跑完就拆）
//
// 四个断言，每个都对应一句设计主张：
//   ① exclusive：三个 DCU 抢同一条事实，只有一个被唤醒 —— 输的连模型都不用醒
//   ② observe  ：不认领，三个都被唤醒，日志上零 _.claim
//   ③ 听话的模型：运行时自己 resolve，不留 dcu.no_output
//   ④ 沉默的模型：重述一次仍无产出 → 记一条 dcu.no_output 并收尾，不静默丢失
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientV2, httpTransport } from '@antlegion/bus/client'
import { lifecycle } from '@antlegion/bus/fold'
import { createPatrol } from './patrol.js'
import { ResidentDCU } from './resident.js'

const PORT = 28099
const BUS = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (cond, label, detail = '') => {
  if (!cond) failures += 1
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? `   ${detail}` : ''}`)
}

async function withBus(run) {
  const dir = await mkdtemp(join(tmpdir(), 'antlegion-dcu-test-'))
  const bus = spawn(process.execPath, ['node_modules/@antlegion/bus/dist/index.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ANTLEGION_DATA_DIR: dir, ANTLEGION_BUS_SECRET: 'test' },
    stdio: 'ignore',
  })
  try {
    for (let i = 0; i < 60; i += 1) {
      try { if ((await fetch(`${BUS}/health`)).ok) break } catch { /* not up yet */ }
      await sleep(100)
    }
    await run()
  } finally {
    bus.kill('SIGTERM')
    await sleep(200)
    await rm(dir, { recursive: true, force: true })
  }
}

/** Three patrols on one bus, all interested in the same type. */
function trio(mode, seen) {
  return ['dcu-a', 'dcu-b', 'dcu-c'].map((author) => createPatrol({
    client: new ClientV2(httpTransport(BUS), author),
    busUrl: BUS,
    author,
    interests: ['task.*'],
    publishes: ['task.done'],
    pollMs: 150,
    livenessTtlSec: 0,
    mode,
    log: () => {},
    onWork: (facts) => { for (const f of facts) seen.push(`${author}:${f.id}`) },
  }))
}

/** A fake dsh agent: `run` decides what the "model" does with its turn. */
function stubAgent(run) {
  const briefs = []
  let busy
  const agent = {
    session: 'stub',
    async whenIdle() { if (busy) { await busy; busy = undefined } },
    followup(message) {
      const text = message?.content?.[0]?.text ?? ''
      briefs.push(text)
      busy = Promise.resolve(run(text, briefs.length)).catch(() => {})
    },
  }
  const ctx = {
    get: (name) => ({
      loader: { await: async () => {} },
      agents: { create: async () => ({ agent }) },
      agentDefaultModel: { currentSelection: () => ({ provider: 'stub', model: 'stub' }) },
      sessions: { flush: async () => {} },
    })[name],
  }
  return { ctx, briefs }
}

await withBus(async () => {
  const human = new ClientV2(httpTransport(BUS), 'human@test')

  // ── ① exclusive：抢占在唤醒之前 ──────────────────────────────
  console.log('\n① exclusive —— 三个 DCU，一条事实，只有一个该醒')
  {
    const seen = []
    const patrols = trio('exclusive', seen)
    patrols.forEach((p) => { void p.start() })
    const { id } = await human.publish('task.todo', { n: 1 })
    await sleep(1200)
    await Promise.all(patrols.map((p) => p.stop()))

    const claims = await human.query({ type: '_.claim' })
    const state = lifecycle(await human.query({}), id)
    ok(seen.length === 1, '只有一个 DCU 被唤醒', `实际唤醒 ${seen.length} 个：${seen.join(', ') || '无'}`)
    ok(claims.length >= 2, '输的那些也确实抢了（认领在代码里发生）', `_.claim ${claims.length} 条`)
    ok(state.state === 'claimed' && seen[0]?.startsWith(state.owner ?? ''), '被唤醒的正是认领赢家', `owner=${state.owner}`)
  }

  // ── ② observe：不认领，都醒 ─────────────────────────────────
  console.log('\n② observe —— 不认领，三个都该醒，日志上零 _.claim')
  {
    const seen = []
    const before = (await human.query({ type: '_.claim' })).length
    const patrols = trio('observe', seen)
    patrols.forEach((p) => { void p.start() })
    const { id } = await human.publish('task.todo', { n: 2 })
    await sleep(1200)
    await Promise.all(patrols.map((p) => p.stop()))

    const after = (await human.query({ type: '_.claim' })).length
    ok(seen.length === 3, '三个 DCU 都被唤醒', `实际 ${seen.length} 个`)
    ok(after === before, '这一轮没有产生任何认领', `_.claim ${before} → ${after}`)
    ok(lifecycle(await human.query({}), id).state === 'open', '事实保持 open，谁都没被挡住')
  }

  // ── ③ 听话的模型：运行时收尾 ─────────────────────────────────
  console.log('\n③ exclusive + 有产出 —— 运行时自己 resolve，不留 no_output')
  {
    const author = 'dcu-good'
    const client = new ClientV2(httpTransport(BUS), author)
    const { id } = await human.publish('task.todo', { n: 3 })
    await client.claim(id)                       // patrol 在真实链路里做的那一步
    const { ctx, briefs } = stubAgent(async () => {
      await client.publish('task.done', { by: author }, { refs: { parent: id } })
    })
    const dcu = new ResidentDCU(ctx, { client, author, busUrl: BUS, mode: 'exclusive', maxFactsPerTurn: 5, log: () => {} })
    await dcu.start()
    dcu.enqueue([(await human.query({})).find((f) => f.id === id)])
    await sleep(900)
    await dcu.dispose()

    const stream = await human.query({})
    const kids = stream.filter((f) => f.refs?.parent === id)
    ok(briefs.length === 1, '只唤醒一次，没有多余的重述', `${briefs.length} 次`)
    ok(!briefs[0].includes('先认领') && briefs[0].includes('已经由运行时认领'),
      '简报不再要求模型认领，只告知它已被认领', '协议收回代码，提示词里只剩禁止句')
    ok(lifecycle(stream, id).state === 'resolved', '运行时替它收尾了')
    ok(kids.some((f) => f.type === 'task.done') && !kids.some((f) => f.type === 'dcu.no_output'), '产出挂上因果链，且没有 no_output')
  }

  // ── ④ 沉默的模型：不静默丢失 ─────────────────────────────────
  console.log('\n④ exclusive + 零产出 —— 重述一次后记账，绝不静默丢失')
  {
    const author = 'dcu-silent'
    const client = new ClientV2(httpTransport(BUS), author)
    const { id } = await human.publish('task.todo', { n: 4 })
    await client.claim(id)
    const { ctx, briefs } = stubAgent(async () => { /* 模型只是想了想，什么也没发 */ })
    const dcu = new ResidentDCU(ctx, { client, author, busUrl: BUS, mode: 'exclusive', maxFactsPerTurn: 5, retryOnNoOutput: 1, log: () => {} })
    await dcu.start()
    dcu.enqueue([(await human.query({})).find((f) => f.id === id)])
    await sleep(900)
    await dcu.dispose()

    const stream = await human.query({})
    const kids = stream.filter((f) => f.refs?.parent === id)
    ok(briefs.length === 2, '零产出触发了一次重述', `${briefs.length} 次唤醒`)
    ok(briefs[1].includes('没有产出'), '重述明确说了上一轮没产出')
    ok(kids.some((f) => f.type === 'dcu.no_output'), '静默损失被写成 dcu.no_output')
    ok(lifecycle(stream, id).state === 'resolved', '事实被收尾，不会在同伴之间无限传球')
  }
})

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 个断言失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
