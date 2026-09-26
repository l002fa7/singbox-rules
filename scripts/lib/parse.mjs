import net from 'node:net';

const RE_SPECIAL = /[.*+?^$(){}[\]\\|]/g;

export function escapeRegex(s) {
  return s.replace(RE_SPECIAL, '\\$&');
}

/** '*.base' 仅匹配子域、不含 base 自身 */
export function subdomainRegex(base) {
  return '^.+\\.' + escapeRegex(base) + '$';
}

export function stripComment(line) {
  const i = line.indexOf('#');
  return i === -1 ? line : line.slice(0, i);
}

function cleanToken(line) {
  let t = stripComment(line).trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export function assertDomain(domain, where) {
  if (!domain) throw new Error('空域名 @ ' + where);
  if (/\s/.test(domain)) throw new Error('域名含空白 [' + domain + '] @ ' + where);
  if (domain.startsWith('.') || domain.endsWith('.')) throw new Error('域名首尾有句点 [' + domain + '] @ ' + where);
  if (domain.includes('..')) throw new Error('域名含连续句点 [' + domain + '] @ ' + where);
}

/**
 * mihomo/clash domain 文本。
 * '+.x' -> suffix, '*.x' -> wildcard, 'x' -> exact, '*' -> suffix '*'
 */
export function parseClashDomain(text, ctx) {
  const suffix = new Set();
  const wildcard = new Set();
  const exact = new Set();
  const notes = [];
  let lineNo = 0;

  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const token = cleanToken(raw);
    if (!token) continue;
    const where = ctx + ':' + lineNo;

    if (token === '*') {
      suffix.add('*');
      notes.push(where + ' 通配符 "*" -> domain_suffix "*"（实测为死规则，保留上游保真）');
      continue;
    }
    if (token.startsWith('+.')) {
      const base = token.slice(2);
      assertDomain(base, where);
      suffix.add(base);
      continue;
    }
    if (token.startsWith('*.')) {
      const base = token.slice(2);
      assertDomain(base, where);
      wildcard.add(base);
      continue;
    }
    if (token.startsWith('.')) {
      const base = token.slice(1);
      assertDomain(base, where);
      suffix.add(base);
      continue;
    }
    assertDomain(token, where);
    exact.add(token);
  }

  return { suffix: [...suffix], wildcard: [...wildcard], exact: [...exact], notes: notes };
}

/**
 * v2fly domain-list-community data 文本。
 * 裸域 = 含子域；'full:x' = 精确；支持 '@属性'。
 */
export function parseV2flyDomain(text, ctx, skipAttributes) {
  const skip = (skipAttributes || []).map((a) => a.toLowerCase());
  const suffix = new Set();
  const exact = new Set();
  const notes = [];
  let lineNo = 0;

  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const line = stripComment(raw).trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const token = parts[0];
    const attrs = parts.slice(1).map((a) => a.replace(/^@/, '').toLowerCase());
    const where = ctx + ':' + lineNo;

    if (token.startsWith('include:')) throw new Error('未支持的 v2fly include 指令 @ ' + where + ' [' + line + ']');
    if (token.startsWith('keyword:')) throw new Error('未支持的 v2fly keyword 指令 @ ' + where + ' [' + line + ']');
    if (token.startsWith('regexp:')) throw new Error('未支持的 v2fly regexp 指令 @ ' + where + ' [' + line + ']');

    const hit = skip.filter((a) => attrs.includes(a));
    if (hit.length > 0) {
      notes.push(where + ' 跳过属性 @' + hit.join(',@') + ' [' + token + ']');
      continue;
    }

    if (token.startsWith('full:')) {
      const base = token.slice(5);
      assertDomain(base, where);
      exact.add(base);
      continue;
    }
    if (token.startsWith('domain:')) {
      const base = token.slice(7);
      assertDomain(base, where);
      suffix.add(base);
      continue;
    }
    assertDomain(token, where);
    suffix.add(token);
  }

  return { suffix: [...suffix], wildcard: [], exact: [...exact], notes: notes };
}

/** 把一行规范化为 CIDR；非法返回 null */
export function normalizeCidr(input) {
  const s = input.trim();
  const slash = s.indexOf('/');
  const addr = slash === -1 ? s : s.slice(0, slash);
  const version = net.isIP(addr);
  if (!version) return null;
  if (slash === -1) return addr + (version === 4 ? '/32' : '/128');
  const lenText = s.slice(slash + 1);
  if (!/^\d{1,3}$/.test(lenText)) return null;
  const len = Number(lenText);
  const max = version === 4 ? 32 : 128;
  if (len < 0 || len > max) return null;
  return addr + '/' + len;
}

export function parseIpList(text, ctx) {
  const cidr = new Set();
  const notes = [];
  let lineNo = 0;

  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const token = stripComment(raw).trim();
    if (!token) continue;
    const norm = normalizeCidr(token);
    if (!norm) throw new Error('非法 IP/CIDR [' + token + '] @ ' + ctx + ':' + lineNo);
    cidr.add(norm);
  }

  return { cidr: [...cidr], notes: notes };
}
