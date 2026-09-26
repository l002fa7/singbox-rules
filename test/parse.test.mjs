import test from 'node:test';
import assert from 'node:assert/strict';

import { parseClashDomain, parseV2flyDomain, parseIpList, normalizeCidr, subdomainRegex } from '../scripts/lib/parse.mjs';

const sorted = (a) => [...a].sort();

test('clash: "+.x" -> suffix', () => {
  const r = parseClashDomain('+.example.com\n', 't');
  assert.deepEqual(r.suffix, ['example.com']);
  assert.deepEqual(r.exact, []);
  assert.deepEqual(r.wildcard, []);
});

test('clash: 裸域 -> exact（不是 suffix）', () => {
  const r = parseClashDomain('example.com\n', 't');
  assert.deepEqual(r.exact, ['example.com']);
  assert.deepEqual(r.suffix, []);
});

test('clash: "*.x" -> wildcard，且生成的 regex 只匹配子域', () => {
  const r = parseClashDomain('*.example.com\n', 't');
  assert.deepEqual(r.wildcard, ['example.com']);
  assert.equal(subdomainRegex('example.com'), '^.+\\.example\\.com$');
});

test('clash: 单独的 "*" 映射为 suffix "*" 并留痕', () => {
  const r = parseClashDomain('*\n+.a.com\n', 't');
  assert.deepEqual(sorted(r.suffix), ['*', 'a.com']);
  assert.equal(r.notes.length, 1);
});

test('clash: 注释、空行、带引号行被正确处理', () => {
  const r = parseClashDomain('# 注释\n\n  "+.a.com"  # 尾注释\n+.b.com\n', 't');
  assert.deepEqual(sorted(r.suffix), ['a.com', 'b.com']);
});

test('clash: 非法域名抛错（带行列位置）', () => {
  assert.throws(() => parseClashDomain('+.bad..domain\n', 'ctx'), /ctx:1/);
  assert.throws(() => parseClashDomain('+.has space.com\n', 'ctx'), /ctx:1/);
});

test('v2fly: 裸域 = 含子域 -> suffix', () => {
  const r = parseV2flyDomain('spotify.com\n', 't', []);
  assert.deepEqual(r.suffix, ['spotify.com']);
  assert.deepEqual(r.exact, []);
});

test('v2fly: "full:x" -> exact', () => {
  const r = parseV2flyDomain('full:spotify.map.fastly.net\n', 't', []);
  assert.deepEqual(r.exact, ['spotify.map.fastly.net']);
  assert.deepEqual(r.suffix, []);
});

test('v2fly: 带 @ads 属性的行被跳过并留痕', () => {
  const r = parseV2flyDomain('full:adeventtracker.spotify.com @ads\n', 't', ['ads']);
  assert.deepEqual(r.exact, []);
  assert.equal(r.notes.length, 1);
});

test('v2fly: 未支持的指令必须显式报错，不得静默漏规则', () => {
  assert.throws(() => parseV2flyDomain('include:other\n', 't', []), /include/);
  assert.throws(() => parseV2flyDomain('keyword:abc\n', 't', []), /keyword/);
  assert.throws(() => parseV2flyDomain('regexp:^a\\.b$\n', 't', []), /regexp/);
});

test('ip: CIDR 解析与裸 IP 补全', () => {
  const r = parseIpList('1.2.3.0/24\n10.0.0.1\n2001:db8::/32\n', 't');
  assert.deepEqual(sorted(r.cidr), ['1.2.3.0/24', '10.0.0.1/32', '2001:db8::/32']);
});

test('ip: 非法行抛错（带行列位置）', () => {
  assert.throws(() => parseIpList('not-an-ip\n', 'ctx'), /ctx:1/);
  assert.throws(() => parseIpList('1.2.3.0/33\n', 'ctx'), /ctx:1/);
  assert.throws(() => parseIpList('1.2.3.0/abc\n', 'ctx'), /ctx:1/);
});

test('ip: normalizeCidr 边界', () => {
  assert.equal(normalizeCidr('0.0.0.0/0'), '0.0.0.0/0');
  assert.equal(normalizeCidr('::/0'), '::/0');
  assert.equal(normalizeCidr('1.2.3.4/32'), '1.2.3.4/32');
  assert.equal(normalizeCidr('1.2.3.4/33'), null);
  assert.equal(normalizeCidr('1.2.3.4/'), null);
});
