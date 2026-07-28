import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://www.cmmedia.es";
const TARGETS = [
  `${BASE_URL}/play/tv/toros`,
  `${BASE_URL}/play/toros`,
  `${BASE_URL}/tv/toros`
];

const OUTPUT = path.resolve("data/cmm-api-probe.json");
const USER_AGENT =
  "Mozilla/5.0 (compatible; AlberoTV/1.0; +https://alberotv.com)";

const API_HINTS = [
  "api",
  "graphql",
  "ajax",
  "json",
  "search",
  "program",
  "content",
  "video",
  "toros",
  "cms",
  "endpoint",
  "fetch(",
  "axios",
  "xmlhttprequest"
];

function clean(value = "") {
  return String(value)
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .trim();
}

function absoluteUrl(value, base) {
  try {
    return new URL(clean(value), base).href;
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      "accept-language": "es-ES,es;q=0.9",
      accept: "text/html,application/javascript,application/json,*/*"
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  return {
    url: response.url || url,
    contentType: response.headers.get("content-type") || "",
    text: await response.text()
  };
}

function extractScriptUrls(html, pageUrl) {
  const urls = [];

  for (const match of html.matchAll(
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  )) {
    urls.push(absoluteUrl(match[1], pageUrl));
  }

  return unique(urls);
}

function extractInlineScripts(html) {
  const scripts = [];

  for (const match of html.matchAll(
    /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const text = match[1].trim();
    if (text) scripts.push(text);
  }

  return scripts;
}

function extractForms(html, pageUrl) {
  const forms = [];

  for (const match of html.matchAll(/<form\b([^>]*)>/gi)) {
    const attributes = match[1];
    const action =
      attributes.match(/\baction\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const method =
      attributes.match(/\bmethod\s*=\s*["']([^"']+)["']/i)?.[1] || "GET";

    forms.push({
      action: absoluteUrl(action || pageUrl, pageUrl),
      method: method.toUpperCase()
    });
  }

  return forms;
}

function extractCandidateUrls(text, baseUrl) {
  const candidates = [];

  const patterns = [
    /https?:\\?\/\\?\/[^"'`\s<>\\]+/gi,
    /["'`]((?:\/|https?:\/\/)[^"'`<>\\\s]{3,250})["'`]/g,
    /\b(?:fetch|axios\.(?:get|post)|open)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    /\burl\s*:\s*["'`]([^"'`]+)["'`]/gi,
    /\bendpoint\s*:\s*["'`]([^"'`]+)["'`]/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = clean(match[1] || match[0]);
      const url = absoluteUrl(raw, baseUrl);

      if (!url) continue;

      const lower = url.toLowerCase();
      if (
        API_HINTS.some(hint => lower.includes(hint.replace("(", ""))) ||
        /\.(?:json)(?:\?|$)/i.test(url)
      ) {
        candidates.push(url);
      }
    }
  }

  return unique(candidates);
}

function extractInterestingSnippets(text) {
  const lines = String(text).split(/\r?\n/);
  const snippets = [];

  for (let index = 0; index < lines.length; index++) {
    const lower = lines[index].toLowerCase();

    if (API_HINTS.some(hint => lower.includes(hint))) {
      const snippet = lines
        .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
        .join("\n")
        .trim();

      if (snippet && snippet.length <= 1800) snippets.push(snippet);
    }
  }

  return unique(snippets).slice(0, 80);
}

function detectEmbeddedState(html) {
  const detections = [];

  const patterns = [
    {
      name: "__NEXT_DATA__",
      regex:
        /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    },
    {
      name: "__NUXT__",
      regex: /(?:window\.)?__NUXT__\s*=\s*([\s\S]*?);<\/script>/i
    },
    {
      name: "__INITIAL_STATE__",
      regex:
        /(?:window\.)?__INITIAL_STATE__\s*=\s*([\s\S]*?);<\/script>/i
    },
    {
      name: "__PRELOADED_STATE__",
      regex:
        /(?:window\.)?__PRELOADED_STATE__\s*=\s*([\s\S]*?);<\/script>/i
    },
    {
      name: "application/ld+json",
      regex:
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
    },
    {
      name: "application/json",
      regex:
        /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i
    }
  ];

  for (const item of patterns) {
    const match = html.match(item.regex)?.[1];
    if (match) {
      detections.push({
        name: item.name,
        length: match.length,
        preview: match.slice(0, 1000)
      });
    }
  }

  return detections;
}

async function inspectTarget(targetUrl) {
  const page = await fetchText(targetUrl);
  const scriptUrls = extractScriptUrls(page.text, page.url);
  const inlineScripts = extractInlineScripts(page.text);

  const result = {
    requestedUrl: targetUrl,
    finalUrl: page.url,
    contentType: page.contentType,
    htmlLength: page.text.length,
    forms: extractForms(page.text, page.url),
    embeddedState: detectEmbeddedState(page.text),
    pageCandidateUrls: extractCandidateUrls(page.text, page.url),
    inlineSnippets: unique(
      inlineScripts.flatMap(extractInterestingSnippets)
    ).slice(0, 100),
    scripts: []
  };

  for (const scriptUrl of scriptUrls) {
    const scriptResult = {
      url: scriptUrl,
      status: "ok",
      contentType: "",
      length: 0,
      candidateUrls: [],
      snippets: [],
      error: null
    };

    try {
      const script = await fetchText(scriptUrl);
      scriptResult.contentType = script.contentType;
      scriptResult.length = script.text.length;
      scriptResult.candidateUrls = extractCandidateUrls(
        script.text,
        script.url
      );
      scriptResult.snippets = extractInterestingSnippets(
        script.text
      ).slice(0, 40);
    } catch (error) {
      scriptResult.status = "error";
      scriptResult.error = error.message;
    }

    result.scripts.push(scriptResult);
  }

  return result;
}

async function main() {
  console.log("CMM API probe: inspeccionando páginas y JavaScript...");

  const results = [];
  const errors = [];

  for (const target of TARGETS) {
    try {
      const result = await inspectTarget(target);
      results.push(result);
      console.log(
        `${target}: ${result.scripts.length} scripts, ` +
          `${result.pageCandidateUrls.length} candidatos en HTML`
      );
    } catch (error) {
      errors.push({ url: target, error: error.message });
      console.error(`${target}: ${error.message}`);
    }
  }

  const allCandidateUrls = unique(
    results.flatMap(result => [
      ...result.pageCandidateUrls,
      ...result.scripts.flatMap(script => script.candidateUrls)
    ])
  );

  const output = {
    generatedAt: new Date().toISOString(),
    targets: TARGETS,
    candidateCount: allCandidateUrls.length,
    candidateUrls: allCandidateUrls,
    results,
    errors
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(
    OUTPUT,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("");
  console.log(`Candidatos encontrados: ${allCandidateUrls.length}`);
  console.log(`Resultado guardado en: ${OUTPUT}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
