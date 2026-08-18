<h1 align="center">My Little Agent</h1>

<p align="center">
A tiny multi-agent framework that runs entirely in the browser,<br/>
powered by <a href="https://developer.chrome.com/docs/ai/built-in">Chrome Built-in AI</a>. No server, no API key, no token cost.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/gzip-3.63%20kB-brightgreen" alt="gzip 3.63 kB" height="18">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="0 dependencies" height="18">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6" alt="TypeScript strict" height="18">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT license" height="18">
</p>

<p align="center">
  <b>English</b> |
  <a href="https://github.com/Hayoung0708/my-little-agent/blob/main/README-ko_kr.md">한국어</a>
</p>

```ts
import { Agent, chain, parallel } from 'my-little-agent'

const lens = (role: string) =>
  new Agent({ instruction: `Analyze strictly from the ${role} angle.`, stateless: true })

const summarizer = new Agent({ instruction: 'Merge the analyses into one paragraph.' })

// Three agents analyze in parallel, then one merges the results.
// Runs on the user's own machine — nothing leaves the device.
const report = await chain(
  parallel([lens('benefits'), lens('drawbacks'), lens('risks')]),
  summarizer,
).run(reviews)
```

**My** — the model runs on the user's machine · **Little** — 3.63 kB gzipped, zero dependencies · **Agent** — agents that use tools and work together.

## Features

- **No backend.** The model ships with Chrome. No proxy, no key management, no billing dashboard.
- **Free and unmetered.** Zero cost per call makes high-frequency AI features possible for the first time.
- **Private by default.** Input never leaves the device. Works offline.
- **Composable.** `Agent`, `tool`, and every workflow share one `Runnable` shape, so they nest freely.
- **Built for a small context window.** Isolated windows per agent, stateless steps, tool-output clamping, external memory.
- **Tiny.** 3.63 kB gzipped, zero runtime dependencies, 617 lines of source you can read in an hour.

## Documentation

- [Getting Started](#getting-started)
- [Core Concepts](#core-concepts)
  - [`Agent`](#agent--one-role-one-session)
  - [`tool`](#tool--a-plain-function-the-model-can-call)
  - [`Runnable`](#runnable--everything-has-the-same-shape)
- [Workflows](#workflows)
- [Context and Memory](#context-and-memory)
- [Honest Limitations](#honest-limitations)
- [Frontend Recipes](#frontend-recipes)
- [How Little, Exactly?](#how-little-exactly)
- [API Reference](#api-reference)
- [Roadmap](#roadmap)

## Getting Started

```bash
pnpm add my-little-agent
```

Works on Chrome 138+ desktop. Chrome downloads and manages the model itself, so nothing is added to your bundle. Check its status at `chrome://on-device-internals`.

### Three lines

```ts
import { Agent } from 'my-little-agent'

const agent = new Agent({ instruction: 'You are a concise assistant.' })
console.log(await agent.send('Explain recursion in one sentence.'))
```

### Check availability in production

Not every visitor can run Built-in AI. Unsupported environments return `'unavailable'` instead of throwing, so you can hide the feature or fall back to your server.

```ts
import { availability } from 'my-little-agent'

const state = await availability()
// 'unavailable' | 'downloadable' | 'downloading' | 'available'

if (state === 'unavailable') {
  hideAIFeature()
} else if (state === 'downloadable') {
  // The first call downloads the model. Show progress.
  new Agent({ onDownloadProgress: (p) => setProgress(Math.round(p * 100)) })
}
```

## Core Concepts

There are three. That's the whole mental model.

### `Agent` — one role, one session

```ts
const agent = new Agent({
  name: 'writer', // used in logs and parallel result labels
  instruction: 'You are a copywriter.', // system prompt
  tools: [/* ... */], // if present, runs a tool-calling loop
  maxSteps: 5, // tool loop ceiling
  stateless: true, // start fresh on every call (for workflow steps)
  maxToolResultChars: 4000, // clamp tool output to protect the window
  history: saved, // restore a previous conversation
  onEvent: (e) => console.log(e), // trace tool calls and results
})

await agent.send('...') // final text
agent.stream('...') // async iterator of deltas
await agent.generate<T>('...', schema) // schema-constrained object
agent.usage // { used, total } context tokens
agent.destroy() // release the session
```

The session is created lazily on the first call, so constructing an `Agent` costs nothing.

### `tool` — a plain function the model can call

```ts
const weather = tool<{ city: string }>({
  name: 'weather',
  description: 'Look up the current temperature of a city', // the model picks by this line alone
  parameters: { type: 'object', properties: { city: { type: 'string' } } },
  execute: async ({ city }) => fetch(`/api/weather?city=${city}`).then((r) => r.json()),
})
```

A throwing tool does not kill the loop — the error is handed back to the model so it can recover.

> Built-in AI has no stable native function calling yet, so the loop is driven by JSON Schema constrained decoding. Your code stays the same once native support lands.

### `Runnable` — everything has the same shape

`Agent`, `chain`, `parallel`, `router`, and `refine` all satisfy `{ name, run(input) }`. That is why they nest without adapters.

```ts
chain(parallel([a, b, c]), router({ ... }), refine({ ... }))
```

## Workflows

| Combinator                       | What it does                           | Use it for                   |
| :------------------------------- | :------------------------------------- | :--------------------------- |
| `chain(...steps)`                | Sequential; each output feeds the next | draft → edit → translate     |
| `parallel(steps, opts?)`         | Same input to all, results merged      | multi-angle analysis         |
| `router({ classifier, routes })` | Classify, then run one route           | intent-based branching       |
| `refine({ worker, evaluator })`  | Rewrite until the score clears the bar | quality-critical output      |
| `step(fn)`                       | A plain function as a stage            | pre/post-processing, masking |

```ts
// Redact, analyze from three angles, then merge.
const flow = chain(
  step((s) => s.replace(/\d{3}-\d{4}-\d{4}/g, '[phone]')),
  parallel([benefits, drawbacks, risks]),
  summarizer,
)
```

To merge with a model, just chain instead of passing an aggregator. To merge manually, pass `reduce`:

```ts
parallel([a, b], { reduce: (results) => results.join('\n---\n') })
```

## Context and Memory

The window is only a few thousand tokens, so this is designed for, not patched around.

### Agents do not share context

Each agent owns its own session and its own window. The only thing crossing between them is the string returned by `run()`.

```
   [classifier]      [analyst]       [summarizer]
    own window       own window       own window
        └── string ──→   └── string ──→
```

This looks like a limitation but it is the point. In a narrow window, sharing is a disaster: one agent's noise eats everyone's budget. Kept separate, N agents mean **N independent windows**, so the system as a whole holds more.

Splitting work improves quality _and_ context. Same reason.

### Three places the window overflows

| Situation                             | What happens                                 | Fix                                          |
| :------------------------------------ | :------------------------------------------- | :------------------------------------------- |
| Reusing an agent across workflow runs | The previous run's turns stay in the window  | `stateless: true`                            |
| A tool returns a large JSON           | One result pushes out the whole conversation | `maxToolResultChars` (4000 by default)       |
| The input document itself is long     | Older parts are silently dropped             | split with `step()`, process with `parallel` |

```ts
// Agents used as workflow steps should be stateless.
// Every call starts blank, so the window never grows across runs.
const summarizer = new Agent({ instruction: 'You summarize.', stateless: true })

const flow = chain(classifier, summarizer)
await flow.run(doc1)
await flow.run(doc2) // doc1's conversation is gone
```

Chat agents that need continuity keep the default (`stateless: false`).

```ts
agent.usage // { used: 812, total: 4096 }
new Agent({ onEvent: (e) => e.type === 'context-overflow' && warn() })
```

### Sessions die on reload

Chrome persists the **model weights** — that multi-gigabyte download — but not your conversation. It lives in memory and disappears when the tab closes. Persisting it is your job, and `agent.history` is how.

```ts
localStorage.setItem('chat', JSON.stringify(agent.history))

// Restore only the recent turns. Restoring everything refills the window.
const saved = JSON.parse(localStorage.getItem('chat') ?? '[]')
const agent = new Agent({ instruction: '...', history: saved.slice(-10) })
```

> Persistence solves **durability**, not **capacity**. A bigger store does not widen the window.

### So keep memory outside the model

> **The context window is a workbench; browser storage is the warehouse.**
> You don't pile the whole warehouse onto the bench — you fetch what the task needs.

`localMemory()` creates a store and `memoryTools()` turns it into tools. Hand the same store to several agents and it becomes a **shared scratchpad**.

```ts
import { Agent, chain, localMemory, memoryTools } from 'my-little-agent'

const shared = localMemory('support-desk')
const tools = memoryTools(shared) // remember / recall / listMemories

const researcher = new Agent({
  instruction: 'Save every fact you find with remember.',
  tools: [...tools, searchTool],
  stateless: true,
})

const writer = new Agent({
  instruction: 'Recall the facts you need, then write the answer.',
  tools,
  stateless: true,
})

await chain(researcher, writer).run('Summarize competitor pricing')
```

Their windows stay independent the whole time. Only short stored entries travel between them, so a long collaboration never blows the window — and the store survives a reload.

Swap the backend by implementing four methods:

```ts
interface MemoryStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}
```

`localMemory()` uses localStorage (~5 MB). For more, implement the interface over IndexedDB or your own API.

## Honest Limitations

### It is much weaker than GPT-5 or Claude

A model that fits inside a laptop GPU is not in the same weight class as one running in a datacenter.

|                   | On-device (Gemini Nano) | Server LLM            |
| :---------------- | :---------------------- | :-------------------- |
| Model size        | billions of parameters  | hundreds of billions  |
| Context           | a few thousand tokens   | hundreds of thousands |
| Complex reasoning | weak                    | strong                |
| Factual accuracy  | low, hallucinates       | relatively high       |
| Long documents    | effectively impossible  | fine                  |

**This is not a cheap replacement for a paid API.** It's a different layer — an edge cache isn't smarter than the origin, but it's close, free, and always on, so it takes different work.

| Axis           | On-device          | Server LLM              |
| :------------- | :----------------- | :---------------------- |
| Answer quality | ❌ loses           | ✅ wins                 |
| Latency        | ✅ no round trip   | ❌ round trip           |
| Cost per call  | ✅ zero            | ❌ metered              |
| Call frequency | ✅ unlimited       | ❌ cost and rate limits |
| Privacy        | ✅ stays on device | ❌ leaves the device    |
| Offline        | ✅ works           | ❌ no                   |
| Ops burden     | ✅ none            | ❌ keys, proxy, billing |

### What small models are actually good at

| Good at (transforming text you already have) | Bad at (producing knowledge it lacks) |
| :------------------------------------------- | :------------------------------------ |
| Classification, routing, tagging             | Factual Q&A                           |
| Structured extraction (text → JSON)          | Recent or rare knowledge              |
| Reformatting, tone, grammar                  | Synthesizing long documents           |
| Short summaries                              | Multi-step reasoning                  |
| Intent detection, natural language → query   | Exact arithmetic                      |

Every [recipe below](#frontend-recipes) sits in the left column. Not a coincidence.

### The framework closes part of the gap structurally

| Weakness                           | Countermeasure                      | Tool                 |
| :--------------------------------- | :---------------------------------- | :------------------- |
| Quality collapses on complex tasks | Decompose into simple stages        | `chain` · `parallel` |
| Output format drifts               | Constrain decoding with JSON Schema | `generate()`         |
| Invents facts                      | Let tools supply knowledge          | `tool()`             |
| Weak first draft                   | Score, then rewrite until it clears | `refine()`           |

The third one matters most. **Don't use a small model as a knowledge store — use it as a language processor.** Tools fetch the facts; the model only reads and phrases them.

```ts
// ❌ Relies on the model's memory
await agent.send('What is our refund policy?')

// ✅ Facts from a tool, sentences from the model
const agent = new Agent({
  instruction: 'You are support. Answer only from what the tool returns.',
  tools: [policyTool],
})
```

### Send the hard ones to your server

`Runnable` is just `{ name, run(input) }`, so a server LLM joins the same pipeline in three lines.

```ts
const cloud = step(
  (input) => fetch('/api/llm', { method: 'POST', body: input }).then((r) => r.text()),
  'cloud',
)

const hybrid = router({
  classifier: new Agent({ name: 'triage' }),
  routes: { local: new Agent({ instruction: 'Handle simple requests.' }), cloud },
  descriptions: {
    local: 'greetings, classification, formatting, short summaries',
    cloud: 'long documents, complex reasoning, questions needing accurate knowledge',
  },
})
```

Most requests finish locally, instantly and for free; only the hard ones reach your server.

> The moment a cloud route exists, the privacy benefit is gone _for that route_. For sensitive data, drop the route or put a masking `step()` in front of it.

### Don't use it when

- **The feature must work for everyone.** Chrome desktop only, and only on machines with enough free disk and GPU memory for the model. Keep it additive, or add a server fallback.
- **You need long documents.** Check `agent.usage` and chunk the input.
- **You need reliable facts.** Feed knowledge through tools.
- **First impressions matter.** The first run may download several gigabytes. Always show progress.

## Frontend Recipes

### Paste → filled form

```ts
const form = await parser.generate<{ name: string; phone: string; address: string }>(
  clipboardText,
  {
    type: 'object',
    properties: {
      name: { type: 'string' },
      phone: { type: 'string' },
      address: { type: 'string' },
    },
    required: ['name', 'phone', 'address'],
  },
)
```

`generate()` constrains the decoding itself, so the model cannot add commentary or break the shape. Feed it straight to `setState`.

### Natural language → client-side filter

```ts
const query = await parser.generate<{ category: string; maxPrice: number }>(
  'running shoes under $30',
  {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['shoes', 'clothes', 'bags'] },
      maxPrice: { type: 'integer' },
    },
    required: ['category', 'maxPrice'],
  },
)

setItems(all.filter((i) => i.category === query.category && i.price <= query.maxPrice))
```

### Expose page features as tools

```ts
const assistant = new Agent({
  instruction: 'You are the shop assistant. Use tools when needed.',
  tools: [
    tool<{ keyword: string }>({
      name: 'searchProducts',
      description: 'Search products by keyword',
      parameters: { type: 'object', properties: { keyword: { type: 'string' } } },
      execute: ({ keyword }) => fetch(`/api/products?q=${keyword}`).then((r) => r.json()),
    }),
    tool<{ id: string }>({
      name: 'addToCart',
      description: 'Add a product to the cart',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      execute: ({ id }) => cartStore.add(id),
    }),
  ],
})

await assistant.send('Add the cheapest running shoe I looked at to my cart')
```

### Support widget with routing

```ts
const desk = router({
  classifier: new Agent({ name: 'classifier' }),
  routes: { refund: refundAgent, tech: techAgent, sales: salesAgent },
  descriptions: {
    refund: 'refunds, cancellations, returns',
    tech: 'errors, how-to questions',
    sales: 'pricing, purchase questions',
  },
})
```

### Self-review before shipping the draft

```ts
const polished = refine({
  worker: new Agent({ instruction: 'You are a copywriter.' }),
  evaluator: new Agent({ instruction: 'You are a strict editor.' }),
  minScore: 85,
  maxRounds: 3,
})
```

### React

No adapter needed.

```tsx
function useAgent(instruction: string) {
  const ref = useRef<Agent>()
  if (!ref.current) ref.current = new Agent({ instruction }) // lazy session, free to construct
  useEffect(() => () => ref.current?.destroy(), [])
  return ref.current
}

export function Summarizer({ text }: { text: string }) {
  const agent = useAgent('You summarize in three sentences.')
  const [out, setOut] = useState('')

  useEffect(() => {
    let alive = true
    setOut('')
    ;(async () => {
      for await (const chunk of agent.stream(text)) {
        if (!alive) return
        setOut((prev) => prev + chunk)
      }
    })()
    return () => {
      alive = false
    }
  }, [text])

  return <p>{out}</p>
}
```

### Multimodal input

```ts
const vision = new Agent({
  instruction: 'You describe images.',
  expectedInputs: [{ type: 'image' }],
})

await vision.send([
  {
    role: 'user',
    content: [
      { type: 'text', value: 'What is in this photo?' },
      { type: 'image', value: imageBlob },
    ],
  },
])
```

## How Little, Exactly?

Measured, not claimed. Reproduce with `npm run size`.

| Scenario                  | minified |        gzip |  brotli |
| :------------------------ | -------: | ----------: | ------: |
| `Agent` only              |  5.61 kB | **2.38 kB** | 2.09 kB |
| Agent + tools + workflows |  7.44 kB | **3.03 kB** | 2.67 kB |
| Entire public API         |  9.18 kB | **3.63 kB** | 3.19 kB |

Importing only `Agent` is smaller than importing everything, which means tree-shaking actually works. The model itself is managed by Chrome and never enters your bundle.

|                                 |                                        |
| :------------------------------ | :------------------------------------- |
| Runtime dependencies            | **0**                                  |
| Source                          | **889 lines** (617 excluding comments) |
| Public API                      | **15 exports**                         |
| Minimum working code            | **3 lines**                            |
| Concepts to learn               | **3**                                  |
| Config files, API keys, servers | **0**                                  |

## API Reference

|                                             |                                                                   |
| :------------------------------------------ | :---------------------------------------------------------------- |
| `isSupported()`                             | Whether the global `LanguageModel` exists                         |
| `availability(opts?)`                       | `'unavailable' \| 'downloadable' \| 'downloading' \| 'available'` |
| `modelParams()`                             | topK / temperature defaults and maximums (`null` if unsupported)  |
| `createSession(opts)`                       | Low-level session creation                                        |
| `new Agent(opts)` / `agent(opts)`           | Create an agent (session is lazy)                                 |
| `.send(input)`                              | Final text, running the tool loop to completion                   |
| `.stream(input)`                            | Async iterator of deltas                                          |
| `.generate<T>(input, schema)`               | Schema-constrained, parsed object                                 |
| `.fork(name?)`                              | A new agent cloned from the current conversation                  |
| `.history`                                  | Conversation record, for saving and restoring                     |
| `.usage`                                    | `{ used, total }` context tokens                                  |
| `.reset()` / `.destroy()`                   | Drop record and session / release session only                    |
| `tool(def)`                                 | Tool definition helper                                            |
| `localMemory(namespace?)`                   | localStorage-backed `MemoryStore`                                 |
| `memoryTools(store)`                        | Turn a store into `remember` / `recall` / `listMemories`          |
| `chain` `parallel` `router` `refine` `step` | Workflow combinators                                              |
| `UnavailableError`                          | Thrown where the Prompt API is unavailable                        |

## Roadmap

- [x] Conversation persistence (`agent.history`) and shared memory (`localMemory`)
- [x] Context guards (`stateless`, tool-output clamping)
- [ ] User approval before tool execution — effectively required for DOM-mutating tools
- [ ] Built-in IndexedDB `MemoryStore`
- [ ] Remote model fallback adapter
- [ ] Web Worker offloading
- [ ] Orchestrator that decomposes subtasks dynamically
- [ ] Automatic summarization before overflow

## Development

**This repository is pnpm-only.** `npm install` and `yarn install` abort through an `only-allow` preinstall hook, and `packageManager` pins the exact pnpm version.

```bash
corepack enable   # installs the pinned pnpm from package.json
pnpm install

pnpm test         # unit + parser tests, with an injected fake LanguageModel global
pnpm test:all     # unit + type + packaging
pnpm typecheck
pnpm lint         # eslint (@tanstack/eslint-config)
pnpm format       # prettier
pnpm size         # reproduces the size table above
pnpm build        # vite (@tanstack/vite-config) + publint --strict
pnpm example      # try it in Chrome 138+
```

### Test layers

Four layers, because each catches something the others cannot.

| Command             | What it covers                                                                                                                                                                                                             |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`         | Agent, tool loop, workflows, memory — against a fake `LanguageModel` global, so it runs without Chrome. Includes parser fuzzing, since model output is the one input we do not control.                                    |
| `pnpm test:types`   | Generic inference consumers rely on (`tool<T>`, `generate<T>`, `Runnable`). Types can break while runtime stays green.                                                                                                     |
| `pnpm test:package` | Packs, installs the tarball with npm, runs it, and resolves types under both `bundler` and `node16`. Also asserts no install lifecycle scripts ship — that bug reached the release candidate once.                         |
| `pnpm test:e2e`     | Playwright against **real** Chrome. The fake model answers exactly as told; only this proves Gemini Nano honors the JSON Schema constraint and that the tool loop converges. Skips itself when Built-in AI is unavailable. |

`test:e2e` uses your installed Chrome (`channel: 'chrome'`), so there is no browser download.

| Tool                                           | Role                                                                  |
| :--------------------------------------------- | :-------------------------------------------------------------------- |
| [TanStack Config](https://tanstack.com/config) | Vite build and ESLint preset                                          |
| Prettier                                       | Formatting, run through lint-staged                                   |
| Husky                                          | Git hooks (`pre-commit`, `commit-msg`)                                |
| lint-staged                                    | Runs eslint and prettier on staged files only                         |
| commitlint                                     | Enforces [Conventional Commits](https://www.conventionalcommits.org/) |

Commit messages follow Conventional Commits, so `feat: add shared memory` passes while `updated stuff` is rejected.

## License

MIT
