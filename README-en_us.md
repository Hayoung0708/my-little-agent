<h1 align="center">My Little Agent</h1>

<p align="center">
A <b>multi-agent</b> composition library built on <b>Chrome Built-in AI</b><br/>
No server, no API key, no token bill — it all happens inside the user's browser.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/gzip-6.17%20kB-brightgreen" alt="gzip 6.17 kB" height="18">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="0 dependencies" height="18">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6" alt="TypeScript strict" height="18">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT license" height="18">
</p>

<p align="center">
  <a href="https://github.com/Hayoung0708/my-little-agent/blob/main/README.md">한국어</a> |
  <b>English</b>
</p>

```ts
import { Agent, chain, summarizer, tool, translator } from 'my-little-agent'

// 1. My own function, called directly by the model
const findOrder = tool<{ id: string }>({
  name: 'findOrder',
  description: 'Look up order details by order number',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  execute: ({ id }) => db.orders.get(id),
})

// 2. An agent holding that tool
const desk = new Agent({
  instruction:
    'Customer support rep. Always check order questions with the tool before answering.',
  tools: [findOrder],
  stateless: true,
})

// 3. Shorten the answer, then put it in Korean. The last two steps run on
//    Chrome's purpose-built models, so they cost the agent zero tokens.
const flow = chain(desk, summarizer({ length: 'short' }), translator({ to: 'ko' }))

await flow.run('Where is my order A-1024?')
```

## What do you get out of this?

What Chrome hands you for free, and what you'd still have to write yourself to actually run it. You get both.

### What comes from Built-in AI

1. **Serverless** — the model lives inside Chrome. No proxy, no key management, no billing dashboard.
2. **Nobody pays** — no token bill lands on you, and users never have to paste in an API key of their own. An "enter your key" screen is a large drop-off point all by itself.
3. **Nothing leaves the device** — you can work with data that isn't allowed off-site: medical, financial, internal documents. It works offline too.

### What My Little Agent adds on top

1. **Tool calling** —
   To put a function in a model's hands you have to constrain the output with a JSON Schema → parse it → send it back when the model names a tool that doesn't exist → feed the execution result back in → and repeat until a final answer comes out. That whole loop is now one line: `tools: [...]`.

2. **Multi-agent composition** —
   Four of them: sequential (`chain`), concurrent (`parallel`), branching (`router`), rewriting (`refine`). The result is a piece again, so they nest inside each other — `chain(parallel([a, b]), router({ … }))`.

3. **Context window management** —
   An on-device model's window is only a few thousand tokens, so it fills up fast. Each agent gets its own window, re-running a flow doesn't pile the last conversation back on, large tool results get truncated, and the console flags the mistakes likely to overflow it.

4. **Memory outside the model** —
   Whatever doesn't fit in the window lives in browser storage and comes out only when it's needed. Hand the same store to several agents and it becomes a shared scratchpad. It survives a refresh.

5. **Routing around unsupported environments** —
   Chrome's purpose-built models differ in availability per language pair and per feature. Instead of checking six places one by one, hang a backup agent on `fallback`.

## Read this first — don't build a critical feature on it

The model runs **on the user's device**, so when the device doesn't meet the bar the feature simply never turns on.

|           |                                                                                                           |
| :-------- | :-------------------------------------------------------------------------------------------------------- |
| Browser   | Chrome 138 or later, **desktop** only (no mobile support)                                                 |
| Storage   | **22 GB free** before the download starts; the model is **deleted if free space later falls below 10 GB** |
| Hardware  | More than 4 GB of VRAM, or 16 GB RAM + 4 cores                                                            |
| First run | Roughly a **4 GB** model download. Users wait through it                                                  |

Installing Chrome doesn't bring the model along with it. The download starts **the first time someone calls `create()`**. That said, the model is **global to the browser** rather than per-site, so if the user already fetched it somewhere else, it's used as is.

Which means availability isn't something you check once and move past. **A device that worked yesterday can fail today because the disk filled up. And you get no error.** `availability()` just quietly returns `'unavailable'`.

> **Use it where it's a "nice to have."**
> Don't use it where the service breaks without it. Hide the feature, keep a separate server path, or set a `fallback`.

## Docs

- [Getting started](#getting-started)
- [The pieces](#the-pieces)
  - [Availability — does it work in this browser](#availability--does-it-work-in-this-browser)
  - [Agent — one AI model](#agent--one-ai-model)
    - [Options](#options)
    - [Methods](#methods)
    - [Built-in agents](#built-in-agents)
  - [Tool — a custom function the model calls](#tool--a-custom-function-the-model-calls)
    - [Built-in tools](#built-in-tools)
  - [Workflow — joining pieces together](#workflow--joining-pieces-together)
  - [Memory — storing it in the browser](#memory--storing-it-in-the-browser)
- [Context and memory](#context-and-memory)
- [Frontend examples](#frontend-examples)

## Getting started

```bash
pnpm add my-little-agent
```

Chrome downloads and manages the model on its own. Nothing is added to your app bundle. You can see the current state at `chrome://on-device-internals`.

### The basics take three lines

```ts
import { Agent } from 'my-little-agent'

const agent = new Agent({ instruction: 'Answer in short, clear English.' })
console.log(await agent.send('Explain recursion in one sentence'))
```

Judged on these three lines alone, this is close to using the Chrome API directly. **The difference shows up the moment you attach tools and start joining several of them together.** That's what the rest of this covers.

## The pieces

`Agent` and `Workflow` are the **same shape**. `{ name, run(input) }` — it has a name, it takes a string and returns a string. In the code that shape is called `Runnable`. That single fact is why they plug into each other with no adapters.

|                  | What it is                                  | Example                                              |
| :--------------- | :------------------------------------------ | :--------------------------------------------------- |
| **Availability** | Check whether it works here                 | `isSupported()`, `availability()`                    |
| **Agent**        | One AI model                                | `new Agent({ instruction: 'You are a translator' })` |
| ↳ Ready made     | 6 of them: translate, summarize, proofread… | `translator({ to: 'ko' })`                           |
| **Tool**         | A custom function the model calls           | `tool({ … })`                                        |
| ↳ Comes with it  | Calculator, page reading                    | `calculator()`, `pageTools()`                        |
| **Workflow**     | Joins agents together                       | `chain`, `parallel`, `router`, `refine`              |
| **Memory**       | Storage in the browser                      | `localMemory()`, `memoryTools()`                     |

`Availability` and `Memory` are not `Runnable`. One is a pre-flight check and the other is a store; everything else is a piece.

### Availability — does it work in this browser

Not every visitor can use built-in AI. Even in environments where it can't run it returns `'unavailable'` rather than throwing, so a branch is all you need.

```ts
import { availability, isSupported } from 'my-little-agent'

isSupported() // boolean — only whether the global LanguageModel exists (sync)
await availability() // whether the model itself is ready (async)
// → 'unavailable' | 'downloadable' | 'downloading' | 'available'
```

| Value            | Meaning                     | What to do                                            |
| :--------------- | :-------------------------- | :---------------------------------------------------- |
| `'unavailable'`  | Can't run on this device    | Hide the feature or go through the server             |
| `'downloadable'` | Usable, but not fetched yet | The first call starts the download. **Show progress** |
| `'downloading'`  | Downloading right now       | Have them wait, and show progress                     |
| `'available'`    | Ready to use                | Just use it                                           |

```ts
if ((await availability()) === 'downloadable') {
  // The first call pulls down about 4 GB. Always show progress.
  new Agent({ onDownloadProgress: (p) => setProgress(Math.round(p * 100)) })
}
```

### Agent — one AI model

One role, one session. The session is created **on the first call**, so constructing a pile of instances up front costs nothing.

```ts
const writer = new Agent({
  name: 'writer',
  instruction: 'A copywriter who writes product ad copy.',
})

await writer.send('Give me three summer sale banner lines')
```

#### Options

All of them optional. Plain `new Agent()` works.

| Option                               | Default        | When to use it                                                                                          |
| :----------------------------------- | :------------- | :------------------------------------------------------------------------------------------------------ |
| `instruction`                        | none           | **This agent's role.** Goes in as the system prompt. You'll use it almost always                        |
| `tools`                              | `[]`           | Functions to hand the model. With even one, it runs the tool-calling loop                               |
| `stateless`                          | `false`        | **`true` starts every call from a blank slate.** Turn it on for agents going into `chain` or `parallel` |
| `name`                               | `'agent'`      | Used in logs and as the label on `parallel` results. Set it when wiring several together                |
| `today`                              | `false`        | Puts one line with today's date in the system prompt. Turn it on for agents that deal with dates        |
| `maxSteps`                           | `5`            | Cap on tool-loop iterations. Raise it for work that has to go through several tools                     |
| `maxToolResultChars`                 | `4000`         | Truncates tool results at this length. Lower it if a tool returns big JSON                              |
| `history`                            | `[]`           | Restores a previous conversation by passing it in. Used for resuming after a refresh                    |
| `temperature` / `topK`               | Chrome default | Closer to 0 is more deterministic. **Both or neither** — you can't set just one                         |
| `onEvent`                            | none           | Streams out tool calls, results, errors, and context overflow. Wire it to a log UI                      |
| `onDownloadProgress`                 | none           | Model download progress, `0`–`1`                                                                        |
| `signal`                             | none           | `AbortSignal`. Cancels this agent's entire run                                                          |
| `expectedInputs` / `expectedOutputs` | text           | Declare these when using multimodal. e.g. `[{ type: 'image' }]`                                         |

```ts
// Chatbot — the conversation has to continue, so leave stateless off (the default)
const bot = new Agent({ instruction: 'A friendly support rep.' })

// Workflow step — has to start blank every time, so turn it on
const step = new Agent({
  instruction: 'Three sentences, essentials only.',
  stateless: true,
})

// An agent that uses tools — raise maxSteps if it needs several passes
const researcher = new Agent({
  instruction: 'Verify the facts with tools, then answer.',
  tools: [searchTool, dbTool],
  maxSteps: 8,
  maxToolResultChars: 1500, // lowered to save window when results run big
  onEvent: (e) => console.log(e.type, e),
})
```

> **Turn on `today: true` to include the date.**
> An on-device model has a fixed training cutoff and no clock. Ask it the date and you get a confidently wrong answer.
> With it on, one line — `Today's date: 2026-08-25 (Tuesday).` — goes at the very front of the system prompt. It costs about 20 tokens.

#### Methods

|                              | Returns                  | When to use it                                                                                     |
| :--------------------------- | :----------------------- | :------------------------------------------------------------------------------------------------- |
| `send(input)`                | `Promise<string>`        | **The default.** One final answer. With tools, it runs the loop to the end first                   |
| `stream(input)`              | `AsyncGenerator<string>` | Typing effect. Fragments of text arrive in order                                                   |
| `generate<T>(input, schema)` | `Promise<T>`             | **When you want JSON.** The schema constrains the output, and it's parsed into an object for you   |
| `run(input)`                 | `Promise<string>`        | Alias for `send()`. It exists to satisfy the `Runnable` contract                                   |
| `fork(name?)`                | `Promise<Agent>`         | A new agent cloned from the current conversation. For branching off the same context to experiment |
| `ready()`                    | `Promise<Session>`       | Creates the session ahead of time. For pulling the first-response delay forward                    |

|             |                             |                                                                                   |
| :---------- | :-------------------------- | :-------------------------------------------------------------------------------- |
| `history`   | `PromptMessage[]`           | The conversation so far. Save it as JSON, restore it through the `history` option |
| `usage`     | `{ used, total }` \| `null` | Context token usage. `null` when there's no session                               |
| `stateless` | `boolean` \| `undefined`    | The configured value. **`undefined` if you never set it** (not `false`)           |
| `reset()`   | —                           | Throws away both the session and the conversation history                         |
| `destroy()` | —                           | Releases only the session. **Always call it on an agent you're done with**        |

```ts
// send — the most common use
const answer = await agent.send('Write me some summer sale copy')

// stream — spill it onto the screen a piece at a time
for await (const chunk of agent.stream('Explain it at length')) {
  setText((prev) => prev + chunk)
}

// generate — an object, no parsing to worry about
const parsed = await agent.generate<{ title: string; tags: string[] }>(article, {
  type: 'object',
  properties: {
    title: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'tags'],
})

// saving and restoring
localStorage.setItem('chat', JSON.stringify(agent.history))
const restored = new Agent({ instruction, history: JSON.parse(saved).slice(-10) })

agent.usage // { used: 812, total: 4096 }
agent.destroy()
```

#### Built-in agents

Chrome ships separate purpose-built models that each do one job. They're wrapped so you use them **exactly like** an agent you built yourself. Think of them as finished agents that need no instruction written for them.

```ts
import {
  languageDetector,
  proofreader,
  rewriter,
  summarizer,
  translator,
  writer,
} from 'my-little-agent'

await translator({ to: 'ko' }).run('Hello') // → '안녕하세요' (source language auto-detected)
await summarizer({ type: 'tldr', length: 'short' }).run(longText)
await languageDetector().run('Bonjour') // → 'fr'
await writer({ tone: 'formal' }).run('A refund request email')
await rewriter({ tone: 'more-casual', length: 'shorter' }).run(draft)
await proofreader().run('I seen him') // → 'I saw him'
```

| Built-in agent       | What it does                                | Options                                             |
| :------------------- | :------------------------------------------ | :-------------------------------------------------- |
| `translator()`       | Translates                                  | `to` (required) · `from` (auto-detected if omitted) |
| `summarizer()`       | Summarizes                                  | `type` · `length` · `format` · `sharedContext`      |
| `languageDetector()` | Identifies the language, returns its code   | —                                                   |
| `writer()`           | Writes new text to order                    | `tone` · `length` · `format` · `context`            |
| `rewriter()`         | Changes the tone or length of existing text | `tone` · `length` · `format` · `context`            |
| `proofreader()`      | Fixes grammar and readability               | `expectedInputLanguages`                            |

All of them take `fallback` (an agent to run instead when they aren't available) and `signal`. The first three are stable from Chrome 138; the last three are still origin trial, so in most environments they fall through to `fallback`.

**This is the biggest saving there is.** The purpose-built models run separately, so they use **zero tokens** of any other agent's context window. When the window is only a few thousand tokens, picking out the work you can finish without asking the model is what pays off most.

```ts
// They mix in right alongside Agent
chain(analyst, summarizer(), translator({ to: 'ko' }))

// In an environment that can't run it, this agent translates instead
translator({
  to: 'ko',
  fallback: new Agent({
    instruction: 'Translate the input into Korean and output only that.',
  }),
})
```

`proofreader` is the only one whose result is an object rather than a string, so it splits in two.

```ts
const fix = proofreader()
await fix.run('I seen him') // → 'I saw him'                      (for composition)
await fix.proofread('I seen him') // → { correctedInput, corrections } (for underlining)
```

> **Don't mix these up with Tool.**
> A Tool is a function **the model** decides to call, so it goes in `tools: [...]`. These are Agents, so they go in `chain(...)`.
> They aren't agents that carry a conversation. There's no `send()`, `history`, or `tools` — only `run()`.

### Tool — a custom function the model calls

```ts
const weather = tool<{ city: string }>({
  name: 'weather',
  description: 'Look up the current temperature in a city', // this one line is all the model sees when choosing
  parameters: { type: 'object', properties: { city: { type: 'string' } } },
  execute: async ({ city }) => fetch(`/api/weather?city=${city}`).then((r) => r.json()),
})

new Agent({ instruction: 'Weather assistant', tools: [weather] })
```

**The model decides on its own when to call it.** That decision comes down to the one line in `description`, so be specific.

A tool throwing doesn't kill the loop. The error is passed back to the model, which tries another approach.

#### Built-in tools

```ts
import { calculator, pageTools } from 'my-little-agent'

new Agent({
  instruction: 'An assistant that answers while looking at this page.',
  tools: [calculator(), ...pageTools()],
})
```

| Built-in tool              | What it does                                  | Arguments            |
| :------------------------- | :-------------------------------------------- | :------------------- |
| `calculator()`             | Exact arithmetic                              | An expression string |
| `pageTools()` → `pageInfo` | Page title, URL, and the user's selected text | None                 |
| `pageTools()` → `readPage` | The page's body text                          | None                 |

**`calculator()`** — exact arithmetic is the thing small models reliably can't do. This fills that gap with a tool. It handles the four operations, modulo (`%`), parentheses, and decimals, and it accepts digit separators (`1,200`). Write percentages as decimals, like `0.15`.

**`pageTools()`** — reads the page currently open. It gives you two tools.

**This is something a server-side LLM structurally cannot do.** What's inside the user's screen is visible only to a model running inside the browser.

```ts
pageTools({
  root: () => document.querySelector('article'), // what to read. defaults to body
  maxChars: 2000, // truncation threshold
  includeQuery: false, // whether to include the URL's query string. defaults to false
})
```

The URL **drops the query string** by default. Session tokens ride along in it often enough, and even though the model runs locally the conversation history can still end up saved.

> **Web search isn't included.**
> The browser has no search capability, so it would mean a third-party API — and the moment you do that, API keys, a proxy server, billing, and outbound data transfer all come with it. The entire premise of this library collapses. If you need it, build it yourself with `tool()`. Ten lines will do.

### Workflow — joining pieces together

|                                  | What it does                                | Where you use it                         |
| :------------------------------- | :------------------------------------------ | :--------------------------------------- |
| `chain(...steps)`                | In order, each result feeding the next      | Draft → proofread → translate            |
| `parallel(steps, opts?)`         | Runs the same input concurrently and merges | Analyzing several angles at once         |
| `router({ classifier, routes })` | Classifies, then runs one path only         | Branching by inquiry type                |
| `refine({ worker, evaluator })`  | Rewrites until it hits a target score       | Output where quality matters             |
| `step(fn)`                       | A pure function, no model involved          | Pre-processing, post-processing, masking |

```ts
// Strip phone numbers, analyze from three angles at once, then merge into one.
const flow = chain(
  step((s) => s.replace(/\d{3}-\d{4}-\d{4}/g, '[phone number]')),
  parallel([pros, cons, risks]),
  summarizer(),
)
```

The result is a piece too, so you can compose it again.

```ts
chain(parallel([a, b, c]), router({ ... }), refine({ ... }))
```

To merge them yourself, pass a `reduce`.

```ts
parallel([a, b], { reduce: (results) => results.join('\n---\n') })
```

> **Turn on `stateless: true` for any Agent you compose.**
> Without it, the second run of a flow still has the first conversation sitting in the window, and the result quietly changes. No error is raised either, which makes it the hardest mistake to track down — so the combinators warn you in the console.
> If you meant to carry the conversation forward, state `stateless: false` explicitly and the warning goes away.

### Memory — storing it in the browser

Sessions disappear on refresh, and the window is narrow. So memory lives outside the model.

```ts
const shared = localMemory('support-desk')
const tools = memoryTools(shared) // remember / recall / listMemories

new Agent({ instruction: 'Save anything you learn with remember.', tools })
```

**Hand the same store to several agents and that is your shared scratchpad.** More on that below.

## Context and memory

With a window of only a few thousand tokens, this problem wasn't patched on later — it was the starting point of the design.

### Agents don't share context with each other

Each agent uses its own session and its own window. The only thing that crosses between them is the one string `run()` returned.

```
   [classifier]      [analyst]        [summarizer]
    own window       own window       own window
       └── string ──→    └── string ──→
```

It looks like a constraint, but it's deliberate. The narrower the window, the more poisonous sharing gets — noise one agent produces is carried by all the rest. Kept apart, N agents become **N independent windows**, and the total information the system handles goes up rather than down.

### The window overflows in four places

| Situation                                     | What happens                                               | What to do                                          |
| :-------------------------------------------- | :--------------------------------------------------------- | :-------------------------------------------------- |
| Re-running a flow composed of the same agents | The last run's conversation is still sitting in the window | `stateless: true` (warns if you don't)              |
| A tool returns big JSON                       | One result pushes out the whole conversation               | `maxToolResultChars` (4000 chars by default)        |
| The input document itself is long             | Older parts get silently cut off                           | Split with `step()` and process in `parallel`       |
| Asking the model to translate or summarize    | Burns window you didn't have to                            | `translator()` · `summarizer()` (zero window usage) |

```ts
agent.usage // { used: 812, total: 4096 }
new Agent({ onEvent: (e) => e.type === 'context-overflow' && warn() })
```

### Sessions disappear on refresh

The only thing Chrome keeps on disk is **the model weights**. The conversation history lives in memory alone and is gone once the tab closes. Saving it is on us, and `agent.history` is the way in.

```ts
localStorage.setItem('chat', JSON.stringify(agent.history))

// Restore only the last few turns. Push all of it back in and the window fills up again.
const saved = JSON.parse(localStorage.getItem('chat') ?? '[]')
const agent = new Agent({ instruction: '...', history: saved.slice(-10) })
```

> Saving solves the **persistence** problem, not the **capacity** one. However large the storage, how much fits in the window doesn't change.

### Which is why memory lives outside the model

> **The context window is your workbench, browser storage is the warehouse.**
> You don't haul the whole warehouse onto the workbench. You bring over only what you need, when you need it.

```ts
import { Agent, chain, localMemory, memoryTools } from 'my-little-agent'

const shared = localMemory('support-desk')
const tools = memoryTools(shared)

const researcher = new Agent({
  instruction: 'Research the material and save what you learn with remember.',
  tools: [...tools, searchTool],
  stateless: true,
})

const writer = new Agent({
  instruction: 'Pull the facts you need with recall, then write the answer.',
  tools,
  stateless: true,
})

await chain(researcher, writer).run('Summarize competitor pricing policies')
```

The two agents' windows stay strangers to the end. All that moves between them is the short entries left in the store, so the window doesn't blow up however long the collaboration runs. And a refresh leaves the store intact.

The store is swappable — you only have to implement four methods.

```ts
interface MemoryStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}
```

`localMemory()` uses localStorage (about 5 MB). If you need more room, implement the same interface over IndexedDB or your own API.

## Frontend examples

### Paste → autofill the form

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

`generate()` constrains the decoding itself. The model can't tack on commentary or break the format, so you can drop the result straight into `setState`.

### Natural language → client-side filter

```ts
const query = await parser.generate<{ category: string; maxPrice: number }>(
  'show me running shoes under 30 dollars',
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

### Multilingual reviews, collected in Korean

```ts
// All of it Chrome's purpose-built models, so none of this touches the context window
const digest = chain(summarizer({ length: 'short' }), translator({ to: 'ko' }))

const summaries = await Promise.all(reviews.map((r) => digest.run(r)))
```

### Exposing page features as tools

```ts
const assistant = new Agent({
  instruction: 'Shopping assistant. Use the tools when you need them.',
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

await assistant.send(
  'Put the cheapest of those running shoes I just looked at in my cart',
)
```

### Routing a support widget

```ts
const desk = router({
  classifier: new Agent({ name: 'classifier', stateless: true }),
  routes: { refund: refundAgent, tech: techAgent, sales: salesAgent },
  descriptions: {
    refund: 'Refunds, cancellations, returns',
    tech: 'Errors, how-to questions',
    sales: 'Pricing, purchase advice',
  },
})
```

### Making it review itself before export

```ts
const polished = refine({
  worker: new Agent({
    instruction: 'A copywriter who writes product ad copy.',
    stateless: true,
  }),
  evaluator: new Agent({
    instruction: 'A demanding editor who picks the copy apart.',
    stateless: true,
  }),
  minScore: 85,
  maxRounds: 3,
})
```

### React

No separate adapter needed.

```tsx
function useAgent(instruction: string) {
  const ref = useRef<Agent>()
  if (!ref.current) ref.current = new Agent({ instruction }) // sessions are created lazily, so building one is free
  useEffect(() => () => ref.current?.destroy(), [])
  return ref.current
}

export function Summary({ text }: { text: string }) {
  const agent = useAgent('Cut it down to three sentences, essentials only.')
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
  instruction: 'Describe what you see in the photo.',
  expectedInputs: [{ type: 'image' }],
})

await vision.send([
  {
    role: 'user',
    content: [
      { type: 'text', value: "What's in this photo?" },
      { type: 'image', value: imageBlob },
    ],
  },
])
```

---

Development, design rules, and the roadmap are in [AGENTS.md](https://github.com/Hayoung0708/my-little-agent/blob/main/AGENTS.md). Licensed under [MIT](https://github.com/Hayoung0708/my-little-agent/blob/main/LICENSE).
