import { createHash } from 'node:crypto';

export const TTL = 900;
export const CLOCK_SKEW_MS = 60000;
export const TOKEN = /^[^\s\x00-\x1f\x7f]{1,8192}(?![\s\S])/;
export const ROOM = /^[A-Z0-9]{12}$(?![\s\S])/;
export const isId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort(), wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const word = (value) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$(?![\s\S])/.test(value);
const line = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed()
  && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && value.trim() === value;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function iso(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$(?![\s\S])/.test(raw)) throw new Error('Expected a UTC timestamp.');
  const time = Date.parse(raw);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== raw.slice(0, 19)) throw new Error('Invalid UTC timestamp.');
  return new Date(time).toISOString();
}



const safeId = value => word(value) && value.length <= 16 && !['constructor', 'prototype', '__proto__', 'unknown'].includes(value);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const POLICY = Object.freeze({ name: 'declared-strong-reference-retention-v1',
  roots: 'a virtual root has an edge to every declared root object',
  traversal: 'only categories declared strong retain their target; weak references never establish reachability',
  dominance: 'a reachable object dominates another when every virtual-root path to the other passes through it',
  retention: 'retained set includes the object itself and every reachable object it dominates',
  accounting: 'declared shallow payload bytes only; individual retained totals overlap across ancestors',
  selection: 'each referenced category needs an owner-declared strength; Unknown withholds the whole analysis',
  excluded: 'live heap attachment, omitted roots, ephemerons, finalizers, runtime-specific GC, memory freeing and leak diagnoses' });
export const POLICY_HASH = hash(POLICY);
const promptFor = (input, category) => `${input.title}\n${input.context}\nHeap ${input.heapId}: classify ${category.id} (${category.label}).\nMeaning: ${category.meaning}\nDoes this category retain its target? Strong does; Weak does not. Choose Unknown for conditional or unsupported semantics. Object IDs, sizes, roots and edges stay local.`;
export function validateInput(input) {
  if (!keys(input, ['heapId', 'title', 'context', 'objects', 'roots', 'categories', 'references']) || !word(input.heapId)
    || !line(input.title, 40) || !line(input.context, 80) || !Array.isArray(input.objects) || input.objects.length > 32
    || !Array.isArray(input.roots) || input.roots.length > 32 || !Array.isArray(input.categories) || input.categories.length > 3
    || !Array.isArray(input.references) || input.references.length > 128) throw new Error('Supply heap metadata, up to 32 objects/roots, three categories and 128 references.');
  const ids = new Set();
  const objects = Array.from(input.objects, object => {
    if (!keys(object, ['id', 'bytes']) || !safeId(object.id) || ids.has(object.id) || !Number.isSafeInteger(object.bytes)
      || object.bytes < 0 || object.bytes > 1000000000 || Object.is(object.bytes, -0)) throw new Error('Objects need unique safe IDs and nonnegative integer byte sizes up to 1000000000.');
    ids.add(object.id); return { ...object };
  }).sort((a, b) => order(a.id, b.id));
  const rootIds = new Set();
  const roots = Array.from(input.roots, id => {
    if (!ids.has(id) || rootIds.has(id)) throw new Error('Roots must be unique declared object IDs.');
    rootIds.add(id); return id;
  }).sort(order);
  const categoryIds = new Set();
  const categories = Array.from(input.categories, category => {
    if (!keys(category, ['id', 'label', 'meaning']) || !safeId(category.id) || categoryIds.has(category.id)
      || !line(category.label, 30) || !line(category.meaning, 80)) throw new Error('Reference categories need unique safe IDs, labels and meanings.');
    categoryIds.add(category.id); return { ...category };
  }).sort((a, b) => order(a.id, b.id));
  const seen = new Set(), usedCategories = new Set();
  const references = Array.from(input.references, reference => {
    if (!keys(reference, ['from', 'to', 'category']) || !ids.has(reference.from) || !ids.has(reference.to) || !categoryIds.has(reference.category)) throw new Error('Every reference needs declared endpoints and category.');
    const identity = JSON.stringify([reference.from, reference.to, reference.category]);
    if (seen.has(identity)) throw new Error('Duplicate reference triple.');
    seen.add(identity); usedCategories.add(reference.category); return { ...reference };
  }).sort((a, b) => order(a.from, b.from) || order(a.to, b.to) || order(a.category, b.category));
  if (usedCategories.size !== categories.length) throw new Error('Declare precisely the categories used by references; no unused categories.');
  const result = { heapId: input.heapId, title: input.title, context: input.context, objects, roots, categories, references };
  for (const category of categories) if (promptFor(result, category).length > 500) throw new Error('Reference-category Question exceeds 500 UTF-16 units.');
  return result;
}
export function validateConfig(config) {
  if (!keys(config, ['participant']) || !keys(config.participant, ['id', 'label']) || !isId(config.participant.id) || !line(config.participant.label, 60)) throw new Error('Config requires an exact heap owner UUID and label.');
  return structuredClone(config);
}
export const itemsFor = input => validateInput(input).categories.map(category => ({ id: category.id }));
export function requestFor(rawInput, config, itemId, attemptId) {
  const input = validateInput(rawInput); validateConfig(config);
  const category = input.categories.find(item => item.id === itemId);
  if (!category || !isId(attemptId)) throw new Error('Invalid reference category or attempt.');
  const key = `retention-${attemptId}`;
  return { prompt: promptFor(input, category), context: `To ${config.participant.id}`,
    options: [{ value: 'strong', label: 'Strong', style: 'default' }, { value: 'weak', label: 'Weak', style: 'default' }, { value: 'unknown', label: 'Unknown', style: 'default' }],
    responder_scope: 'direct', target_user_id: config.participant.id, ttl: TTL, correlation_id: key,
    data: { input_hash: hash(input), category_hash: hash(category), policy_hash: POLICY_HASH, item_id: itemId, attempt_id: attemptId }, idempotencyKey: key };
}
export function previewInput(rawInput, config) {
  const input = validateInput(rawInput); validateConfig(config);
  const questions = input.categories.map(category => {
    const { correlation_id, idempotencyKey, data, ...question } = requestFor(input, config, category.id, '01990000-0000-7000-8000-000000000001');
    return { categoryId: category.id, ...question };
  });
  return { source: input, sourceHash: hash(input), policy: POLICY, policyHash: POLICY_HASH, questions,
    note: 'Attempt UUID, correlation ID and input/category/policy hashes are added when each Question is created. No references means no Questions.' };
}
function validateChoices(input, choices, complete) {
  if (!Array.isArray(choices) || choices.length !== input.categories.length) throw new Error('Supply exactly one strength for every category.');
  const seen = new Set(), allowed = complete ? ['strong', 'weak'] : ['strong', 'weak', 'unknown', null];
  const result = Array.from(choices, choice => {
    if (!keys(choice, ['categoryId', 'strength']) || seen.has(choice.categoryId) || !input.categories.some(category => category.id === choice.categoryId)
      || !allowed.includes(choice.strength)) throw new Error('Invalid, repeated or unresolved reference strength.');
    seen.add(choice.categoryId); return { ...choice };
  });
  return result.sort((a, b) => order(a.categoryId, b.categoryId));
}

/** Pure modeled retention analysis; the CLI additionally requires attributed owner declarations. */
export function analyzeHeap(rawInput, rawChoices) {
  const input = validateInput(rawInput), classifications = validateChoices(input, rawChoices, true);
  const strengths = new Map(classifications.map(item => [item.categoryId, item.strength]));
  const adjacency = new Map(input.objects.map(item => [item.id, new Set()]));
  const strongReferences = input.references.filter(reference => strengths.get(reference.category) === 'strong');
  for (const reference of strongReferences) adjacency.get(reference.from).add(reference.to);
  const reachable = new Set(), queue = [...input.roots];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (reachable.has(id)) continue;
    reachable.add(id); queue.push(...adjacency.get(id));
  }
  const reachableIds = [...reachable].sort(order), unreachableIds = input.objects.filter(item => !reachable.has(item.id)).map(item => item.id);
  const virtualRoot = Symbol('virtual root'), all = new Set([virtualRoot, ...reachableIds]);
  const predecessors = new Map(reachableIds.map(id => [id, new Set()]));
  for (const id of input.roots) predecessors.get(id).add(virtualRoot);
  for (const reference of strongReferences) if (reachable.has(reference.from)) predecessors.get(reference.to).add(reference.from);
  const dominators = new Map([[virtualRoot, new Set([virtualRoot])], ...reachableIds.map(id => [id, new Set(all)])]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of reachableIds) {
      let next = new Set(all);
      for (const predecessor of predecessors.get(id)) next = new Set([...next].filter(candidate => dominators.get(predecessor).has(candidate)));
      next.add(id);
      const previous = dominators.get(id);
      if (next.size !== previous.size || [...next].some(candidate => !previous.has(candidate))) { dominators.set(id, next); changed = true; }
    }
  }
  const sizes = new Map(input.objects.map(item => [item.id, item.bytes]));
  const sumBytes = ids => ids.reduce((sum, id) => sum + sizes.get(id), 0);
  const objects = input.objects.map(object => {
    if (!reachable.has(object.id)) return { ...object, reachable: false, dominators: null, immediateDominator: null, retained: null };
    const ownDominators = reachableIds.filter(id => dominators.get(object.id).has(id));
    const strict = ownDominators.filter(id => id !== object.id);
    const closest = strict.filter(candidate => strict.every(other => dominators.get(candidate).has(other)));
    if (closest.length !== (strict.length === 0 ? 0 : 1)) throw new Error('Immediate-dominator invariant failed.');
    const retainedIds = reachableIds.filter(id => dominators.get(id).has(object.id));
    return { ...object, reachable: true, dominators: ownDominators, immediateDominator: closest[0] ?? null,
      retained: { objectIds: retainedIds, bytes: sumBytes(retainedIds) } };
  });
  const totalBytes = sumBytes(input.objects.map(item => item.id)), reachableBytes = sumBytes(reachableIds), unreachableBytes = sumBytes(unreachableIds);
  if (reachableBytes + unreachableBytes !== totalBytes) throw new Error('Heap byte-accounting invariant failed.');
  return { classifications, reachableIds, unreachableIds, objects, strongReferenceCount: strongReferences.length,
    weakReferenceCount: input.references.length - strongReferences.length,
    byteAccounting: { totalBytes, reachableBytes, unreachableBytes }, sourceHash: hash(input), policyHash: POLICY_HASH,
    heapAttached: false, objectsFreed: false,
    note: 'Retention describes this declared graph only. Per-object retained totals overlap and must not be summed as heap size.' };
}
export function heapPlan(rawInput, rawChoices) {
  const input = validateInput(rawInput), choices = validateChoices(input, rawChoices, false);
  const status = choices.some(choice => choice.strength === null) ? 'incomplete' : choices.some(choice => choice.strength === 'unknown') ? 'unknown' : 'complete';
  return { status, analysis: status === 'complete' ? analyzeHeap(input, choices) : null };
}

export function validateState(state, rawInput) {
  const input = validateInput(rawInput);
  if (!keys(state, ['version', 'inputHash', 'config', 'room', 'credentialHash', 'startedAt', 'attempts']) || state.version !== 1
    || state.inputHash !== hash(input) || typeof state.room !== 'string' || !ROOM.test(state.room)
    || typeof state.credentialHash !== 'string' || !/^[0-9a-f]{64}$(?![\s\S])/.test(state.credentialHash)
    || !Array.isArray(state.attempts) || state.attempts.length > itemsFor(input).length || iso(state.startedAt) !== state.startedAt) throw new Error('Invalid state or changed heap graph. Restore the original input and configuration.');
  validateConfig(state.config);
  const items = itemsFor(input), ids = new Set(), questionIds = new Set(); let previous = state.startedAt, askerId;
  for (const [index, attempt] of state.attempts.entries()) {
    if (!keys(attempt, ['id', 'itemId', 'createdAt', 'request', 'questionId', 'status', 'observation']) || !isId(attempt.id) || ids.has(attempt.id)
      || attempt.itemId !== items[index].id || iso(attempt.createdAt) !== attempt.createdAt || attempt.createdAt < previous
      || hash(attempt.request) !== hash(requestFor(input, state.config, attempt.itemId, attempt.id))
      || !['creating', 'pending', 'answered', 'expired', 'cancelled', 'invalid_answer'].includes(attempt.status)) throw new Error('Invalid saved reference-category declaration or order.');
    ids.add(attempt.id); previous = attempt.createdAt;
    if (attempt.status === 'creating') {
      if (attempt.questionId !== null || attempt.observation !== null) throw new Error('Invalid uncertain creation state.');
    } else {
      if (!isId(attempt.questionId) || questionIds.has(attempt.questionId)) throw new Error('Invalid or repeated Question ID.');
      questionIds.add(attempt.questionId); validateObservation(attempt.observation, attempt.status, attempt.request);
      if (attempt.observation.checkedAt < attempt.createdAt) throw new Error('Observation predates its saved creation intent.');
      previous = attempt.observation.checkedAt;
      if (Date.parse(attempt.observation.createdAt) < Date.parse(attempt.createdAt) - CLOCK_SKEW_MS) throw new Error('Question predates its saved creation intent.');
      if (askerId !== undefined && attempt.observation.askerId !== askerId) throw new Error('Questions belong to different asking registrations.');
      askerId = attempt.observation.askerId;
    }
    if (['creating', 'pending'].includes(attempt.status) && index !== state.attempts.length - 1) throw new Error('Only the last confirmation may have an active Question.');
  }
  return state;
}




export function report(state, rawInput) {
  const input = validateInput(rawInput); validateState(state, input);
  const answers = input.categories.map(category => {
    const attempt = state.attempts.find(item => item.itemId === category.id), answer = attempt?.observation?.answer;
    return { itemId: category.id, status: attempt?.status === 'creating' ? 'create_unknown' : attempt?.status ?? 'unasked',
      choice: answer?.value ?? null, label: answer?.label ?? null, questionId: attempt?.questionId ?? null, attemptId: attempt?.id ?? null,
      responderId: answer?.responderId ?? null, answeredAt: answer?.answeredAt ?? null, askerId: attempt?.observation?.askerId ?? null, observedAt: attempt?.observation?.checkedAt ?? null };
  });
  const calculation = heapPlan(input, answers.map(answer => ({ categoryId: answer.itemId, strength: answer.choice })));
  const current = answers.find(answer => ['create_unknown', 'pending'].includes(answer.status));
  const status = current?.status ?? (answers.some(answer => answer.status === 'unasked') ? 'ready' : calculation.status);
  return { version: 1, heapId: input.heapId, sourceHash: hash(input), source: input, policy: POLICY, policyHash: POLICY_HASH,
    participant: state.config.participant, room: state.room, configHash: hash(state.config), answers, ...calculation, status };
}

function validateObservation(observation, status, request) {
  if (!keys(observation, ['createdAt', 'expiresAt', 'checkedAt', 'askerId', 'resolvedAt', 'answer']) || !isId(observation.askerId)) throw new Error('Invalid saved observation.');
  for (const key of ['createdAt', 'expiresAt', 'checkedAt']) if (iso(observation[key]) !== observation[key]) throw new Error('Invalid saved timestamp.');
  const duration = Date.parse(observation.expiresAt) - Date.parse(observation.createdAt);
  if (duration < TTL * 1000 - 1000 || duration > TTL * 1000 + 1000) throw new Error('Question lifetime differs from the saved request.');
  const latest = Date.parse(observation.checkedAt) + CLOCK_SKEW_MS;
  if (Date.parse(observation.createdAt) > latest) throw new Error('Question creation is implausibly in the future. Check the local clock.');
  if (status === 'pending') {
    if (observation.resolvedAt !== null) throw new Error('Pending Question has a resolution timestamp.');
  } else if (iso(observation.resolvedAt) !== observation.resolvedAt || observation.resolvedAt < observation.createdAt
    || Date.parse(observation.resolvedAt) > latest
    || (status === 'expired' ? observation.resolvedAt < observation.expiresAt : observation.resolvedAt > observation.expiresAt)) throw new Error('Invalid Question resolution time.');
  if (status === 'answered') {
    const answer = observation.answer;
    if (!keys(answer, ['value', 'label', 'responderId', 'answeredAt']) || answer.responderId !== request.target_user_id
      || !request.options.some((option) => option.value === answer.value && option.label === answer.label)
      || iso(answer.answeredAt) !== answer.answeredAt || answer.answeredAt !== observation.resolvedAt
      || answer.answeredAt < observation.createdAt || answer.answeredAt > observation.expiresAt) throw new Error('Invalid saved reference-category declaration evidence.');
  } else if (observation.answer !== null) throw new Error('Unanswered reference-category declarations must not contain reference-category declaration evidence.');
}

export function observeQuestion(q, request, questionId, room, checkedAt) {
  if (!isId(questionId) || q?.id !== questionId || q.kind !== 'question' || (q.is_handoff !== undefined && q.is_handoff !== false)
    || q.asker?.type !== 'agent' || !isId(q.asker?.id) || q.prompt !== request.prompt || q.context !== request.context
    || q.responder_scope !== 'direct' || q.target_user_id !== request.target_user_id || q.resolution_policy !== 'first'
    || (q.results !== undefined && q.results !== null) || q.text_input !== null || q.correlation_id !== request.correlation_id || q.reply_to !== null || hash(q.data) !== hash(request.data)
    || (q.room_code ?? q.room?.code) !== room || q.room_code !== undefined && q.room_code !== room
    || q.room !== undefined && q.room?.code !== room || !['pending', 'answered', 'expired', 'cancelled'].includes(q.state)
    || !Array.isArray(q.options) || q.options.length !== request.options.length
    || Array.from(q.options).some((option, index) => option?.value !== request.options[index].value || option?.label !== request.options[index].label
      || (option?.primary !== undefined && option.primary !== false) || (option?.destructive !== undefined && option.destructive !== false))) throw new Error('Question does not match the saved configuration, room, or reviewer.');
  const observation = { createdAt: iso(q.created_at), expiresAt: iso(q.expires_at), checkedAt: iso(checkedAt), askerId: q.asker.id,
    resolvedAt: q.resolved_at === null ? null : iso(q.resolved_at), answer: null };
  let status = q.state === 'answered' ? 'invalid_answer' : q.state;
  if (q.state !== 'answered' && q.answer !== null) throw new Error('Unresolved Question includes an unexpected answer.');
  if (q.state === 'answered') {
    const answer = q.answer;
    try {
      if (!answer || answer.text !== null || answer.responder?.id !== request.target_user_id
        || !request.options.some((option) => option.value === answer.value && option.label === answer.label)) throw new Error('Invalid answer.');
      observation.answer = { value: answer.value, label: answer.label, responderId: answer.responder.id, answeredAt: iso(answer.answered_at) };
      validateObservation(observation, 'answered', request); status = 'answered';
    } catch { observation.answer = null; }
  }
  validateObservation(observation, status, request);
  return { status, observation };
}

export function assertParticipantRoom(rooms, room, participantId) {
  if (!Array.isArray(rooms) || rooms.length > 1000) throw new Error('Invalid room inventory.');
  const matches = rooms.filter((item) => item?.invite_code === room), selected = matches[0];
  if (matches.length !== 1 || selected.type !== 'standard' || selected.is_public !== false || !Array.isArray(selected.members)
    || selected.members.length > 1000 || !selected.members.some((member) => member?.user_id === participantId)) throw new Error('Use a granted standard private room containing the named participant.');
}
