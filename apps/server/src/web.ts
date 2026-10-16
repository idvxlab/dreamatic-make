import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { InputError } from "@harness/core";
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
export function publicIPv4(address: string) {
  return isIP(address) === 4 && !blocked.check(address, "ipv4");
}
export async function publicFetch(
  raw: string,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
  depth = 0,
  payload?: string,
  binary = false,
): Promise<{ url: string; text: string; contentType: string; bytes: Buffer }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InputError("Invalid source URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new InputError(
      "Use a public HTTP(S) URL on a standard port, without credentials",
    );
  if (
    url.hostname === "localhost" ||
    (isIP(url.hostname) && !publicIPv4(url.hostname))
  )
    throw new InputError("Private or unsupported source address");
  // Resolve once and pin the connection to a checked public IPv4 address to prevent DNS rebinding.
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some((item) => !publicIPv4(item.address)))
    throw new InputError("Private source address rejected");
  const address = addresses[0].address;
  const response = await new Promise<{
    status: number;
    location?: string;
    contentType: string;
    text: string;
    bytes: Buffer;
  }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        family: 4,
        method: payload === undefined ? "GET" : "POST",
        headers: {
          "User-Agent": "dreamatic-make/0.2 (product prototyping research)",
          Accept: "text/html,application/json,text/plain",
          ...headers,
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(20000),
          ...(signal ? [signal] : []),
        ]),
        lookup: (_host, _options, done) => {
          done(null, address, 4);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > (binary ? 8 : 2) * 1024 * 1024) {
            res.destroy();
            reject(new InputError("Source exceeds 2 MiB"));
          } else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            contentType: res.headers["content-type"] ?? "",
            text: binary ? "" : Buffer.concat(chunks).toString("utf8"),
            bytes: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
  if (response.status >= 300 && response.status < 400 && response.location) {
    if (payload !== undefined || Object.keys(headers).length) throw new InputError("Authenticated search redirects are not allowed");
    if (depth >= 4) throw new InputError("Too many source redirects");
    return publicFetch(
      new URL(response.location, url).href,
      signal,
      {},
      depth + 1,
      undefined,
      binary,
    );
  }
  if (response.status < 200 || response.status >= 300)
    throw new InputError(`Source returned HTTP ${response.status}`);
  if (
    !binary && !/text\/(html|plain)|application\/(json|xhtml\+xml)/i.test(
      response.contentType,
    )
  )
    throw new InputError(
      "This source type is not supported for text extraction; retain the link and request dimension data separately.",
    );
  return {
    url: url.href,
    text: response.text,
    bytes: response.bytes,
    contentType: response.contentType,
  };
}
export function extractText(html: string) {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}
export async function searchWeb(
  query: string,
  key: string,
  signal?: AbortSignal,
  provider: string = "serper",
  fetchSource: typeof publicFetch = publicFetch,
) {
  if (!["serper", "brave"].includes(provider)) throw new InputError("Unsupported search provider");
  if (!key) throw new InputError(`Web search is not configured. Set the ${provider === "serper" ? "Serper" : "Brave Search"} API key in Settings, or use web_fetch with known manufacturer URLs.`);
  let response;
  if (provider === "serper") {
    response = await fetchSource("https://google.serper.dev/search", signal, {
      "X-API-KEY": key, "Content-Type": "application/json",
    }, 0, JSON.stringify({ q: query, num: 5 }));
  } else {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "5");
    response = await fetchSource(url.href, signal, { "X-Subscription-Token": key });
  }
  let data;
  try { data = JSON.parse(response.text); }
  catch { throw new InputError("Search provider returned invalid JSON"); }
  const items: unknown = provider === "serper" ? data?.organic : data?.web?.results;
  if (items !== undefined && !Array.isArray(items)) throw new InputError("Search provider returned invalid results");
  const results: Array<{title: string; url: string; description: string}> = [];
  const seen = new Set<string>();
  for (const raw of (items ?? []) as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const url = provider === "serper" ? item.link : item.url;
    const description = provider === "serper" ? item.snippet : item.description;
    if (typeof item.title !== "string" || typeof url !== "string" || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: item.title, url, description: typeof description === "string" ? description : "" });
    if (results.length === 5) break;
  }
  return { provider, query, fetchedAt: new Date().toISOString(), evidenceType: "search_snippets_not_verified_specifications", results };
}
