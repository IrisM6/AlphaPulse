import { config } from "../package.json";
import {
  registerAlphaXivLikesColumn,
  shutdownAlphaXivLikesColumn,
} from "./modules/column";
import { loadStrings } from "./modules/l10n";
import { registerItemMenu, unregisterItemMenu } from "./modules/menu";
import {
  registerPaperActor,
  unregisterPaperActor,
} from "./modules/paper-sites";
import { observePrefs } from "./modules/prefs";

/**
 * Registers the AlphaPulse pane in Zotero's settings window.
 *
 * `Zotero.PreferencePanes` is not part of the bundled Zotero typings yet, so
 * the call is made through a narrow structural type.
 *
 * The pane icon must be a raster image: the sidebar renders it through a XUL
 * `<image>`, which sizes the source from its intrinsic dimensions. An SVG with
 * only a `viewBox` has none and would render as nothing. These files exist at
 * several sizes so HiDPI displays stay sharp.
 */
function registerPreferencePane(): void {
  const zotero = Zotero as unknown as {
    PreferencePanes?: {
      register(options: {
        pluginID: string;
        src: string;
        label: string;
        image?: string;
        scripts?: string[];
      }): unknown;
    };
  };

  try {
    zotero.PreferencePanes?.register({
      pluginID: config.addonID,
      src: `${rootURI}content/preferences.xhtml`,
      label: config.addonName,
      image: `chrome://${config.addonRef}/content/icons/favicon.png`,
      // Pane scripts run before the markup is parsed, which is where the
      // Fluent file has to be linked into the settings window.
      scripts: [`${rootURI}content/preferences.js`],
    });
  } catch (error) {
    Zotero.logError(
      new Error(
        `[AlphaPulse] Could not register the preference pane: ${error}`,
      ),
    );
  }
}

/**
 * The plugin's Fluent file, as it is named after the build prefixes it.
 *
 * Zotero registers every `.ftl` under `locale/<locale>/` automatically, but a
 * window only gets the messages once the file is linked into it. The link is
 * what `document.l10n` reads, so both the settings pane and the main window
 * need one.
 */
const FTL_FILE = `${config.addonRef}-addon.ftl`;

/** Links the Fluent file into a window. Safe to call more than once. */
function ensureWindowLocalization(win: Window): void {
  try {
    const target = win as unknown as {
      MozXULElement?: { insertFTLIfNeeded?(name: string): void };
    };
    target.MozXULElement?.insertFTLIfNeeded?.(FTL_FILE);
  } catch (error) {
    Zotero.debug(`[AlphaPulse] Could not link ${FTL_FILE}: ${error}`);
  }
}

/** Removes the link again, as the plugin-development docs ask on shutdown. */
function removeWindowLocalization(win: Window): void {
  try {
    win.document.querySelector(`[href="${FTL_FILE}"]`)?.remove();
  } catch {
    // The window is already gone.
  }
}

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  await registerAlphaXivLikesColumn();
  registerPaperActor();

  // The Fluent file has to be linked into the window before the strings are
  // read, otherwise the first read would fall back to the built-in English
  // text for the rest of the session.
  for (const win of Zotero.getMainWindows()) ensureWindowLocalization(win);
  await loadStrings();

  try {
    registerPreferencePane();
  } catch (error) {
    // A missing pane must not stop the column from working.
    Zotero.logError(error as Error);
  }

  // Repaint the column when a setting changes, so colour edits show up without
  // a restart. Column registration owns the repaint callback.
  try {
    observePrefs(() => {
      void Zotero.ItemTreeManager.refreshColumns?.();
    });
  } catch (error) {
    Zotero.debug(`[AlphaPulse] Could not observe preferences: ${error}`);
  }

  for (const win of Zotero.getMainWindows()) {
    registerItemMenu(win);
  }

  addon.data.initialized = true;
  Zotero.debug("[AlphaPulse] alphaXiv Likes column registered");
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  ensureWindowLocalization(win);
  registerItemMenu(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterItemMenu(win);
  removeWindowLocalization(win);
}

async function onShutdown(): Promise<void> {
  for (const win of Zotero.getMainWindows()) {
    unregisterItemMenu(win);
    removeWindowLocalization(win);
  }

  unregisterPaperActor();
  await shutdownAlphaXivLikesColumn();
  addon.data.alive = false;

  const zoteroWithPlugin = Zotero as _ZoteroTypes.Zotero & {
    [key: string]: unknown;
  };
  delete zoteroWithPlugin[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
