/* global URL */
/**
 * Reads the paper links on the AMiner and ChatPaper search pages.
 *
 * Plain functions over a document, so the page actor
 * (`paper-child.sys.mjs`) uses them in the page, and the test suite runs them
 * over saved copies of the real pages.
 */

function cleanText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveHref(raw, base) {
  if (!raw) return "";
  try {
    return new URL(raw, base).href;
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Paper links on an AMiner results page, in page order.
 *
 * Each result's title link carries the paper's English title, both as text and
 * as the `title` attribute of the span inside it.
 */
export function aminerCandidates(doc, base) {
  const titled = [...doc.querySelectorAll('a.title-link[href*="/pub/"]')];
  const pool = titled.length
    ? titled
    : [...doc.querySelectorAll('a[href*="/pub/"]')];

  const seen = new Set();
  const out = [];
  for (const anchor of pool) {
    const href = resolveHref(anchor.getAttribute("href"), base);
    if (!href || seen.has(href)) continue;

    const shown = anchor.querySelector("[title]")?.getAttribute("title");
    const titles = unique([cleanText(shown), cleanText(anchor.textContent)]);
    if (!titles.length) continue;

    seen.add(href);
    out.push({ href, title: titles[0], titles });
  }
  return out;
}

/**
 * Paper links on a ChatPaper search page.
 *
 * Each result block links to the paper with its Chinese title, and shows the
 * English title in `.doc-info-name`; both are offered to the matcher.
 */
export function chatPaperCandidates(doc, base) {
  const blocks = [...doc.querySelectorAll(".document")];
  const sources = blocks.length
    ? blocks.map((scope) => ({
        scope,
        link: scope.querySelector('a[href*="/paper/"]'),
      }))
    : [...doc.querySelectorAll('a[href*="/paper/"]')].map((link) => ({
        scope: link.parentElement ?? link,
        link,
      }));

  const seen = new Set();
  const out = [];
  for (const { scope, link } of sources) {
    if (!link) continue;
    const href = resolveHref(link.getAttribute("href"), base);
    if (!href || seen.has(href)) continue;

    const english = cleanText(
      scope.querySelector(".doc-info-name")?.textContent,
    );
    const chinese = cleanText(link.textContent);
    const titles = unique([english, chinese]);
    if (!titles.length) continue;

    seen.add(href);
    out.push({ href, title: titles[0], titles });
  }
  return out;
}
