# AlphaPulse interface strings (English).
# Used by the column labels, the context menu, the cell tooltips
# (src/modules/l10n.ts) and the settings pane.

# --- Columns and menu -------------------------------------------------------

column-label = alphaXiv Likes
column-citations-label = Citations
menu-refresh = Refresh like counts
menu-refresh-citations = Refresh citation counts
menu-open-scholar = Open the search page in Google Scholar in your browser
menu-manual-citations = Fill in the citation count by hand…
manual-citations-title = AlphaPulse · citation count
manual-citations-message = Type the number the Citations column should show for this item. An empty box hands the item back to the automatic read.
manual-citations-done = The Citations column now shows {count}, and the automatic read leaves this item alone.
manual-citations-cleared = The typed number is gone; the automatic read takes this item over again.
manual-citations-invalid = That is not a citation count. Type digits only, or leave the box empty to clear it.
notify-manual-title = AlphaPulse · citation count
cell-source-manual = manual entry
notify-open-scholar = Opened the search page in your browser. That is the browser's own session and does not affect what the plugin reads.
menu-open-alphaxiv = Open the alphaXiv page
menu-open-aminer = Open the AMiner page
menu-open-chatpaper = Open the ChatPaper page
notify-paper-searching = Searching {site} for "{title}"…
notify-paper-no-match = No result on {site} is close enough to this paper, so no page was opened.
notify-paper-opened = The best match on {site} is open in your browser.
notify-paper-busy = This site is still looking up the previous paper; please wait.
notify-paper-no-title = This item has no title, so there is nothing to search for.
notify-paper-no-browser = The background browser could not start, so the lookup could not run.
notify-paper-failed = The lookup failed partway; no page was opened.
menu-activity-wait-seconds = {seconds} seconds
menu-activity-wait-minutes = {minutes} minutes
menu-activity-idle = Nothing is being read or waiting to be retried
menu-activity-none-selected = None of the selected items is being read or waiting to be retried
menu-activity-item-reading = {title}: reading
menu-activity-item-queued = {title}: waiting its turn ({ahead} ahead of it · {count} request(s) for this item)
menu-activity-item-next = {title}: next to be read · starting in about {wait}
menu-activity-item-starting = {title}: next to be read · starting right away
menu-activity-item-retry = {title}: {count} request(s) for this item · retrying automatically in about {wait}
menu-activity-item-retry-now = {title}: {count} request(s) for this item · retrying right away
menu-activity-item-paused = {title}: {count} request(s) for this item · automatic retries are paused
menu-activity-overflow = and {count} more, each with its own wait
activity-untitled = (untitled)
notify-alphaxiv-title = AlphaPulse · alphaXiv
notify-open-alphaxiv = The paper's alphaXiv page is open in your browser.
error-no-arxiv-id = None of the selected items has an arXiv ID, so there is no alphaXiv page to open.
menu-clear = Remove the Extra records this plugin wrote

# --- Cells ------------------------------------------------------------------

cell-loading = Reading…
cell-citations-loading = Reading the citation count…
cell-citations-loading-from = Reading the citation count ({sources})…
cell-unavailable = No like count found
cell-citations-unavailable = No citation count found
cell-unavailable-reason = Read failed: {reason} · {retry}
cell-citations-unavailable-reason = Read failed: {reason} · {retry}
cell-citations-not-found = No high-confidence match in Google Scholar (the title was searched)
cell-citations-waiting-cancelled = This wait was cancelled and will not be retried; use the item menu → Refresh citation counts to queue it again
cell-no-alphaxiv = alphaXiv has no record of this paper, so there is no like count to read (it will not be retried)
cell-filtered = Hidden by the like-count filter
cell-cleared = Records cleared; refresh from the context menu to read them again
cell-trend = {delta} since the previous snapshot (now {likes})
cell-high-impact = Top 10% of its field and year
cell-scholar-blocked = Google Scholar is asking for a human check; retrying in about {minutes} minutes
cell-scholar-rate-limited = Google Scholar is rate limiting this address (HTTP 429); retrying in about {minutes} minutes
cell-citation-source = Source: {source}
cell-split-prefix = likes
cell-split-prefix-citations = cited
cell-quantile-high = High for the items in view
cell-quantile-low = Low for the items in view
cell-quantile-mid = Mid-range for the items in view
cell-quantile-title = {label}: high from {high} likes, low up to {low} (ranked against {sample} items)

failure-http-403 = the site refused the request (HTTP 403)
failure-http-429 = the request was rate limited (HTTP 429)
failure-http-4xx = the request was refused (HTTP 4xx)
failure-http-5xx = the site answered with a server error (HTTP 5xx)
failure-network = the request never reached the site (network, DNS, proxy or timeout)
failure-empty = the site answered with an empty response
failure-no-count = the page arrived without that number
failure-not-selected = Google Scholar is not read for unselected items; select it or refresh from the context menu
cell-retry-in = retrying automatically in about {minutes} minutes
cell-burst-pause = this burst is finished; reading resumes in about {minutes} minutes

# --- Refresh summaries ------------------------------------------------------

notify-refresh-likes-title = AlphaPulse · likes
notify-refresh-citations-title = AlphaPulse · citations
refresh-likes-updated = Re-read {updated} like count(s)
refresh-citations-updated = Re-read {updated} citation count(s)
refresh-failed = {failed} could not be read (the old value is kept)
refresh-failed-retry = {failed} could not be read (the old value is kept; retrying automatically in about {minutes} minutes)
refresh-missing = {missing} have no high-confidence match in Google Scholar
refresh-queued = {queued} joined the waiting list (reads are sequential; each is read when its turn comes, nothing to do)
refresh-missing-likes = {missing} are not on alphaXiv, so there is no like count to read
refresh-skipped-likes = {skipped} have no arXiv ID to read a like count with
refresh-skipped = {skipped} have a title too short to search for
refresh-nothing = Nothing to refresh.
refresh-joining = "; "
progress-error = AlphaPulse could not finish this update: {message}

notify-scholar-title = AlphaPulse · Google Scholar
notify-scholar-blocked = Google Scholar is asking for a human check; retrying automatically in about {minutes} minutes.
notify-scholar-rate-limited = Google Scholar is rate limiting (HTTP 429); retrying automatically in about {minutes} minutes.
notify-scholar-paused = Google Scholar has refused several rounds; automatic retrying has stopped. Refresh by hand later and the automatic retrying picks up again.

# --- Clear ------------------------------------------------------------------

notify-clear-title = AlphaPulse · clear
clear-done = Cleared the plugin's records from {count} item(s); everything else in Extra is untouched, and nothing is written again until the next refresh.
clear-none = There was nothing of the plugin's to clear; nothing is written again until the next refresh.

error-no-selection = Select at least one item first.
error-single-selection = This action works on a single item only.

# ===========================================================================
# Settings pane
# ===========================================================================

pref-pane-intro = Reads each paper's alphaXiv likes and citation count and writes them into the item's Extra field.

pref-match-title = arXiv matching
pref-match-desc = Reads the arXiv record from the link, the DOI or Extra; when it is not there, an academic API can look it up.
pref-match-auto =
    .label = Look up items that have no arXiv ID
pref-match-auto-accept = Accept automatically at this confidence (%)
pref-match-title-results = Results per title search
pref-match-use-arxiv =
    .label = Title search on the arXiv API
pref-match-use-s2 =
    .label = Semantic Scholar (DOI and title)
pref-match-use-openalex =
    .label = OpenAlex (DOI and title)
pref-match-use-crossref =
    .label = Crossref (DOI metadata)
pref-match-use-unpaywall =
    .label = Unpaywall (needs a contact email)
pref-match-contact = Contact email for OpenAlex / Unpaywall

pref-appearance-title = Appearance
pref-appearance-desc = How likes and citation counts are drawn in the columns.
pref-appearance-style = Style
pref-style-plain =
    .label = Plain text
pref-style-badge =
    .label = Glass pill
pref-style-ring =
    .label = Glass circle
pref-style-bookmark =
    .label = Accent block
pref-style-morandi =
    .label = Muted (Morandi)
pref-style-academic =
    .label = Academic
pref-style-fresh =
    .label = Fresh
pref-style-playful =
    .label = Playful
pref-style-outline =
    .label = Thin outline
pref-style-split =
    .label = Two-tone split
pref-style-dot =
    .label = Number badge

pref-color-title = Colour
pref-color-enabled =
    .label = Colour the like counts
pref-color-mode = Colour by
pref-color-mode-threshold =
    .label = Fixed thresholds
pref-color-mode-quantile =
    .label = Rank in the current list (quantiles)
pref-color-quantile-low = Low quantile (%)
pref-color-quantile-high = High quantile (%)
pref-color-high-threshold = High threshold
pref-color-low-threshold = Low threshold
pref-color-high = Colour
pref-color-low = Colour
pref-color-mid = Colour for the middle range (blank uses the theme colour)
pref-color-quantile-note = Below the low quantile is low, above the high quantile is high; with too few values it falls back to the fixed thresholds.
pref-color-picker = Click a swatch to open the picker (area + hue slider); a CSS colour can also be typed in.
pref-color-reset = Restore this style's default colours
pref-color-reset-note = After changing colours, this puts the style's own palette back.

pref-trend-title = Like trend
pref-trend-desc = Shows the day-to-day change in the column, as in "2979 ↑12".
pref-trend-show =
    .label = Show the daily change in the column
pref-trend-hot = Daily growth counted as "hot lately"
pref-trend-history = Days of snapshots to keep (up to 30)

pref-citations-title = Citations
pref-citations-desc = Citation data comes from Google Scholar, OpenAlex and Semantic Scholar.
pref-citations-enabled =
    .label = Show the Citations column and read citation data
pref-citations-ttl = Re-read after this many days (0 = read once)
pref-citations-scholar-note = Google Scholar has no public API, so the plugin reads the "Cited by" number from the results page. When Google rate limits or asks for a check it pauses and retries (from 10 minutes up to 2 hours) and never substitutes another source.
pref-citations-source = Citation sources
pref-citations-source-scholar =
    .label = Google Scholar (default)
pref-citations-source-openalex =
    .label = OpenAlex
pref-citations-source-s2 =
    .label = Semantic Scholar
pref-citations-source-note = Numbers come only from the ticked sources; with several ticked, the largest is shown and the tooltip names it.
pref-citations-s2-note = Semantic Scholar rate limits without a key.
pref-citations-sources = Citation sources (several may be ticked; the largest number is shown)


pref-refresh-title = Refresh and network
pref-refresh-desc = The two refresh actions are independent and act only on the selected items.
pref-scholar-pacing = Google Scholar reading rhythm
pref-scholar-pacing-desc = Reads are spread across the ranges below instead of repeating one interval; changes apply to the next search.
pref-scholar-dwell-min = Shortest stay on a loaded page (seconds)
pref-scholar-dwell-min-hint = suggested 4
pref-scholar-dwell-max = Longest stay on a loaded page (seconds)
pref-scholar-dwell-max-hint = suggested 8 (a short scroll first)
pref-scholar-activity-list = Reading progress per item: {list}
pref-scholar-activity-empty = Nothing is being read or waiting to be retried.
pref-scholar-activity-item-reading = {title} is being read ({count} request(s) for this item)
pref-scholar-activity-item-queued = {title} is waiting its turn ({ahead} ahead of it)
pref-scholar-activity-item-next = {title} is next to be read, in about {minutes} minutes
pref-scholar-activity-item-next-now = {title} is next to be read, starting right away
pref-scholar-activity-item-retry = {title} retries in about {minutes} minutes ({count} request(s) for this item)
pref-scholar-activity-item-paused = {title} is not being retried automatically ({count} request(s) for this item)
pref-scholar-activity-more = and {count} more
pref-scholar-cancel = Clear the waiting times (cancel the read attempts)
pref-scholar-cancel-desc = Drops the waiting list and its countdowns: nothing is retried automatically, and the counts already read are left as they are. Use the item menu → Refresh citation counts to read them again.
pref-scholar-cancel-done = Cancelled {count} waiting item(s); nothing will be retried automatically.
pref-scholar-cancel-none = Nothing is waiting.
pref-scholar-pace-current = In effect: {min}–{max} seconds between searches, {dwellMin}–{dwellMax} seconds on a loaded page, and a {pauseMin}–{pauseMax} minute rest after every {batchMin}–{batchMax} searches
pref-scholar-interval-min = Shortest gap between two searches (s)
pref-scholar-interval-min-hint = suggested 16
pref-scholar-interval-max = Longest gap between two searches (s)
pref-scholar-interval-max-hint = suggested 30
pref-scholar-batch-min = Searches per burst (lower bound)
pref-scholar-batch-min-hint = suggested 8
pref-scholar-batch-max = Searches per burst (upper bound)
pref-scholar-batch-max-hint = suggested 15
pref-scholar-pause-min = Pause after a burst (minutes, lower bound)
pref-scholar-pause-min-hint = suggested 15
pref-scholar-pause-max = Pause after a burst (minutes, upper bound)
pref-scholar-pause-max-hint = suggested 40
pref-refresh-ttl = Re-read like counts after (days, 0 = never)
pref-refresh-interval = Minimum delay between requests to the same host (ms)
pref-refresh-timeout = Request timeout (ms)

pref-filter-title = Like-count range filter
pref-filter-desc = Items outside the range stay visible but the cell fades; the number itself is unchanged.
pref-filter-enabled =
    .label = Enable the like-count range filter
pref-filter-min = Minimum likes
pref-filter-max = Maximum likes (0 = no limit)

pref-citation-appearance-title = Citation appearance
pref-citation-appearance-desc = Citation counts are orders of magnitude away from like counts, so they can be styled and thresholded on their own.
pref-citation-appearance-linked =
    .label = Follow the like appearance settings
pref-citation-appearance-style = Citation style
pref-citation-color-enabled =
    .label = Colour the citation counts
pref-citation-color-mode = Colour by
pref-citation-color-mode-note = Thresholds are set below; the quantiles are shared with the Colour section.
pref-citation-color-high-threshold = High threshold
pref-citation-color-low-threshold = Low threshold
pref-citation-color-mid = Colour for the middle range (blank uses the theme colour)
pref-citation-color-reset = Restore the citation style's default colours
pref-citation-filter-enabled =
    .label = Enable the citation range filter
pref-citation-filter-min = Minimum citations
pref-citation-filter-max = Maximum citations (0 = no limit)
pref-citation-filter-note = As with the like filter: items outside the range stay visible, with a faded cell.
