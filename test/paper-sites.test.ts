import { assert } from "chai";
import {
  aminerSearchURL,
  chatPaperSearchURL,
  lookupPaperPage,
  pickBestMatch,
  type PaperCandidate,
  type PaperLookupDeps,
  type PaperSession,
  type PaperSite,
} from "../src/modules/paper-sites";
// A plain ES module shared with the page actor; it has no type declarations.
// @ts-expect-error -- a plain ES module without declarations
import * as dom from "../addon/content/paper-dom.mjs";

/**
 * The decisions behind "open the AMiner page" and "open the ChatPaper page",
 * tested against a fake page. The live sites are not part of the suite: their
 * results are built with JavaScript, and what they answer is up to them.
 *
 * The ChatPaper fixture is a trimmed copy of a real results page. The AMiner
 * fixture follows the structure the reference describes (a `title-link` anchor
 * to `/pub/`, with the English title on an inner `[title]` span); no saved
 * AMiner results page is in the repository, so it is a hand-written copy of
 * that structure.
 */

const DPO_ITEM_TITLE =
  "DPO：direct preference optimization: your language model is secretly a reward model";
const DPO_EN_TITLE =
  "Direct Preference Optimization: Your Language Model is Secretly a Reward Model";
const DPO_CHATPAPER_HREF =
  "https://chatpaper.com/zh-CN/paper/7726?from=subpath-search";
const DPO_AMINER_HREF =
  "https://www.aminer.cn/pub/6532c8b2939a5f40820a0e11/direct-preference-optimization-your-language-model-is-secretly-a-reward-model";

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

/** AMiner results: two versions of the DPO paper and one unrelated paper. */
const AMINER_RESULTS_HTML = `
<div class="result">
  <a class="title-link" href="/pub/6532c8b2939a5f40820a0e11/direct-preference-optimization-your-language-model-is-secretly-a-reward-model"><span title="Direct Preference Optimization: Your Language Model is Secretly a Reward Model">Direct Preference Optimization: Your Language Model is Secretly a Reward Model</span></a>
</div>
<div class="result">
  <a class="title-link" href="/pub/6532c8b2939a5f40820a0e12/direct-preference-optimization"><span title="Direct Preference Optimization">Direct Preference Optimization</span></a>
</div>
<div class="result">
  <a class="title-link" href="/pub/6532c8b2939a5f40820a0e13/graph-networks"><span title="Graph Networks for Molecules">Graph Networks for Molecules</span></a>
</div>
`;

function parse(html: string): Document {
  const win = Zotero.getMainWindow() as unknown as {
    DOMParser: new () => DOMParser;
  };
  return new win.DOMParser().parseFromString(html, "text/html");
}

/** The fake page: it answers `candidates` with what its results list shows. */
function fakeDeps(candidates: PaperCandidate[]) {
  const opened: string[] = [];
  const notices: string[] = [];
  const started: string[] = [];
  const closed: string[] = [];
  const queries: Array<{ name: string; site: unknown }> = [];

  const deps: PaperLookupDeps = {
    async openSession(url) {
      started.push(url);
      const session: PaperSession = {
        async query(name, data) {
          queries.push({ name, site: data?.site });
          return name === "candidates" ? candidates : null;
        },
        close() {
          closed.push(url);
        },
      };
      return session;
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

  return { deps, opened, notices, started, closed, queries };
}

describe("opening the AMiner and ChatPaper pages", function () {
  describe("reading the real ChatPaper results page", function () {
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

  describe("reading the AMiner results page", function () {
    it("lists only the paper links, with their English titles", function () {
      const found = dom.aminerCandidates(
        parse(AMINER_RESULTS_HTML),
        aminerSearchURL(DPO_ITEM_TITLE),
      );
      assert.equal(found.length, 3);
      assert.equal(found[0].href, DPO_AMINER_HREF);
      assert.include(found[0].titles ?? [], DPO_EN_TITLE);
    });

    it("picks the DPO paper for the title as it is written in the library", function () {
      const picked = pickBestMatch(
        DPO_ITEM_TITLE,
        dom.aminerCandidates(
          parse(AMINER_RESULTS_HTML),
          aminerSearchURL(DPO_ITEM_TITLE),
        ),
      );
      assert.equal(picked?.href, DPO_AMINER_HREF);
    });
  });

  describe("pickBestMatch", function () {
    it("takes the result whose title is closest to the paper", function () {
      const picked = pickBestMatch("Attention Is All You Need", [
        {
          href: "https://www.aminer.cn/pub/1/speech",
          title: "Attention is All You Need in Speech Separation",
        },
        {
          href: "https://www.aminer.cn/pub/2/attention",
          title: "Attention is All You Need",
        },
      ]);
      assert.equal(picked?.href, "https://www.aminer.cn/pub/2/attention");
    });

    it("takes the first of several versions with the same title", function () {
      const picked = pickBestMatch("Attention Is All You Need", [
        {
          href: "https://www.aminer.cn/pub/a/attention",
          title: "Attention Is All You Need",
        },
        {
          href: "https://www.aminer.cn/pub/b/attention",
          title: "attention is all you need",
        },
      ]);
      assert.equal(picked?.href, "https://www.aminer.cn/pub/a/attention");
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
          href: "https://www.aminer.cn/pub/x/graphs",
          title: "Graph Neural Networks for Molecules",
        },
      ]);
      assert.isNull(picked);
    });

    it("skips results without a title or an address", function () {
      const picked = pickBestMatch("Attention Is All You Need", [
        { href: "https://www.aminer.cn/pub/empty", title: "   " },
        { href: "", title: "Attention Is All You Need" },
        {
          href: "https://www.aminer.cn/pub/ok",
          title: "Attention Is All You Need",
        },
      ]);
      assert.equal(picked?.href, "https://www.aminer.cn/pub/ok");
    });

    it("returns nothing for an empty list", function () {
      assert.isNull(pickBestMatch("Attention Is All You Need", []));
    });
  });

  describe("search addresses", function () {
    it("builds the ChatPaper search address from the title", function () {
      assert.equal(
        chatPaperSearchURL("  Attention Is All You Need  "),
        "https://chatpaper.com/zh-CN/search?keywords=Attention%20Is%20All%20You%20Need&type=all",
      );
    });

    it("builds the AMiner search address from the title", function () {
      assert.equal(
        aminerSearchURL("  Attention Is All You Need  "),
        "https://www.aminer.cn/search/pub?q=Attention%20Is%20All%20You%20Need",
      );
    });
  });

  describe("lookupPaperPage", function () {
    // The site set-up is built inside each test, not while the suite is
    // being declared, so the work only happens when a test runs.
    const siteCases = (): Array<{
      site: PaperSite;
      name: string;
      search: string;
      candidates: PaperCandidate[];
      href: string;
    }> => [
      {
        site: "aminer",
        name: "AMiner",
        search: aminerSearchURL(DPO_ITEM_TITLE),
        candidates: dom.aminerCandidates(
          parse(AMINER_RESULTS_HTML),
          aminerSearchURL(DPO_ITEM_TITLE),
        ),
        href: DPO_AMINER_HREF,
      },
      {
        site: "chatpaper",
        name: "ChatPaper",
        search: chatPaperSearchURL(DPO_ITEM_TITLE),
        candidates: dom.chatPaperCandidates(
          parse(CHATPAPER_RESULTS_HTML),
          chatPaperSearchURL(DPO_ITEM_TITLE),
        ),
        href: DPO_CHATPAPER_HREF,
      },
    ];

    for (const site of ["aminer", "chatpaper"] as const) {
      it(`${site}: opens the best match and stops there`, async function () {
        const each = siteCases().find((item) => item.site === site)!;
        const fake = fakeDeps(each.candidates);

        await lookupPaperPage(each.site, DPO_ITEM_TITLE, fake.deps);

        assert.deepEqual(fake.started, [each.search]);
        assert.deepEqual(fake.opened, [each.href]);
        assert.deepEqual(
          fake.closed,
          [each.search],
          "the hidden page is closed",
        );
        assert.isTrue(fake.notices.some((line) => line.startsWith(each.name)));
        assert.isTrue(
          fake.queries.every((query) => query.site === each.site),
          "the page is asked about this site only",
        );
      });

      it(`${site}: opens nothing when no result is close enough`, async function () {
        const each = siteCases().find((item) => item.site === site)!;
        const fake = fakeDeps([
          {
            href: "https://example.org/unrelated",
            title: "Graph Neural Networks for Molecules",
          },
        ]);

        await lookupPaperPage(each.site, DPO_ITEM_TITLE, fake.deps);

        assert.deepEqual(fake.opened, []);
        assert.isTrue(fake.notices.some((line) => line.startsWith(each.name)));
      });
    }

    it("does not open a page when the results never arrive", async function () {
      const fake = fakeDeps([]);

      await lookupPaperPage("aminer", DPO_ITEM_TITLE, fake.deps);

      assert.deepEqual(fake.opened, []);
      assert.deepEqual(fake.closed, [aminerSearchURL(DPO_ITEM_TITLE)]);
    });
  });
});
