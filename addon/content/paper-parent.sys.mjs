/* global JSWindowActorParent */
/**
 * The chrome side of the "find this paper" page actor. It has no behaviour of
 * its own: the lookup in `src/modules/paper-sites.ts` sends it requests, and
 * the page side (`paper-child.sys.mjs`) answers them. It only has to exist so
 * that `getActor` on the hidden browser hands back a usable object.
 */
export class AlphaPulsePaperParent extends JSWindowActorParent {}
