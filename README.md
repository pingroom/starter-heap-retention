# Heap retention with PingRoom

Explain which objects retain other objects in an exported heap graph. PingRoom asks the snapshot owner whether each reference category is strong or weak. Code then computes reachability, dominators and retained bytes using those declarations.

Use this beside a profiler exporter or memory-analysis exercise. It reads a small declared graph and writes local JSON; it never attaches to a process, runs garbage collection or frees memory.

## Try it offline

Choose **Use this template**, clone your copy, and use Node.js 22 or newer:

```sh
npm ci
npm test
npm run demo
```

Four demos cover mixed strengths, all-weak references, Unknown and a graph without references. Tests and demos use published `@pingroom/sdk` **0.8.0** through local mock transports. After installation they need no credentials or network and send no live pings. Dependencies are pinned with a lockfile; `.npmrc` requests a 14-day release age where supported by npm. GitHub Actions checks Node 22 and 24.

## Prepare a snapshot

```sh
cp examples/heap.json heap.json
cp config.example.json config.json
npm run preview
```

Map your export into `heap.json`:

| Field | Contract |
| --- | --- |
| `heapId` | Stable ID, 1–40 characters: lowercase letter first, then lowercase letters, digits, `_` or `-`. |
| `title`, `context` | Nonempty single-line descriptions, at most 40 and 80 UTF-16 code units. Identify the source and reference-semantics documentation. |
| `objects` | 0–32 `{id, bytes}` records. IDs are unique; bytes are integers from 0 through 1,000,000,000. These are declared shallow sizes. |
| `roots` | Unique object IDs directly retained by the modeled environment. An empty list is valid. |
| `categories` | 0–3 `{id, label, meaning}` declarations for exactly the categories used by references. Labels allow 30 UTF-16 units; meanings allow 80. |
| `references` | 0–128 `{from, to, category}` records. Both endpoints and category must exist. Duplicate triples are rejected; self-references and cycles are allowed. |

Object and category IDs use the `heapId` alphabet with a 16-character limit. `unknown`, `constructor`, `prototype` and `__proto__` are reserved for these IDs. Metadata must already be trimmed and well formed, without control or format characters. Extra fields, sparse arrays, negative zero, fractional sizes and unknown IDs are rejected. The input must fit 64 KiB, and each complete Question must fit 500 UTF-16 units.

Objects, roots and categories are sorted by ID; references sort by endpoints and category. Reordering arrays preserves the session. Different categories may describe references between the same endpoints; any declared strong reference supplies a retaining edge.

Supply the complete graph for the scope you intend to analyze, including every external root. Code cannot discover omitted references, verify sizes or infer runtime-specific semantics. Conditional references, ephemerons, finalizers and native allocation overhead are outside this model. An unreachable object is unreachable **in this supplied graph**, not proven collectible in a running process.

## Connect and declare strengths

Install [PingRoom](https://pingroom.io/i), then:

```sh
npm run connect
npm run inspect
```

Approve pairing and grant a standard private room containing the snapshot owner, with room-list and Question create/read permissions. Verify the person in the app and copy their exact member UUID and a descriptive label into `config.json`. Names alone do not establish identity.

For an existing granted connection, copy `.env.example` to `.env` and set **both** `PINGROOM_TOKEN` and `PINGROOM_ROOM`. Blank or partial pairs are rejected; credential sources cannot be mixed.

```sh
npm start
# After the owner answers, record the answer:
npm start
# Repeat for the next category, then:
npm run export
```

Each invocation creates at most one direct, 15-minute Question or reads the original Question once. Categories are asked in ID order:

- **Strong:** references of this category retain their targets.
- **Weak:** references do not establish reachability.
- **Unknown:** semantics are unresolved or unsupported; withhold the whole analysis.

The Question includes category ID, label and meaning, plus heap metadata, owner UUID and source/category/policy hashes. Object IDs, byte sizes, roots and individual edges stay local. Unknown, missing, expired, cancelled, invalid or misattributed answers block export. Later categories can still be collected; there is no background polling or replacement Question.

A graph without references must have no categories. Its first run verifies the connection and room, saves a session and completes without sending any Question.

## Read the result

```sh
npm run status
npm run report
npm run export
```

These commands are local and need no credentials. `report` saves private `.retention/report.json`, including partial answer evidence. After every category has a known strength, `export` writes `.retention/retention.json`. Both include the canonical source, policy, hashes and attributed answers; the complete export also includes the analysis. Export refuses changed input or incomplete evidence. A failed export preserves any previous output; a successful export atomically writes or replaces it. Consume an output only after successful export for its expected source hash.

A virtual root connects to every declared root object. Code follows only strong references. For each reachable object:

- `dominators` lists objects appearing on **every** path from the virtual root to that object, including itself.
- `immediateDominator` is its nearest strict dominator. `null` means the virtual root; it is not an unknown result.
- `retained.objectIds` contains the object and every reachable object it dominates. Removing that object from this modeled graph would make those objects unreachable.
- `retained.bytes` sums the declared shallow sizes of that retained set.

Unreachable objects have `reachable: false`, `dominators: null` and `retained: null`; no retained-size claim is made for them. `byteAccounting` separates reachable and unreachable bytes and reconciles their sum to total declared bytes. **Per-object retained totals overlap across ancestors and must not be added together as total heap size.**

Shared paths can prevent exclusive retention. Cycles do not automatically retain themselves without a path from a root. Multiple roots may leave a shared descendant immediately dominated only by the virtual root. Zero-byte objects still participate in paths and retention.

Chrome's [memory terminology guide](https://developer.chrome.com/docs/devtools/memory-problems/get-started) explains retained size and dominators. This starter accepts its own bounded JSON format, not a native V8 heap snapshot, and makes no leak diagnosis or prediction about live memory reclamation.

## Adapt and resume

Write an adapter from your profiler's documented object/root/reference export. Preserve root completeness and distinguish supported strong/weak categories before adapting conditional runtime semantics. No profiler, database, deployment or deletion adapter is included.

For pure local calculation, import `analyzeHeap(rawInput, classifications)` from `src/model.js`. Supply exactly one `{categoryId, strength: 'strong' | 'weak'}` entry per category. It returns reachability, per-object dominators and retained sets, counts and byte accounting without modifying inputs. CLI export additionally requires the attributed owner declarations.

Real inputs, configuration, credentials, state and outputs are ignored by Git. Keep `.retention/` and `.pingroom/` private. Writes are atomic under a local lock. State/reports are bounded to 1 MiB; HTTP responses to 512 KiB with a five-second deadline. Changed input, owner, room or credentials cannot reuse the session.

A lost creation response leaves `create_unknown` and never triggers an automatic resend:

```sh
npm run status
npm run find-id
npm run recover -- EXACT-QUESTION-UUID
```

Recover only the original Question. An empty bounded search does not prove creation failed. Resolve or revoke uncertain/expired pairing in Connected Agents before archiving its pending record. Remove a stale `.lock` only after confirming its process stopped. Keep the source and original session while resolving uncertainty.

Run commands serially. Exit codes: `0` complete/local result; `1` invalid setup/evidence or refused export; `2` incomplete/Unknown/failed answer; `3` ready/pending/interrupted; `4` uncertain creation. Local status/report return 0 even for incomplete states; inspect their JSON status.

Tests compare retention against independent vertex-removal reachability across exhaustive and seeded graphs, and cover shared paths, cycles, multiple roots, empty/maximum snapshots, attribution, recovery, pairing and real CLI subprocesses. Live phone delivery is not tested. MIT licensed.
