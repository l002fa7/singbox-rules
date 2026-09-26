import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 下载文本源，带重试与可选本地缓存。
 * 返回 { text, sha256, bytes, fromCache }
 */
export async function fetchText(url, options) {
  const opts = options || {};
  const retries = opts.retries === undefined ? 3 : opts.retries;
  const cacheDir = opts.cacheDir || null;
  const id = opts.id || 'source';

  if (cacheDir) {
    const cached = path.join(cacheDir, id + '.txt');
    if (fs.existsSync(cached)) {
      const text = fs.readFileSync(cached, 'utf8');
      return { text: text, sha256: sha256(text), bytes: Buffer.byteLength(text), fromCache: true };
    }
  }

  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'singbox-rules-builder/1.0', 'Accept': '*/*' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      const text = await res.text();
      if (!text) throw new Error('响应为空');
      if (cacheDir) {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, id + '.txt'), text, 'utf8');
      }
      return { text: text, sha256: sha256(text), bytes: Buffer.byteLength(text), fromCache: false };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(1000 * attempt);
    }
  }
  throw new Error('下载失败 ' + url + ' : ' + lastError.message);
}
