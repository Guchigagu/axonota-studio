import type { WebPage } from "@nb/core";
import { fetchFn } from "./env";

/** 同一查询在本次会话里只搜一次，批量生成时不会重复打搜索接口 */
const cache = new Map<string, WebPage[]>();

/** Bing 跳转链接还原成真实 URL；DDG 的 uddg 参数同理 */
function realUrl(href: string): string {
  try {
    const u = new URL(href, "https://www.bing.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    const uParam = u.searchParams.get("u");
    if (uParam) {
      const raw = uParam.startsWith("a1") ? uParam.slice(2) : uParam;
      const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
      const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      if (/^https?:/i.test(decoded)) return decoded;
    }
    return u.href;
  } catch {
    return href;
  }
}

function parseBing(html: string, limit: number): WebPage[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: WebPage[] = [];
  for (const li of Array.from(doc.querySelectorAll("li.b_algo"))) {
    const a = li.querySelector("h2 a");
    const title = a?.textContent?.trim() ?? "";
    const href = a?.getAttribute("href") ?? "";
    const text = li.querySelector(".b_caption p")?.textContent?.trim() ?? "";
    if (!title || !href) continue;
    out.push({ title, url: realUrl(href), text });
    if (out.length >= limit) break;
  }
  return out;
}

function parseDdg(html: string, limit: number): WebPage[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: WebPage[] = [];
  for (const el of Array.from(doc.querySelectorAll(".result"))) {
    const a = el.querySelector(".result__a");
    const title = a?.textContent?.trim() ?? "";
    const href = a?.getAttribute("href") ?? "";
    const text = el.querySelector(".result__snippet")?.textContent?.trim() ?? "";
    if (!title || !href) continue;
    out.push({ title, url: realUrl(href), text });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    return res.ok ? await res.text() : "";
  } finally {
    clearTimeout(timer);
  }
}

/** 联网检索：返回实际搜到的网页标题 / 真实 URL / 摘要；失败时返回空数组，不影响生成 */
export async function searchWeb(query: string, limit = 4): Promise<WebPage[]> {
  const key = `${query}::${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const bing = await fetchHtml(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans&count=${limit + 2}`,
    );
    let pages = parseBing(bing, limit);
    if (!pages.length) {
      const ddg = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
      pages = parseDdg(ddg, limit);
    }
    const seen = new Set<string>();
    pages = pages.filter((p) => {
      if (!/^https?:/i.test(p.url) || seen.has(p.url)) return false;
      seen.add(p.url);
      return true;
    });
    cache.set(key, pages);
    return pages;
  } catch {
    return [];
  }
}
