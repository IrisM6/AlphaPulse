/* global JSWindowActorChild */
/**
 * The page side of "open the ChatPaper page".
 *
 * ChatPaper's search results are built with JavaScript, and the hidden browser
 * the plugin reads them in is remote, so the plugin cannot see the list
 * directly. This window actor runs inside the ChatPaper page only, and answers
 * one request: the paper links on the results page. Which one is the paper is
 * decided on the parent side.
 */

import { chatPaperCandidates } from "./paper-dom.mjs";

export class AlphaPulsePaperChild extends JSWindowActorChild {
  receiveMessage(message) {
    const doc = this.document;
    if (!doc) return null;

    if (message.name === "candidates") {
      return chatPaperCandidates(doc, doc.location?.href ?? "");
    }
    return null;
  }
}
