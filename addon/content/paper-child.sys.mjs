/* global JSWindowActorChild */
/**
 * The page side of "open the AMiner / ChatPaper page".
 *
 * Both sites build their search results with JavaScript, and the hidden browser
 * the plugin reads them in is remote, so the plugin cannot see the list
 * directly. This window actor runs inside those two sites only, and answers one
 * request: the paper links on the results page. Which one is the paper is
 * decided on the parent side.
 */

import { aminerCandidates, chatPaperCandidates } from "./paper-dom.mjs";

export class AlphaPulsePaperChild extends JSWindowActorChild {
  receiveMessage(message) {
    const doc = this.document;
    if (!doc) return null;

    if (message.name === "candidates") {
      const base = doc.location?.href ?? "";
      return message.data?.site === "aminer"
        ? aminerCandidates(doc, base)
        : chatPaperCandidates(doc, base);
    }
    return null;
  }
}
