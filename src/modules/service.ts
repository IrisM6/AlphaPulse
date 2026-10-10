/**
 * The stateful core of AlphaPulse.
 *
 * `getCellData()` is a synchronous API because Zotero's item-tree data
 * provider is synchronous: it returns a cached value or a loading marker
 * immediately, and the asynchronous work (resolving an arXiv ID, then reading
 * the like count) invalidates the tree when it finishes.
 */

import pkg from "../../package.json";
import {
  ARXIV_ID_KEY,
  buildAlphaXivURL,
  extractArxivID,
  readCachedLikes,
  readLikesUpdatedAt,
  hasAlphaLikesData,
  stripAlphaLikesData,
  upsertLikesCache,
  upsertResolvedArxivID,
} from "./arxiv-id";
import {
  citationCountsFromSemanticScholar,
  CITATION_REJECTED_STATUSES,
  isRateLimitStatus,
  googleScholarCitationCount,
  googleScholarCitedByEvidence,
  googleScholarCitationSearchURL,
  googleScholarResultCount,
  googleScholarResultBlocks,
  googleScholarResultTitle,
  isHighImpact,
  readScholarTitle,
  scholarTitleSearchURL,
  isGoogleInterstitial,
  openAlexCitationSearchURL,
  openAlexCitationURL,
  openAlexSearchResults,
  openAlexWorkInfo,
  primaryCitationCount,
  primaryCitationSource,
  readCitations,
  readCitationsUpdatedAt,
  semanticScholarCitationURL,
  upsertCitations,
  writeManualCitations,
  type CitationCounts,
} from "./citations";
import {
  CITATION_SOURCE_LABELS,
  CITATION_TITLE_MIN_LENGTH,
  CITATIONS_BLOCKED_MARKER,
  SCHOLAR_CANCELLED_MARKER,
  citationProviderOrder,
  GOOGLE_SCHOLAR_HOME,
  isGoogleScholarResultsPage,
  minutesUntil,
  scholarRetryDelayMs,
  type CitationSourceKey,
} from "./citations";
import { ERROR_RETRY_DELAY_MS } from "./constants";
import {
  latestTrend,
  readLikesHistory,
  recordLikesSnapshot,
  trendOverDays,
  type LikesSnapshot,
  type TrendDelta,
} from "./history";
import {
  browserUserAgent,
  clearGoogleCookies,
  cookieNames,
  EXIT_IP_URL,
  googleConsentStored,
  hostOf,
  parseHTMLBody,
  PacedRequester,
  readExitIP,
  userAgentFor,
  type FingerprintReading,
  type HttpTransport,
  type ScholarPage,
  type ScholarPath,
} from "./http";
import { hiddenBrowserClass } from "./page";
import {
  describeProxy,
  formatDiagnosis,
  trimBodyHead,
  type DiagnosisInput,
  type HttpProbe,
} from "./diagnose";
import { t } from "./l10n";
import { openExternal, toast } from "./notify";
import {
  CELL_CLEARED,
  CELL_LOADING,
  CELL_UNAVAILABLE,
  failureReasonFrom,
  fromSortableValue,
  isNotFoundError,
  NO_ALPHAXIV_MARKER,
  parseLikesFromDocument,
  toSortableValue,
  withValueDecorations,
  type FailureReason,
} from "./likes";
import {
  getCitationAppearance,
  getCitationPrefs,
  getCitationSourcePreferences,
  getColorScheme,
  getPref,
  getRangeFilter,
  getRequestPrefs,
  getScholarPacing,
  getResolverPrefs,
  getTrendPrefs,
  isWithinRange,
  observePrefs,
  readClearedItemIDs,
  writeClearedItemIDs,
} from "./prefs";
import { quantileThresholds } from "./quantile";
import {
  findArxivCandidates,
  normalizeDoi,
  type ArxivCandidate,
  type PaperMetadata,
  type ResolverDeps,
} from "./resolver";
import { normalizeText, titleSimilarity, yearDistance } from "./similarity";

/** Item types that can plausibly have an arXiv preprint. */
const RESOLVABLE_ITEM_TYPES = new Set([
  "bookSection",
  "conferencePaper",
  "journalArticle",
  "manuscript",
  "preprint",
  "report",
  "thesis",
]);

/** Shorter titles are too ambiguous to search for automatically. */
const MIN_TITLE_LENGTH = 20;

const RESOLUTION_CACHE_TTL_SUCCESS_MS = 24 * 60 * 60_000;
const RESOLUTION_CACHE_TTL_MISS_MS = 10 * 60_000;

type ItemState =
  | { kind: "loading" }
  | { kind: "success"; arxivID: string; likes: number }
  | { kind: "failed"; retryAfter: number; reason: FailureReason }
  /**
   * alphaXiv has no record of this paper.
   *
   * Not a failure and not a zero: the paper was looked for and is not there,
   * so the cell stays empty with the reason in its tooltip and nothing is
   * retried - asking again would find the same nothing. A manual refresh asks
   * again, which is the only way it can change.
   */
  | { kind: "absent" };

type CitationState =
  | { kind: "loading" }
  | { kind: "success"; counts: CitationCounts }
  | { kind: "failed"; retryAfter: number; reason: FailureReason }
  /**
   * Google Scholar was asked and has no paper with this title.
   *
   * An answer, not a failure: there is no wait to keep and nothing to retry,
   * so the cell says so and stays that way until the user asks again.
   */
  | { kind: "absent" }

  /**
   * The user cancelled the waiting list.
   *
   * The read was asked for and then taken back: the cell stops carrying a
   * countdown it would never honour, and nothing is queued again on the next
   * repaint. A manual refresh asks for it afresh, which is the only way out -
   * cancelling is not a permanent "never read this one".
   */
  | { kind: "cancelled" };

interface ResolutionCacheEntry {
  candidates: ArxivCandidate[];
  createdAt: number;
  expiresAt: number;
}

/**
 * How long computed percentile cut-offs are reused. Quoting the population
 * keeps the data provider from rescanning on every rendered cell, while still
 * tracking a scrolling list closely enough to feel live.
 */
const QUANTILE_REFRESH_MS = 2_000;

/** Title similarity an OpenAlex search hit must reach to be trusted. */
const CITATION_TITLE_MATCH_MIN = 0.85;

/**
 * How many automatic retries a Scholar block gets before the user is told.
 *
 * Two retries cover a transient rate limit; needing a third means Google is
 * asking for a person, and the notice explains what to do about it.
 */
const SCHOLAR_ANNOUNCE_AFTER = 3;

/**
 * How many blocks in one episode before the automatic retries stop.
 *
 * The delay already doubles up to two hours, so this is not about speed: it is
 * about not doing the one thing that is certain to be useless. Every automatic
 * retry is another automated request to the site that just said it does not
 * want them, and the counter only grows - the reported episode had reached
 * attempt 31. Past this point the plugin waits for a person instead: the menu
 * offers the check itself and a clean Google session.
 */
const SCHOLAR_MAX_ATTEMPTS = 4;

/**
 * The shortest wait the queue's timer may be set for.
 *
 * A deadline that has just passed must not turn into a timer that fires in a
 * tight loop; a second is below anything a person can tell apart from "now".
 */
const SCHOLAR_QUEUE_MIN_WAIT_MS = 1_000;

/** Bounds on the population sample, so a huge library stays responsive. */
const MIN_QUANTILE_VALUES = 5;

export interface CitationCellPlan {
  value: string;
  text: string;
  count: number | null;
  highImpact: boolean;
  /** Display name of the provider whose count is shown, for the tooltip. */
  source: string | null;
}

export interface EffectiveThresholds {
  high: number;
  low: number;
  /** Which rule produced them, for the cell's tooltip. */
  source: "threshold" | "quantile";
  sampleSize: number;
}

/**
 * What an explicit refresh did, so the menu can report it.
 *
 * A refresh that quietly leaves the old numbers in place is indistinguishable
 * from a refresh that failed, which is what the action is for: the summary
 * says how many counts were actually re-read.
 */
export interface RefreshSummary {
  /** Items the action was applied to. */
  total: number;
  /** Counts that came back and were stored. */
  updated: number;
  /** Items whose count could not be read; their old value is kept. */
  failed: number;
  /**
   * Items that went onto the waiting list and had not been read by the time
   * the summary was written.
   *
   * Reported: eleven papers waiting their turn were reported as 「11 条未能
   * 读取（保留原值，约 10 分钟后自动重试）」, which says they failed and
   * invents a retry for them. They had not failed - they were queued, and the
   * queue comes back for them on its own. A paper still waiting is counted
   * here instead, and the message says so.
   */
  queued?: number;
  /**
   * Items Google Scholar answered about, and has no paper for.
   *
   * A number of its own because it is neither a success nor a failure: the
   * read happened, the answer is real, and the user is told what it was
   * instead of being left waiting for a retry.
   */
  missing?: number;
  /**
   * Minutes until the earliest automatic retry among the failed items, when
   * there is one.
   *
   * The summary says "will retry in about N minutes" instead of only "failed",
   * because a failure the user cannot act on should at least tell them they do
   * not have to.
   */
  retryMinutes?: number;
  /** Items that have nothing to look counts up with yet. */
  skipped: number;
}

/**
 * What the plugin is doing for one paper, as the menu and the settings say it.
 *
 * The reading is sequential - one Scholar search at a time, spaced out - so
 * the only meaningful count is the one for the paper whose turn it was: this
 * many searches have been spent on *this* paper since it was last read
 * successfully. A session-wide tally answers a question nobody asks ("how many
 * requests has Zotero made?") and hides the one that matters ("what is
 * happening to the paper I am looking at?"), which is what the reported bug
 * was: one paper stuck behind Google's check, and a line about the session.
 */
export interface ScholarItemActivity {
  itemID: number;
  /** The item's own title, so a line can say which paper it is about. */
  title: string;
  /** Scholar searches spent on this item since it was last read. */
  attempts: number;
  /** True while a search for this item is on its way. */
  reading: boolean;
  /**
   * How many papers will be read before this one; 0 means it is next in line.
   *
   * A paper with someone ahead of it cannot be given a time - the queue in
   * front of it decides, not a clock - and the line says so instead of naming
   * a moment it would borrow from the paper that is actually waiting. That
   * borrowing is what the reported bug looked like from the user's side: a
   * newly added paper showing the same "in about 5 minutes" as the old one it
   * was queued behind, and neither of them being read.
   */
  ahead: number;
  /**
   * Milliseconds until this item's own next moment.
   *
   * Meaningful only for the paper at the head of the queue (`ahead === 0`):
   * there it is the later of its own retry deadline and the rhythm the next
   * request has to wait for. For a paper behind another one it is 0, because
   * there is no moment to name - only a place in the queue.
   */
  nextInMs: number;
}

/**
 * Why a paper is in the waiting list.
 *
 * `auto` is a row with no count yet whose cell asked for a read: it is read
 * only while the row is one the user is looking at, which is the rule that
 * keeps Google Scholar from being asked about rows nobody selected. `stale` is
 * a cached count whose age passed the configured lifetime - the user asked for
 * those to keep themselves fresh, so no selection is involved. `user` is an
 * explicit refresh: it goes to the head of the list and is never dropped.
 */
type ScholarReadKind = "auto" | "stale" | "user";

/** What became of a paper's turn in the waiting list. */
type ScholarQueueResult =
  | "read"
  | "failed"
  | "skipped"
  | "missing"
  /**
   * The batch was asked for while this paper was already on the list: it keeps
   * its place and its turn, and the summary says it is waiting rather than
   * calling it a failure.
   */
  | "queued";

/**
 * What one Google Scholar read answered.
 *
 * A count is a count - zero included, because a paper nobody has cited is a
 * paper with no citations, not a paper that could not be read. `no-match` is
 * an answer too: the results page came back, the titles on it were read, and
 * none of them is this paper - so the user is told that, instead of being
 * promised a retry that would find the same nothing. `null` is the only
 * outcome worth asking about again: a refusal, a page that never arrived, an
 * answer that could not be read.
 */
type ScholarCitationRead =
  { kind: "count"; count: number } | { kind: "no-match" } | null;

/** One paper's place in the waiting list. */
interface ScholarQueueEntry {
  itemID: number;
  kind: ScholarReadKind;
  /**
   * The earliest moment this paper may be read, or null for "when its turn
   * comes". Set by a failed attempt to the moment the user is told to expect
   * a retry; the pump's timer fires on exactly that moment, so the wait the
   * cell, the tooltip and the menu name is the wait that happens.
   */
  notBefore: number | null;
  /** True while that deadline is Google's block rather than the paper's own. */
  onBlock: boolean;
  /**
   * Resolved when this paper's turn is over, with what came of it. Only an
   * explicit refresh waits on it; an automatic read has nobody to tell.
   */
  done: ((result: ScholarQueueResult) => void) | null;
}

export interface ItemTrend {
  /** Day-over-day change, when two snapshots exist. */
  latest: TrendDelta | null;
  /** Change over the configured window, when history reaches back that far. */
  window: TrendDelta | null;
  history: LikesSnapshot[];
  /** A day-over-day rise at or above the configured threshold. */
  hot: boolean;
}

/**
 * The providers whose counts may be shown - exactly the chosen ones.
 *
 * This used to be a preference-first list with the rest of the authority order
 * behind it, which meant choosing Google Scholar still showed OpenAlex numbers
 * whenever Scholar had nothing to say. Now only the selected providers are
 * asked: one provider means its number or an empty cell, several mean the
 * largest of their counts. Nothing outside the selection is ever substituted.
 */
function citationOrder(): CitationSourceKey[] {
  return citationProviderOrder(getCitationSourcePreferences());
}

function isSameYearOrAdjacent(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true;
  const distance = yearDistance(a, b);
  return distance === null || distance <= 1;
}

export interface CellRenderPlan {
  /** Raw value handed to Zotero's sortable data provider. */
  value: string;
  /** Display text after sort-key decoding. */
  text: string;
  /** Like count when the cell holds a number. */
  likes: number | null;
  /** Whether the like-count range filter excludes this cell. */
  filteredOut: boolean;
  /** Snapshot deltas, or `null` when the trend display is switched off. */
  trend: ItemTrend | null;
}

function safeGetField(item: Zotero.Item, field: string): string {
  try {
    return String(item.getField(field) || "");
  } catch {
    return "";
  }
}

function yearFromDate(date: string): number | null {
  const match = (date || "").match(/(\d{4})/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return year >= 1900 && year <= 2100 ? year : null;
}

/**
 * `getCreators()` returns given/last names, or the whole name in `lastName`
 * for single-field creators such as consortiums.
 */
function rawCreatorName(creator: unknown): string {
  const value = creator as {
    creatorType?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    fieldMode?: number;
  };

  if (value.creatorType && value.creatorType !== "author") return "";
  if (value.name) return String(value.name).trim();
  if (value.fieldMode === 1) return String(value.lastName || "").trim();
  return `${value.firstName || ""} ${value.lastName || ""}`.trim();
}

/**
 * The part of an item tree this module touches, as it exists across the Zotero
 * versions we support. `invalidateRowCache` is only a method on newer builds,
 * and the cache itself is internal in all of them, so both spellings are
 * optional here.
 */
export interface ItemTreeView {
  invalidateRowCache?: (invalidateAll?: boolean) => void;
  _rowCache?: Record<string, unknown>;
  /** Item id to row index, as the tree keeps it. */
  _rowMap?: Record<string, number>;
  tree?: { invalidate?: () => void; invalidateRow?: (row: number) => void };
}

/**
 * Makes the next paint of an item tree rebuild its cell values from scratch.
 *
 * Redrawing alone is not enough: a cell's value is memoised per row, so a
 * preference that only changes how an existing value is drawn (the trend
 * arrow, colours, styles) keeps showing the value the data provider produced
 * *before* the change until the row cache is dropped. Zotero does the same two
 * steps for its own display-only preferences - clear the cache, then redraw.
 */
export function dropRowCache(itemsView: ItemTreeView | null | undefined): void {
  if (!itemsView) return;

  if (typeof itemsView.invalidateRowCache === "function") {
    itemsView.invalidateRowCache(true);
  } else if (itemsView._rowCache) {
    itemsView._rowCache = {};
  }
  itemsView.tree?.invalidate?.();
}

/**
 * Repaints every item tree that is showing our columns.
 *
 * Every row's value is dropped, which is what a preference change needs: the
 * next paint rebuilds all of them from scratch. It is *not* what a read of one
 * item needs - dropping a row's value makes the tree ask the data provider for
 * it again, and a row that has no count yet starts a read of its own when it is
 * asked. Repainting everything after one item finished is how refreshing a
 * single entry turned into a read of every entry in the list.
 */
function refreshItemTrees(): void {
  for (const win of Zotero.getMainWindows()) {
    try {
      dropRowCache(win.ZoteroPane?.itemsView as ItemTreeView | undefined);
    } catch {
      // A window can disappear while an asynchronous request is completing.
    }
  }
}

/**
 * Repaints just the rows of the given items, the way Zotero does for its own
 * item changes: drop that row's value, then invalidate that row.
 *
 * Rows that are untouched never re-ask for a value, so a refresh of one item
 * cannot start a read for its neighbours.
 */
export function repaintRows(ids: Iterable<number>): void {
  for (const win of Zotero.getMainWindows()) {
    try {
      const view = win.ZoteroPane?.itemsView as ItemTreeView | undefined;
      if (!view) continue;

      const rows: number[] = [];
      for (const id of ids) {
        if (view._rowCache) delete view._rowCache[id];
        const row = view._rowMap?.[id];
        if (typeof row === "number") rows.push(row);
      }
      if (!rows.length) continue;

      if (typeof view.tree?.invalidateRow === "function") {
        for (const row of rows) view.tree.invalidateRow(row);
      } else {
        view.tree?.invalidate?.();
      }
    } catch {
      // A window can disappear while an asynchronous request is completing.
    }
  }
}

/** What a clear run did, for the menu's summary. */
export interface ClearSummary {
  /** Items the action was run on. */
  total: number;
  /** Items that actually had AlphaPulse lines in `Extra`. */
  cleared: number;
  /** Items that had none - nothing was removed, but they are left alone now. */
  alreadyEmpty: number;
}

/**
 * What a failed cell carries: why it failed, and when the next attempt is.
 *
 * "读取失败" on its own reads as "this is broken"; the retry time is the part
 * that tells the user whether to wait or to fix something. The renderer turns
 * the marker into a sentence.
 */
function failureDecorations(
  reason: FailureReason,
  retryAfter: number,
): string[] {
  return [reason, `retry:${minutesUntil(retryAfter)}`];
}

export class AlphaLikesService {
  private requester: PacedRequester;
  private itemStates = new Map<number, ItemState>();
  private resolutionCache = new Map<string, ResolutionCacheEntry>();
  private inFlightLikes = new Map<string, Promise<number | null>>();
  private inFlightResolution = new Map<string, Promise<ArxivCandidate[]>>();
  private staleRefreshing = new Set<number>();
  /**
   * Items an explicit refresh is currently re-reading, per column.
   *
   * The cached value stays in `Extra` while the refresh runs, so a failed
   * re-read cannot cost the user the number they already had; these items are
   * simply shown as loading until the fresh value (or the old one) is back.
   * Two sets, because refreshing citations must not blank the likes column.
   */
  private refreshingLikes = new Set<number>();
  private refreshingCitations = new Set<number>();
  /**
   * Items the user cleared with the context menu.
   *
   * Read from the preferences on first use and written back whenever an item
   * is cleared or revived, so the set survives a restart without putting a
   * single byte into `Extra` - the field the action is meant to empty.
   */
  private clearedItems: Set<number> | null = null;

  private stopObservingPrefs: (() => void) | null = null;
  private disposed = false;

  private citationStates = new Map<number, CitationState>();
  private inFlightCitations = new Map<
    string,
    Promise<{ counts: CitationCounts | null; noMatch: boolean }>
  >();

  /**
   * Google Scholar's human check, while it is in force.
   *
   * `attempts` counts consecutive blocks so the wait doubles each time;
   * `items` remembers what was being read so the retry can pick it up again
   * without making the user do anything.
   */
  /**
   * Per-paper reading state: what this session has asked Scholar about each
   * item, and when each item is tried again.
   *
   * Entries live only while they are worth reading. A count is reset by the
   * paper's own successful read - the user's rule, and the right one: what is
   * interesting is how hard *this* paper is being tried, not how long the
   * plugin has been running. An item that was never attempted has no entry
   * until a block or a failure gives it a wait worth reporting.
   */
  private scholarItems = new Map<
    number,
    {
      attempts: number;
      reading: boolean;
      /** Absolute time of the next automatic attempt, or null for "none". */
      nextAttemptAt: number | null;
      /** True while that time comes from the block rather than the item. */
      onBlock: boolean;
      reason: FailureReason;
    }
  >();
  private scholarBlock: {
    attempts: number;
    until: number;
    url: string;
    /**
     * `true` when Google rate-limited the address (429/503) rather than
     * refusing the request (403). The two mean different things to the user:
     * one is "slow down, this network is busy", the other is "prove you are a
     * person", and the notice spells out which one it was.
     */
    rateLimited: boolean;
  } | null = null;
  private scholarRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private scholarBlockedItems = new Set<number>();
  /**
   * The waiting list for citation reads: one list for the whole library.
   *
   * There is one Google Scholar and one pace to read it at, so there is one
   * queue. Everything that wants a count goes into it - a row that has never
   * been read, a cached row whose value has aged out, the papers an explicit
   * refresh named, and the retries of papers that were refused - and the queue
   * serves them one at a time, out of the front, with the rhythm the requester
   * enforces between requests.
   *
   * Reported (1.3.7): adding a paper started its read while an older paper was
   * still waiting to be retried. The new paper showed 0 attempts and the *old
   * paper's* deadline - the two lines said the same five minutes - the older
   * paper was pushed back by the block the new read provoked, and a third,
   * even older paper sat on "retrying now" without anything ever retrying it.
   * One list, read in the order the reads were asked for, is what makes all
   * three of those statements true or absent.
   */
  private scholarQueue: ScholarQueueEntry[] = [];
  /** Item ids in the list, so a repaint cannot queue the same paper twice. */
  private scholarQueued = new Set<number>();
  /** The paper whose search is on its way, if any. */
  private scholarReading: number | null = null;
  /** True while the list is being served. */
  private scholarPumping = false;
  /** Wakes the pump when the paper at the head of the queue comes due. */
  private scholarQueueTimer: ReturnType<typeof setTimeout> | null = null;
  /** One notification per block episode, not one per paper. */
  private scholarBlockAnnounced = false;
  /** True once the automatic retries have been given up on, per episode. */
  private scholarRetryPaused = false;
  /** How many rounds of Google Scholar refusals this episode has had. */
  private scholarRound = 0;
  /**
   * The items the running refresh was asked about.
   *
   * The refresh actions are per selection, and the rule the user asked for is
   * about that selection: pressing "refresh citations" must not start a like
   * read for the rows it was asked about. A row that is not part of the batch
   * has nothing to do with it - and reported, that is exactly what went wrong
   * for a paper added while the citation reads were running: its like count
   * was held back for as long as the batch took, which for a queue that is
   * *meant* to space its searches 16-30 seconds apart is minutes.
   */
  private scopeItems: Set<number> | null = null;
  /**
   * Which column is being refreshed right now, if either.
   *
   * An explicit refresh means "read this, and only this": while the citation
   * column is being re-read, a row that gets painted must not start a like
   * read of its own (and the other way round). Reported: "刷新引用量和点赞数
   * 要分开，我刷新引用量把点赞数也刷新了" - the two actions share the item list
   * and the repaint, so without this the one that repaints drags the other
   * along: a row with no count starts a read the moment it is asked for one.
   */
  private readScope: "likes" | "citations" | null = null;
  /** Item ids the last few repaints saw selected, with the time they did. */
  private selectionCache: { at: number; ids: Set<number> } | null = null;

  /**
   * Latest like count seen for each item the column has rendered. This is the
   * population the percentile colouring ranks against, so "top 20%" means the
   * top 20% of the counts the user has actually loaded.
   */
  private observedLikes = new Map<number, number>();
  /** Citation counts seen by the renderer, for the citation percentiles. */
  private observedCitations = new Map<number, number>();
  private citationQuantileCache: {
    thresholds: EffectiveThresholds | null;
    computedAt: number;
  } | null = null;
  private quantileCache: {
    thresholds: EffectiveThresholds | null;
    computedAt: number;
  } | null = null;

  constructor() {
    const { timeoutMs, intervalMs } = getRequestPrefs();
    this.requester = new PacedRequester({
      timeoutMs,
      intervalMs,
      // A thunk, not a snapshot: the ranges are read for every search, so
      // editing them in the settings pane changes the next read.
      scholarPacing: () => getScholarPacing(),
    });
    this.stopObservingPrefs = observePrefs((name) => this.onPrefChanged(name));
  }

  // -------------------------------------------------------------------------
  // Cell rendering
  // -------------------------------------------------------------------------

  /**
   * Synchronous entry point used by the column's data provider.
   */
  getCellData(item: Zotero.Item): string {
    return this.planCell(item).value;
  }

  /**
   * Same computation as `getCellData`, plus the metadata the cell renderer
   * needs for colouring. Kept separate so the colouring rules stay testable
   * and the data provider stays a one-liner.
   */
  planCell(item: Zotero.Item): CellRenderPlan {
    const raw = this.computeCellValue(item);
    const text = fromSortableValue(raw);
    const likes = /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;

    // Feed the percentile population, including counts the range filter hides.
    if (likes !== null) this.observedLikes.set(item.id, likes);

    const filter = getRangeFilter();
    const filteredOut = likes !== null && !isWithinRange(likes, filter);

    // Out-of-range rows keep their count and get dimmed by the renderer: the
    // value itself is never blanked, so sorting still sees the real figure.
    const value = raw;

    const trend =
      likes !== null && getTrendPrefs().enabled ? this.readTrend(item) : null;

    return {
      // The renderer only receives the data string, so the delta travels with
      // it. Decorations follow the zero-padded sort key, which keeps sorting
      // numeric.
      value: withValueDecorations(
        value,
        trend?.latest ? [trend.latest.delta] : [],
      ),
      text,
      likes,
      filteredOut,
      trend,
    };
  }

  /**
   * Cut-offs used for colouring.
   *
   * In `quantile` mode these are percentiles of the loaded like counts; when
   * the sample is too small, or every loaded item has the same count, the
   * fixed thresholds are used so the column never collapses to one colour.
   */
  /**
   * Cut-offs for the Citations column, derived exactly like the likes ones:
   * percentiles of the citation counts currently in the item tree, falling
   * back to the configured fixed cut-offs when the sample is too small to rank.
   */
  getEffectiveCitationThresholds(): EffectiveThresholds {
    const appearance = getCitationAppearance();
    const fallback: EffectiveThresholds = {
      high: appearance.highThreshold,
      low: appearance.lowThreshold,
      source: "threshold",
      sampleSize: this.observedCitations.size,
    };

    if (appearance.mode !== "quantile") return fallback;

    const now = Date.now();
    if (
      this.citationQuantileCache &&
      now - this.citationQuantileCache.computedAt < QUANTILE_REFRESH_MS
    ) {
      return this.citationQuantileCache.thresholds ?? fallback;
    }

    const scheme = getColorScheme();
    const values = [...this.observedCitations.values()];
    const derived =
      values.length >= MIN_QUANTILE_VALUES
        ? quantileThresholds(
            values,
            scheme.quantileLowPercent,
            scheme.quantileHighPercent,
          )
        : null;

    const thresholds: EffectiveThresholds | null = derived
      ? {
          high: derived.high,
          low: derived.low,
          source: "quantile",
          sampleSize: derived.sampleSize,
        }
      : null;

    this.citationQuantileCache = { thresholds, computedAt: now };
    return thresholds ?? fallback;
  }

  getEffectiveThresholds(): EffectiveThresholds {
    const scheme = getColorScheme();
    const fallback: EffectiveThresholds = {
      high: scheme.highThreshold,
      low: scheme.lowThreshold,
      source: "threshold",
      sampleSize: this.observedLikes.size,
    };

    if (scheme.mode !== "quantile") return fallback;

    const now = Date.now();
    if (
      this.quantileCache &&
      now - this.quantileCache.computedAt < QUANTILE_REFRESH_MS
    ) {
      return this.quantileCache.thresholds ?? fallback;
    }

    const values = [...this.observedLikes.values()];
    const derived =
      values.length >= MIN_QUANTILE_VALUES
        ? quantileThresholds(
            values,
            scheme.quantileLowPercent,
            scheme.quantileHighPercent,
          )
        : null;

    const thresholds: EffectiveThresholds | null = derived
      ? {
          high: derived.high,
          low: derived.low,
          source: "quantile",
          sampleSize: derived.sampleSize,
        }
      : null;

    this.quantileCache = { thresholds, computedAt: now };
    return thresholds ?? fallback;
  }

  /**
   * Routes every read through an injected transport, or restores Zotero's own.
   *
   * The seam the test suite uses so that its runs never touch the live sites,
   * and the one `api.setReadTransport` hands out.
   */
  setReadTransport(transport: HttpTransport | null): void {
    this.requester.setTransport(transport);
  }

  /** Snapshot history and derived deltas for one item. */
  readTrend(item: Zotero.Item): ItemTrend {
    const prefs = getTrendPrefs();
    const history = readLikesHistory(safeGetField(item, "extra"));
    const latest = latestTrend(history);
    const window = trendOverDays(history, prefs.historyDays);

    return {
      latest,
      window,
      history,
      hot:
        latest !== null && latest.delta >= prefs.hotDelta && prefs.hotDelta > 0,
    };
  }

  // -------------------------------------------------------------------------
  // Citations
  // -------------------------------------------------------------------------

  /**
   * Synchronous entry point for the Citations column, mirroring `getCellData`.
   */
  getCitationCellData(item: Zotero.Item): string {
    return this.planCitationCell(item).value;
  }

  /**
   * Whether Google Scholar is waiting out a human check, and for how long.
   *
   * The renderer explains an empty cell with this, and the context menu offers
   * to open the check in the browser, so both read it from one place.
   */
  getScholarBlockStatus(): {
    blocked: boolean;
    minutesLeft: number;
    attempts: number;
    url: string;
    rateLimited: boolean;
  } {
    const block = this.scholarBlock;
    if (!block || block.until <= Date.now()) {
      return {
        blocked: false,
        minutesLeft: 0,
        attempts: block?.attempts ?? 0,
        url: block?.url ?? GOOGLE_SCHOLAR_HOME,
        rateLimited: block?.rateLimited ?? false,
      };
    }
    return {
      blocked: true,
      minutesLeft: Math.max(1, Math.ceil((block.until - Date.now()) / 60_000)),
      attempts: block.attempts,
      url: block.url,
      rateLimited: block.rateLimited,
    };
  }

  /**
   * Whether the reader is waiting out a burst pause, and for how long.
   *
   * A citation row that is being read during a pause looks like a row that is
   * stuck: the plugin deliberately stops asking Google for several minutes
   * after a few searches, and the tooltip is where that is explained.
   */
  scholarPauseStatus(): { paused: boolean; minutes: number } {
    try {
      const wait = this.requester.scholarWait();
      return {
        paused: wait.paused && wait.waitMs > 0,
        minutes: Math.max(1, wait.pauseMinutes),
      };
    } catch {
      // A reader that cannot answer is not a reason to lose the cell.
      return { paused: false, minutes: 0 };
    }
  }

  /**
   * The page a user can open to clear the check themselves.
   *
   * With an item at hand this is that paper's own Scholar search - already
   * filled in and already run - rather than Scholar's front page, because a
   * blank search box leaves the user to retype a title the plugin knows. The
   * remembered result, when there is one, is searched for instead: the user
   * said that is the paper whose count belongs to this item.
   */
  scholarVerificationURL(item?: Zotero.Item | null): string {
    if (item) {
      const title = this.scholarSearchTitle(item);
      if (title) return scholarTitleSearchURL(title);
    }
    return this.scholarBlock?.url ?? GOOGLE_SCHOLAR_HOME;
  }

  /** Opens that page in the default browser. */
  /**
   * What this session has asked Google Scholar for, and what it waits for.
   *
   * The settings pane and the menu both read this, so the two cannot drift:
   * one count, one wait, computed where the queue actually lives.
   */
  scholarActivity(): {
    requests: number;
    nextInMs: number;
    paused: boolean;
    burstLeft: number;
    /** True once the automatic retries have been given up on this episode. */
    autoPaused: boolean;
    /** Per-paper state, the paper whose turn is next first. */
    items: ScholarItemActivity[];
  } {
    const session = this.requester.scholarActivity();
    const now = Date.now();
    const items: ScholarItemActivity[] = [];

    // The list is the report, and it is reported in the order it is written:
    // the paper whose turn it is first, then the ones behind it. A paper is
    // named while it is waiting to be read or being read; a paper that has
    // been read, or has left the list, is not a line - there is nothing left
    // to promise about it.
    let rowsAhead = 0;
    let usersAhead = 0;
    for (const entry of [...this.scholarQueue]) {
      const item = this.itemForID(entry.itemID);
      // An item that went away takes its reading with it: a line about a
      // deleted paper is a line about nothing.
      if (!item) {
        this.scholarItems.delete(entry.itemID);
        continue;
      }

      const state = this.scholarItems.get(entry.itemID);
      const reading = this.scholarReading === entry.itemID;
      // How many papers are read before this one. The list is served in
      // order, so for an automatic read that is everything in front of it -
      // which is how a paper that has just been added says who it is waiting
      // behind instead of borrowing that paper's deadline. A paper the user
      // asked for is served as soon as the rhythm allows, so only the user's
      // own earlier asks are counted in front of it.
      const ahead = entry.kind === "user" ? usersAhead : rowsAhead;

      items.push({
        itemID: entry.itemID,
        title: String(safeGetField(item, "title") ?? "").trim(),
        attempts: state?.attempts ?? 0,
        reading,
        ahead,
        // Only the paper whose turn it is has a moment to name: its own retry
        // deadline, or the rhythm the next request has to wait out. It waits
        // for the later of the two, because a request cannot leave before the
        // rhythm allows it. A paper behind it waits for a turn, not a clock.
        nextInMs:
          reading || ahead > 0
            ? 0
            : Math.max(
                entry.notBefore === null
                  ? 0
                  : Math.max(0, entry.notBefore - now),
                session.nextInMs,
              ),
      });

      rowsAhead += 1;
      if (entry.kind === "user") usersAhead += 1;
    }

    return {
      ...session,
      autoPaused: this.scholarRetryPaused,
      items,
    };
  }

  /**
   * Empties the waiting list: no more waiting, no more automatic retries.
   *
   * Reported as a wish rather than a bug - a long list of papers each with ten
   * minutes in front of it should be something the user can stop. Cancelling
   * drops every paper that is waiting, together with the wait each of them
   * was keeping and the automatic retries that went with it; whatever is
   * already in `Extra` is untouched, and nothing is un-read. A manual refresh
   * after this starts again from nothing, because asking for a paper is the
   * user's own decision and this button is not a veto on it.
   *
   * The paper whose search is in the air is left alone: the request has
   * already left, and its answer is worth keeping. It is not retried after
   * that, and it does not put the ones behind it back on the list.
   */
  cancelScholarWaits(): { cancelled: number } {
    let cancelled = 0;
    for (const entry of [...this.scholarQueue]) {
      // Someone the search is already out for is not "waiting" any more.
      if (this.scholarReading === entry.itemID) continue;
      cancelled += 1;
      // A paper with a number in `Extra` keeps showing it: the count is not
      // being un-read. One without a number stops carrying the countdown it
      // was given, because that countdown has just been cancelled.
      const state = this.citationStates.get(entry.itemID);
      if (!state || state.kind === "failed" || state.kind === "loading") {
        this.citationStates.set(entry.itemID, { kind: "cancelled" });
      }
      this.dropScholarEntry(entry, "skipped");
    }

    // A refusal the papers were waiting out is over as well: cancelling is the
    // user saying they are not waiting for it.
    this.clearScholarBlock();
    this.scholarBlockedItems.clear();
    if (this.scholarQueueTimer !== null) {
      clearTimeout(this.scholarQueueTimer);
      this.scholarQueueTimer = null;
    }

    // The per-paper lines go with the waits: a paper that was cancelled is not
    // being retried, and a line saying "in about 5 minutes" about it would be
    // the same broken promise this round was about.
    this.scholarItems.clear();
    if (!this.disposed)
      repaintRows([...this.scholarQueue].map((e) => e.itemID));
    this.debug(`[AlphaPulse] 已取消 ${cancelled} 条等待中的引用量读取`);
    return { cancelled };
  }

  openScholarVerification(item?: Zotero.Item | null): void {
    openExternal(this.scholarVerificationURL(item));
  }

  /**
   * The alphaXiv page the like count comes from, when the paper has an ID.
   *
   * Null rather than a guess: alphaXiv addresses papers by arXiv ID only, so
   * an item whose ID could not be resolved has no page to open, and the menu
   * entry hides itself instead of landing the user on the site's front page.
   */
  alphaXivPageURL(item?: Zotero.Item | null): string | null {
    if (!item) return null;
    const arxivID = this.getItemArxivID(item);
    return arxivID ? buildAlphaXivURL(arxivID) : null;
  }

  /** Opens that page in the default browser. False when there is no page. */
  openAlphaXivPage(item?: Zotero.Item | null): boolean {
    const url = this.alphaXivPageURL(item);
    if (!url) return false;

    openExternal(url);
    return true;
  }

  /** The title Scholar is asked about: the picked result, else the item's. */
  private scholarSearchTitle(item: Zotero.Item): string {
    const pinned = readScholarTitle(safeGetField(item, "extra"));
    if (pinned) return pinned;

    const title = safeGetField(item, "title").trim();
    return title.length >= 10 ? title : "";
  }

  // -------------------------------------------------------------------------
  // Cleared items
  // -------------------------------------------------------------------------

  private cleared(): Set<number> {
    if (this.clearedItems === null) {
      this.clearedItems = new Set(readClearedItemIDs());
    }
    return this.clearedItems;
  }

  /**
   * Whether this item's records were cleared and nothing may be written to it.
   *
   * A cleared item is neutral - not "no data", but "leave me alone" - so the
   * column shows an empty cell and no request is made for it until an explicit
   * refresh lifts the mark.
   */
  isCleared(item: Zotero.Item | number): boolean {
    const id = typeof item === "number" ? item : item.id;
    return this.cleared().has(id);
  }

  /** Lifts the mark for the items an explicit refresh is about to re-read. */
  private reviveItems(items: Zotero.Item[]): void {
    const set = this.cleared();
    let changed = false;
    for (const item of items) changed = set.delete(item.id) || changed;
    if (changed) writeClearedItemIDs([...set]);
  }

  /**
   * Nothing is fetched while the block is in force, and nothing is retried
   * early: Google answers a burst of requests by extending the block.
   */
  private isScholarBlocked(): boolean {
    return this.scholarBlock !== null && this.scholarBlock.until > Date.now();
  }

  /** The state of one item's reading, created on first use. */
  private scholarItemState(itemID: number) {
    let state = this.scholarItems.get(itemID);
    if (!state) {
      state = {
        attempts: 0,
        reading: false,
        nextAttemptAt: null,
        onBlock: false,
        reason: "no-count",
      };
      this.scholarItems.set(itemID, state);
    }
    return state;
  }

  /**
   * Counts one Scholar search as spent on this paper.
   *
   * Called where the request actually leaves, not where a row is painted: a
   * row that is skipped because Google is still refusing costs nothing, and
   * counting it would put a number on a paper that was never asked about.
   */
  private noteScholarAttempt(itemID: number): void {
    const state = this.scholarItemState(itemID);
    state.attempts += 1;
    state.reading = true;
  }

  /**
   * Records what became of this paper's last search.
   *
   * A paper that was read successfully is taken out of the map altogether:
   * its count is back to nothing, the way the user asked for it - the next
   * time it needs reading, it starts from one.
   */
  private noteScholarOutcome(
    itemID: number,
    outcome:
      | { ok: true }
      | {
          ok: false;
          reason: FailureReason;
          /** When this item is tried again; from the block when one is on. */
          retryAfter: number;
          onBlock: boolean;
        },
  ): void {
    if (outcome.ok) {
      this.scholarItems.delete(itemID);
      return;
    }
    const state = this.scholarItemState(itemID);
    state.reading = false;
    state.nextAttemptAt = outcome.retryAfter;
    state.onBlock = outcome.onBlock;
    state.reason = outcome.reason;
  }

  /**
   * Records a block and schedules the automatic retry.
   *
   * The first couple of blocks are handled silently: they are usually ordinary
   * rate limiting that clears itself, and a notice for every one of them would
   * be noise. Only when the automatic retries have failed often enough that
   * the check looks like it needs a person is the user told - once per episode,
   * with the retry time and a way to clear it themselves.
   */
  private noteScholarBlock(url: string, rateLimited = false): void {
    // Counted per *round*, not per read. A repaint can have twenty rows in
    // flight, and when Google refuses them all, twenty failures arrive for what
    // is one episode of being blocked - counting those as twenty attempts made
    // the report say "attempt 20" and jumped the cap in the first second.
    const freshRound = this.scholarBlock === null;
    if (freshRound) this.scholarRound += 1;

    // The jar is cleared by the plugin itself, and never mentioned in the UI:
    // a block is the one moment where the cookies collected so far are worth
    // dropping, and the next attempt should look like a browser that has just
    // arrived rather than one that kept knocking with the same session. Done
    // once per round, so a repaint's worth of refusals clears it once.
    if (freshRound) {
      // Wrapped, because this is housekeeping and not the read: a session
      // that cannot answer for its cookies must still leave the block
      // recorded, or the wait the user is owed would be lost with it.
      try {
        const cleared = clearGoogleCookies();
        this.requester.restartGoogleSession();
        this.debug(
          `[AlphaPulse] 被拦后自动清掉 ${cleared} 个 Google Cookie，` +
            `下次重试会重新打开 Scholar 首页`,
        );
      } catch (error) {
        this.debug(`could not clear the Google cookies: ${error}`);
      }
    }
    const attempts = Math.max(1, this.scholarRound);
    const delay = scholarRetryDelayMs(attempts);
    // The most recent answer decides how the wait is described, so a block
    // that started as a refusal and turned into rate limiting says so.
    this.scholarBlock = {
      attempts,
      until: Date.now() + delay,
      url,
      rateLimited,
    };

    if (!this.scholarBlockAnnounced) {
      this.debug(
        `Google Scholar asked for a human check; retrying in ${Math.round(
          delay / 60_000,
        )} minutes`,
      );
    }

    if (!this.scholarBlockAnnounced && attempts >= SCHOLAR_ANNOUNCE_AFTER) {
      this.scholarBlockAnnounced = true;
      const minutes = minutesUntil(Date.now() + delay);
      toast(
        t("notify-scholar-title"),
        rateLimited
          ? t("notify-scholar-rate-limited", { minutes })
          : t("notify-scholar-blocked", { minutes }),
      );
    }

    if (attempts >= SCHOLAR_MAX_ATTEMPTS) {
      // Retrying again would only add another automated request to the pile
      // Google is refusing. Say so once and stop.
      if (!this.scholarRetryPaused) {
        this.scholarRetryPaused = true;
        this.debug(
          `Google Scholar has refused ${attempts} attempts in a row; ` +
            `automatic retries stop until the user acts`,
        );
        toast(t("notify-scholar-title"), t("notify-scholar-paused"));
      }
      return;
    }

    this.scheduleScholarRetry(delay);
  }

  private scheduleScholarRetry(delayMs: number): void {
    if (this.scholarRetryTimer !== null) clearTimeout(this.scholarRetryTimer);
    this.scholarRetryTimer = setTimeout(() => {
      this.scholarRetryTimer = null;
      void this.retryBlockedScholar();
    }, delayMs);
  }

  /**
   * Clears the block and re-reads the items that were waiting on it.
   *
   * The backoff is cleared only when a request actually succeeds, so an item
   * that is still blocked simply books a longer wait.
   */
  private async retryBlockedScholar(): Promise<void> {
    if (this.disposed) return;
    this.scholarBlock = null;
    this.scholarBlockAnnounced = false;
    this.scholarBlockedItems.clear();

    // The refused papers never left the waiting list - the block only decided
    // when they may be tried again - so ending the block is letting their
    // deadlines go and carrying on with the same list, in the same order. This
    // used to re-read a set of its own, which is how a paper could sit on
    // "retrying now" while the retry went to somebody else.
    const now = Date.now();
    for (const entry of this.scholarQueue) {
      if (!entry.onBlock) continue;
      entry.onBlock = false;
      entry.notBefore = now;
    }

    await this.pumpScholarQueue();
  }

  /**
   * Stops waiting and tries now - the user pressed refresh, or answered the
   * check themselves.
   */
  private clearScholarBlock(): void {
    if (this.scholarRetryTimer !== null) {
      clearTimeout(this.scholarRetryTimer);
      this.scholarRetryTimer = null;
    }
    this.scholarBlock = null;
    this.scholarBlockAnnounced = false;
    this.scholarRetryPaused = false;
    this.scholarRound = 0;

    // The wait the block imposed is over for everyone it was imposed on.
    // Their own count stays - a paper that was refused is still a paper that
    // was asked, and its number is what the menu is for.
    const now = Date.now();
    for (const state of this.scholarItems.values()) {
      if (!state.onBlock) continue;
      state.onBlock = false;
      state.nextAttemptAt = now;
    }
    // The papers in the list are waiting on the same deadline, and it has just
    // been taken away: they are due again, and the pump below is what will
    // notice when it next looks.
    for (const entry of this.scholarQueue) {
      if (!entry.onBlock) continue;
      entry.onBlock = false;
      entry.notBefore = now;
    }
  }

  // -------------------------------------------------------------------------
  // The waiting list
  // -------------------------------------------------------------------------

  /**
   * Puts a paper in the waiting list, or hands back the place it already has.
   *
   * A repaint asks for the same read over and over, and the second ask is the
   * same ask: a paper already in the list keeps its place, and a paper already
   * being read keeps it too - the read that is on its way *is* the read. The
   * user's own refresh is the one exception. It becomes the newest ask and
   * goes to the head of the list, because that is where a person who has just
   * pressed the button expects their paper to be read, and it stops being an
   * entry that can be dropped for not being selected.
   */
  private queueScholarRead(
    item: Zotero.Item,
    kind: ScholarReadKind,
  ): ScholarQueueEntry | null {
    if (this.disposed) return null;

    const existing = this.scholarQueued.has(item.id)
      ? this.scholarQueue.find((entry) => entry.itemID === item.id)
      : undefined;
    if (existing) {
      if (kind === "user") {
        // The user asking again is a new ask, not a place in the list: a paper
        // waiting out a retry is tried when its owner presses refresh, not
        // when its deadline happens to pass. Both halves matter - the second
        // press of refresh used to be answered minutes later, by a notice the
        // user had stopped waiting for.
        existing.notBefore = null;
        existing.onBlock = false;
        // A paper that was queued on its own moves up to where the user's own
        // papers are read, behind the ones asked for before it.
        if (existing.kind !== "user") {
          existing.kind = "user";
          this.scholarQueue = this.scholarQueue.filter(
            (entry) => entry !== existing,
          );
          this.insertScholarEntry(existing);
        }
      }
      return existing;
    }

    const entry: ScholarQueueEntry = {
      itemID: item.id,
      kind,
      notBefore: null,
      onBlock: false,
      done: null,
    };
    // The user's papers line up ahead of the automatic reads and *behind* any
    // paper the user asked about a moment earlier: a batch is read in the order
    // it was named, which is the order the user is watching for.
    if (kind === "user") this.insertScholarEntry(entry);
    else this.scholarQueue.push(entry);
    this.scholarQueued.add(item.id);
    return entry;
  }

  /** Puts a user's paper at the end of the user's own run, ahead of the rest. */
  private insertScholarEntry(entry: ScholarQueueEntry): void {
    const firstAutomatic = this.scholarQueue.findIndex(
      (other) => other.kind !== "user",
    );
    if (firstAutomatic < 0) this.scholarQueue.push(entry);
    else this.scholarQueue.splice(firstAutomatic, 0, entry);
  }

  /** A repaint asking for a read: it joins the queue and waits its turn. */
  private queueAutomaticCitationRead(
    item: Zotero.Item,
    kind: "auto" | "stale",
  ): void {
    if (!this.queueScholarRead(item, kind)) return;
    void this.pumpScholarQueue();
  }

  /**
   * The user's own refresh, as the list sees it.
   *
   * The papers go to the head in the order they were named, and the promise
   * settles when each of them has had its turn - so the summary the menu shows
   * is written about reads that have actually happened.
   */
  private readCitationsThroughQueue(
    items: Zotero.Item[],
  ): Promise<Map<number, ScholarQueueResult>> {
    const results = new Map<number, ScholarQueueResult>();

    const waits = items.map(
      (item) =>
        new Promise<void>((resolve) => {
          const settle = (result: ScholarQueueResult): void => {
            results.set(item.id, result);
            resolve();
          };
          const entry = this.queueScholarRead(item, "user");
          if (!entry) {
            settle("skipped");
            return;
          }
          // A second ask for the same paper (the user pressing refresh twice)
          // must not silence the first one's answer.
          const previous = entry.done;
          entry.done = (result) => {
            previous?.(result);
            settle(result);
          };
        }),
    );

    void this.pumpScholarQueue();
    return Promise.all(waits).then(() => results);
  }

  /**
   * Serves the waiting list, one paper at a time.
   *
   * Single-flight: whoever calls it first walks the list, and the calls that
   * arrive while it does - a repaint, a timer, a block ending - are asking for
   * the same walk. Only one search is ever in the air, which is what "one list"
   * means to Google: the pace between two requests is the requester's, and it
   * starts counting from the last search.
   */
  private async pumpScholarQueue(): Promise<void> {
    if (this.scholarPumping || this.disposed) return;
    if (this.scholarQueueTimer !== null) {
      clearTimeout(this.scholarQueueTimer);
      this.scholarQueueTimer = null;
    }
    this.scholarPumping = true;

    try {
      for (;;) {
        if (this.disposed) break;

        const entry = this.nextScholarRead();
        if (!entry) {
          // Nothing is due: sleep until the earliest of the deadlines the
          // lines are showing. Sleeping on the papers' own clock is what makes
          // "retrying in about 5 minutes" true without a repaint. While Google
          // is refusing, nothing is due whatever the papers' own deadlines say,
          // and the block's own timer is the one that ends it.
          if (this.isScholarBlocked()) {
            this.settleScholarBatchForBlock();
            break;
          }
          const wake = this.nextScholarWakeMs();
          if (wake !== null) this.scheduleScholarQueueWake(wake);
          break;
        }

        // The rhythm comes before the read, not inside it. A request would
        // wait the same time inside the requester's own queue, but the paper
        // would sit under a "reading" label the whole while - and it is the
        // wait, not the read, that is happening.
        const rhythm = this.scholarRhythmMs();
        if (rhythm > 0) {
          this.scheduleScholarQueueWake(rhythm);
          break;
        }

        const item = this.itemForID(entry.itemID);
        if (!item) {
          this.dropScholarEntry(entry, "skipped");
          continue;
        }

        this.scholarReading = entry.itemID;
        const state = this.scholarItemState(entry.itemID);
        state.reading = true;
        let result: ScholarQueueResult = "failed";
        try {
          result = await this.populateCitations(item);
        } catch (error) {
          this.debug(
            `citation lookup failed for item ${entry.itemID}: ${error}`,
          );
        } finally {
          state.reading = false;
          this.scholarReading = null;
        }

        if (result === "failed" && this.isScholarBlocked()) {
          // The refusal is one episode, and this paper is the one it was
          // answered to: the rest of the user's batch is waiting, not failed.
          this.settleScholarBatchForBlock(entry);
        }
        this.finishScholarEntry(entry, result);
      }
    } finally {
      this.scholarPumping = false;
    }
  }

  /**
   * The paper whose turn it is: the first in the list that can be read now.
   *
   * A paper waiting out its own retry keeps its place and is passed over - it
   * must not hold up one that has never been tried, and the paper behind it
   * must not overtake anything that *is* ready, which is the rule the user
   * asked for: while anything is being read, nothing new starts. Entries that
   * no longer want a read at all leave the list here: the item is gone, its
   * records were cleared, it has nothing to look a count up with, or it was an
   * automatic read for a row the user is no longer on - that one comes back
   * the next time the row is painted while selected.
   */
  private nextScholarRead(): ScholarQueueEntry | null {
    const now = Date.now();
    if (this.isScholarBlocked()) return null;

    // Papers nobody wants any more leave the list wherever they stand. A
    // refresh waiting its turn must not wait behind one of them.
    for (const entry of [...this.scholarQueue]) {
      const item = this.itemForID(entry.itemID);
      if (!item || !this.scholarReadWanted(item, entry)) {
        this.dropScholarEntry(entry, "skipped");
      }
    }

    for (const entry of this.scholarQueue) {
      const due = entry.notBefore === null || entry.notBefore <= now;
      // One list, served in order, with one exception. A paper the user asked
      // for is read as soon as the rhythm allows, wherever it stands: the
      // press is the newest ask, and the row the user is watching is the one
      // that has to move. An automatic read waits for every paper in front of
      // it - the ones the user asked for, and the older ones waiting out a
      // retry - because that is what was asked for: a paper added while an
      // older one is waiting is read after that older paper has had its turn,
      // not beside it and not on the older paper's deadline.
      if (due && (entry.kind === "user" || entry === this.scholarQueue[0])) {
        return entry;
      }
    }

    return null;
  }

  /** Whether a paper in the list still wants the read it was queued for. */
  private scholarReadWanted(
    item: Zotero.Item,
    entry: ScholarQueueEntry,
  ): boolean {
    if (this.disposed) return false;
    // A cleared item is neutral, not empty: the user emptied it and nothing is
    // written back until they ask for the numbers again.
    if (this.isCleared(item)) return false;
    if (!this.hasCitationKey(item)) return false;
    // The rule that keeps Google Scholar out of rows nobody is reading: an
    // automatic read belongs to a selected row, and while that is not true
    // there is nothing worth asking about.
    if (entry.kind === "auto" && !this.scholarReadAllowed(item)) return false;
    return true;
  }

  /**
   * What became of a paper's turn.
   *
   * A read that produced a number is finished with the list. A failed one
   * stays - with its place and with the deadline every surface is already
   * showing - and the list's own timer comes back for it, so "自动重试" is a
   * thing that happens rather than a thing the line says.
   */
  private finishScholarEntry(
    entry: ScholarQueueEntry,
    result: ScholarQueueResult,
  ): void {
    const state = this.citationStates.get(entry.itemID);
    if (result === "read" || state?.kind !== "failed") {
      this.dropScholarEntry(entry, result);
      return;
    }

    entry.notBefore = state.retryAfter;
    entry.onBlock = this.isScholarBlocked();
    const done = entry.done;
    entry.done = null;
    done?.(result);
  }

  /** Takes a paper out of the list and answers whoever was waiting for it. */
  private dropScholarEntry(
    entry: ScholarQueueEntry,
    result: ScholarQueueResult,
  ): void {
    this.scholarQueue = this.scholarQueue.filter((item) => item !== entry);
    this.scholarQueued.delete(entry.itemID);

    // Nothing is coming for a paper that left the list, so a loading marker on
    // its row would be a spinner that never stops turning.
    if (this.citationStates.get(entry.itemID)?.kind === "loading") {
      this.citationStates.delete(entry.itemID);
    }
    if (!this.disposed) repaintRows([entry.itemID]);

    const done = entry.done;
    entry.done = null;
    done?.(result);
  }

  /**
   * Answers an explicit refresh whose remaining papers are waiting out a block.
   *
   * The papers keep their place in the list and are read the moment the check
   * clears - what settles here is the promise the refresh action is waiting on,
   * so the notice can say "3 could not be read, retrying in about 5 minutes"
   * rather than leaving the user with a menu that never comes back. Nothing was
   * asked of Google for these papers, and the wait the notice names is the one
   * the list will keep.
   */
  private settleScholarBatchForBlock(failed?: ScholarQueueEntry): void {
    const block = this.scholarBlock;
    if (!block) return;

    const retryAfter = Math.max(
      block.until,
      Date.now() + SCHOLAR_QUEUE_MIN_WAIT_MS,
    );
    const reason: FailureReason = block.rateLimited ? "http-429" : "http-403";

    for (const entry of this.scholarQueue) {
      // The paper whose search was refused is answered by its own read, and
      // says it failed. The papers behind it have not been asked about at all:
      // they are waiting out the same refusal, and the list comes back for
      // them when it ends. Reported: eleven waiting papers were announced as
      // 「11 条未能读取（保留原值，约 10 分钟后自动重试）」, which called them
      // failures and gave them a retry none of them had earned.
      if (entry === failed) continue;
      entry.onBlock = true;
      entry.notBefore = Math.max(entry.notBefore ?? 0, retryAfter);
      if (!entry.done) continue;

      this.citationStates.set(entry.itemID, {
        kind: "failed",
        retryAfter,
        reason,
      });
      const done = entry.done;
      entry.done = null;
      done("queued");
    }
  }

  /**
   * Milliseconds until the list has something to do, or null.
   *
   * Two kinds of moment matter: the deadline of the paper at the front, since
   * the list is served in order, and the deadline of any paper the user asked
   * for, since those are read as soon as the rhythm allows wherever they
   * stand. Everything behind the front paper waits for it, so its moment is
   * not one this method has to wake for.
   */
  private nextScholarWakeMs(): number | null {
    const now = Date.now();
    const front = this.scholarQueue[0];
    let soonest: number | null = null;
    for (const entry of this.scholarQueue) {
      const item = this.itemForID(entry.itemID);
      if (!item || !this.scholarReadWanted(item, entry)) continue;
      if (entry.notBefore === null) continue;
      if (entry !== front && entry.kind !== "user") continue;
      const wait = Math.max(0, entry.notBefore - now);
      if (soonest === null || wait < soonest) soonest = wait;
    }
    return soonest;
  }

  /**
   * How long the next request has to wait for the reading rhythm: the spacing
   * between two searches and the pause after a burst of them, whichever is
   * longer.
   *
   * Read from the requester, which is where the rhythm is enforced, so the
   * pump and the lines in the menu cannot disagree about when a paper's turn
   * comes.
   */
  private scholarRhythmMs(): number {
    return Math.max(0, this.requester.scholarActivity().nextInMs);
  }

  /** Wakes the pump when a deadline passes, and not a moment before. */
  private scheduleScholarQueueWake(delayMs: number): void {
    if (this.disposed) return;
    if (this.scholarQueueTimer !== null) clearTimeout(this.scholarQueueTimer);
    this.scholarQueueTimer = setTimeout(
      () => {
        this.scholarQueueTimer = null;
        void this.pumpScholarQueue();
      },
      Math.max(SCHOLAR_QUEUE_MIN_WAIT_MS, delayMs),
    );
  }

  /** The item behind an id, or null once it is gone. */
  private itemForID(itemID: number): Zotero.Item | null {
    try {
      return Zotero.Items.get(itemID) || null;
    } catch {
      return null;
    }
  }

  /**
   * Throws away the Google session the reads have been going through.
   *
   * The block is what the plugin saw; the cookies are what Google remembers
   * about this client. A jar Google has marked keeps being answered with `429`
   * however slowly the reads are paced - the same search in the browser next
   * to it, on the same machine and address, opens normally - so dropping the
   * jar is the closest thing to arriving as a browser that was never here.
   * It is the user's decision to make, hence a menu entry, and it is reported
   * back so the notice can say what happened.
   */
  /**
   * Clears Google's cookies from Zotero's jar and re-reads the selected rows.
   *
   * There is no menu entry for this any more: the plugin does it by itself
   * when a read comes back blocked, which is the only time it helps. It stays
   * callable so the automatic path and the tests have one implementation.
   */
  async resetGoogleSession(): Promise<{ cookies: number; items: number }> {
    const cookies = clearGoogleCookies();
    this.clearScholarBlock();
    // Starting over means starting over: the next Google request opens the
    // site's front page again, which is where a browser picks up the cookies
    // Google gives it, and the consent cookie is written again (it went out
    // with the jar). Without this the plugin retried a search with an empty
    // jar - a client Google has never seen, which is exactly what "unusual
    // traffic" is reserved for.
    this.requester.restartGoogleSession();

    const items = [...this.scholarBlockedItems]
      .map((id) => Zotero.Items.get(id))
      .filter((item): item is Zotero.Item => Boolean(item));
    this.scholarBlockedItems.clear();

    if (items.length && !this.disposed) await this.refreshCitations(items);

    this.debug(
      `[AlphaPulse] 已清除 ${cookies} 个 Google Cookie 并重试 ${items.length} 个条目`,
    );
    return { cookies, items: items.length };
  }

  /**
   * Wraps the per-item plan so an empty cell can explain itself.
   *
   * While Google Scholar is waiting out a human check every cell that has no
   * number yet - loading, failed or genuinely absent - reads the same: "none
   * yet", with a tooltip saying why and when the next attempt is. Leaving the
   * spinner or a bare N/A there would look like a paper without citations.
   */
  planCitationCell(item: Zotero.Item): CitationCellPlan {
    if (!this.isTopLevelRow(item)) {
      return {
        value: "",
        text: "",
        count: null,
        highImpact: false,
        source: null,
      };
    }
    const plan = this.planCitationCellFor(item);
    // Feed the citation percentile population, like `planCell` does for likes.
    if (plan.count !== null) this.observedCitations.set(item.id, plan.count);
    if (plan.count !== null) return plan;
    return this.blockedCitationPlan() ?? plan;
  }

  private blockedCitationPlan(): CitationCellPlan | null {
    if (!this.isScholarBlocked()) return null;

    return {
      value: withValueDecorations(CELL_UNAVAILABLE, [CITATIONS_BLOCKED_MARKER]),
      text: CELL_UNAVAILABLE,
      count: null,
      highImpact: false,
      source: null,
    };
  }

  private planCitationCellFor(item: Zotero.Item): CitationCellPlan {
    if (this.isCleared(item)) {
      return {
        value: CELL_CLEARED,
        text: CELL_CLEARED,
        count: null,
        highImpact: false,
        source: null,
      };
    }

    const prefs = getCitationPrefs();
    if (!prefs.enabled)
      return {
        value: "",
        text: "",
        count: null,
        highImpact: false,
        source: null,
      };

    if (this.refreshingCitations.has(item.id)) {
      return {
        value: CELL_LOADING,
        text: CELL_LOADING,
        count: null,
        highImpact: false,
        source: null,
      };
    }

    const extra = safeGetField(item, "extra");
    const cached = readCitations(extra);

    if (this.readingLikes(item.id)) {
      // The likes column is being refreshed; this column is not part of that.
      // The stored number still shows - it is what the row had - but nothing
      // starts a read from here: not the cell, and not the background refresh
      // an expired value would otherwise schedule.
      if (cached) return this.citationPlanFrom(cached);
      return {
        value: "",
        text: "",
        count: null,
        highImpact: false,
        source: null,
      };
    }

    if (cached) {
      this.citationStates.delete(item.id);
      if (this.isCitationCacheStale(extra, prefs.cacheTtlDays)) {
        this.scheduleCitationRefresh(item);
      }
      return this.citationPlanFrom(cached);
    }

    const state = this.citationStates.get(item.id);
    if (state) {
      if (state.kind === "success") return this.citationPlanFrom(state.counts);
      if (state.kind === "loading") {
        return {
          value: CELL_LOADING,
          text: CELL_LOADING,
          count: null,
          highImpact: false,
          source: null,
        };
      }
      if (state.kind === "cancelled") {
        // The user emptied the waiting list. Re-queueing here would put the
        // paper straight back on it the next time the row is painted, which is
        // the opposite of what the button did.
        return {
          value: withValueDecorations(CELL_UNAVAILABLE, [
            SCHOLAR_CANCELLED_MARKER,
          ]),
          text: CELL_UNAVAILABLE,
          count: null,
          highImpact: false,
          source: null,
        };
      }
      if (state.kind === "absent") {
        // Scholar answered and has no paper with this title. That is the
        // answer, so the cell states it - no wait, no retry, and no request
        // spent again on the next repaint. A refresh clears it, which is how
        // the user asks again.
        return {
          value: withValueDecorations(CELL_UNAVAILABLE, ["no-match"]),
          text: CELL_UNAVAILABLE,
          count: null,
          highImpact: false,
          source: null,
        };
      }
      if (state.retryAfter > Date.now()) {
        // A failed citation read used to blank the cell, which is
        // indistinguishable from a paper with no citations anywhere: it says
        // "N/A" and carries the reason for the tooltip instead.
        return {
          value: withValueDecorations(
            CELL_UNAVAILABLE,
            failureDecorations(state.reason, state.retryAfter),
          ),
          text: CELL_UNAVAILABLE,
          count: null,
          highImpact: false,
          source: null,
        };
      }
    }

    if (!this.disposed && this.hasCitationKey(item)) {
      if (!this.scholarReadAllowed(item)) {
        // Blank, with the reason in the tooltip: this is a decision the plugin
        // made, not a failure, and it says how to get the number.
        return {
          value: withValueDecorations(CELL_UNAVAILABLE, ["not-selected"]),
          text: CELL_UNAVAILABLE,
          count: null,
          highImpact: false,
          source: null,
        };
      }

      this.citationStates.set(item.id, { kind: "loading" });
      // The queue, not a read of its own: this row's turn may be behind the
      // papers already waiting, which is exactly what a newly added paper must
      // not be allowed to jump.
      this.queueAutomaticCitationRead(item, "auto");
      return {
        value: CELL_LOADING,
        text: CELL_LOADING,
        count: null,
        highImpact: false,
        source: null,
      };
    }

    return {
      value: "",
      text: "",
      count: null,
      highImpact: false,
      source: null,
    };
  }

  private citationPlanFrom(counts: CitationCounts): CitationCellPlan {
    const order = citationOrder();
    const count = primaryCitationCount(counts, order);
    if (count === null) {
      return {
        value: "",
        text: "",
        count: null,
        highImpact: false,
        source: null,
      };
    }

    // A typed number is the user's own, and the tooltip says so rather than
    // naming whichever provider happens to hold the same count.
    const manual = counts.manual === true && counts.googleScholar !== undefined;
    const primary = manual ? null : primaryCitationSource(counts, order);
    const highImpact = isHighImpact(counts);

    return {
      // `1` asks the renderer for the high-impact marker; the provider key that
      // follows becomes the tooltip's "source" line.
      value: withValueDecorations(toSortableValue(count), [
        ...(highImpact ? [1] : []),
        ...(manual ? ["manual"] : primary ? [primary] : []),
      ]),
      text: String(count),
      count,
      highImpact,
      source: manual ? null : primary ? CITATION_SOURCE_LABELS[primary] : null,
    };
  }

  /**
   * Whether there is anything to look this paper's citations up with.
   *
   * An identifier is the sure way: it names one paper exactly. A title is the
   * other way, and the one Google Scholar is read with in the first place - so
   * a paper the user added by hand, with nothing but its title on it, is read
   * like any other. Reported: a paper with no DOI, no arXiv ID and no URL,
   * whose count was looked up by title, and whose answer came back as "1 item
   * is missing a DOI/arXiv ID".
   */
  private hasCitationKey(item: Zotero.Item): boolean {
    if (safeGetField(item, "DOI").trim()) return true;
    if (this.getItemArxivID(item) !== null) return true;
    const title = safeGetField(item, "title")?.trim() ?? "";
    return title.length >= CITATION_TITLE_MIN_LENGTH;
  }

  private isCitationCacheStale(extra: string, ttlDays: number): boolean {
    if (!ttlDays) return false;

    const updatedAt = readCitationsUpdatedAt(extra);
    if (!updatedAt) return true;
    return Date.now() - updatedAt.getTime() > ttlDays * 86_400_000;
  }

  private scheduleCitationRefresh(item: Zotero.Item): void {
    if (this.disposed) return;
    if (this.citationStates.get(item.id)?.kind === "loading") return;

    this.citationStates.set(item.id, { kind: "loading" });
    this.queueAutomaticCitationRead(item, "stale");
  }

  private async populateCitations(
    item: Zotero.Item,
  ): Promise<Exclude<ScholarQueueResult, "skipped">> {
    const arxivID = this.getItemArxivID(item);
    // The user typed this item's score by hand, which they did because the
    // plugin could not get it. Asking Google Scholar anyway would spend a
    // request on a number that is going to be thrown away.
    const manual = readCitations(safeGetField(item, "extra"))?.manual === true;

    try {
      const { counts, noMatch } = await this.fetchCitations(
        item,
        arxivID,
        manual,
      );
      if (this.disposed) return "failed";

      // Scholar answered that it has no paper with this title. Nothing is
      // booked for later and nothing is written: asking again would find the
      // same nothing, and the user is told what was found instead - which is
      // what they asked for.
      if (counts === null && noMatch && !this.isScholarBlocked()) {
        this.citationStates.set(item.id, { kind: "absent" });
        this.noteScholarOutcome(item.id, { ok: true });
        this.debug(
          `[AlphaPulse] Google Scholar has no paper like ${JSON.stringify(
            safeGetField(item, "title"),
          )}; the cell says so instead of promising a retry`,
        );
        return "missing";
      }

      if (counts === null) {
        const blocked = this.isScholarBlocked();
        if (blocked) this.scholarBlockedItems.add(item.id);
        // A paper that is waiting out Google's check is waiting for the same
        // moment as the notice that announced it, and for the same moment as
        // every other paper that was refused with it: one deadline, so the
        // popup, the tooltip and the menu say the same number of minutes.
        const retryAfter = blocked
          ? Math.max(this.scholarBlock?.until ?? 0, Date.now() + 1_000)
          : Date.now() + ERROR_RETRY_DELAY_MS;
        const reason: FailureReason = blocked
          ? this.getScholarBlockStatus().rateLimited
            ? "http-429"
            : "http-403"
          : "no-count";
        this.citationStates.set(item.id, {
          kind: "failed",
          retryAfter,
          // The block's own reason is carried through: a rate limit (429) and
          // a refusal (403) are not the same failure to report.
          reason,
        });
        this.noteScholarOutcome(item.id, {
          ok: false,
          reason,
          retryAfter,
          onBlock: blocked,
        });
        return "failed";
      }

      this.citationStates.set(item.id, { kind: "success", counts });
      // The paper has its number, so its count starts over from nothing.
      this.noteScholarOutcome(item.id, { ok: true });
      await this.writeExtra(item, (extra) => upsertCitations(extra, counts));
      return "read";
    } catch (error) {
      if (!this.disposed) {
        const reason = failureReasonFrom(error);
        const retryAfter = Date.now() + ERROR_RETRY_DELAY_MS;
        this.citationStates.set(item.id, {
          kind: "failed",
          retryAfter,
          reason,
        });
        this.noteScholarOutcome(item.id, {
          ok: false,
          reason,
          retryAfter,
          onBlock: false,
        });
        this.debug(`citation lookup failed for item ${item.id}: ${error}`);
      }
      return "failed";
    } finally {
      // Same as the like column: this item's answer is shown the moment it is
      // read, while the items still being read keep their loading marker.
      this.refreshingCitations.delete(item.id);
      if (!this.disposed) repaintRows([item.id]);
    }
  }

  /**
   * Merges whatever the enabled providers can tell us.
   *
   * Semantic Scholar is asked by DOI or arXiv ID and is skipped silently when
   * it rate-limits. OpenAlex answers precisely for a DOI; without one it is
   * searched by title, and a hit is only trusted when its title matches and
   * its year is within a year of ours, because OpenAlex carries duplicate and
   * mis-attributed records that a naive "first result" would accept.
   */
  private fetchCitations(
    item: Zotero.Item,
    arxivID: string | null,
    manual = false,
  ): Promise<{ counts: CitationCounts | null; noMatch: boolean }> {
    const paper = this.readPaperMetadata(item);
    const key = `${paper.doi || ""}|${arxivID || ""}|${normalizeText(paper.title)}`;

    const existing = this.inFlightCitations.get(key);
    if (existing) return existing;

    // A picked Scholar result replaces the title we search Scholar for; the
    // cache key stays the item's own metadata so the pin survives a rename.
    const scholarTitle = readScholarTitle(safeGetField(item, "extra"));

    const request = this.collectCitations(
      item.id,
      paper,
      arxivID,
      scholarTitle,
      manual,
    ).finally(() => this.inFlightCitations.delete(key));

    this.inFlightCitations.set(key, request);
    return request;
  }

  private async collectCitations(
    itemID: number,
    paper: PaperMetadata,
    arxivID: string | null,
    scholarTitle: string | null,
    manual = false,
  ): Promise<{ counts: CitationCounts | null; noMatch: boolean }> {
    const prefs = getResolverPrefs();

    // Every selected provider is asked; the column then shows the largest
    // count among the ones that answered. A provider that fails or has no
    // record simply does not contribute - it is never replaced by another.
    //
    // They are asked at the same time, not one after the other: the sources
    // are different sites with their own queues, and Google Scholar is by far
    // the slowest of them (a page load, a five second spacing, and a refusal
    // that books a wait nobody wants to sit through twice). Asking in turn
    // made OpenAlex and Semantic Scholar - which answer in a moment - wait
    // behind it for no reason at all.
    // Whether Google Scholar answered that it has no paper like this one. It is
    // not a failure and not a count: it is what the user is told, and it only
    // stands while no other provider found the paper.
    let noMatch = false;

    const tasks = citationOrder().map(async (source) => {
      if (source === "googleScholar") {
        // The item carries a number the user typed; Scholar is not asked, and
        // the merge keeps the typed one.
        if (manual) return null;
        const scholar = await this.collectGoogleScholarCitation(
          itemID,
          paper,
          scholarTitle,
        );
        if (scholar === null) return null;
        if (scholar.kind === "no-match") {
          noMatch = true;
          return null;
        }
        return { googleScholar: scholar.count };
      }

      if (source === "semanticScholar") {
        const url = semanticScholarCitationURL({
          doi: paper.doi,
          arxivID: arxivID ?? undefined,
        });
        if (!url) return null;

        const payload = await this.safeJSON("Semantic Scholar citations", url);
        return citationCountsFromSemanticScholar(payload);
      }

      return this.collectOpenAlexCitations(paper, prefs);
    });

    const answers = await Promise.all(tasks);

    let merged: CitationCounts = {};
    let answered = false;
    for (const counts of answers) {
      if (!counts) continue;
      merged = { ...merged, ...counts };
      answered = true;
    }

    return {
      counts: answered ? merged : null,
      noMatch: answered ? false : noMatch,
    };
  }

  /**
   * Reads Google Scholar's "Cited by" count.
   *
   * Scholar has no API, so the public results page is fetched and the first
   * result whose title resembles the item's is used. A block page (consent
   * interstitial, captcha, rate limit) stops the attempt, tells the user once,
   * and books a retry with a doubling wait - hammering Scholar is the fastest
   * way to stay blocked. No other provider is substituted for the missing
   * number; the cell says the count is waiting instead.
   */
  private async collectGoogleScholarCitation(
    itemID: number,
    paper: PaperMetadata,
    pinnedTitle: string | null,
  ): Promise<ScholarCitationRead> {
    const expected = (pinnedTitle || paper.title || "").trim();
    if (expected.length < CITATION_TITLE_MIN_LENGTH) return null;
    if (this.isScholarBlocked()) return null;

    const url = googleScholarCitationSearchURL(expected);

    // Two ways in: a real page load in Zotero's hidden browser, then a plain
    // request. Scholar answers a browser and refuses an XMLHttpRequest from the
    // same address with the same cookies, so the attempt that looks like a
    // browser is tried first and the one that works is remembered.
    // A search is about to leave for this paper: this is the moment its own
    // count goes up, and the moment a failure will be attributed to it.
    this.noteScholarAttempt(itemID);

    let page: { status: number; body: string; via: ScholarPath | null };
    try {
      page = await this.requester.requestScholarPage(url);
    } catch (error) {
      this.debug(`Google Scholar citations failed: ${error}`);
      return null;
    }
    if (page.via) {
      this.debug(`Google Scholar citations read by ${page.via}`);
    }

    // The page decides, not the status.
    //
    // Reported: a paper whose search page carried a "Cited by" link was
    // answered with 「未能读取（保留原值，约 10 分钟后自动重试）」, and every
    // paper behind it stopped too, because a refusal is a wait for the whole
    // list. A page that carries a result set, or the "Cited by" line of one,
    // is proof the search came back: whatever the transport reported about the
    // status, this was a read and not a robot check. A block is booked only
    // when there is no such evidence.
    const evidence =
      isGoogleScholarResultsPage(page.body) ||
      googleScholarCitedByEvidence(page.body);

    if (CITATION_REJECTED_STATUSES.has(page.status) && !evidence) {
      this.noteScholarBlock(url, isRateLimitStatus(page.status));
      return null;
    }
    if (!evidence && (page.status < 200 || page.status >= 300)) return null;

    // A 200 can still be an interstitial - the consent page in particular
    // arrives with a perfectly ordinary status.
    if (!page.body) return null;

    if (!evidence) {
      // Nothing on the page says a search happened, so it is judged the old
      // way: a consent or captcha page books the wait, anything else is a read
      // that came back empty and is simply tried again.
      if (
        googleScholarCitationCount(page.body) === -1 ||
        isGoogleInterstitial(page.body)
      ) {
        this.noteScholarBlock(url);
      }
      return null;
    }

    // The search came back, so whatever Google thought of the last one is over.
    this.clearScholarBlock();

    // The count belongs to the result whose title agrees with the item's, and
    // it is read from that result's own block: the first count on the page
    // belongs to the first result, and the first result is not always the
    // paper that was asked about.
    const blocks = googleScholarResultBlocks(page.body);
    const ranked = blocks
      .map((block) => ({
        block,
        title: googleScholarResultTitle(block),
      }))
      .filter((entry) => entry.title)
      .map((entry) => ({
        ...entry,
        similarity: titleSimilarity(expected, entry.title),
      }))
      .filter((entry) => entry.similarity >= CITATION_TITLE_MATCH_MIN)
      .sort((a, b) => b.similarity - a.similarity);

    if (!ranked.length) {
      // Results, and none of them is this paper - or a result set with nothing
      // in it. Either way Scholar has no paper by this name, which the user is
      // told rather than being left waiting for a retry that would find the
      // same nothing.
      if (blocks.length || isGoogleScholarResultsPage(page.body)) {
        return { kind: "no-match" };
      }
      // A count without a result set around it: no way to tell whose it is, so
      // it is not adopted and the read is tried again later.
      return null;
    }

    // A result with no "Cited by" line is a paper nobody has cited yet. Zero
    // is a count like any other - the same rule the like count follows, and
    // the reported case was a paper found by its title alone whose count of
    // zero came back as "no number on the page".
    const count = ranked
      .map((entry) => googleScholarResultCount(entry.block))
      .find((value) => value !== null);
    return { kind: "count", count: count ?? 0 };
  }

  private async collectOpenAlexCitations(
    paper: PaperMetadata,
    prefs: { contactEmail: string; titleSearchResults: number },
  ): Promise<CitationCounts | null> {
    const byDoi = openAlexCitationURL({
      doi: paper.doi,
      contactEmail: prefs.contactEmail,
    });

    if (byDoi) {
      const payload = await this.safeJSON("OpenAlex citations", byDoi);
      const info = openAlexWorkInfo(payload);
      if (info) return info.counts;
    }

    // No DOI, or the DOI is not indexed: fall back to a verified title search.
    if (!paper.title || paper.title.length < CITATION_TITLE_MIN_LENGTH) {
      return null;
    }

    const payload = await this.safeJSON(
      "OpenAlex citation search",
      openAlexCitationSearchURL(paper.title, {
        perPage: Math.min(5, Math.max(2, prefs.titleSearchResults)),
        contactEmail: prefs.contactEmail,
      }),
    );

    for (const info of openAlexSearchResults(payload)) {
      if (titleSimilarity(paper.title, info.title) < CITATION_TITLE_MATCH_MIN) {
        continue;
      }
      if (!isSameYearOrAdjacent(paper.year, info.year)) continue;
      return info.counts;
    }

    return null;
  }

  /** Fetches a page as text, logging failures instead of aborting the merge. */
  /**
   * Runs a page request, logging failures instead of letting them abort the
   * merge. Unlike `safeText` the status survives, so a refusal can be told
   * apart from a page that simply carried nothing.
   */
  private async safePage(
    label: string,
    url: string,
    accept?: string,
  ): Promise<{ status: number; body: string } | null> {
    try {
      return await this.requester.requestPage(url, accept);
    } catch (error) {
      this.debug(`${label} failed: ${error}`);
      return null;
    }
  }

  private async safeText(
    label: string,
    url: string,
    accept?: string,
  ): Promise<string | null> {
    try {
      return accept
        ? await this.requester.requestText(url, accept)
        : await this.requester.requestText(url);
    } catch (error) {
      this.debug(`${label} failed: ${error}`);
      return null;
    }
  }

  /** Runs a request, logging failures instead of letting them abort the merge. */
  private async safeJSON(label: string, url: string): Promise<unknown> {
    try {
      return await this.requester.requestJSON(url);
    } catch (error) {
      this.debug(`${label} failed: ${error}`);
      return null;
    }
  }

  /**
   * Re-reads citation counts, ignoring the cached value and any cooldown.
   *
   * Separate from the like-count refresh on purpose: the two move on very
   * different timescales, and a user who wants fresh citations does not
   * necessarily want to re-read every like count as well. A pending Scholar
   * block is dropped first, because asking is exactly what this action means.
   */
  async refreshCitations(items: Zotero.Item[]): Promise<RefreshSummary> {
    // The user asking for these entries is a new episode: whatever Google said
    // last time, this attempt starts from an empty hand. The automatic retry
    // does not do this - it is the second, third and fourth attempt of the same
    // episode, and that is what the stop-after-four rule counts.
    this.clearScholarBlock();
    return this.readCitations(items);
  }

  private async readCitations(items: Zotero.Item[]): Promise<RefreshSummary> {
    this.readScope = "citations";
    this.scopeItems = new Set(items.filter(Boolean).map((item) => item.id));
    try {
      return await this.readCitationsScoped(items);
    } finally {
      this.readScope = null;
      this.scopeItems = null;
    }
  }

  private async readCitationsScoped(
    items: Zotero.Item[],
  ): Promise<RefreshSummary> {
    const targets = items.filter(Boolean);
    const summary: RefreshSummary = {
      total: targets.length,
      updated: 0,
      failed: 0,
      skipped: 0,
      missing: 0,
    };
    if (!targets.length) return summary;

    // Asking for the counts is exactly the signal that lifts a clear.
    this.reviveItems(targets);

    for (const item of targets) {
      this.citationStates.delete(item.id);
      this.refreshingCitations.add(item.id);
    }
    repaintRows(targets.map((item) => item.id));

    try {
      // Through the one waiting list, at the head of it: the papers the user
      // named are read as soon as the search that is in the air is done and
      // the rhythm allows another, and not one moment before - the pace is
      // Google's, not the button's.
      const results = await this.readCitationsThroughQueue(targets);
      for (const item of targets) {
        if (this.disposed) break;
        const result = results.get(item.id);
        if (result === "read") summary.updated += 1;
        else if (result === "missing") {
          summary.missing = (summary.missing ?? 0) + 1;
        } else if (result === "skipped") summary.skipped += 1;
        else if (result === "queued") {
          // Waiting its turn, not failed: 「已加入等待列表」 rather than
          // 「未能读取」, which would promise a retry that belongs to nobody.
          summary.queued = (summary.queued ?? 0) + 1;
        } else {
          summary.failed += 1;
          const retry = this.retryMinutesFor(item);
          if (retry !== null) {
            summary.retryMinutes =
              summary.retryMinutes === undefined
                ? retry
                : Math.min(summary.retryMinutes, retry);
          }
        }
        // One row at a time, like the likes: the entry that has been read
        // shows its number while the ones behind it are still reading.
        if (!this.disposed) repaintRows([item.id]);
      }
    } finally {
      for (const item of targets) this.refreshingCitations.delete(item.id);
      if (!this.disposed) repaintRows(targets.map((item) => item.id));
    }

    return summary;
  }

  private computeCellValue(item: Zotero.Item): string {
    // An attachment or snapshot under a paper is not the paper: its URL may
    // carry an arXiv ID, but the number belongs to the parent row only.
    if (!this.isTopLevelRow(item)) return "";

    // A cleared item is left alone. Reading it again would put the deleted
    // lines straight back into `Extra` on the next repaint.
    if (this.isCleared(item)) return CELL_CLEARED;

    const arxivID = this.getItemArxivID(item);
    if (arxivID) return this.cellForKnownID(item, arxivID);

    if (!getPref("autoResolveNonArxiv")) return "";
    if (!this.isReadableItem(item)) return "";

    if (!this.canResolve(item)) {
      // Nothing to match a paper on: no arXiv ID anywhere, no title long
      // enough to search with, and no DOI or date to corroborate one. Asking
      // is not possible, so there is no like count to be had - and the cell
      // says which nothing this is instead of going on about a missing
      // identifier, which is what the user reported seeing.
      this.itemStates.set(item.id, { kind: "absent" });
      return withValueDecorations(CELL_UNAVAILABLE, [NO_ALPHAXIV_MARKER]);
    }

    return this.cellForUnknownID(item);
  }

  private cellForKnownID(item: Zotero.Item, arxivID: string): string {
    // An explicit refresh ignores the stored value until the new one is here,
    // so the user can see that something is happening.
    if (this.refreshingLikes.has(item.id)) return CELL_LOADING;

    const extra = safeGetField(item, "extra");
    const cached = readCachedLikes(extra);

    if (cached !== null) {
      if (this.isCacheStale(extra) && !this.readingCitations(item.id)) {
        this.scheduleStaleRefresh(item, arxivID);
      }
      this.itemStates.delete(item.id);
      return toSortableValue(cached);
    }

    const state = this.itemStates.get(item.id);
    if (state) {
      if (state.kind === "success" && state.arxivID === arxivID) {
        return toSortableValue(state.likes);
      }
      if (state.kind === "loading") return CELL_LOADING;
      // Nothing to show and nothing to wait for: the paper is not on alphaXiv,
      // and the tooltip is where that is said.
      if (state.kind === "absent") {
        return withValueDecorations(CELL_UNAVAILABLE, [NO_ALPHAXIV_MARKER]);
      }
      if (state.kind === "failed" && state.retryAfter > Date.now()) {
        // The reason rides along with the value: it is the only channel the
        // renderer has, and a blank cell on its own says nothing about what to
        // fix or how long to wait.
        return withValueDecorations(
          CELL_UNAVAILABLE,
          failureDecorations(state.reason, state.retryAfter),
        );
      }
      // A failed lookup whose cooldown elapsed falls through and is retried.
    }

    if (!this.disposed && !this.readingCitations(item.id)) {
      this.itemStates.set(item.id, { kind: "loading" });
      void this.populateLikes(item, arxivID);
    }
    return CELL_LOADING;
  }

  private cellForUnknownID(item: Zotero.Item): string {
    // Resolving an item ends in a like read, so it belongs to the likes column
    // and not to a citation refresh - of this item. A paper the batch never
    // named is read as soon as its row is painted, which is what adding a
    // paper is supposed to do.
    if (this.readingCitations(item.id)) return "";

    const state = this.itemStates.get(item.id);

    if (state) {
      if (state.kind === "success") return toSortableValue(state.likes);
      if (state.kind === "loading") return CELL_LOADING;
      // Looked for and not there: an answer, not a read to keep trying.
      if (state.kind === "absent") {
        return withValueDecorations(CELL_UNAVAILABLE, [NO_ALPHAXIV_MARKER]);
      }
      if (state.retryAfter > Date.now()) {
        return withValueDecorations(
          CELL_UNAVAILABLE,
          failureDecorations(state.reason, state.retryAfter),
        );
      }
    }

    if (!this.disposed) {
      this.itemStates.set(item.id, { kind: "loading" });
      void this.resolveItem(item);
    }
    return CELL_LOADING;
  }

  /**
   * Whether this row is a paper at all.
   *
   * A note, an attachment or a row of any other kind is not something alphaXiv
   * could hold, so nothing is read for it and nothing is claimed about it.
   */
  /**
   * Whether this row is a top-level library item rather than an attachment or
   * note shown under one. Child rows never display a like or citation count.
   */
  private isTopLevelRow(item: Zotero.Item): boolean {
    try {
      if (typeof item.isRegularItem === "function" && !item.isRegularItem()) {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }

  private isReadableItem(item: Zotero.Item): boolean {
    try {
      if (typeof item.isRegularItem === "function" && !item.isRegularItem()) {
        return false;
      }
    } catch {
      return false;
    }

    return RESOLVABLE_ITEM_TYPES.has(item.itemType);
  }

  private canResolve(item: Zotero.Item): boolean {
    if (!this.isReadableItem(item)) return false;
    if (safeGetField(item, "title").trim().length < MIN_TITLE_LENGTH) {
      return false;
    }

    // Require at least one corroborating signal beyond the title so that
    // unrelated items never trigger network traffic.
    return Boolean(
      safeGetField(item, "DOI").trim() || safeGetField(item, "date").trim(),
    );
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  /** Whether the last read found nothing to read: no paper, no record. */
  private isAbsent(item: Zotero.Item): boolean {
    return this.itemStates.get(item.id)?.kind === "absent";
  }

  getItemArxivID(item: Zotero.Item): string | null {
    return extractArxivID(
      safeGetField(item, "url"),
      safeGetField(item, "extra"),
      safeGetField(item, "DOI"),
    );
  }

  readPaperMetadata(item: Zotero.Item): PaperMetadata {
    return {
      title: safeGetField(item, "title").trim(),
      doi: normalizeDoi(safeGetField(item, "DOI")),
      authors: this.readAuthors(item),
      year: yearFromDate(safeGetField(item, "date")),
      extra: safeGetField(item, "extra"),
    };
  }

  private readAuthors(item: Zotero.Item): string[] {
    try {
      if (typeof item.getCreators !== "function") return [];

      return (item.getCreators() || [])
        .map((creator) => rawCreatorName(creator))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private resolutionKey(paper: PaperMetadata): string {
    if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
    return `title:${normalizeText(paper.title)}`;
  }

  // -------------------------------------------------------------------------
  // Likes
  // -------------------------------------------------------------------------

  private isCacheStale(extra: string): boolean {
    const { cacheTtlDays } = getRequestPrefs();
    if (!cacheTtlDays) return false;

    const updatedAt = readLikesUpdatedAt(extra);
    if (!updatedAt) return true;
    return Date.now() - updatedAt.getTime() > cacheTtlDays * 86_400_000;
  }

  /**
   * Re-fetches an expired value in the background while the stale number stays
   * visible, so enabling the TTL never blanks the column.
   */
  private scheduleStaleRefresh(item: Zotero.Item, arxivID: string): void {
    if (this.disposed || this.staleRefreshing.has(item.id)) return;
    this.staleRefreshing.add(item.id);

    void this.populateLikes(item, arxivID, { force: true }).finally(() => {
      this.staleRefreshing.delete(item.id);
    });
  }

  private async populateLikes(
    item: Zotero.Item,
    arxivID: string,
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    try {
      const likes = await this.fetchLikes(arxivID, { fresh: options.force });
      if (this.disposed) return false;

      // The item may have been edited while waiting in the paced queue.
      if (this.getItemArxivID(item) !== arxivID) {
        this.itemStates.delete(item.id);
        return false;
      }

      if (likes === null) {
        this.itemStates.set(item.id, {
          kind: "failed",
          retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
          reason: "no-count",
        });
        return false;
      }

      this.itemStates.set(item.id, { kind: "success", arxivID, likes });
      this.observedLikes.set(item.id, likes);

      const { historyDays } = getTrendPrefs();
      await this.writeExtra(item, (extra) =>
        // The snapshot is what makes `2979 ↑12` possible on a later run.
        recordLikesSnapshot(
          upsertLikesCache(extra, likes),
          likes,
          new Date(),
          historyDays,
        ),
      );
      return true;
    } catch (error) {
      if (!this.disposed) {
        // A 404 is alphaXiv saying it has no page for this paper - an answer,
        // like the resolver finding no match. Everything else (a 5xx, a dead
        // network, a page whose markup moved) is a failed read and keeps the
        // old value with a retry.
        if (isNotFoundError(error)) {
          this.itemStates.set(item.id, { kind: "absent" });
          this.debug(`alphaXiv has no record of ${arxivID}`);
        } else {
          this.itemStates.set(item.id, {
            kind: "failed",
            retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
            reason: failureReasonFrom(error),
          });
          this.debug(`failed to fetch likes for ${arxivID}: ${error}`);
        }
      }
      return false;
    } finally {
      // The number is in `Extra` by now, so the cell leaves the loading marker
      // here - per item - instead of when the whole batch has finished. A
      // refresh of twenty items fills in twenty times, not once at the end,
      // and a like count never waits for the citations of the same item.
      this.refreshingLikes.delete(item.id);
      if (!this.disposed) repaintRows([item.id]);
      if (options.force) this.staleRefreshing.delete(item.id);
    }
  }

  /**
   * Concurrent requests for the same paper share one network round trip.
   *
   * An explicit refresh is the exception: it was asked for by the user, and
   * "it read again" has to be true, so it starts its own request instead of
   * joining one that a repaint happened to start a moment earlier.
   */
  private fetchLikes(
    arxivID: string,
    options: { fresh?: boolean } = {},
  ): Promise<number | null> {
    const existing = this.inFlightLikes.get(arxivID);
    if (existing && !options.fresh) return existing;

    const request = this.requester
      .requestHTML(buildAlphaXivURL(arxivID))
      .then((doc) => parseLikesFromDocument(doc))
      .finally(() => {
        // Only the newest request owns the entry: an older one finishing
        // later must not clear it.
        if (this.inFlightLikes.get(arxivID) === request) {
          this.inFlightLikes.delete(arxivID);
        }
      });

    this.inFlightLikes.set(arxivID, request);
    return request;
  }

  // -------------------------------------------------------------------------
  // arXiv ID resolution
  // -------------------------------------------------------------------------

  private resolverDeps(): ResolverDeps {
    return {
      requestJSON: (url: string) => this.requester.requestJSON(url),
      requestXML: (url: string) => this.requester.requestXML(url),
      prefs: getResolverPrefs(),
      debug: (message: string) => this.debug(message),
    };
  }

  private async getCandidatesForPaper(
    paper: PaperMetadata,
    force: boolean,
  ): Promise<ArxivCandidate[]> {
    const key = this.resolutionKey(paper);

    if (!force) {
      const cached = this.resolutionCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.candidates;
    }

    const inFlight = this.inFlightResolution.get(key);
    if (inFlight) return inFlight;

    const request = findArxivCandidates(paper, this.resolverDeps())
      .then((candidates) => {
        const ttl = candidates.length
          ? RESOLUTION_CACHE_TTL_SUCCESS_MS
          : RESOLUTION_CACHE_TTL_MISS_MS;
        this.resolutionCache.set(key, {
          candidates,
          createdAt: Date.now(),
          expiresAt: Date.now() + ttl,
        });
        return candidates;
      })
      .finally(() => this.inFlightResolution.delete(key));

    this.inFlightResolution.set(key, request);
    return request;
  }

  /**
   * Runs the resolver for arbitrary metadata (used by the picker dialog).
   *
   * `minScore` lowers the display floor for the manual picker: the automatic
   * path hides weak matches on purpose, while a user looking at the list is
   * the right judge of a match the scorer was unsure about.
   */
  async searchArxiv(
    paper: PaperMetadata,
    options: { minScore?: number } = {},
  ): Promise<ArxivCandidate[]> {
    const key = this.resolutionKey(paper);
    const request = findArxivCandidates(paper, this.resolverDeps(), options)
      .then((candidates) => {
        this.resolutionCache.set(key, {
          candidates,
          createdAt: Date.now(),
          expiresAt: Date.now() + RESOLUTION_CACHE_TTL_SUCCESS_MS,
        });
        return candidates;
      })
      .finally(() => this.inFlightResolution.delete(key));

    const inFlight = this.inFlightResolution.get(key);
    if (inFlight) return inFlight;

    this.inFlightResolution.set(key, request);
    return request;
  }

  private async resolveItem(
    item: Zotero.Item,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const paper = this.readPaperMetadata(item);

    try {
      const candidates = await this.getCandidatesForPaper(
        paper,
        options.force ?? false,
      );
      if (this.disposed) return;

      // Another window may have resolved the item in the meantime.
      if (this.getItemArxivID(item)) return;

      const best = candidates[0];

      // Only a high-confidence match is adopted. A medium one is deliberately
      // treated as "no match": there is no manual confirmation step any more,
      // and silently adopting a maybe would put a wrong paper's number in the
      // column with nothing on screen to say so.
      if (best?.confidence === "high") {
        await this.applyArxivID(item, best.arxivID);
        return;
      }

      // No paper in the index matches this item closely enough, which is an
      // answer about the item rather than a failure of the read: there is
      // nothing to retry, and the column says so in the tooltip instead of
      // promising a wait that would end in the same nothing.
      this.itemStates.set(item.id, { kind: "absent" });
    } catch (error) {
      this.debug(`arXiv lookup failed for item ${item.id}: ${error}`);
      this.itemStates.set(item.id, {
        kind: "failed",
        retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
        reason: failureReasonFrom(error),
      });
    } finally {
      if (!this.disposed) repaintRows([item.id]);
    }
  }

  // -------------------------------------------------------------------------
  // The read diagnostic
  // -------------------------------------------------------------------------

  /**
   * Makes one real attempt at each read for what is selected, and writes down
   * everything that decided the outcome.
   *
   * "It does not read" cannot be fixed from a distance: the answer depends on
   * the machine's network, its proxy settings, and what the two sites choose to
   * do with that particular address. The report is meant to be pasted into a
   * message, so it carries the exact URLs, the exact headers, the status, the
   * exception and the opening characters of each answer - plus the settings
   * that decide where the reads go at all.
   *
   * It never touches the cache: a probe failure cannot cost the user a count.
   */
  async diagnose(items?: Zotero.Item[]): Promise<string> {
    // An explicit list wins even when it is empty: the caller knows what is
    // selected, and a test can ask for "nothing".
    const chosen = items ?? this.selectedItems();
    const targets = chosen.slice(0, 2);
    const itemLines: string[] = [];
    const probes: HttpProbe[] = [];
    const notes: string[] = [];

    if (!targets.length) {
      notes.push("没有选中任何条目：请在条目列表里选中一篇论文再运行诊断。");
    }
    if (chosen.length > 2) {
      notes.push("只诊断了前 2 个条目。");
    }

    for (const item of targets) {
      const arxivID = this.getItemArxivID(item);
      const title = safeGetField(item, "title").trim();
      const extra = safeGetField(item, "extra");
      const cached = readCachedLikes(extra);

      itemLines.push(`「${title}」（id ${item.id}，${item.itemType}）`);
      itemLines.push(
        `   arXiv ID：${arxivID ?? "（没有）"}；已清除：${
          this.isCleared(item) ? "是" : "否"
        }；点赞缓存：${cached ?? "无"}；引用缓存：${
          readCitations(extra) ? "有" : "无"
        }`,
      );

      if (this.isCleared(item)) {
        // Without this line the report shows a healthy request next to a blank
        // column, which reads like a contradiction.
        notes.push(
          `「${title}」被清除过：列里保持空白、也不会自动读取，这是设计如此；` +
            `选中它点一次「刷新 alphaXiv 点赞」或「刷新引用数」即可恢复。`,
        );
      }
      if (!arxivID) {
        notes.push(`「${title}」没有 arXiv ID，点赞数无法查询。`);
      } else {
        probes.push(await this.probeLikes(arxivID));
      }

      const searchTitle = (readScholarTitle(extra) || title).trim();
      if (searchTitle.length < 10) {
        notes.push(`「${title}」的标题太短，无法拿去 Google Scholar 检索。`);
      } else {
        probes.push(await this.probeScholar(searchTitle));
      }
    }

    for (const probe of probes) this.explainProbe(probe, notes);

    // The difference the plugin cannot see for itself, and the one that is
    // left once everything it sends has been made to match a browser: an
    // extension or VPN routes the browser and not the application, so the
    // browser's Google session is fine while the plugin's address is limited.
    const exitIP = await this.safeText("出口 IP", EXIT_IP_URL).catch(
      () => null,
    );
    if (exitIP) {
      const address = readExitIP(exitIP);
      if (address) {
        notes.push(
          `Zotero 的出口 IP：${address}。在浏览器里打开 ${EXIT_IP_URL} ` +
            `对比一下：如果两边不一样，说明日常浏览器走了代理或 VPN 扩展、` +
            `而 Zotero 没有——这正是"浏览器能打开、插件被限流"的直接原因，` +
            `把 Zotero 也指到同一条线路即可（设置 → 高级 → 网络 → 代理）。`,
        );
      }
    }

    // The one thing header work cannot answer: whether the reads are refused
    // for what they send or for who has been sending them. Both paths are read
    // through the engine Zotero already uses, so the numbers show what a
    // Firefox-based client looks like from this machine - the user can open
    // the same page in their own browser and compare.
    const fingerprints = await this.readFingerprints();

    const sourcePrefs =
      getCitationSourcePreferences().join(",") || "（未选择）";
    const settings = [
      `引用来源：${sourcePrefs}`,
      `引用列：${getCitationPrefs().enabled ? "显示" : "隐藏"}，缓存 ${
        getCitationPrefs().cacheTtlDays
      } 天`,
      `自动匹配非 arXiv 条目：${
        getPref("autoResolveNonArxiv") ? "开" : "关"
      }（自动采用阈值 ${getPref("autoAcceptPercent")}%）`,
      `请求间隔 ${getPref("requestIntervalMs")}ms，超时 ${getPref(
        "requestTimeoutMs",
      )}ms，点赞缓存 ${
        getPref("cacheTtlDays") === 0
          ? "不自动过期"
          : `${getPref("cacheTtlDays")} 天`
      }`,
      `Zotero 里 scholar.google.com 的 cookie：${
        cookieNames("scholar.google.com").join("、") || "（没有）"
      }`,
      (() => {
        const browser = hiddenBrowserClass();
        return `Google 读取方式：浏览器页面加载优先${
          browser.constructor
            ? "（可用）"
            : `（不可用：${browser.error ?? "原因未知"}）`
        }，失败时改用直接请求；本次会话当前用${
          this.requester.scholarReadPath() === "browser"
            ? "浏览器页面加载"
            : "直接请求"
        }`;
      })(),
    ];

    // The session's opening request says whether Google is limiting the address
    // itself or only this search - the first is not something a retry fixes.
    const warmup = this.requester.sessionWarmup();
    if (warmup) {
      notes.push(
        `本次会话打开 Scholar 首页（用来拿到 Google 自己的 cookie）：${
          warmup.status === null
            ? `失败 - ${warmup.error ?? "未知错误"}`
            : `HTTP ${warmup.status}`
        }`,
      );
    }

    if (this.isScholarBlocked()) {
      const status = this.getScholarBlockStatus();
      notes.push(
        `Google Scholar 正在等待期：约 ${Math.max(
          1,
          status.minutesLeft,
        )} 分钟后重试（第 ${status.attempts} 次；原因：${
          status.rateLimited
            ? "这个地址被限流（429/503）"
            : "要求人机验证（403）"
        }）。`,
      );
    }

    notes.push(
      "诊断只做上面写出的这几次真实请求：点赞与引用各测一次，这是它自己的动作，" +
        "与右键的刷新无关——「刷新 alphaXiv 点赞」和「刷新引用数」互不影响，各读各的。",
    );
    notes.push(
      "这份报告只包含这些真实请求的结果，不会改动任何缓存或设置；把整段贴回来即可。",
    );

    const agent =
      (Zotero.getMainWindow() as unknown as Window | null)?.navigator
        ?.userAgent ?? "";

    const input: DiagnosisInput = {
      pluginVersion: String(pkg.version),
      zoteroVersion: Zotero.version,
      gecko: /rv:(\d+)/.exec(agent)?.[1] ?? "未知",
      platform: String(
        (Services as unknown as { appinfo?: { OS?: string } })?.appinfo?.OS ??
          "未知",
      ),
      proxy: describeProxy(),
      consentCookie: googleConsentStored(),
      itemCount: targets.length,
      items: itemLines,
      settings,
      probes,
      fingerprints,
      notes,
    };

    return formatDiagnosis(input);
  }

  /**
   * The fingerprint self-check, when the requester can run it.
   *
   * The tests replace the requester with a plain object that answers for the
   * reads a test cares about; asking it for a fingerprint would fail the whole
   * diagnostic over a section that is extra credit, so a missing method means
   * the section is simply left out.
   */
  private async readFingerprints(): Promise<FingerprintReading[]> {
    const requester = this.requester as PacedRequester & {
      probeFingerprint?: () => Promise<FingerprintReading[]>;
    };
    if (typeof requester.probeFingerprint !== "function") return [];

    try {
      return await requester.probeFingerprint();
    } catch (error) {
      this.debug(`[AlphaPulse] 指纹自检失败：${String(error)}`);
      return [];
    }
  }

  /** One line of advice per probe that needs it. */
  private explainProbe(probe: HttpProbe, notes: string[]): void {
    const status = probe.status ?? 0;
    if (!probe.label.includes("Scholar")) return;

    const attempts = probe.attempts ?? [];
    const browser = attempts.find((attempt) => attempt.via === "browser");
    const request = attempts.find((attempt) => attempt.via === "xhr");
    const worked = (attempt?: { usable: boolean }) => Boolean(attempt?.usable);

    // The comparison is the diagnosis: a page that opens like a browser and a
    // request that is refused means the site is judging the client, and the
    // plugin has just switched to the path that is judged acceptable.
    if (worked(browser) && !worked(request)) {
      notes.push(
        "同一个地址、同一批 cookie：用浏览器方式打开页面能读到结果，用普通请求会被拒。" +
          "插件已记住这一点，之后直接走浏览器方式，不再发那种会被拒的请求。",
      );
    }
    if (browser && browser.status === null && browser.error) {
      notes.push(`浏览器方式不可用：${browser.error}。`);
    }
    if (worked(request) && !worked(browser)) {
      notes.push(
        "这次是普通请求读到的（浏览器方式没有结果）；插件会继续用它，直到浏览器方式重新可用。",
      );
    }

    if (status === 429 || status === 503) {
      notes.push(
        "Google 这次给的是 429/503（按地址限流），不是 403（人机验证）：" +
          "这类限制对同一个地址上的所有程序都生效，浏览器里做同样的搜索也会被挡，" +
          "等待通常比换办法更快恢复。插件会按 10 分钟起翻倍重试，这期间不再打扰 Google。",
      );
      if (getCitationSourcePreferences().length <= 1) {
        notes.push(
          "现在只勾选了 Google Scholar。被限流期间一个数字都拿不到，可在设置里把" +
            "「OpenAlex」「Semantic Scholar」一起勾上：勾选多个来源时，插件会查询全部、" +
            "显示其中最大的数字，并不会拿别家数字冒充 Google Scholar。",
        );
      }
    }
    if (status === 403) {
      notes.push(
        "Google 这次给的是 403：这是人机验证页，右键 →「打开 Google Scholar 验证页」" +
          "可以在浏览器里自己完成一次，回来点「刷新引用数」即可立刻重试。",
      );
    }
  }

  private selectedItems(): Zotero.Item[] {
    try {
      const win = Zotero.getMainWindow();
      const pane = (
        win as unknown as {
          ZoteroPane?: { getSelectedItems?: () => Zotero.Item[] };
        }
      ).ZoteroPane;
      return pane?.getSelectedItems?.() ?? [];
    } catch {
      return [];
    }
  }

  /** One alphaXiv page fetch, described for the report. */
  private async probeLikes(arxivID: string): Promise<HttpProbe> {
    const attempt = await this.probePage(
      buildAlphaXivURL(arxivID),
      "text/html,application/xhtml+xml",
      "alphaXiv 点赞",
    );
    if (attempt.status === null) return attempt.probe;

    const likes = parseLikesFromDocument(parseHTMLBody(attempt.body));
    attempt.probe.verdict =
      likes === null
        ? "页面能打开，但里面没有点赞数（页面结构可能变了）"
        : `读到点赞数 ${likes}`;
    return attempt.probe;
  }

  /**
   * One Scholar search, described for the report - through both paths.
   *
   * The comparison is the point: when a browser load answers and a request is
   * refused, the site is refusing the *client*, and the plugin can do something
   * about that. When both are refused, it is the address, and no amount of
   * header work will change it.
   */
  private async probeScholar(title: string): Promise<HttpProbe> {
    const url = googleScholarCitationSearchURL(title);
    const probe: HttpProbe = {
      label: "Google Scholar 引用数",
      url,
      userAgent: browserUserAgent(),
      status: null,
      error: null,
      bodyLength: 0,
      bodyHead: "",
      verdict: "",
      attempts: [],
    };

    let page: ScholarPage;
    try {
      page = await this.requester.requestScholarPage(url, { compare: true });
    } catch (error) {
      probe.error = error instanceof Error ? error.message : String(error);
      probe.verdict = "请求没有发出去／没有回应";
      return probe;
    }

    probe.attempts = page.attempts;
    probe.status = page.status || null;
    probe.bodyLength = page.body.length;
    // When neither path got a page the winner has no body - but a refusal page
    // is exactly the one worth quoting, so the head of the attempt that did
    // answer is used instead.
    probe.bodyHead = page.body
      ? trimBodyHead(page.body)
      : (page.attempts.find((attempt) => attempt.bodyHead)?.bodyHead ?? "");

    if (page.via === null) {
      const status = page.status;
      if (status >= 400) {
        probe.verdict = isRateLimitStatus(status)
          ? `HTTP ${status} — 两种读取方式都被限流（按地址）`
          : `HTTP ${status} — 两种读取方式都被拒绝（按人机验证处理）`;
      } else {
        probe.verdict = "两种读取方式都没有拿到页面";
      }
      return probe;
    }

    const how = page.via === "browser" ? "浏览器页面加载" : "直接请求";
    const count = googleScholarCitationCount(page.body);
    const hits = googleScholarResultBlocks(page.body).length;
    if (isGoogleInterstitial(page.body) && hits === 0) {
      probe.verdict = `${how}：人机验证 / 同意页（里面没有结果）`;
    } else if (hits > 0) {
      probe.verdict = `${how}：结果页${hits} 个结果，第一个 Cited by ${
        count ?? "未解析"
      }`;
    } else {
      probe.verdict = `${how}：既不是结果页也不是验证页`;
    }
    return probe;
  }

  /** One GET, with whatever came back written down either way. */
  private async probePage(
    url: string,
    accept: string,
    label: string,
  ): Promise<{ probe: HttpProbe; body: string; status: number | null }> {
    const host = hostOf(url);
    const probe: HttpProbe = {
      label,
      url,
      userAgent: userAgentFor(host),
      status: null,
      error: null,
      bodyLength: 0,
      bodyHead: "",
      verdict: "",
    };

    try {
      const page = await this.requester.requestPage(url, accept);
      probe.status = page.status;
      if (page.userAgent) probe.userAgent = page.userAgent;
      probe.bodyLength = page.body.length;
      probe.bodyHead = trimBodyHead(page.body);
      if (page.status >= 400) {
        probe.verdict = `HTTP ${page.status}（正文开头就是服务器返回的内容）`;
      }
      return { probe, body: page.body, status: page.status };
    } catch (error) {
      probe.error = error instanceof Error ? error.message : String(error);
      probe.verdict = "请求没有发出去／没有回应";
      return { probe, body: "", status: null };
    }
  }

  // -------------------------------------------------------------------------
  // Public actions (context menu)
  // -------------------------------------------------------------------------

  /** Stores a confirmed arXiv ID and immediately fetches its like count. */
  async applyArxivID(item: Zotero.Item, arxivID: string): Promise<void> {
    await this.writeExtra(item, (extra) =>
      upsertResolvedArxivID(extra, arxivID),
    );

    this.itemStates.delete(item.id);
    repaintRows([item.id]);

    await this.populateLikes(item, arxivID, { force: true });
  }

  /**
   * Re-reads like counts, ignoring the cached value and any failure cooldown.
   *
   * Items without an arXiv ID get another resolution attempt. The cached count
   * stays in `Extra` while this runs - a failed re-read must not cost a number
   * that was correct a minute ago - but the cells are held on the loading
   * marker so the refresh is visible instead of looking like nothing happened.
   */
  async refreshItems(items: Zotero.Item[]): Promise<RefreshSummary> {
    this.readScope = "likes";
    this.scopeItems = new Set(items.filter(Boolean).map((item) => item.id));
    try {
      return await this.refreshLikesScoped(items);
    } finally {
      this.readScope = null;
      this.scopeItems = null;
    }
  }

  private async refreshLikesScoped(
    items: Zotero.Item[],
  ): Promise<RefreshSummary> {
    const targets = items.filter(Boolean);
    const summary: RefreshSummary = {
      total: targets.length,
      updated: 0,
      failed: 0,
      skipped: 0,
    };
    if (!targets.length) return summary;

    // An explicit refresh is also how a cleared item comes back: the user is
    // asking for the counts, which is a different thing from the column
    // silently re-reading them.
    this.reviveItems(targets);

    for (const item of targets) {
      this.itemStates.delete(item.id);
      this.staleRefreshing.delete(item.id);
      this.refreshingLikes.add(item.id);

      if (!this.getItemArxivID(item)) {
        this.resolutionCache.delete(
          this.resolutionKey(this.readPaperMetadata(item)),
        );
      }
    }
    repaintRows(targets.map((item) => item.id));

    try {
      for (const item of targets) {
        if (this.disposed) break;

        const arxivID = this.getItemArxivID(item);
        if (arxivID) {
          const updated = await this.populateLikes(item, arxivID, {
            force: true,
          });
          // alphaXiv answering "no page for this paper" is a result, not a
          // failure: it is counted as a miss, and the popup says the paper is
          // not there rather than promising a retry.
          if (this.isAbsent(item)) summary.missing = (summary.missing ?? 0) + 1;
          else if (updated) summary.updated += 1;
          else {
            summary.failed += 1;
            const retry = this.retryMinutesFor(item);
            if (retry !== null) {
              summary.retryMinutes =
                summary.retryMinutes === undefined
                  ? retry
                  : Math.min(summary.retryMinutes, retry);
            }
          }
        } else {
          await this.resolveItem(item, { force: true });
          // A newly resolved ID already fetched its count on the way in.
          if (this.getItemArxivID(item)) summary.updated += 1;
          else if (this.isAbsent(item))
            summary.missing = (summary.missing ?? 0) + 1;
          else summary.skipped += 1;
        }
        if (!this.disposed) repaintRows([item.id]);
      }
    } finally {
      for (const item of targets) this.refreshingLikes.delete(item.id);
      if (!this.disposed) repaintRows(targets.map((item) => item.id));
    }

    return summary;
  }

  /**
   * Removes every line AlphaPulse wrote into `Extra`.
   *
   * Strictly scoped: only the lines this plugin owns (`alphaxiv_*`, matched by
   * `stripAlphaLikesData`) are removed, so a user's own notes, `tex.*` keys or
   * another tool's records survive the action untouched. Nothing but `Extra`
   * is written - no preference is reset and no column is re-configured.
   *
   * The items are marked as cleared as well, because this plugin reads a count
   * again the moment it has none: without the mark the next repaint would put
   * back exactly what the user just deleted. `refreshItems` and
   * `refreshCitations` lift the mark for the items they are given.
   */
  async clearItems(items: Zotero.Item[]): Promise<ClearSummary> {
    const targets = items.filter(Boolean);
    const summary: ClearSummary = {
      total: targets.length,
      cleared: 0,
      alreadyEmpty: 0,
    };
    if (!targets.length) return summary;

    const set = this.cleared();

    // Marks first, strips second. A read that is already in flight writes
    // through the same guard, so marking first is what stops it from putting
    // the deleted lines back a moment later; the strip itself goes through the
    // guard on purpose (`force`), because these are exactly the items the
    // guard is meant to refuse for everything else.
    for (const item of targets) set.add(item.id);
    writeClearedItemIDs([...set]);

    for (const item of targets) {
      const before = safeGetField(item, "extra");
      await this.writeExtra(item, stripAlphaLikesData, { force: true });

      // A write that had already passed the guard when the mark went in can
      // still land between the strip's read and its save. One more pass leaves
      // the item the way the user asked for it, whatever the race did.
      if (hasAlphaLikesData(safeGetField(item, "extra"))) {
        await this.writeExtra(item, stripAlphaLikesData, { force: true });
      }

      if (safeGetField(item, "extra") === before) summary.alreadyEmpty += 1;
      else summary.cleared += 1;

      this.itemStates.delete(item.id);
      this.citationStates.delete(item.id);
      this.refreshingLikes.delete(item.id);
      this.refreshingCitations.delete(item.id);
      this.staleRefreshing.delete(item.id);
      this.observedLikes.delete(item.id);
      this.observedCitations.delete(item.id);
    }

    this.quantileCache = null;
    this.citationQuantileCache = null;
    repaintRows(targets.map((item) => item.id));
    return summary;
  }

  /**
   * Writes the citation count the user typed, or clears their entry.
   *
   * `null` hands the item back to the automatic read. The number goes into the
   * same record the reads write, marked as typed, so the column, the tooltip,
   * the sort and "clear data" all work on it unchanged.
   */
  async setManualCitations(
    items: Zotero.Item[],
    count: number | null,
  ): Promise<{ items: number }> {
    let written = 0;

    for (const item of items) {
      try {
        await this.writeExtra(item, (extra) =>
          writeManualCitations(extra, count),
        );
        const counts = readCitations(safeGetField(item, "extra"));
        if (counts)
          this.citationStates.set(item.id, { kind: "success", counts });
        else this.citationStates.delete(item.id);
        written += 1;
      } catch (error) {
        this.debug(`could not write the manual citation for item ${item.id}`);
        throw error;
      }
    }

    this.citationQuantileCache = null;
    repaintRows(items.map((item) => item.id));
    return { items: written };
  }

  private async writeExtra(
    item: Zotero.Item,
    update: (extra: string) => string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    // The one choke point every write goes through, so a lookup that was
    // already in flight when the user cleared the item cannot land afterwards.
    // `force` is for the clear action itself, which has to write to exactly
    // those items.
    if (!options.force && this.isCleared(item)) return;

    const current = safeGetField(item, "extra");
    const next = update(current);
    if (next === current) return;

    try {
      item.setField("extra", next);
      await item.saveTx();
    } catch (error) {
      // A read-only (or group) library still benefits from the in-memory value.
      this.debug(
        `could not update ${ARXIV_ID_KEY} for item ${item.id}: ${error}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private onPrefChanged(name: string): void {
    if (this.disposed) return;

    // The list of cleared items can be edited outside the running service
    // (a second window, the preferences pane of a future version), so the
    // cached copy has to go when it changes.
    if (name === "clearedItemIDs") this.clearedItems = null;

    if (name === "requestTimeoutMs" || name === "requestIntervalMs") {
      const { timeoutMs, intervalMs } = getRequestPrefs();
      this.requester.setOptions({ timeoutMs, intervalMs });
    }

    // Colour mode and the percentile cut-offs are derived, so the memo has to
    // go or the column would keep the previous ranking.
    if (
      name === "colorMode" ||
      name === "quantileLowPercent" ||
      name === "quantileHighPercent" ||
      name === "historyDays"
    ) {
      this.quantileCache = null;
      this.citationQuantileCache = null;
    }

    // Colouring, filtering and thresholds only change the presentation, so a
    // repaint is enough. Resolution switches also reset cached state.
    if (
      name === "autoResolveNonArxiv" ||
      name === "confirmPercent" ||
      name === "autoAcceptPercent"
    ) {
      this.itemStates.clear();
    }

    // Turning citation lookups on has to start from a clean slate, and turning
    // them off should stop the pending work from repainting.
    if (name === "citationsEnabled" || name === "citationCacheTtlDays") {
      this.citationStates.clear();
      this.inFlightCitations.clear();
    }

    refreshItemTrees();
  }

  /**
   * Whether the user is looking at this item, with a short memory.
   *
   * A repaint asks for every visible row in one burst, and the answer decides
   * whether Google Scholar may be read for that row, so the selection is read
   * once per burst instead of once per row.
   */
  private isSelected(item: Zotero.Item): boolean {
    const now = Date.now();
    if (!this.selectionCache || now - this.selectionCache.at > 500) {
      const ids = new Set<number>();
      for (const win of Zotero.getMainWindows()) {
        try {
          const pane = (
            win as unknown as {
              ZoteroPane?: { getSelectedItems?: () => Zotero.Item[] };
            }
          ).ZoteroPane;
          for (const selected of pane?.getSelectedItems?.() ?? []) {
            ids.add(selected.id);
          }
        } catch {
          // A window that is closing has no pane to ask.
        }
      }
      this.selectionCache = { at: now, ids };
    }
    return this.selectionCache.ids.has(item.id);
  }

  /**
   * Whether an automatic read would spend a Google Scholar request.
   *
   * Google is the one source that answers this plugin's automatic traffic with
   * a rate limit, and the automatic traffic is every row the list repaints -
   * a library of a few hundred entries is a few hundred searches, which is a
   * block in a minute. The cheap sources (OpenAlex, Semantic Scholar) do not
   * mind and stay automatic; Google Scholar is read for the selected items and
   * for the items an explicit refresh names, which is also the traffic the user
   * themselves asked for.
   */
  private scholarReadAllowed(item: Zotero.Item): boolean {
    return !this.usesGoogleScholar() || this.isSelected(item);
  }

  /** Minutes until this item is tried again, when a failed read set a time. */
  private retryMinutesFor(item: Zotero.Item): number | null {
    const state =
      this.itemStates.get(item.id) ?? this.citationStates.get(item.id);
    if (!state || state.kind !== "failed") return null;
    return minutesUntil(state.retryAfter);
  }

  /** Whether this item's like count is being read by a running refresh. */
  private readingLikes(itemID: number): boolean {
    return this.readScope === "likes" && this.isInScope(itemID);
  }

  /** Whether this item's citation count is being read by a running refresh. */
  private readingCitations(itemID: number): boolean {
    return this.readScope === "citations" && this.isInScope(itemID);
  }

  /**
   * Whether the running refresh covers this item.
   *
   * A refresh that did not name its items covers everything, which is the
   * cautious reading - it is only ever a refresh that exists.
   */
  private isInScope(itemID: number): boolean {
    return this.scopeItems === null || this.scopeItems.has(itemID);
  }

  private usesGoogleScholar(): boolean {
    return getCitationSourcePreferences().includes("googleScholar");
  }

  private debug(message: string): void {
    Zotero.debug(`[AlphaPulse] ${message}`);
  }

  dispose(): void {
    this.disposed = true;
    this.requester.dispose();
    this.itemStates.clear();
    this.resolutionCache.clear();
    this.inFlightLikes.clear();
    this.inFlightResolution.clear();
    this.inFlightCitations.clear();
    this.staleRefreshing.clear();
    this.citationStates.clear();
    this.scholarItems.clear();
    this.observedLikes.clear();
    this.observedCitations.clear();
    this.quantileCache = null;
    this.citationQuantileCache = null;

    // The waiting list goes with the plugin. Whoever is waiting on a turn in
    // it is answered, because a refresh that never comes back is worse than
    // one that says the reading was dropped.
    if (this.scholarQueueTimer !== null) {
      clearTimeout(this.scholarQueueTimer);
      this.scholarQueueTimer = null;
    }
    for (const entry of [...this.scholarQueue]) {
      this.dropScholarEntry(entry, "skipped");
    }
    this.scholarQueued.clear();

    this.clearScholarBlock();
    this.scholarBlockedItems.clear();
    this.stopObservingPrefs?.();
    this.stopObservingPrefs = null;
  }
}
