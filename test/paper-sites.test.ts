import { assert } from "chai";
import {
  chatPaperSearchURL,
  lookupOnChatPaper,
  pickBestMatch,
  type PaperCandidate,
  type PaperLookupDeps,
  type PaperSession,
} from "../src/modules/paper-sites";
// A plain ES module shared with the page actor; it has no type declarations.
// @ts-expect-error -- a plain ES module without declarations
import * as dom from "../addon/content/paper-dom.mjs";

/**
 * The decisions behind "open the ChatPaper page", tested against a fake page
 * and a saved copy of the real results markup. The live site is not part of
 * the suite: its results are built with JavaScript, and what it answers is up
 * to it.
 */

const DPO_ITEM_TITLE =
  "DPO：direct preference optimization: your language model is secretly a reward model";
const DPO_EN_TITLE =
  "Direct Preference Optimization: Your Language Model is Secretly a Reward Model";
const DPO_CHATPAPER_HREF =
  "https://chatpaper.com/zh-CN/paper/7726?from=subpath-search";

/** Markup of a ChatPaper search result block, as saved from chatpaper.com (trimmed). */
const CHATPAPER_RESULTS_HTML = `
<div class="document simple" data-doc="7726"><div class="main-content"><div class="content"><div class="doc-name"><div class="doc-name-main">
<span class="serial-number">1.</span><a href="/zh-CN/paper/7726?from=subpath-search" class="doc-name-content"><div class="markstream-vue"><p><span><span>直接偏好优化：你的语言模型实际上是一个奖励模型</span></span></p></div></a>
</div></div></div>
<div class="doc-info"><div class="doc-info-name"><span>Direct Preference Optimization: Your Language Model is Secretly a Reward Model</span></div></div></div>
<div class="document simple" data-doc="8001"><div class="main-content"><div class="content"><div class="doc-name"><div class="doc-name-main">
<span class="serial-number">2.</span><a href="/zh-CN/paper/8001?from=subpath-search" class="doc-name-content"><div class="markstream-vue"><p><span><span>奖励模型的缩放规律</span></span></p></div></a>
</div></div></div>
<div class="doc-info"><div class="doc-info-name"><span>Scaling Laws for Reward Model Over-Optimization</span></div></div></div>
`;

function parse(html: string): Document {
  const win = Zotero.getMainWindow() as unknown as {
    DOMParser: new () => DOMParser;
  };
  return new win.DOMParser().parseFromString(html, "text/html");
}

interface Script {
  /** What the results page lists, once it has rendered. */
  candidates: PaperCandidate[];
}

function fakeDeps(script: Script) {
  const opened: string[] = [];
  const notices: string[] = [];
  const started: string[] = [];
  const closed: string[] = [];

  const session = (startUrl: string): PaperSession => {
    started.push(startUrl);
    return {
      async query(name) {
        return name === "candidates" ? script.candidates : null;
      },
      close() {
        closed.push(startUrl);
      },
    };
  };

  const deps: PaperLookupDeps = {
    async openSession(url) {
      return session(url);
    },
    open(url) {
      opened.push(url);
    },
    notify(headline, message) {
      notices.push(`${headline}: ${message}`);
    },
    async delay() {
      // The fake results are there at once.
    },
  };

  return { deps, opened, notices, started, closed };
}

describe("opening the ChatPaper page", function () {
  describe("reading the real results page", function () {
    it("lists each result with its Chinese and English titles", function () {
      const found = dom.chatPaperCandidates(
        parse(CHATPAPER_RESULTS_HTML),
        chatPaperSearchURL(DPO_ITEM_TITLE),
      );
      assert.equal(found.length, 2);
      assert.equal(found[0].href, DPO_CHATPAPER_HREF);
      assert.include(found[0].titles ?? [], DPO_EN_TITLE);
      assert.include(
        found[0].titles ?? [],
        "直接偏好优化：你的语言模型实际上是一个奖励模型",
      );
    });

    it("picks the DPO paper for the title as it is written in the library", function () {
      const picked = pickBestMatch(
        DPO_ITEM_TITLE,
        dom.chatPaperCandidates(
          parse(CHATPAPER_RESULTS_HTML),
          chatPaperSearchURL(DPO_ITEM_TITLE),
        ),
      );
      assert.equal(picked?.href, DPO_CHATPAPER_HREF);
    });
  });

  describe("pickBestMatch", function () {
    it("takes the result whose title is closest to the paper", function () {
      const picked = pickBestMatch("Attention Is All You Need", [
        {
          href: "https://chatpaper.com/zh-CN/paper/1",
          title: "Attention is All You Need in Speech Separation",
        },
        {
          href: "https://chatpaper.com/zh-CN/paper/2",
          title: "Attention is All You Need",
        },
      ]);
      assert.equal(picked?.href, "https://chatpaper.com/zh-CN/paper/2");
    });

    it("takes the first of several versions with the same title", function () {
      const picked = pickBestMatch("Attention Is All You Need", [
        {
          href: "https://chatpaper.com/zh-CN/paper/a",
          title: "Attention Is All You Need",
        },
        {
          href: "https://chatpaper.com/zh-CN/paper/b",
          title: "attention is all you need",
        },
      ]);
      assert.equal(picked?.href, "https://chatpaper.com/zh-CN/paper/a");
    });

    it("counts a result by its best title", function () {
      const picked = pickBestMatch("直接偏好优化", [
        {
          href: "https://chatpaper.com/zh-CN/paper/1",
          title: "Something Else Entirely Unrelated",
          titles: ["Something Else Entirely Unrelated", "直接偏好优化"],
        },
      ]);
      assert.equal(picked?.href, "https://chatpaper.com/zh-CN/paper/1");
    });

    it("returns nothing when no result is close enough", function () {
      const picked = pickBestMatch("Attention Is All You Need", [
        {
          href: "https://chatpaper.com/zh-CN/paper/x",
          title: "Graph Neural Networks for Molecules",
        },
      ]);
      assert.isNull(picked);
    });

    it("skips results without a title or an address", function () {
      const picked = pickBestMatch("Attention Is All You Need", [
        { href: "https://chatpaper.com/zh-CN/paper/empty", title: "   " },
        { href: "", title: "Attention Is All You Need" },
        {
          href: "https://chatpaper.com/zh-CN/paper/ok",
          title: "Attention Is All You Need",
        },
      ]);
      assert.equal(picked?.href, "https://chatpaper.com/zh-CN/paper/ok");
    });

    it("returns nothing for an empty list", function () {
      assert.isNull(pickBestMatch("Attention Is All You Need", []));
    });
  });

  it("builds the ChatPaper search address from the title", function () {
    assert.equal(
      chatPaperSearchURL("  Attention Is All You Need  "),
      "https://chatpaper.com/zh-CN/search?keywords=Attention%20Is%20All%20You%20Need&type=all",
    );
  });

  describe("lookupOnChatPaper", function () {
    it("goes to the search page and opens the best matching paper", async function () {
      const fake = fakeDeps({
        candidates: [
          {
            href: "https://chatpaper.com/zh-CN/paper/999",
            title: "Unrelated Paper About Graphs",
          },
          {
            href: DPO_CHATPAPER_HREF,
            title: "直接偏好优化",
            titles: [
              "直接偏好优化：你的语言模型实际上是一个奖励模型",
              DPO_EN_TITLE,
            ],
          },
        ],
      });

      await lookupOnChatPaper(DPO_ITEM_TITLE, fake.deps);

      assert.deepEqual(fake.started, [chatPaperSearchURL(DPO_ITEM_TITLE)]);
      assert.deepEqual(fake.opened, [DPO_CHATPAPER_HREF]);
      assert.deepEqual(
        fake.closed,
        [chatPaperSearchURL(DPO_ITEM_TITLE)],
        "the hidden page is closed",
      );
    });

    it("opens nothing when no result is close enough", async function () {
      const fake = fakeDeps({
        candidates: [
          {
            href: "https://chatpaper.com/zh-CN/paper/5",
            title: "Graph Neural Networks for Molecules",
          },
        ],
      });

      await lookupOnChatPaper(DPO_ITEM_TITLE, fake.deps);

      assert.deepEqual(fake.opened, []);
      assert.isTrue(fake.notices.some((line) => line.includes("ChatPaper")));
    });
  });
});
