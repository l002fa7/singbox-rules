import test from 'node:test';
import assert from 'node:assert/strict';

import { collect, applyDeletions, eliminateSubsumed, toDomainRules, toIpRules, sortCidrs } from '../scripts/lib/compose.mjs';

const sorted = (a) => [...a].sort();
const setSorted = (s) => [...s].sort();

test('collect: 多源合并去重', () => {
  const e = collect([
    { suffix: ['a.com', 'b.com'], exact: ['x.com'] },
    { suffix: ['b.com', 'c.com'], exact: ['x.com', 'y.com'] },
  ]);
  assert.deepEqual(setSorted(e.suffix), ['a.com', 'b.com', 'c.com']);
  assert.deepEqual(setSorted(e.exact), ['x.com', 'y.com']);
});

test('删除: "+.foo.com" 覆盖删除自身与所有子域条目', () => {
  const e = collect([{ suffix: ['foo.com', 'a.foo.com', 'b.foo.com', 'keep.com'], exact: ['c.foo.com', 'keep2.com'] }]);
  const removed = applyDeletions(e, { suffix: ['foo.com'], wildcard: [], exact: [] });
  assert.deepEqual(setSorted(e.suffix), ['keep.com']);
  assert.deepEqual(setSorted(e.exact), ['keep2.com']);
  assert.equal(removed.suffix.length + removed.exact.length, 4);
});

test('删除: 裸域只删精确条目，不误伤同名后缀条目', () => {
  const e = collect([{ suffix: ['foo.com', 'a.foo.com'], exact: ['foo.com'] }]);
  applyDeletions(e, { suffix: [], wildcard: [], exact: ['foo.com'] });
  assert.deepEqual(setSorted(e.suffix), ['a.foo.com', 'foo.com']);
  assert.deepEqual(setSorted(e.exact), []);
});

test('删除: "*.foo.com" 只删子域，保留 foo.com 自身', () => {
  const e = collect([{ suffix: ['foo.com', 'a.foo.com'], exact: ['b.foo.com'] }]);
  applyDeletions(e, { suffix: [], wildcard: ['foo.com'], exact: [] });
  assert.deepEqual(setSorted(e.suffix), ['foo.com']);
  assert.deepEqual(setSorted(e.exact), []);
});

test('删除: "*" 不会一次删空全部', () => {
  const e = collect([{ suffix: ['*', 'a.com'], exact: ['b.com'] }]);
  applyDeletions(e, { suffix: ['*'], wildcard: [], exact: [] });
  assert.deepEqual(setSorted(e.suffix), ['a.com']);
  assert.deepEqual(setSorted(e.exact), ['b.com']);
});

test('后缀包含消除: 子域条目被上层后缀吸收', () => {
  const e = collect([{ suffix: ['example.com', 'a.example.com', 'b.a.example.com', 'other.com'], exact: ['c.example.com', 'other.com', 'd.other.com'] }]);
  const r = eliminateSubsumed(e);
  assert.deepEqual(sorted(r.suffix), ['example.com', 'other.com']);
  assert.deepEqual(r.exact, []);
});

test('toDomainRules: 三类字段分别落到 domain_suffix / domain / domain_regex', () => {
  const e = collect([{ suffix: ['a.com'], wildcard: ['b.com'], exact: ['c.com'] }]);
  const rules = toDomainRules(eliminateSubsumed(e));
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].domain_suffix, ['a.com']);
  assert.deepEqual(rules[0].domain, ['c.com']);
  assert.deepEqual(rules[0].domain_regex, ['^.+\\.b\\.com$']);
});

test('toDomainRules: 空集合不产生空字段', () => {
  const rules = toDomainRules({ suffix: [], exact: [], wildcard: [] });
  assert.deepEqual(rules, [{}]);
});

test('toIpRules: CIDR 去重后按 IPv4 数值序排序，IPv6 排后', () => {
  const rules = toIpRules(['9.0.0.0/8', '1.0.0.0/8', '2001:db8::/32', '1.2.3.0/24']);
  assert.deepEqual(rules[0].ip_cidr, ['1.0.0.0/8', '1.2.3.0/24', '9.0.0.0/8', '2001:db8::/32']);
  assert.deepEqual(sortCidrs(['10.0.0.0/8', '2.0.0.0/8']), ['2.0.0.0/8', '10.0.0.0/8']);
});
