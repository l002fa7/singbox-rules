import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchText } from './lib/fetch.mjs';
import { parseClashDomain, parseV2flyDomain, parseIpList } from './lib/parse.mjs';
import { collect, applyDeletions, eliminateSubsumed, toDomainRules, toIpRules } from './lib/compose.mjs';
import { writeSourceJson, compileRuleSet, singboxVersion } from './lib/compile.mjs';
import { assertMatches } from './lib/verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { cacheDir: null, buildDir: null, singbox: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--singbox') out.singbox = argv[++i];
    else if (a === '--cache-dir') out.cacheDir = argv[++i];
    else if (a === '--build-dir') out.buildDir = argv[++i];
    else throw new Error('未知参数: ' + a);
  }
  return out;
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function parseSource(src, text, ctx) {
  if (src.format === 'clash') return parseClashDomain(text, ctx);
  if (src.format === 'v2fly') return parseV2flyDomain(text, ctx, src.skipAttributes);
  if (src.format === 'ip') return parseIpList(text, ctx);
  throw new Error('未知信源格式: ' + src.format + ' @ ' + ctx);
}

function fmt(n) { return String(n).padStart(8, ' '); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const singbox = args.singbox || process.env.SINGBOX || 'sing-box';
  const buildDir = path.resolve(ROOT, args.buildDir || '.build');
  const cacheDir = args.cacheDir ? path.resolve(ROOT, args.cacheDir) : null;

  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'rulesets.json'), 'utf8'));
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'cases.json'), 'utf8'));

  const sbVersion = singboxVersion(singbox);
  console.log('sing-box 版本: ' + sbVersion);
  console.log('构建目录: ' + buildDir);
  console.log('');

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  const summary = { singbox: sbVersion, generatedAt: new Date().toISOString(), rulesets: [] };

  for (const rs of config.rulesets) {
    console.log('==================== ' + rs.id + ' ====================');
    const parsed = [];
    const sourceMeta = [];

    for (const src of rs.sources) {
      const ctx = rs.id + '/' + src.id;
      const got = await fetchText(src.url, { id: src.id, cacheDir: cacheDir });
      const p = parseSource(src, got.text, ctx);
      parsed.push(p);
      const n = (p.suffix ? p.suffix.length : 0) + (p.exact ? p.exact.length : 0) +
                (p.wildcard ? p.wildcard.length : 0) + (p.cidr ? p.cidr.length : 0);
      sourceMeta.push({ id: src.id, url: src.url, sha256: got.sha256, bytes: got.bytes, entries: n, notes: p.notes.length });
      console.log('  [源] ' + src.id + '  ' + fmt(n) + ' 条  sha256=' + got.sha256.slice(0, 12) + (got.fromCache ? ' (cache)' : ''));
    }

    let rules;
    let count;

    if (rs.kind === 'domain') {
      const entries = collect(parsed);

      const addFile = path.join(ROOT, rs.add);
      const addText = readTextIfExists(addFile);
      if (addText && addText.trim()) {
        const added = parseClashDomain(addText, rs.add);
        for (const v of added.suffix) entries.suffix.add(v);
        for (const v of added.wildcard) entries.wildcard.add(v);
        for (const v of added.exact) entries.exact.add(v);
        console.log('  [追加] ' + rs.add + '  +' + (added.suffix.length + added.wildcard.length + added.exact.length) + ' 条');
      }

      const delFile = path.join(ROOT, rs.del);
      const delText = readTextIfExists(delFile);
      if (delText && delText.trim()) {
        const del = parseClashDomain(delText, rs.del);
        const removed = applyDeletions(entries, del);
        console.log('  [删除] ' + rs.del + '  -' + (removed.suffix.length + removed.wildcard.length + removed.exact.length) + ' 条');
      }

      const before = entries.suffix.size + entries.exact.size + entries.wildcard.size;
      const finalEntries = eliminateSubsumed(entries);
      const after = finalEntries.suffix.length + finalEntries.exact.length + finalEntries.wildcard.length;
      console.log('  [去冗余] ' + before + ' -> ' + after + '（消除 ' + (before - after) + ' 条被上层后缀覆盖的条目）');

      rules = toDomainRules(finalEntries);
      count = after;
    } else if (rs.kind === 'ip') {
      const cidrs = new Set();
      for (const p of parsed) for (const v of p.cidr) cidrs.add(v);
      rules = toIpRules([...cidrs]);
      count = cidrs.size;
    } else {
      throw new Error('未知 kind: ' + rs.kind);
    }

    const [lo, hi] = rs.expectedCount;
    if (count < lo || count > hi) {
      throw new Error('规则数量异常: ' + rs.id + ' = ' + count + '，期望区间 [' + lo + ', ' + hi + ']');
    }
    console.log('  [数量] ' + count + ' 条（区间 [' + lo + ', ' + hi + ']）');

    const tmpJson = path.join(buildDir, 'json', rs.id + '.json');
    const tmpSrs = path.join(buildDir, 'srs', rs.id + '.srs');
    writeSourceJson(tmpJson, rules);
    const bytes = compileRuleSet(singbox, tmpJson, tmpSrs);
    console.log('  [编译] ' + rs.output + '  ' + bytes + ' bytes');

    const checks = cases[rs.output] || [];
    for (const c of checks) assertMatches(singbox, tmpSrs, c.probe, c.expect, c.why);
    console.log('  [冒烟] ' + checks.length + ' 条断言全部通过');

    fs.mkdirSync(path.dirname(path.join(ROOT, rs.output)), { recursive: true });
    fs.copyFileSync(tmpSrs, path.join(ROOT, rs.output));

    summary.rulesets.push({
      id: rs.id, output: rs.output, count: count, bytes: bytes,
      sources: sourceMeta, checks: checks.length,
    });
    console.log('');
  }

  fs.writeFileSync(path.join(buildDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('==================== 构建成功 ====================');
  for (const r of summary.rulesets) {
    console.log('  ' + r.output + '  ' + r.count + ' 条  ' + r.bytes + ' bytes');
  }
  console.log('BUILD_SUMMARY_JSON=' + JSON.stringify(summary));
}

main().catch((err) => {
  console.error('构建失败: ' + err.message);
  process.exit(1);
});
