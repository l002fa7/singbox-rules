import { runSingbox } from './compile.mjs';

/**
 * 注意：sing-box rule-set match 命中与未命中退出码都是 0，
 * 必须解析 stdout 判断，不能看 exit code。
 */
export function matches(singbox, srsFile, probe) {
  const r = runSingbox(singbox, ['rule-set', 'match', srsFile, probe, '-f', 'binary']);
  const out = (r.stdout + r.stderr).trim();
  if (/FATAL|panic/i.test(out)) throw new Error('rule-set match 执行失败 [' + probe + ']: ' + out);
  return out.length > 0;
}

export function assertMatches(singbox, srsFile, probe, expected, why) {
  const actual = matches(singbox, srsFile, probe);
  if (actual !== expected) {
    throw new Error(
      '冒烟断言失败: ' + srsFile + ' 探测 ' + probe + ' 期望 ' + expected + ' 实际 ' + actual +
      (why ? '（' + why + '）' : '')
    );
  }
  return { probe: probe, expected: expected, why: why || '' };
}
