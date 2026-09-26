import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 写入 sing-box 源 rule-set JSON。必须无 BOM，否则 sing-box 解析失败。 */
export function writeSourceJson(file, rules) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 3, rules: rules }, null, 2), 'utf8');
}

export function runSingbox(singbox, args) {
  const r = spawnSync(singbox, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error('无法执行 sing-box: ' + r.error.message);
  return {
    status: r.status,
    stdout: (r.stdout || '').replace(/\u001b\[[0-9;]*m/g, ''),
    stderr: (r.stderr || '').replace(/\u001b\[[0-9;]*m/g, ''),
  };
}

export function compileRuleSet(singbox, srcJson, outSrs) {
  fs.mkdirSync(path.dirname(outSrs), { recursive: true });
  const r = runSingbox(singbox, ['rule-set', 'compile', srcJson, '-o', outSrs]);
  if (r.status !== 0) throw new Error('sing-box compile 失败 (' + r.status + ')\n' + r.stderr + r.stdout);
  if (!fs.existsSync(outSrs)) throw new Error('sing-box 未生成产物: ' + outSrs);
  return fs.statSync(outSrs).size;
}

export function decompileRuleSet(singbox, srsFile, outJson) {
  const r = runSingbox(singbox, ['rule-set', 'decompile', srsFile, '-o', outJson]);
  if (r.status !== 0) throw new Error('sing-box decompile 失败\n' + r.stderr + r.stdout);
  return JSON.parse(fs.readFileSync(outJson, 'utf8'));
}

export function singboxVersion(singbox) {
  const r = runSingbox(singbox, ['version']);
  const m = r.stdout.match(/sing-box version (\S+)/);
  if (!m) throw new Error('无法识别 sing-box 版本: ' + r.stdout + r.stderr);
  return m[1];
}
