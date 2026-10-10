/**
 * The plugin's one menu entry.
 *
 * Reported: the plugin was five context-menu lines with no heading, so nothing
 * on the right-click said they were one plugin, and the pages the numbers come
 * from were three clicks away in a browser. What is asserted here is the shape
 * the user sees: an entry with an icon and the plugin's name, the actions
 * inside it, and a second host so the entry can also be found in the Tools
 * menu - where a plugin is normally looked for, and where it exists even with
 * nothing selected.
 */

import { assert } from "chai";
import {
  activityLines,
  menuVisibility,
  registerItemMenu,
  shortenTitle,
  unregisterItemMenu,
} from "../src/modules/menu";
import { t } from "../src/modules/l10n";
import { getService } from "../src/modules/column";

const MENU_ID = "alphalikes-menu";
const TOOLS_MENU_ID = "alphalikes-tools-menu";

/** The parts of Zotero's main window this file touches. */
interface MainWindowish {
  document: Document;
  ZoteroPane?: {
    getSelectedItems?: () => Zotero.Item[];
  };
}

describe("the plugin menu", function () {
  const win = () => Zotero.getMainWindow() as unknown as MainWindowish;
  const doc = () => win().document;
  /** The main window as the menu code wants it. */
  /** The main window as the menu code takes it. */
  const host = () => win() as unknown as Parameters<typeof registerItemMenu>[0];

  /**
   * The entries directly inside a popup.
   *
   * Direct children on purpose: the actions now live in a submenu, and a
   * descendant query would find them there and report the old shape as still
   * present no matter where they were put.
   */
  function itemsIn(popup: Element): Array<{ id: string; label: string }> {
    return Array.from(popup.children)
      .filter((child) => child.tagName.toLowerCase() === "menuitem")
      .map((item) => ({
        id: item.getAttribute("id") ?? "",
        label: item.getAttribute("label") ?? "",
      }));
  }

  before(function () {
    registerItemMenu(host());
  });

  after(function () {
    unregisterItemMenu(host());
  });

  it("is one entry with an icon and the plugin's name", function () {
    const menu = doc().getElementById(MENU_ID);
    assert.isOk(menu, "the item menu has no plugin entry");
    assert.equal(
      menu?.getAttribute("label"),
      "AlphaPulse",
      "the entry has to carry the plugin's name, not a feature's",
    );

    const style = menu?.getAttribute("style") ?? "";
    const image = menu?.getAttribute("image") ?? "";
    assert.include(
      `${style} ${image}`,
      "icons/favicon.png",
      "the entry has to draw the plugin's icon",
    );
  });

  it("holds every action, and nothing is left in the menu's top level", function () {
    const popup = doc().getElementById("alphalikes-menu-popup");
    assert.isOk(popup, "the entry has no popup of its own");

    const ids = itemsIn(popup as Element).map((item) => item.id);
    for (const id of [
      "alphalikes-refresh-likes",
      "alphalikes-refresh-citations",
      "alphalikes-open-alphaxiv",
      "alphalikes-open-scholar",
      "alphalikes-manual-citations",
      "alphalikes-clear-data",
    ]) {
      assert.include(ids, id, `${id} is missing from the plugin menu`);
    }

    // The line about this session's reading is an entry of its own, and it is
    // not an action: it answers "is it working?" and cannot be clicked.
    assert.include(ids, "alphalikes-activity", "the reading status is missing");
    const activity = doc().getElementById("alphalikes-activity");
    assert.isTrue(
      activity?.hasAttribute("disabled"),
      "the status line must not look like something to click",
    );

    // The old shape: the five entries sitting directly in the context menu.
    const itemMenu = doc().getElementById("zotero-itemmenu");
    for (const item of itemsIn(itemMenu as Element)) {
      assert.notInclude(
        [
          "alphalikes-refresh-likes",
          "alphalikes-refresh-citations",
          "alphalikes-open-alphaxiv",
          "alphalikes-open-scholar",
          "alphalikes-manual-citations",
          "alphalikes-clear-data",
        ],
        item.id,
        "an action is still registered at the menu's top level",
      );
    }
  });

  it("is in the Tools menu as well, for when nothing is selected", function () {
    const menu = doc().getElementById(TOOLS_MENU_ID);
    assert.isOk(menu, "the Tools menu does not offer the plugin");
    assert.equal(menu?.getAttribute("label"), "AlphaPulse");

    const popup = doc().getElementById("alphalikes-tools-popup");
    const ids = itemsIn(popup as Element).map((item) => item.id);
    assert.include(
      ids,
      "alphalikes-clear-data",
      "the Tools-menu entry is not the same set of actions",
    );
  });

  it("offers to open the paper's alphaXiv page once it has an ID", async function () {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "AlphaPulse menu probe paper");
    item.setField("date", "2026-09-22");
    item.setField("url", "https://arxiv.org/abs/2401.00031");
    await item.saveTx();

    try {
      const saved = Zotero.Items.get(item.id);
      assert.equal(
        getService().alphaXivPageURL(saved),
        "https://www.alphaxiv.org/abs/2401.00031",
        "the action has to point at the paper's own page",
      );

      // No arXiv ID, no page: the entry hides itself rather than opening the
      // site's front page.
      const plain = new Zotero.Item("journalArticle");
      plain.libraryID = Zotero.Libraries.userLibraryID;
      plain.setField("title", "AlphaPulse menu probe paper without an ID");
      await plain.saveTx();
      try {
        assert.isNull(getService().alphaXivPageURL(Zotero.Items.get(plain.id)));
      } finally {
        await plain.eraseTx();
      }
    } finally {
      await item.eraseTx();
    }
  });

  function otherSourceOpen(): boolean {
    return menuVisibility({
      count: 1,
      citationsEnabled: false,
      findsScholar: false,
      openableAlphaXiv: false,
    }).openAMiner;
  }

  it("decides each entry from the selection and the sources", function () {
    // The rule is a pure function so it can be read and tested without a live
    // popup: a test that dispatches `popupshowing` cannot tell this module's
    // handler from another copy of it, which is one module instance per bundle
    // - and the rule is what determines what a user sees.
    const open = menuVisibility({
      count: 1,
      citationsEnabled: true,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.deepEqual(open, {
      entry: true,
      refresh: true,
      refreshCitations: true,
      openAlphaXiv: true,
      openScholar: true,
      openAMiner: true,
      openChatPaper: true,
      manualCitations: true,
      clear: true,
    });

    // Opening the ChatPaper page needs a selected row (its title is what is
    // searched), and does not depend on the citation sources.
    const none = menuVisibility({
      count: 0,
      citationsEnabled: true,
      findsScholar: true,
      openableAlphaXiv: false,
    });
    assert.isFalse(none.openAMiner);
    assert.isFalse(none.openChatPaper);
    assert.isTrue(otherSourceOpen(), "still offered without Google Scholar");

    // Google Scholar is the only source that can ask the visitor to prove they
    // are human, so its two entries leave with it.
    const otherSource = menuVisibility({
      count: 1,
      citationsEnabled: true,
      findsScholar: false,
      openableAlphaXiv: false,
    });
    assert.isFalse(otherSource.openScholar);
    assert.isFalse(
      otherSource.openAlphaXiv,
      "a paper with no arXiv ID has no alphaXiv page to open",
    );
    assert.isTrue(otherSource.refresh, "the likes column still reads");

    // One number belongs to one row: with two rows selected there is no single
    // item the typed count would be writing to.
    const twoRows = menuVisibility({
      count: 2,
      citationsEnabled: true,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.isFalse(
      twoRows.manualCitations,
      "a typed citation count is offered for one row at a time",
    );

    // And it is a citation entry, so it leaves with the Citations column.
    const noCitations = menuVisibility({
      count: 1,
      citationsEnabled: false,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.isFalse(noCitations.manualCitations);

    // Nothing selected: the whole entry goes, because a read action with no
    // rows has nothing to act on.
    const nothingSelected = menuVisibility({
      count: 0,
      citationsEnabled: true,
      findsScholar: true,
      openableAlphaXiv: false,
    });
    assert.isFalse(nothingSelected.entry);
    assert.isFalse(nothingSelected.clear);
    // Opening the Scholar page stays: it is about the session, not about a row.
    assert.isTrue(nothingSelected.openScholar);

    // Citations column off: the citation entries leave with it.
    const citationsOff = menuVisibility({
      count: 2,
      citationsEnabled: false,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.isFalse(citationsOff.refreshCitations);
    assert.isFalse(citationsOff.openScholar);
    assert.isTrue(citationsOff.refresh, "the likes column is not affected");
  });

  it("says what each paper is waiting for, one line per paper", function () {
    // A quiet column and a stopped plugin look the same; this block answers
    // the question without the user opening the settings. Reported: one line
    // for the whole session - "2 requests, next in about now" - over a list of
    // papers that were each at a different point, and a wait that disagreed
    // with the notice. What is asserted is the shape the user asked for: one
    // line per paper, each carrying that paper's own count and its own next
    // attempt, in the order the reading reaches them.
    const activity = {
      autoPaused: false,
      items: [
        {
          itemID: 1,
          title: "Attention Is All You Need",
          attempts: 2,
          reading: false,
          ahead: 0,
          nextInMs: 5 * 60_000,
        },
        {
          itemID: 2,
          title: "DeepSeek-R1",
          attempts: 1,
          reading: false,
          ahead: 0,
          nextInMs: 20 * 60_000,
        },
      ],
    };

    const lines = activityLines(activity, [1, 2]);
    assert.lengthOf(lines, 2, "one paper, one line");
    assert.include(lines[0], "Attention Is All You Need");
    assert.include(lines[0], "2", "the paper's own count is in its line");
    assert.include(lines[0], "5", "and its own wait");
    assert.include(lines[1], "DeepSeek-R1");
    assert.include(lines[1], "20");
    assert.notInclude(
      lines[1],
      "Attention",
      "a line is about one paper, not about the selection",
    );

    // A paper nobody has asked about yet is not "retrying": it is next in the
    // queue, waiting for the reading rhythm, and its line says that.
    const next = activityLines(
      {
        autoPaused: false,
        items: [
          {
            ...activity.items[0],
            itemID: 3,
            title: "Fresh paper",
            attempts: 0,
            ahead: 0,
            nextInMs: 20_000,
          },
        ],
      },
      [3],
    );
    assert.equal(
      next[0],
      t("menu-activity-item-next", {
        title: "Fresh paper",
        wait: t("menu-activity-wait-seconds", { seconds: "20" }),
      }),
      "a paper that has not been asked about is next in line, not retrying",
    );

    // Reported (1.3.7): a newly added paper, queued behind one that was
    // waiting out a retry, was given the *older* paper's deadline - two lines
    // reading "in about 5 minutes" for two different papers. A paper with
    // someone ahead of it has a place in the queue, not a time, and says so.
    const behind = activityLines(
      {
        autoPaused: false,
        items: [
          {
            ...activity.items[0],
            itemID: 4,
            title: "Queued paper",
            attempts: 0,
            ahead: 2,
            nextInMs: 0,
          },
        ],
      },
      [4],
    );
    assert.include(
      behind[0],
      t("menu-activity-item-queued", {
        title: "Queued paper",
        count: "0",
        ahead: "2",
      }),
    );
    assert.include(
      behind[0],
      "0",
      "a paper that has not been asked about yet states zero of its own",
    );
    assert.notInclude(
      behind[0],
      "5",
      "and never borrows the waiting paper's five minutes",
    );

    // Reading now needs no countdown, and a paused episode says so instead of
    // promising a time nothing will happen at.
    const reading = activityLines(
      {
        autoPaused: false,
        items: [{ ...activity.items[0], reading: true }],
      },
      [1],
    );
    assert.equal(
      reading[0],
      t("menu-activity-item-reading", { title: "Attention Is All You Need" }),
    );

    const paused = activityLines(
      { autoPaused: true, items: activity.items },
      [1],
    );
    assert.equal(
      paused[0],
      t("menu-activity-item-paused", {
        title: "Attention Is All You Need",
        count: "2",
      }),
    );
  });

  it("shows only the selected papers, and says so when none is waiting", function () {
    // The right-click menu is about what is selected; the Tools menu is about
    // the plugin, which has no selection to speak of.
    const activity = {
      autoPaused: false,
      items: [
        {
          itemID: 1,
          title: "One",
          attempts: 1,
          reading: false,
          nextInMs: 60_000,
        },
        {
          itemID: 2,
          title: "Two",
          attempts: 1,
          reading: false,
          nextInMs: 60_000,
        },
      ],
    };

    assert.deepEqual(
      activityLines(activity, [2]).length,
      1,
      "only the selected paper is described",
    );
    assert.deepEqual(
      activityLines(activity, []),
      [t("menu-activity-none-selected")],
      "a selection with nothing in flight says that, not the session's business",
    );
    assert.deepEqual(
      activityLines({ autoPaused: false, items: [] }, null),
      [t("menu-activity-idle")],
      "and an idle plugin says it is idle",
    );
  });

  it("keeps the status block to a readable number of rows", function () {
    // A menu is read, not scrolled: four papers by name, then one line for the
    // rest, each of which still has its own wait in its own tooltip.
    const items = Array.from({ length: 7 }, (_, index) => ({
      itemID: index + 1,
      title: `Paper ${index + 1}`,
      attempts: index + 1,
      reading: false,
      nextInMs: (index + 1) * 60_000,
    }));
    const lines = activityLines({ autoPaused: false, items }, null);
    assert.lengthOf(lines, 5, "four papers plus the overflow line");
    assert.include(
      lines[4],
      "3",
      "the overflow counts the papers it stands for",
    );
  });

  it("shortens a title rather than cutting a menu row off", function () {
    assert.equal(shortenTitle("  DeepSeek-R1  "), "DeepSeek-R1");
    assert.equal(
      shortenTitle(""),
      t("activity-untitled"),
      "a paper with no title still gets a line",
    );
    const long = shortenTitle(
      "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning",
    );
    assert.isBelow(long.length, 30);
    assert.match(long, /…$/, "a cut title says it was cut");
  });

  it("takes every entry back out on shutdown", function () {
    unregisterItemMenu(host());
    for (const id of [
      MENU_ID,
      "alphalikes-menu-popup",
      TOOLS_MENU_ID,
      "alphalikes-tools-popup",
      "alphalikes-refresh-likes",
      "alphalikes-activity",
      "alphalikes-manual-citations",
    ]) {
      assert.isNull(doc().getElementById(id), `${id} survived the teardown`);
    }
    registerItemMenu(host());
  });
});
