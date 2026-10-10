/* global URL */
/**
 * Reads the paper links on a ChatPaper search page.
 *
 * A plain function over a document, so the page actor
 * (`paper-child.sys.mjs`) uses it in the page, and the test suite runs it over
 * a saved copy of the real page.
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
