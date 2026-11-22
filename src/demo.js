import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { step, exportAnalysis } from './engine.js';
import { readJson } from './storage.js';
import { mockApi, CONFIG, ROOM_CODE, id } from './mock.js';
const original = await readJson(new URL('../examples/heap.json', import.meta.url), 65536);
for (const [name, choices] of [['mixed', ['strong', 'weak']], ['all-weak', ['weak', 'weak']], ['unknown', ['strong', 'unknown']], ['no-references', []]]) {
  const input = structuredClone(original);
  if (choices.length === 0) { input.references = []; input.categories = []; }
  const directory = await mkdtemp(join(tmpdir(), 'retention-demo-'));
  try {
    const now = () => '2026-01-01T09:00:00.000Z', api = mockApi(now);
    const options = { client: api.client, directory, input, config: CONFIG, token: 'offline-fixture-token', room: ROOM_CODE, now };
    let result;
    for (const [index, choice] of choices.entries()) {
      assert.equal((await step(options)).status, 'pending');
      api.answer(id(index + 1), choice); result = await step(options);
    }
    if (choices.length === 0) result = await step(options);
    if (choices.includes('unknown')) { assert.equal(result.analysis, null); await assert.rejects(exportAnalysis(directory, input)); }
    else { const exported = await exportAnalysis(directory, input); assert.equal(exported.status, 'complete'); }
    assert.equal(api.calls.filter(call => call.method === 'POST').length, choices.length);
    console.log(JSON.stringify({ name, status: result.status, analysis: result.analysis }, null, 2));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
