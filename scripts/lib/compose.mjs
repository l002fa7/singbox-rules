import net from 'node:net';
import { subdomainRegex } from './parse.mjs';

export function collect(sources) {
  const suffix = new Set();
  const wildcard = new Set();
  const exact = new Set();
  for (const s of sources) {
    for (const v of s.suffix || []) suffix.add(v);
    for (const v of s.wildcard || []) wildcard.add(v);
    for (const v of s.exact || []) exact.add(v);
  }
  return { suffix: suffix, wildcard: wildcard, exact: exact };
}

function underDomain(name, base) {
  return name === base || name.endsWith('.' + base);
}

function strictlyUnder(name, base) {
  return name.endsWith('.' + base);
}

/**
 * 删除采用「覆盖」语义（见 custom/direct-del-domain.list 注释）。
 * '*' 只能通过显式 '*' 删除，不会一次删空。
 */
export function applyDeletions(entries, del) {
  const delSuffix = del.suffix || [];
  const delWildcard = del.wildcard || [];
  const delExact = del.exact || [];

  const removed = { suffix: [], wildcard: [], exact: [] };

  function coveredBySuffix(name) {
    for (const d of delSuffix) {
      if (d === '*') continue;
      if (underDomain(name, d)) return true;
    }
    return false;
  }

  function coveredByWildcard(name) {
    for (const d of delWildcard) {
      if (strictlyUnder(name, d)) return true;
    }
    return false;
  }

  for (const s of [...entries.suffix]) {
    // 注意：裸域删除（delExact）只作用于精确条目，不作用于同名后缀条目
    const drop = delSuffix.includes(s) || coveredBySuffix(s) || coveredByWildcard(s);
    if (drop) { entries.suffix.delete(s); removed.suffix.push(s); }
  }
  for (const e of [...entries.exact]) {
    const drop = delSuffix.includes(e) || delExact.includes(e) || coveredBySuffix(e) || coveredByWildcard(e);
    if (drop) { entries.exact.delete(e); removed.exact.push(e); }
  }
  for (const w of [...entries.wildcard]) {
    const drop = delSuffix.includes(w) || delWildcard.includes(w) || coveredBySuffix(w) || coveredByWildcard(w);
    if (drop) { entries.wildcard.delete(w); removed.wildcard.push(w); }
  }

  return removed;
}

/**
 * 后缀包含消除：被更高层后缀覆盖的条目丢弃。
 */
export function eliminateSubsumed(entries) {
  const suffixSet = entries.suffix;
  const keptSuffix = [];
  for (const s of suffixSet) {
    if (s === '*') { keptSuffix.push(s); continue; }
    const labels = s.split('.');
    let covered = false;
    for (let i = 1; i < labels.length; i++) {
      if (suffixSet.has(labels.slice(i).join('.'))) { covered = true; break; }
    }
    if (!covered) keptSuffix.push(s);
  }

  const keptExact = [];
  for (const e of entries.exact) {
    if (suffixSet.has(e)) continue;
    const labels = e.split('.');
    let covered = false;
    for (let i = 1; i < labels.length; i++) {
      if (suffixSet.has(labels.slice(i).join('.'))) { covered = true; break; }
    }
    if (!covered) keptExact.push(e);
  }

  return { suffix: keptSuffix, exact: keptExact, wildcard: [...entries.wildcard] };
}

function domainSortKey(d) {
  return d.split('.').reverse().map((x) => x.toLowerCase()).join('\u0000');
}

export function sortDomains(list) {
  return [...list].sort((a, b) => (domainSortKey(a) < domainSortKey(b) ? -1 : domainSortKey(a) > domainSortKey(b) ? 1 : 0));
}

/** sing-box 源 rule-set：域名规则 */
export function toDomainRules(entries) {
  const rule = {};
  const suffix = sortDomains(entries.suffix);
  const exact = sortDomains(entries.exact);
  const regex = entries.wildcard.map(subdomainRegex).sort();
  if (suffix.length) rule.domain_suffix = suffix;
  if (exact.length) rule.domain = exact;
  if (regex.length) rule.domain_regex = regex;
  return [rule];
}

function cidrSortKey(s) {
  const i = s.indexOf('/');
  const addr = s.slice(0, i);
  const len = Number(s.slice(i + 1));
  const version = net.isIP(addr);
  if (version === 4) {
    const p = addr.split('.').map(Number);
    const n = ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
    return '0\u0000' + String(n).padStart(10, '0') + '\u0000' + String(len).padStart(3, '0');
  }
  return '1\u0000' + addr + '\u0000' + String(len).padStart(3, '0');
}

export function sortCidrs(list) {
  return [...list].sort((a, b) => (cidrSortKey(a) < cidrSortKey(b) ? -1 : cidrSortKey(a) > cidrSortKey(b) ? 1 : 0));
}

/** sing-box 源 rule-set：IP 规则 */
export function toIpRules(cidrs) {
  return [{ ip_cidr: sortCidrs(cidrs) }];
}
