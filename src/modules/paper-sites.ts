/**
 * Opening a paper's ChatPaper page from its title.
 *
 * ChatPaper has a search page addressed by the title, but its results are
 * built with JavaScript. So the search runs in a hidden browser, where a window
 * actor (`addon/content/paper-child.sys.mjs`) reads the list of results; the
 * best one is then opened in the user's own browser.
 *
 * The decisions - which result is the paper, and when nothing is close enough -
 * are plain functions and an orchestrator with injected dependencies, so they
 * are tested against fake pages. The live site is not part of the test suite.
 */

import { config } from "../../package.json";
import { hiddenBrowserClass } from "./page";
import { openExternal, toast } from "./notify";
import { t } from "./l10n";
import { titleSimilarity } from "./similarity";

/** The page actor's name, as registered in `registerPaperActor`. */
const ACTOR_NAME = "AlphaPulsePaper";

const SITE = "ChatPaper";

/** Below this similarity no result is the paper, so nothing is opened. */
export const MATCH_THRESHOLD = 0.6;

/** How long a results page may take to render. */
const PAGE_WAIT_MS = 20_000;
const POLL_MS = 1_000;

export function chatPaperSearchURL(title: string): string {
  return `https://chatpaper.com/zh-CN/search?keywords=${encodeURIComponent(title.trim())}&type=all`;
}

export interface PaperCandidate {
  href: string;
  /** The title to show. */
  title: string;
  /** Every title the result carries (English and Chinese); the best one counts. */
  titles?: string[];
}

function candidateTitles(candidate: PaperCandidate): string[] {
  const all = [candidate.title, ...(candidate.titles ?? [])];
  return all.map((value) => value?.trim() ?? "").filter(Boolean);
}

/**
 * The result that is the paper, or `null` when none is close enough.
 *
 * Journal and preprint versions of one work come back as several results with
 * nearly the same title. The one with the highest similarity is taken; on a
 * tie the first one on the page, which is where the site ranks it. Results
 * with no title or no address are skipped.
 */
export function pickBestMatch(
  title: string,
  candidates: PaperCandidate[],
): PaperCandidate | null {
  let best: PaperCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (!candidate.href) continue;

    const score = Math.max(
      0,
      ...candidateTitles(candidate).map((resultTitle) =>
        titleSimilarity(title, resultTitle),
      ),
    );
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= MATCH_THRESHOLD ? best : null;
}

/** What the lookup needs from a page it has open. */
export interface PaperSession {
  query(name: string, data?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export interface PaperLookupDeps {
  openSession(url: string): Promise<PaperSession | null>;
  open(url: string): void;
  notify(headline: string, message: string): void;
  delay(ms: number): Promise<void>;
}

/** Asks the page, treating an error (page not ready yet) as no answer. */
async function ask<T>(
  session: PaperSession,
  name: string,
  data?: Record<string, unknown>,
): Promise<T | null> {
  try {
    return ((await session.query(name, data)) as T) ?? null;
  } catch {
    return null;
  }
}

/** Polls the page until `done` accepts an answer, or the wait runs out. */
async function pollUntil<T>(
  deps: PaperLookupDeps,
  waitMs: number,
  ask1: () => Promise<T | null>,
  done: (value: T) => boolean,
): Promise<T | null> {
  // Counted in polls rather than read from the clock, so the wait is the
  // same whatever the delay function really does.
  const polls = Math.ceil(waitMs / POLL_MS);
  for (let poll = 0; poll <= polls; poll += 1) {
    const value = await ask1();
    if (value !== null && done(value)) return value;
    if (poll < polls) await deps.delay(POLL_MS);
  }
  return null;
}

async function waitForCandidates(
  session: PaperSession,
  deps: PaperLookupDeps,
): Promise<PaperCandidate[]> {
  const found = await pollUntil(
    deps,
    PAGE_WAIT_MS,
    () => ask<PaperCandidate[]>(session, "candidates"),
    (list) => Array.isArray(list) && list.length > 0,
  );
  return found ?? [];
}

/**
 * Finds the paper on ChatPaper and opens its page in the user's browser.
 */
export async function lookupOnChatPaper(
  title: string,
  deps: PaperLookupDeps,
): Promise<void> {
  const session = await deps.openSession(chatPaperSearchURL(title));
  if (!session) {
    deps.notify(SITE, t("notify-paper-no-browser"));
    return;
  }

  try {
    const candidates = await waitForCandidates(session, deps);
    const paper = pickBestMatch(title, candidates);
    if (!paper) {
      deps.notify(SITE, t("notify-paper-no-match", { site: SITE }));
      return;
    }

    deps.open(paper.href);
    deps.notify(SITE, t("notify-paper-chatpaper-opened"));
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------

interface ActorLike {
  sendQuery(name: string, data?: unknown): Promise<unknown>;
}

interface HiddenBrowserLike {
  load(
    url: string,
    options?: { requireSuccessfulStatus?: boolean },
  ): Promise<boolean>;
  destroy?: () => void;
  browsingContext?: {
    currentWindowGlobal?: { getActor(name: string): ActorLike } | null;
  } | null;
}

/** One hidden browser, opened on `url`, with the page actor for queries. */
async function openHiddenSession(url: string): Promise<PaperSession | null> {
  const { constructor } = hiddenBrowserClass();
  if (!constructor) return null;

  const browser = new constructor({
    allowJavaScript: true,
  }) as unknown as HiddenBrowserLike;
  try {
    await browser.load(url, { requireSuccessfulStatus: false });
  } catch (error) {
    Zotero.debug(`[AlphaPulse] could not load ${url}: ${error}`);
    browser.destroy?.();
    return null;
  }

  return {
    async query(name, data) {
      const actor =
        browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR_NAME);
      if (!actor) throw new Error("the page is not ready");
      return actor.sendQuery(name, data);
    },
    close() {
      try {
        browser.destroy?.();
      } catch {
        // A browser that will not close is Zotero's to clean up.
      }
    },
  };
}

export function liveDeps(): PaperLookupDeps {
  return {
    openSession: openHiddenSession,
    open: openExternal,
    notify: (headline, message) => toast(headline, message),
    delay: (ms) => Zotero.Promise.delay(ms),
  };
}

/** Whether a lookup is already running, so a second click does not start another. */
let running = false;

/** Starts a lookup for `title`, reporting progress as it goes. */
export function lookupPaper(
  title: string,
  deps: PaperLookupDeps = liveDeps(),
): void {
  const cleaned = title.trim();
  if (!cleaned) {
    deps.notify(SITE, t("notify-paper-no-title"));
    return;
  }
  if (running) {
    deps.notify(SITE, t("notify-paper-busy"));
    return;
  }

  running = true;
  deps.notify(
    SITE,
    t("notify-paper-searching", { site: SITE, title: cleaned }),
  );
  void lookupOnChatPaper(cleaned, deps)
    .catch((error: unknown) => {
      Zotero.debug(`[AlphaPulse] ChatPaper lookup failed: ${error}`);
      deps.notify(SITE, t("notify-paper-failed"));
    })
    .finally(() => {
      running = false;
    });
}

/** Makes the page actor available on ChatPaper. Safe to call twice. */
export function registerPaperActor(): void {
  const utils = (
    globalThis as unknown as {
      ChromeUtils?: {
        registerWindowActor(
          name: string,
          options: Record<string, unknown>,
        ): void;
      };
    }
  ).ChromeUtils;
  if (!utils) return;

  try {
    utils.registerWindowActor(ACTOR_NAME, {
      parent: {
        esModuleURI: `chrome://${config.addonRef}/content/paper-parent.sys.mjs`,
      },
      child: {
        esModuleURI: `chrome://${config.addonRef}/content/paper-child.sys.mjs`,
      },
      matches: ["https://chatpaper.com/*"],
      allFrames: false,
    });
  } catch (error) {
    // Registering twice (a reload within one session) is harmless.
    if (!/already registered/i.test(String(error))) {
      Zotero.debug(`[AlphaPulse] could not register the paper actor: ${error}`);
    }
  }
}

export function unregisterPaperActor(): void {
  const utils = (
    globalThis as unknown as {
      ChromeUtils?: { unregisterWindowActor(name: string): void };
    }
  ).ChromeUtils;
  try {
    utils?.unregisterWindowActor(ACTOR_NAME);
  } catch {
    // Not registered: nothing to undo.
  }
}
