import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeHeap, heapPlan, validateInput, previewInput, requestFor, hash } from '../src/model.js';
import { CONFIG, id } from '../src/mock.js';
const example = JSON.parse(await readFile(new URL('../examples/heap.json', import.meta.url), 'utf8'));
const choices = [{ categoryId: 'member', strength: 'strong' }, { categoryId: 'observer', strength: 'weak' }];
const object = (result, id) => result.objects.find(item => item.id === id);
const bare = () => ({ heapId: 'fixture', title: 'Fixture', context: 'Declared test graph.', objects: [], roots: [], categories: [], references: [] });
const oneCategory = () => ({ id: 'edge', label: 'Edge', meaning: 'Declared owning references.' });
function graph(n, references, roots) {
  return { ...bare(), objects: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, bytes: i * 7 })), roots,
    categories: references.length ? [oneCategory()] : [], references };
}
const classify = input => input.categories.map(category => ({ categoryId: category.id, strength: 'strong' }));
function removalOracle(input, strengths, removed = null) {
  const kinds = new Map(strengths.map(item => [item.categoryId, item.strength])), visited = new Set();
  function walk(current) {
    if (current === removed || visited.has(current)) return;
    visited.add(current);
    for (const edge of input.references) if (edge.from === current && kinds.get(edge.category) === 'strong') walk(edge.to);
  }
  input.roots.forEach(walk);
  return visited;
}
function assertRemovalOracle(input, strengths) {
  const result = analyzeHeap(input, strengths), before = removalOracle(input, strengths);
  assert.deepEqual(result.reachableIds, [...before].sort());
  for (const row of result.objects) {
    if (!before.has(row.id)) { assert.equal(row.retained, null); assert.equal(row.dominators, null); continue; }
    const after = removalOracle(input, strengths, row.id), lost = [...before].filter(id => !after.has(id)).sort();
    assert.deepEqual(row.retained.objectIds, lost);
    assert.equal(row.retained.bytes, input.objects.filter(item => lost.includes(item.id)).reduce((sum, item) => sum + item.bytes, 0));
    const dom = result.reachableIds.filter(id => !removalOracle(input, strengths, id).has(row.id));
    assert.deepEqual(row.dominators, dom);
    const strict = dom.filter(id => id !== row.id);
    if (!strict.length) assert.equal(row.immediateDominator, null);
    else {
      assert.ok(strict.includes(row.immediateDominator));
      for (const ancestor of strict) assert.ok(object(result, row.immediateDominator).dominators.includes(ancestor));
    }
  }
  return result;
}

test('strong references retain a cycle; weak references and unreachable cycles do not', () => {
  const result = assertRemovalOracle(example, choices);
  assert.deepEqual(result.reachableIds, ['cache', 'catalog', 'leaf', 'shared']);
  assert.deepEqual(result.unreachableIds, ['orphan']);
  assert.deepEqual(object(result, 'shared').retained, { objectIds: ['leaf', 'shared'], bytes: 100 });
  assert.equal(object(result, 'leaf').immediateDominator, 'shared');
  assert.equal(object(result, 'cache').immediateDominator, 'catalog');
  assert.deepEqual(result.byteAccounting, { totalBytes: 250, reachableBytes: 240, unreachableBytes: 10 });
});
test('alternative strong path defeats exclusive retention even when a direct path exists', () => {
  const input = graph(4, [ ['n0','n1'], ['n0','n2'], ['n1','n3'], ['n2','n3'] ].map(([from,to]) => ({from,to,category:'edge'})), ['n0']);
  const result = assertRemovalOracle(input, classify(input));
  assert.equal(object(result, 'n3').immediateDominator, 'n0');
  assert.deepEqual(object(result, 'n1').retained.objectIds, ['n1']);
  assert.deepEqual(object(result, 'n2').retained.objectIds, ['n2']);
});
test('multiple roots produce virtual-root dominators and do not imply ownership between roots', () => {
  const input = graph(3, [ ['n0','n1'], ['n1','n2'] ].map(([from,to]) => ({from,to,category:'edge'})), ['n0', 'n1']);
  const result = assertRemovalOracle(input, classify(input));
  assert.equal(object(result, 'n1').immediateDominator, null);
  assert.deepEqual(object(result, 'n0').retained.objectIds, ['n0']);
  assert.deepEqual(object(result, 'n1').retained.objectIds, ['n1', 'n2']);
});
test('empty heap, no roots and reference-free graphs have valid explicit accounting', () => {
  assert.deepEqual(analyzeHeap(bare(), []).byteAccounting, {totalBytes:0,reachableBytes:0,unreachableBytes:0});
  const noRoots = structuredClone(example); noRoots.roots = [];
  assert.ok(analyzeHeap(noRoots, choices).objects.every(item => item.retained === null));
  const noRefs = graph(3, [], ['n1']);
  assert.deepEqual(analyzeHeap(noRefs, []).reachableIds, ['n1']);
  assert.equal(heapPlan(noRefs, []).status, 'complete');
});
test('all weak leaves only roots reachable; same endpoint in strong and weak categories remains retaining', () => {
  const input = structuredClone(example), allWeak = choices.map(choice => ({...choice,strength:'weak'}));
  assert.deepEqual(analyzeHeap(input, allWeak).reachableIds, ['catalog']);
  input.references.push({from:'catalog',to:'shared',category:'observer'});
  assert.deepEqual(assertRemovalOracle(input, choices).reachableIds, ['cache','catalog','leaf','shared']);
});
test('every three-object directed graph and root subset agrees with independent vertex-removal oracle (4096 cases)', () => {
  const edges = Array.from({length:9}, (_, i) => ({from:`n${Math.floor(i/3)}`,to:`n${i%3}`,category:'edge'}));
  let cases = 0;
  for (let mask=0; mask<512; mask++) for (let roots=0; roots<8; roots++) {
    const input=graph(3,edges.filter((_,i)=>mask & (1<<i)),[0,1,2].filter(i=>roots & (1<<i)).map(i=>`n${i}`));
    assertRemovalOracle(input,classify(input));cases++;
  }
  assert.equal(cases,4096);
});
test('300 seeded mixed-category graphs agree with independent removal oracle', () => {
  let seed=61391;
  const random=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
  for(let sample=0;sample<300;sample++) {
    const count=4+random(9), refs=[];
    for(let a=0;a<count;a++)for(let b=0;b<count;b++)if(random(5)===0)refs.push({from:`n${a}`,to:`n${b}`,category:random(2)?'edge':'weak'});
    const input=graph(count,refs,Array.from({length:count},(_,i)=>i).filter(()=>random(4)===0).map(i=>`n${i}`));
    input.categories=[...new Set(refs.map(ref=>ref.category))].map(id=>({...oneCategory(),id}));
    assertRemovalOracle(input,input.categories.map(category=>({categoryId:category.id,strength:category.id==='edge'?'strong':'weak'})));
  }
});
test('maximum chain has exact retained sizes, self-inclusion and no total-size double counting', () => {
  const refs=Array.from({length:31},(_,i)=>({from:`n${i}`,to:`n${i+1}`,category:'edge'}));
  const input=graph(32,refs,['n0']);input.objects.forEach(item=>{item.bytes=1000000000;});
  const result=assertRemovalOracle(input,classify(input));
  assert.equal(result.byteAccounting.totalBytes,32000000000);
  for(let i=0;i<32;i++)assert.equal(object(result,`n${i}`).retained.bytes,(32-i)*1000000000);
  assert.ok(result.objects.reduce((sum,item)=>sum+item.retained.bytes,0)>result.byteAccounting.totalBytes);
});
test('maximum accepted shape and output remain well below the one-MiB report limit', () => {
  const refs=Array.from({length:128},(_,i)=>({from:`n${i%32}`,to:`n${Math.floor(i/32)}`,category:['edge','weak','other'][i%3]}));
  const input=graph(32,refs,Array.from({length:32},(_,i)=>`n${i}`));input.categories=['edge','weak','other'].map(id=>({...oneCategory(),id}));
  const result=assertRemovalOracle(input,classify(input));
  assert.equal(result.strongReferenceCount,128);assert.equal(result.objects.length,32);
  assert.ok(Buffer.byteLength(JSON.stringify({source:input,analysis:result},null,2))<150000);
});
test('canonical declaration order does not affect source hash, results or prompt order', () => {
  const copy=structuredClone(example);copy.objects.reverse();copy.roots.reverse();copy.categories.reverse();copy.references.reverse();
  assert.deepEqual(analyzeHeap(copy,[...choices].reverse()),analyzeHeap(example,choices));
  assert.equal(hash(validateInput(copy)),hash(validateInput(example)));
  assert.deepEqual(previewInput(copy,CONFIG),previewInput(example,CONFIG));
});
test('input and choices are not mutated', () => {
  const input=structuredClone(example), before=JSON.stringify(input), selected=structuredClone(choices), old=JSON.stringify(selected);
  analyzeHeap(input,selected);assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(selected),old);
});
test('Unknown and missing declarations withhold every retention finding', () => {
  assert.equal(heapPlan(example,[choices[0],{categoryId:'observer',strength:'unknown'}]).status,'unknown');
  assert.equal(heapPlan(example,[choices[0],{categoryId:'observer',strength:null}]).analysis,null);
  assert.throws(()=>analyzeHeap(example,[choices[0],{categoryId:'observer',strength:'unknown'}]));
  for(const bad of [[],[choices[0],choices[0]],[...choices,{categoryId:'extra',strength:'strong'}],choices.map(item=>({...item,extra:true}))])assert.throws(()=>analyzeHeap(example,bad));
});
test('invalid graph structure, counts, sizes, IDs and reference categories fail validation', () => {
  for(const mutate of [
    x=>x.objects.push({...x.objects[0]}),x=>x.roots.push(x.roots[0]),x=>x.roots.push('absent'),x=>x.references.push({...x.references[0]}),
    x=>x.references[0].from='absent',x=>x.references[0].to='absent',x=>x.references[0].category='absent',x=>x.categories.push({...x.categories[0],id:'unused'}),
    x=>x.objects[0].bytes=-0,x=>x.objects[0].bytes=-1,x=>x.objects[0].bytes=1.5,x=>x.objects[0].bytes=1000000001,x=>x.objects[0].bytes='10',
    x=>x.objects[0].id='constructor',x=>x.objects[0].id='bad\n',x=>x.objects[0].extra=true,x=>x.extra=true,x=>x.title=' untrimmed',
    x=>x.categories[0].meaning='\ud800',x=>x.categories[0].label='bad\u200b',x=>x.objects=Array(2),x=>x.references=Array(2),x=>x.roots=Array(1),
    x=>x.objects=Array.from({length:33},(_,i)=>({id:`x${i}`,bytes:1})),x=>x.references=Array(129),x=>x.categories=Array(4)
  ]) { const input=structuredClone(example);mutate(input);assert.throws(()=>validateInput(input)); }
});
test('questions identify actual category semantics while keeping graph data local', () => {
  const request=requestFor(example,CONFIG,'member',id(1)), preview=previewInput(example,CONFIG);
  assert.match(request.prompt,/Ordinary owning field references/);assert.match(request.prompt,/member \(Owned members\)/);
  assert.deepEqual(request.options.map(item=>item.value),['strong','weak','unknown']);
  assert.equal(preview.questions.length,2);assert.equal(preview.questions[0].categoryId,'member');
  assert.ok(!JSON.stringify(request).includes('orphan'));
  assert.throws(()=>requestFor(example,CONFIG,'absent',id(1)));
  assert.equal(previewInput(bare(),CONFIG).questions.length,0);
});
