/**
 * Regression tests for the two refresh actions.
 *
 * The reported case: 「刷新 alphaXiv 点赞」 looked like it did nothing, while
 * 「清除」 visibly re-read the counts - because the stored number stayed in the
 * cell for the whole request, so a refresh that came back with the same figure
 * was indistinguishable from one that never ran. These tests drive the real
 * service against a stubbed network, which is the only way to tell "the count
 * really was re-read" from "the count happened to be the same".
 */

import { assert } from "chai";
import { trimBodyHead } from "../src/modules/http";
import { getService } from "../src/modules/column";
import { upsertLikesCache } from "../src/modules/arxiv-id";
import {
  fromSortableValue,
  CELL_LOADING,
  CELL_UNAVAILABLE,
} from "../src/modules/likes";
import { renderLikeCell } from "../src/modules/column";
import { CITATIONS_BLOCKED_MARKER } from "../src/modules/citations";
import { getPref, setPref } from "../src/modules/prefs";

/** A page shaped like the alphaXiv paper view. */
function alphaXivPage(likes: number): Document {
  const win = Zotero.getMainWindow() as unknown as Window;
  const html =
    `<html><body><button aria-label="Like this paper">` +
    `<span class="inline-block">${likes}</span></button></body></html>`;
  return new win.DOMParser().parseFromString(html, "text/html");
}

/**
 * The page alphaXiv serves for a paper with no likes yet.
 *
 * Same as `alphaXivPage` minus the number: the live site renders the like
 * button with its icon and nothing else, which is how it writes zero.
 */
function alphaXivPageWithoutCount(): Document {
  const win = Zotero.getMainWindow() as unknown as Window;
  const html =
    `<html><body><button aria-label="Like this paper">` +
    `<svg aria-hidden="true"></svg></button></body></html>`;
  return new win.DOMParser().parseFromString(html, "text/html");
}

/** A Scholar results page whose first hit is the item itself. */
function scholarPage(count: number, title: string): string {
  return `
    <div class="gs_r gs_or gs_scl"><div class="gs_ri">
      <h3 class="gs_rt"><a href="/url?q=https://example.org/p">${title}</a></h3>
      <div class="gs_fl"><a href="/scholar?cites=1">Cited by ${count}</a></div>
    </div></div>`;
}

interface Stub {
  served: string[];
  likes: number;
  scholar: number;
  /** Title of the single Scholar hit the stub serves. */
  scholarTitle: string;
  failLikes: boolean;
  /** HTTP status the alphaXiv request answers with, or null for a page. */
  likesStatus: number | null;
  /** The citation count an OpenAlex answer carries. */
  openAlex: number;
  /** Serve the page alphaXiv serves for a paper with no likes yet. */
  pageWithoutCount: boolean;
  failScholar: boolean;
  /** HTTP status the Scholar request answers with. */
  scholarStatus: number;
  /** Set to hold the next request open until `release` is called. */
  hold: boolean;
  /** Hold the Scholar read alone, without touching the other hosts. */
  holdScholar: boolean;
  /** Releases the held Scholar read. */
  releaseScholar: (() => void) | null;
  /** Every gate currently held open, so a test can let a whole batch finish. */
  pendingGates: Array<() => void>;
  /** Releases all of them. */
  releaseAll: () => void;
  /**
   * With `hold`, the number of requests that still answer immediately: the
   * first ones land, the ones after that wait. Used to watch a batch fill in
   * row by row.
   */
  holdAfter: number | null;
  release: (() => void) | null;
}

function stubRequester(service: unknown, likes: number, scholar = 0): Stub {
  const state: Stub = {
    served: [],
    likes,
    scholar,
    scholarTitle: "AlphaLikes refresh probe paper",
    failLikes: false,
    likesStatus: null,
    openAlex: 5,
    pageWithoutCount: false,
    failScholar: false,
    scholarStatus: 200,
    hold: false,
    holdAfter: null,
    release: null,
    holdScholar: false,
    releaseScholar: null,
    pendingGates: [],
    releaseAll: () => undefined,
  };
  const target = service as { requester: Record<string, unknown> };
  const previous = target.requester;

  function gate(): Promise<void> {
    if (!state.hold) return Promise.resolve();
    if (state.holdAfter !== null && state.served.length <= state.holdAfter) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      state.pendingGates.push(resolve);
      state.release = resolve;
    });
  }

  target.requester = {
    ...previous,
    // The service asks what the session's opening Google request answered; a
    // stub has no such history.
    sessionWarmup: () => null,
    // It also asks the requester how long the reading rhythm has left to run -
    // the waiting list paces itself on the same clock the requests use - and
    // spreading an instance does not carry its methods across.
    scholarActivity: () => ({
      requests: 0,
      nextInMs: 0,
      paused: false,
      burstLeft: 1,
    }),
    requestHTML: async (url: string) => {
      state.served.push(url);
      await gate();
      // alphaXiv answers a paper it has no page for with a 404; the requester
      // turns that status into this message, and the service reads it as "this
      // paper is not on alphaXiv" rather than as a failed read.
      if (state.likesStatus !== null) {
        throw new Error(
          // The message `requestHTML` builds from a status; the host is not
          // what the service reads, the status is.
          `HTTP ${state.likesStatus} from www.alphaxiv.org`,
        );
      }
      if (state.failLikes) throw new Error("service unavailable");
      return state.pageWithoutCount
        ? alphaXivPageWithoutCount()
        : alphaXivPage(state.likes);
    },
    requestJSON: async (url: string) => {
      state.served.push(url);
      await gate();
      // OpenAlex's own answer shape, which is all a cheap-source read needs.
      return {
        cited_by_count: state.openAlex,
        title: state.scholarTitle,
        doi: "https://doi.org/10.1234/alphalikes.probe",
        publication_year: 2026,
      };
    },
    requestText: async (url: string) => {
      state.served.push(url);
      await gate();
      if (state.failScholar) throw new Error("service unavailable");
      return scholarPage(state.scholar, state.scholarTitle);
    },
    // Scholar reads go through the two-path reader; a stub answers on the
    // request path, which is also what the plugin falls back to.
    requestScholarPage: async (url: string) => {
      state.served.push(url);
      if (state.holdScholar) {
        await new Promise<void>((resolve) => {
          state.releaseScholar = resolve;
        });
      }
      await gate();
      if (state.failScholar) throw new Error("service unavailable");
      const body =
        state.scholarStatus === 200
          ? scholarPage(state.scholar, state.scholarTitle)
          : "<html><title>Sorry...</title><body>unusual traffic</body></html>";
      const attempt = {
        via: "xhr" as const,
        status: state.scholarStatus,
        error: null,
        bytes: body.length,
        bodyHead: trimBodyHead(body),
        usable: state.scholarStatus === 200,
      };
      return {
        status: state.scholarStatus,
        body: state.scholarStatus === 200 ? body : "",
        via: state.scholarStatus === 200 ? ("xhr" as const) : null,
        attempts: [attempt],
      };
    },
    // Scholar reads keep the status, so a refusal can be told from a page that
    // carried nothing.
    requestPage: async (url: string) => {
      state.served.push(url);
      await gate();
      if (state.failScholar) throw new Error("service unavailable");
      return {
        status: state.scholarStatus,
        body:
          state.scholarStatus === 200
            ? scholarPage(state.scholar, state.scholarTitle)
            : "<html><title>Sorry...</title><body>unusual traffic</body></html>",
      };
    },
  };

  // A test that holds several requests at once - a likes batch and a citation
  // read - has to be able to let all of them go, not only the newest.
  state.releaseAll = () => {
    for (const resolve of state.pendingGates.splice(0)) resolve();
  };

  return state;
}

describe("AlphaLikes refresh", function () {
  let item: Zotero.Item;
  let service: ReturnType<typeof getService>;
  let stub: Stub;

  before(async function () {
    service = getService();
    item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "AlphaLikes refresh probe paper");
    item.setField("date", "2026-09-21");
    item.setField(
      "extra",
      upsertLikesCache("alphaxiv_arxiv_id: 2401.00001", 111),
    );
    await item.saveTx();
  });

  after(async function () {
    try {
      await item.eraseTx();
    } catch {
      // The library may already be gone when the run tears down.
    }
  });

  describe("like counts", function () {
    it("shows the cached count until something re-reads it", function () {
      assert.equal(fromSortableValue(service.getCellData(item)), "111");
    });

    it("re-reads the count when the refresh action runs", async function () {
      stub = stubRequester(service, 222);

      const summary = await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.include(
        stub.served.join(" "),
        "2401.00001",
        "the refresh has to ask alphaXiv about this paper",
      );
      assert.equal(fromSortableValue(service.getCellData(item)), "222");
      assert.equal(summary.total, 1);
      assert.equal(summary.updated, 1);
      assert.equal(summary.failed, 0);
    });

    it("stores zero for a paper nobody has liked, and says it read it", async function () {
      // Reported: a paper with 0 likes came back as a failed refresh -
      // 「未能读取（保留原值，约 5 分钟后自动重试）」 - although the page had
      // loaded and said zero. alphaXiv leaves the number out when it is zero,
      // and the plugin read the missing number as a missing read.
      stub = stubRequester(service, 0);
      stub.pageWithoutCount = true;

      const summary = await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.equal(
        fromSortableValue(service.getCellData(item)),
        "0",
        "zero likes is a count, and the column shows it",
      );
      assert.equal(summary.updated, 1);
      assert.equal(
        summary.failed,
        0,
        "nothing failed: there was nothing to fail",
      );

      const extra = String(item.getField("extra"));
      assert.include(
        extra,
        "alphaxiv_likes: 0",
        "and the zero is cached like any other count",
      );
    });

    it("leaves attachments and snapshots under a paper blank in both columns", async function () {
      // Reported: after expanding a paper, its snapshot showed a like count
      // (and a citation count). The snapshot's URL carries the same arXiv ID,
      // so the ID lookup used to answer for the child row. Only the paper
      // itself owns these numbers.
      const paper = new Zotero.Item("journalArticle");
      paper.libraryID = Zotero.Libraries.userLibraryID;
      paper.setField("title", "Child row probe paper with a snapshot");
      paper.setField("url", "https://arxiv.org/abs/2401.00001");
      paper.setField("extra", upsertLikesCache("", 42));
      await paper.saveTx();

      const snapshot = new Zotero.Item("attachment");
      snapshot.libraryID = Zotero.Libraries.userLibraryID;
      snapshot.parentID = paper.id;
      snapshot.setField("title", "Snapshot");
      snapshot.setField("url", "https://arxiv.org/abs/2401.00001");
      snapshot.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
      await snapshot.saveTx();

      try {
        const parentRow = Zotero.Items.get(paper.id);
        assert.equal(
          service.planCell(parentRow).text,
          "42",
          "the paper itself still shows its like count",
        );

        const child = Zotero.Items.get(snapshot.id);
        assert.isFalse(child.isRegularItem(), "the snapshot is a child row");
        assert.equal(service.getCellData(child), "", "no like count");
        assert.equal(
          service.getCitationCellData(child),
          "",
          "no citation count",
        );
        assert.equal(service.planCitationCell(child).text, "");
      } finally {
        try {
          await snapshot.eraseTx();
          await paper.eraseTx();
        } catch {
          // The library may already be gone when the run tears down.
        }
      }
    });

    it("says nothing is readable for an item with nothing to match on", async function () {
      // Reported: an item with no arXiv ID and no way to look one up was
      // reported as 「标题太短，无法自动检索」. There is no like count to read
      // for such a row, and what the column says is that alphaXiv has nothing
      // - not that the user's metadata is too short.
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", "Short");
      // No date and no DOI: nothing to look a paper up with, and a title too
      // short to search for on its own.
      await target.saveTx();

      try {
        stub = stubRequester(service, 0);
        const plan = service.planCell(target);
        const cell = renderLikeCell(
          String(plan.value),
          { className: "col-alphaxiv_likes" },
          (Zotero.getMainWindow() as unknown as Window).document,
        ) as HTMLElement;

        assert.equal(
          (cell.firstElementChild as HTMLElement).textContent,
          "",
          "nothing to show, so nothing is shown",
        );
        assert.match(
          cell.title,
          /alphaXiv/i,
          "and the tooltip says which nothing it is",
        );
        assert.deepEqual(
          stub.served,
          [],
          "and no request is spent on a row that cannot be looked up",
        );
      } finally {
        try {
          await target.eraseTx();
        } catch {
          // The library may already be gone when the run tears down.
        }
      }
    });

    it("says a paper is not on alphaXiv instead of failing it", async function () {
      // Reported: a paper alphaXiv has no page for was reported as a failed
      // read with a retry every ten minutes, and the retries never produced
      // anything because there is nothing to produce. The answer is an answer:
      // the cell stays empty, and the tooltip says which nothing it is.
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", "AlphaLikes alphaXiv absence probe");
      target.setField("date", "2026-09-22");
      target.setField("extra", "alphaxiv_arxiv_id: 2509.00077");
      await target.saveTx();

      try {
        stub = stubRequester(service, 0);
        // alphaXiv answers a paper it has no record of with a 404.
        stub.likesStatus = 404;

        const summary = await service.refreshItems([
          Zotero.Items.get(target.id),
        ]);

        assert.equal(summary.updated, 0, "there is no count to store");
        assert.equal(
          summary.missing,
          1,
          "it is a paper alphaXiv does not have, not a failed read",
        );
        assert.equal(summary.failed, 0, "and nothing failed");

        const plan = service.planCell(target);
        const cell = renderLikeCell(
          String(plan.value),
          { className: "col-alphaxiv_likes" },
          (Zotero.getMainWindow() as unknown as Window).document,
        ) as HTMLElement;
        assert.equal(
          (cell.firstElementChild as HTMLElement).textContent,
          "",
          "the cell has nothing to show, so it shows nothing",
        );
        assert.match(
          cell.title,
          /alphaXiv/i,
          "and the tooltip names what is missing",
        );
        assert.notMatch(
          cell.title,
          /\d+\s*(分钟|minutes)/,
          "no retry is promised for a paper that is simply not there",
        );
      } finally {
        try {
          await target.eraseTx();
        } catch {
          // The library may already be gone when the run tears down.
        }
      }
    });

    it("shows the loading state while the re-read is in flight", async function () {
      stub = stubRequester(service, 333);
      stub.hold = true;

      const running = service.refreshItems([Zotero.Items.get(item.id)]);
      assert.equal(
        fromSortableValue(service.getCellData(item)),
        CELL_LOADING,
        "a refresh has to be visible: a stored number that never changes " +
          "looks exactly like a refresh that did nothing",
      );

      stub.hold = false;
      stub.release?.();
      await running;

      assert.equal(fromSortableValue(service.getCellData(item)), "333");
    });

    it("fills in each row as it is read, not at the end of the batch", async function () {
      // Two items of its own: a refresh writes what it read into `Extra`, so
      // borrowing the shared item would move the values the other tests in
      // this block hand on to each other.
      const make = async (id: string, title: string) => {
        const created = new Zotero.Item("journalArticle");
        created.libraryID = Zotero.Libraries.userLibraryID;
        created.setField("title", title);
        created.setField("date", "2026-09-21");
        created.setField(
          "extra",
          upsertLikesCache(`alphaxiv_arxiv_id: ${id}`, 111),
        );
        await created.saveTx();
        return created;
      };

      const first = await make("2401.00003", "AlphaLikes pace probe (first)");
      const second = await make("2401.00004", "AlphaLikes pace probe (second)");

      try {
        stub = stubRequester(service, 777);
        // The first read answers, the second is held open: if the cells only
        // left their loading marker when the whole batch was done, the first
        // row would still be reading "…" here.
        stub.hold = true;
        stub.holdAfter = 1;

        const running = service.refreshItems([first, second]);

        for (
          let waited = 0;
          waited < 80 &&
          fromSortableValue(service.getCellData(first)) !== "777";
          waited += 1
        ) {
          await Zotero.Promise.delay(25);
        }

        assert.equal(
          fromSortableValue(service.getCellData(first)),
          "777",
          "the row that has been read shows its count straight away",
        );
        assert.equal(
          fromSortableValue(service.getCellData(second)),
          CELL_LOADING,
          "the row still being read keeps its loading marker",
        );

        stub.hold = false;
        stub.release?.();
        await running;

        assert.equal(fromSortableValue(service.getCellData(second)), "777");
      } finally {
        for (const created of [first, second]) {
          try {
            await created.eraseTx();
          } catch {
            // The library may already be gone when the run tears down.
          }
        }
      }
    });

    it("keeps the old count when the re-read fails", async function () {
      stub = stubRequester(service, 444);
      stub.failLikes = true;

      const summary = await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.equal(
        fromSortableValue(service.getCellData(item)),
        "333",
        "a failed refresh must not blank a count that is still the best we know",
      );
      assert.equal(summary.updated, 0);
      assert.equal(summary.failed, 1);
      assert.isAtLeast(
        summary.retryMinutes ?? 0,
        1,
        "the summary has to carry the wait, or 'N failed' is all the user sees",
      );
    });

    it("leaves citations alone", async function () {
      stub = stubRequester(service, 555, 42);

      await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.notInclude(
        stub.served.join(" "),
        "scholar.google.com",
        "re-reading likes is not a request to re-read citations",
      );
    });
  });

  describe("citation counts", function () {
    before(function () {
      // The default source is Google Scholar; make sure nothing else is
      // ticked from an earlier test in this run.
      setPref("citationSourcePreferences", "googleScholar");
    });

    it("re-reads the count and caches it", async function () {
      stub = stubRequester(service, 0, 42);

      const summary = await service.refreshCitations([
        Zotero.Items.get(item.id),
      ]);

      assert.include(stub.served.join(" "), "scholar.google.com");
      assert.equal(summary.total, 1);
      assert.equal(summary.updated, 1);
      assert.equal(summary.failed, 0);

      const plan = service.planCitationCell(Zotero.Items.get(item.id));
      assert.equal(plan.text, "42");
      assert.equal(plan.source, "Google Scholar");
    });

    it("shows the loading state while the re-read is in flight", async function () {
      stub = stubRequester(service, 0, 77);
      stub.hold = true;

      const running = service.refreshCitations([Zotero.Items.get(item.id)]);
      assert.equal(
        service.planCitationCell(Zotero.Items.get(item.id)).text,
        CELL_LOADING,
      );

      stub.hold = false;
      stub.release?.();
      await running;

      assert.equal(
        service.planCitationCell(Zotero.Items.get(item.id)).text,
        "77",
      );
    });

    it("searches for the record an older install left in Extra", async function () {
      const target = Zotero.Items.get(item.id);
      // A different figure from the one already in Extra, so the re-read is
      // visible in the summary rather than looking like "nothing happened".
      stub = stubRequester(service, 0, 4321);

      // Rows an older build wrote: the chosen record's title, then the counts.
      // The remembered title is what the search asks for, and Scholar answers
      // with that same record, so the automatic match lands on it.
      stub.scholarTitle = "The Exact Paper The User Chose";
      await target.setField(
        "extra",
        [
          "alphaxiv_arxiv_id: 2401.00001",
          "alphaxiv_scholar_title: The Exact Paper The User Chose",
          "alphaxiv_citations: gs=1234",
        ].join("\n"),
      );
      await target.saveTx();

      const summary = await service.refreshCitations([target]);
      assert.equal(summary.updated, 1);
      assert.equal(service.planCitationCell(target).text, "4321");

      // The remembered title decides what the silent lookup searches for, so
      // an install that upgraded keeps landing on the record it had chosen.
      const queries = stub.served
        .filter((url) => url.includes("scholar.google.com"))
        .map((url) => decodeURIComponent(url));
      assert.isTrue(
        queries.some((url) => url.includes("The Exact Paper The User Chose")),
      );
    });

    it("adopts a match only at high confidence", async function () {
      const target = Zotero.Items.get(item.id);
      // A near-but-not-exact title: the Scholar hit scores below the high
      // confidence band, and a medium match is treated as "not found" now
      // that there is no dialog to confirm it in.
      stub = stubRequester(service, 0, 97531);
      stub.scholarTitle = "A Completely Different Paper About Fish";

      const summary = await service.refreshCitations([target]);
      assert.equal(summary.updated, 0);

      const plan = service.planCitationCell(target);
      assert.notInclude(String(plan.text), "97531");
    });

    it("reads a 403 as the human check, not as a failed request", async function () {
      // The reported bug: from a network Google distrusts, Scholar answers
      // with 403 and a "sorry" page. Throwing on that status meant the error
      // surfaced as a broken read and the count stayed empty for good, even
      // though the same request in a browser was fine.
      //
      // The item has no stored count, so a refusal leaves nothing to keep.
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", "AlphaLikes refresh probe paper");
      target.setField("date", "2026-09-21");
      target.setField("DOI", "10.1234/alphalikes.403");
      await target.saveTx();

      try {
        stub = stubRequester(service, 0, 0);
        stub.scholarStatus = 403;

        const summary = await service.refreshCitations([target]);

        assert.equal(summary.updated, 0);
        assert.equal(summary.failed, 1);
        const plan = service.planCitationCell(target);
        assert.include(
          plan.value,
          CITATIONS_BLOCKED_MARKER,
          "a refusal has to book a retry, not read as a paper with no citations",
        );
        assert.equal(plan.text, CELL_UNAVAILABLE);

        // Leave no block behind: the next test would otherwise see the retry
        // window rather than its own stub.
        stub.scholarStatus = 200;
        stub.scholar = 12;
        await service.refreshCitations([target]);
        assert.equal(service.planCitationCell(target).text, "12");
      } finally {
        await target.eraseTx();
      }
    });

    it("reads a 429 as rate limiting, which is a different answer", async function () {
      // Google rate limits an address (429) rather than refusing the request
      // (403). The wait is the same, but what the user is told is not: one is
      // "slow down, this network is busy", the other is "prove you are a
      // person", and opening a browser only helps with the second.
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", "AlphaLikes refresh probe paper");
      target.setField("date", "2026-09-21");
      target.setField("DOI", "10.1234/alphalikes.429");
      await target.saveTx();

      try {
        stub = stubRequester(service, 0, 0);
        stub.scholarStatus = 429;

        const summary = await service.refreshCitations([target]);

        assert.equal(summary.updated, 0);
        assert.equal(summary.failed, 1);

        const status = service.getScholarBlockStatus();
        assert.isTrue(status.blocked, "a 429 has to book a retry as well");
        assert.isTrue(
          status.rateLimited,
          "429 means the address is being limited, not that Google wants a " +
            "human check",
        );
        const plan = service.planCitationCell(target);
        assert.include(plan.value, CITATIONS_BLOCKED_MARKER);
        assert.equal(plan.text, CELL_UNAVAILABLE);

        // Leave no block behind: the next test would otherwise see the retry
        // window rather than its own stub.
        stub.scholarStatus = 200;
        stub.scholar = 12;
        await service.refreshCitations([target]);
        assert.equal(service.planCitationCell(target).text, "12");
        assert.isFalse(service.getScholarBlockStatus().rateLimited);
      } finally {
        await target.eraseTx();
      }
    });

    it("counts an item with nothing to look up as skipped", async function () {
      // A title is a key of its own - a paper with no DOI, no arXiv id and no
      // URL is looked up by its name - so what is left with nothing to look up
      // is a name too short to be searched for at all.
      const bare = new Zotero.Item("journalArticle");
      bare.libraryID = Zotero.Libraries.userLibraryID;
      bare.setField("title", "N/A");
      await bare.saveTx();

      try {
        stub = stubRequester(service, 0, 5);
        const summary = await service.refreshCitations([bare]);

        assert.equal(summary.skipped, 1);
        assert.equal(summary.updated, 0);
      } finally {
        await bare.eraseTx();
      }
    });

    it("reads an item whose title is the only thing to look it up with", async function () {
      // Reported: a paper with no DOI, no arXiv id and no URL was found in
      // Scholar by its title alone; its count of zero came back as "1 without
      // a DOI/arXiv ID" and the paper was never read. The title is the key,
      // and a zero is a count.
      const bare = new Zotero.Item("journalArticle");
      bare.libraryID = Zotero.Libraries.userLibraryID;
      bare.setField("title", "AlphaLikes refresh probe paper");
      await bare.saveTx();

      try {
        stub = stubRequester(service, 0, 0);
        const summary = await service.refreshCitations([bare]);

        assert.equal(summary.updated, 1, "the title was searched for");
        assert.equal(
          summary.skipped,
          0,
          "and the paper is not one without a key",
        );
        assert.equal(summary.missing, 0, "and it was found");
        assert.equal(
          service.planCitationCell(bare).text,
          "0",
          "the count Scholar gave is a number, even when it is nothing",
        );
      } finally {
        await bare.eraseTx();
      }
    });
  });

  it("fills in citations row by row as well", async function () {
    // Reported: "在选中多条的情况下，我是要读取单条返回单条，依次来". The
    // citation column has to behave like the like column does - the entry
    // that has been read shows its number while the rest are still reading.
    const make = async (suffix: string) => {
      const created = new Zotero.Item("journalArticle");
      created.libraryID = Zotero.Libraries.userLibraryID;
      // The title the stub's Scholar page carries: a count is only adopted
      // when the hit's title agrees with the item's.
      created.setField("title", "AlphaLikes refresh probe paper");
      created.setField("date", "2026-09-22");
      created.setField("DOI", `10.1234/alphalikes.pace.${suffix}`);
      await created.saveTx();
      return created;
    };

    const first = await make("first");
    const second = await make("second");
    setPref("citationSourcePreferences", "googleScholar");

    try {
      stub = stubRequester(service, 0, 4321);
      stub.hold = true;
      stub.holdAfter = 1;

      const running = service.refreshCitations([first, second]);

      for (
        let waited = 0;
        waited < 80 && service.planCitationCell(first).count === null;
        waited += 1
      ) {
        await Zotero.Promise.delay(25);
      }

      assert.equal(
        service.planCitationCell(first).count,
        4321,
        "the row that has been read shows its count straight away",
      );
      assert.include(
        String(service.planCitationCell(second).text),
        "…",
        "the row still being read keeps its loading marker",
      );

      stub.hold = false;
      stub.release?.();
      await running;

      assert.equal(service.planCitationCell(second).count, 4321);
    } finally {
      for (const created of [first, second]) {
        try {
          await created.eraseTx();
        } catch {
          // The library may already be gone when the run tears down.
        }
      }
    }
  });

  describe("what the batch is told about itself", function () {
    /** An item with nothing in `Extra`: a read of it has to go and ask. */
    async function scholarItem(title: string, id: string) {
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", title);
      target.setField("date", "2026-09-22");
      target.setField("DOI", `10.1234/alphalikes.${id}`);
      await target.saveTx();
      return target;
    }

    async function discard(target: Zotero.Item) {
      try {
        await target.eraseTx();
      } catch {
        // The library may already be gone when the run tears down.
      }
    }

    it("calls a waiting paper waiting, not failed", async function () {
      // Reported: 「已重新读取 0 条引用数；11 条未能读取（保留原值，约 10
      // 分钟后自动重试）」 while the list was stuck. One paper was refused and
      // the rest were queued behind it, and calling those failures invented a
      // retry that belonged to none of them.
      const refused = await scholarItem(
        "AlphaLikes refresh probe paper",
        "queued.1",
      );
      const behind = await scholarItem(
        "AlphaLikes refresh probe paper",
        "queued.2",
      );

      try {
        stub = stubRequester(service, 0, 5);
        // Google answers with a refusal page: no results, no Cited by, nothing
        // that says a search came back.
        stub.scholarStatus = 429;

        const summary = await service.refreshCitations([refused, behind]);

        assert.equal(
          summary.failed,
          1,
          "one paper was asked about, and the answer was a refusal",
        );
        assert.equal(
          summary.queued,
          1,
          "the paper behind it has not been asked about at all: it is waiting",
        );
        assert.isNumber(
          summary.retryMinutes,
          "the retry time comes from the refusal that stopped the batch",
        );
        assert.isAbove(
          summary.retryMinutes ?? 0,
          0,
          "and it is a wait, not a zero",
        );
      } finally {
        await discard(refused);
        await discard(behind);
      }
    });
  });

  describe("keeping the two actions apart", function () {
    /**
     * An item with a known arXiv ID and nothing cached: the like cell is the
     * one that starts a read as soon as it is asked for a value, which is what
     * a repaint does to every visible row.
     */
    async function blankLikesItem(title: string, id: string) {
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", title);
      target.setField("date", "2026-09-22");
      target.setField("DOI", `10.1234/alphalikes.${id}`);
      target.setField("extra", `alphaxiv_arxiv_id: ${id}`);
      await target.saveTx();
      return target;
    }

    async function discard(target: Zotero.Item) {
      try {
        await target.eraseTx();
      } catch {
        // The library may already be gone when the run tears down.
      }
    }

    it("starts no like read while a citation read is running", async function () {
      // Reported: "刷新引用量和点赞数要分开，我刷新引用量把点赞数也刷新了". The two
      // actions share the item list and the repaint, so the reading one has to
      // say which column it belongs to; otherwise the repaint is enough to set
      // the other column going.
      const target = await blankLikesItem(
        "AlphaLikes separation probe (likes)",
        "2401.00041",
      );

      try {
        stub = stubRequester(service, 444, 5);
        stub.hold = true;

        const running = service.refreshCitations([Zotero.Items.get(target.id)]);
        // What the tree does to every visible row while a read is in flight.
        service.getCellData(target);

        assert.deepEqual(
          stub.served.filter((url) => url.includes("alphaxiv.org")),
          [],
          "a citation refresh must not start a like read on the way",
        );

        stub.hold = false;
        stub.release?.();
        await running;
      } finally {
        await discard(target);
      }
    });

    it("reads the likes of a paper added while a citation batch is running", async function () {
      // Reported: adding a paper while the citation reads were running left
      // its like count unread for minutes, as if the like column were waiting
      // for the citation queue. The two columns are independent: the rule the
      // user asked for is that *the rows being refreshed for citations* are
      // left alone by the like column, not that the whole column stops while
      // the citation queue - which is meant to take minutes - is busy.
      const asked = await blankLikesItem(
        "AlphaLikes independence probe (asked)",
        "2401.00101",
      );
      const added = await blankLikesItem(
        "AlphaLikes independence probe (added)",
        "2401.00102",
      );

      try {
        stub = stubRequester(service, 321, 5);
        // Only the Scholar read is held: the citation batch is in flight, the
        // way it is for minutes at a time.
        stub.holdScholar = true;

        const running = service.refreshCitations([Zotero.Items.get(asked.id)]);
        await Zotero.Promise.delay(100);

        // The paper the user just added, painted by the tree like any other
        // row. Its own likes have nothing to do with the batch in flight.
        assert.equal(
          fromSortableValue(service.getCellData(added)),
          CELL_LOADING,
          "the new row shows that it is reading",
        );
        await Zotero.Promise.delay(500);

        assert.equal(
          fromSortableValue(service.getCellData(added)),
          "321",
          "the new paper's likes are read without waiting for the citations",
        );
        assert.deepEqual(
          stub.served.filter((url) => url.includes("alphaxiv.org")),
          ["https://www.alphaxiv.org/abs/2401.00102"],
          "and the row being refreshed for citations is still left alone",
        );

        stub.holdScholar = false;
        stub.releaseScholar?.();
        await running;
      } finally {
        await discard(asked);
        await discard(added);
      }
    });

    it("reads the citations of a paper added while a likes batch is running", async function () {
      // The same independence the other way round: a batch of like reads takes
      // as long as it takes, and a paper added while it runs has nothing to do
      // with it. Only the rows the batch named are left alone.
      const previous = getPref("citationSourcePreferences");
      const asked = await blankLikesItem(
        "AlphaLikes independence probe (asked likes)",
        "2401.00111",
      );
      const added = await blankLikesItem(
        "AlphaLikes independence probe (added citations)",
        "2401.00112",
      );

      try {
        // A source that is read without a selection, so the test does not
        // depend on what the UI happens to have selected.
        setPref("citationSourcePreferences", "openAlex");
        stub = stubRequester(service, 444, 5);
        stub.hold = true;

        const running = service.refreshItems([Zotero.Items.get(asked.id)]);
        await Zotero.Promise.delay(100);

        const value = service.getCitationCellData(added);
        await Zotero.Promise.delay(300);

        assert.equal(
          value,
          CELL_LOADING,
          "the added paper's citation read starts, so its cell says it is reading",
        );
        assert.isTrue(
          stub.served.some((url) => url.includes("openalex.org")),
          "and the read is asked for without waiting for the likes",
        );
        assert.deepEqual(
          stub.served.filter((url) => url.includes("alphaxiv.org")),
          ["https://www.alphaxiv.org/abs/2401.00111"],
          "while the row the likes batch named is still left alone",
        );

        stub.hold = false;
        stub.releaseAll();
        await running;
      } finally {
        setPref("citationSourcePreferences", previous);
        await discard(asked);
        await discard(added);
      }
    });

    it("starts no citation read while a like read is running", async function () {
      // The same rule the other way round. Read through a cheap source, so the
      // test does not depend on what the UI has selected: Google Scholar is
      // only read for selected items.
      const previous = getPref("citationSourcePreferences");
      const target = await blankLikesItem(
        "AlphaLikes separation probe (citations)",
        "2401.00042",
      );

      try {
        setPref("citationSourcePreferences", "openAlex");
        stub = stubRequester(service, 444, 5);
        stub.hold = true;

        const running = service.refreshItems([Zotero.Items.get(target.id)]);
        const value = service.getCitationCellData(target);

        assert.deepEqual(
          stub.served.filter(
            (url) =>
              url.includes("openalex.org") ||
              url.includes("semanticscholar.org") ||
              url.includes("scholar.google"),
          ),
          [],
          "a like refresh must not start a citation read on the way",
        );
        assert.equal(
          value,
          "",
          "and the citation cell stays blank rather than loading",
        );

        stub.hold = false;
        stub.release?.();
        await running;
      } finally {
        setPref("citationSourcePreferences", previous);
        await discard(target);
      }
    });
  });

  it("does not re-read the like counts on the way", async function () {
    // Reported: "刷新引用量和点赞数要分开，我刷新引用量把点赞数也刷新了".
    const target = new Zotero.Item("journalArticle");
    target.libraryID = Zotero.Libraries.userLibraryID;
    target.setField("title", "AlphaLikes refresh probe paper");
    target.setField("date", "2026-09-22");
    target.setField("DOI", "10.1234/alphalikes.separation");
    target.setField(
      "extra",
      upsertLikesCache("alphaxiv_arxiv_id: 2401.00031", 321),
    );
    await target.saveTx();

    try {
      stub = stubRequester(service, 999, 42);
      await service.refreshCitations([Zotero.Items.get(target.id)]);

      assert.deepEqual(
        stub.served.filter((url) => url.includes("alphaxiv.org")),
        [],
        "the citation refresh has to stay away from alphaXiv",
      );
      assert.equal(
        fromSortableValue(service.getCellData(target)),
        "321",
        "and the like count has to be exactly what it was",
      );
    } finally {
      try {
        await target.eraseTx();
      } catch {
        // The library may already be gone when the run tears down.
      }
    }
  });
});
