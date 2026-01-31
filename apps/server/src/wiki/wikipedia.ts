export type WikiSearchResult = {
  title: string;
  snippet: string;
};

export type WikiPageSummary = {
  title: string;
  url: string;
  extract: string;
};

export type WikiContextOptions = {
  excludeMedia?: boolean;
  excludeDisambiguation?: boolean;
  referenceYear?: number;
};

const WIKI_API = "https://en.wikipedia.org/w/api.php";

function wikiUrl(params: Record<string, string>): string {
  const u = new URL(WIKI_API);
  u.searchParams.set("origin", "*"); // for browser environments; harmless on server
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export async function wikiSearch(query: string, limit = 5): Promise<WikiSearchResult[]> {
  const url = wikiUrl({
    action: "query",
    format: "json",
    list: "search",
    utf8: "1",
    srsearch: query,
    srlimit: String(limit)
  });
  const res = await fetch(url, { headers: { "user-agent": "the-court-dev/0.1" } });
  if (!res.ok) throw new Error(`Wikipedia search failed: ${res.status}`);
  const json = (await res.json()) as any;
  const items = (json?.query?.search ?? []) as any[];
  return items.map((it) => ({ title: String(it.title), snippet: String(it.snippet ?? "") }));
}

export async function wikiSummary(title: string): Promise<WikiPageSummary> {
  const url = wikiUrl({
    action: "query",
    format: "json",
    prop: "extracts|info",
    explaintext: "1",
    exintro: "1",
    inprop: "url",
    redirects: "1",
    titles: title
  });
  const res = await fetch(url, { headers: { "user-agent": "the-court-dev/0.1" } });
  if (!res.ok) throw new Error(`Wikipedia summary failed: ${res.status}`);
  const json = (await res.json()) as any;
  const pages = json?.query?.pages ?? {};
  const page = Object.values(pages)[0] as any;
  return {
    title: String(page?.title ?? title),
    url: String(page?.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`),
    extract: String(page?.extract ?? "")
  };
}

const MEDIA_HINTS = [
  /\bfilm\b/i,
  /\btelevision (series|show)\b/i,
  /\btv series\b/i,
  /\bminiseries\b/i,
  /\bvideo game\b/i,
  /\bnovel\b/i,
  /\balbum\b/i,
  /\bsong\b/i,
  /\bsingle\b/i,
  /\bcomic\b/i,
  /\bmanga\b/i,
  /\banime\b/i,
  /\bplay\b/i,
  /\bopera\b/i,
  /\bmusical\b/i,
  /\bsoundtrack\b/i,
];

function isDisambiguationPage(page: WikiPageSummary): boolean {
  const title = page.title.toLowerCase();
  const extract = page.extract.toLowerCase();
  return title.includes("(disambiguation)") || extract.includes("may refer to");
}

function isLikelyMediaPage(page: WikiPageSummary): boolean {
  const text = `${page.title} ${page.extract}`.toLowerCase();
  return MEDIA_HINTS.some((pattern) => pattern.test(text));
}

function resolveExcludeMedia(options: WikiContextOptions): boolean {
  if (typeof options.excludeMedia === "boolean") return options.excludeMedia;
  const refYear = options.referenceYear;
  if (typeof refYear === "number" && Number.isFinite(refYear)) {
    return refYear < 1800;
  }
  return true;
}

export function filterWikipediaPages(pages: WikiPageSummary[], options: WikiContextOptions = {}): WikiPageSummary[] {
  const excludeMedia = resolveExcludeMedia(options);
  const excludeDisambiguation = options.excludeDisambiguation ?? true;
  return pages.filter((page) => {
    if (excludeDisambiguation && isDisambiguationPage(page)) return false;
    if (excludeMedia && isLikelyMediaPage(page)) return false;
    return true;
  });
}

export async function retrieveWikipediaContext(
  queries: string[],
  pagesPerQuery = 2,
  options: WikiContextOptions = {}
): Promise<WikiPageSummary[]> {
  const out: WikiPageSummary[] = [];
  for (const q of queries) {
    const hits = await wikiSearch(q, pagesPerQuery);
    for (const h of hits) {
      const s = await wikiSummary(h.title);
      out.push(s);
    }
  }
  // de-duplicate by URL
  const seen = new Set<string>();
  const unique = out.filter((p) => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
  return filterWikipediaPages(unique, options);
}
