/* global JSWindowActorParent */
/**
 * The plugin side of "open the AMiner / ChatPaper page".
 *
 * The plugin asks the page for its result list with `sendQuery("candidates")`;
 * the page answers from `paper-child.sys.mjs`. Nothing needs to arrive the
 * other way, so this actor only has to exist for the messages to flow.
 */

export class AlphaPulsePaperParent extends JSWindowActorParent {}
