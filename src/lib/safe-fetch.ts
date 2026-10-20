import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "./errors";

/** Only public addresses; verify DNS and pin the chosen address for this connection. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const normalized = new URL(`https://[${address}]/`).hostname.slice(1,-1).toLowerCase();
    const [first,second] = normalized.split(":").map(s=>parseInt(s||"0",16));
    return /^[23][0-9a-f]{0,3}:/.test(normalized) && !(first === 0x2001 && second < 0x200) && !normalized.startsWith("2001:db8:") && !normalized.startsWith("2002:") && !normalized.startsWith("3fff:");
  }
  return false;
}
export type SafeFetchOptions = { method?: string; headers?: Record<string,string>; body?: string | Uint8Array; maxBytes?: number; timeoutMs?: number; redirects?: number };
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<{ status: number; headers: Record<string,string>; body: Buffer; url: string }> {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) throw new ValidationError("仅支持不含账号密码的标准 HTTPS 公网地址");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new ValidationError("此地址不能用于外部连接");
  const max = Math.min(options.maxBytes ?? 1_048_576, 25 * 1_048_576), chosen = addresses[0];
  const result = await new Promise<{ status: number; headers: Record<string,string>; body: Buffer; url: string }>((resolve,reject) => {
    const requestOptions: https.RequestOptions & {autoSelectFamily:boolean} = { autoSelectFamily: false, family: chosen.family, method: options.method ?? "GET", headers: { "User-Agent": "AgileCampus-Link/1.0", ...options.headers }, lookup: (_hostname,_opts,cb) => cb(null, chosen.address, chosen.family) };
    const req = https.request(url, requestOptions, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > max) req.destroy(new ValidationError("外部内容超过大小限制")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k,v]) => [k, Array.isArray(v) ? v.join(", ") : v ?? ""])), body: Buffer.concat(chunks), url: url.href }));
    });
    const timer = setTimeout(() => req.destroy(new ValidationError("外部连接超时，请稍后重试")), Math.min(options.timeoutMs ?? 12000, 30000));
    req.on("error", reject); req.on("close", () => clearTimeout(timer));
    if (options.body) req.write(options.body); req.end();
  });
  if ([301,302,303,307,308].includes(result.status) && result.headers.location) {
    if ((options.redirects ?? 3) <= 0) throw new ValidationError("外部地址跳转次数过多");
    const next = new URL(result.headers.location, url);
    if (next.origin !== url.origin && Object.keys(options.headers ?? {}).some(k => /authorization|cookie/i.test(k))) throw new ValidationError("外部服务不能将登录凭据转发到其他网站");
    return safeFetch(next.href, { ...options, redirects: (options.redirects ?? 3) - 1 });
  }
  return result;
}
