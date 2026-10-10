# AlphaPulse 界面文案（简体中文）。
# 供列标题、右键菜单、单元格提示（src/modules/l10n.ts）与设置面板使用。

# --- 列与菜单 ---------------------------------------------------------------

column-label = alphaXiv 点赞
column-citations-label = 引用数
menu-refresh = 刷新点赞数
menu-refresh-citations = 刷新引用数
menu-open-scholar = 在浏览器中打开 Google Scholar 搜索页
menu-manual-citations = 手动填写引用量…
manual-citations-title = AlphaPulse · 引用量
manual-citations-message = 输入这一条在「引用量」列里显示的数字。留空表示交回自动读取。
manual-citations-done = 「引用量」列现在显示 {count}；这一条不再自动读取。
manual-citations-cleared = 手动填的数字已清掉，这一条重新自动读取。
manual-citations-invalid = 这不是引用量。请只填数字，或留空清除。
notify-manual-title = AlphaPulse · 引用量
cell-source-manual = 手动输入
notify-open-scholar = 已在浏览器中打开搜索页。这是浏览器自己的会话，不影响插件读取。
menu-open-alphaxiv = 打开 alphaXiv 页面
menu-open-aminer = 打开 AMiner 页面
menu-open-chatpaper = 打开 ChatPaper 页面
notify-paper-searching = 正在 {site} 上查找「{title}」……
notify-paper-no-match = {site} 上没有找到足够相似的文献，没有打开任何页面。
notify-paper-opened = 已在默认浏览器打开 {site} 上最匹配的文献页面。
notify-paper-busy = 这个网站还在查找上一篇，请稍候。
notify-paper-no-title = 这篇条目没有标题，无法搜索。
notify-paper-no-browser = 无法启动后台浏览器，这次没能自动查找。
notify-paper-failed = 查找过程中出了错，没有打开任何页面。
menu-activity-wait-seconds = {seconds} 秒
menu-activity-wait-minutes = {minutes} 分钟
menu-activity-idle = 没有正在读取或等待重试的条目
menu-activity-none-selected = 所选条目没有正在读取或等待重试的记录
menu-activity-item-reading = {title}：正在读取
menu-activity-item-queued = {title}：排队等待读取（前面还有 {ahead} 条 · 本条已请求 {count} 次）
menu-activity-item-next = {title}：排在下一个 · 约 {wait} 后开始读取
menu-activity-item-starting = {title}：排在下一个 · 马上开始读取
menu-activity-item-retry = {title}：本条已请求 {count} 次 · 约 {wait} 后自动重试
menu-activity-item-retry-now = {title}：本条已请求 {count} 次 · 马上自动重试
menu-activity-item-paused = {title}：本条已请求 {count} 次 · 自动重试已暂停
menu-activity-overflow = 还有 {count} 条在等，各自的重试时间见悬停提示
activity-untitled = （无标题）
notify-alphaxiv-title = AlphaPulse · alphaXiv
notify-open-alphaxiv = 已在默认浏览器打开这篇论文的 alphaXiv 页面。
error-no-arxiv-id = 选中的条目里没有一个能确定 arXiv ID，无法打开 alphaXiv 页面。
menu-clear = 清除本插件写入的 Extra 记录

# --- 单元格 -----------------------------------------------------------------

cell-loading = 正在读取…
cell-citations-loading = 正在读取引用数…
cell-citations-loading-from = 正在读取引用数（{sources}）…
cell-unavailable = 未找到点赞数
cell-citations-unavailable = 未找到引用数
cell-unavailable-reason = 读取失败：{reason}·{retry}
cell-citations-unavailable-reason = 读取失败：{reason}·{retry}
cell-citations-not-found = 没有高置信度的对应文献（已按标题搜索）
cell-citations-waiting-cancelled = 已取消本次等待，不会再自动重试；需要时点右键 → 刷新引用数重新排队
cell-no-alphaxiv = alphaXiv 上没有找到这篇论文，没有点赞数可读（不会再自动重试）
cell-filtered = 已被点赞数范围筛选隐藏
cell-cleared = 记录已清除，右键刷新可重新读取
cell-trend = 较上次快照 {delta}（当前 {likes}）
cell-high-impact = 本领域同年份前 10%
cell-scholar-blocked = Google Scholar 要求人机验证，约 {minutes} 分钟后自动重试
cell-scholar-rate-limited = 被 Google Scholar 限流（HTTP 429），约 {minutes} 分钟后自动重试
cell-citation-source = 来源：{source}
cell-split-prefix = 赞
cell-split-prefix-citations = 引
cell-quantile-high = 当前列表中偏高
cell-quantile-low = 当前列表中偏低
cell-quantile-mid = 当前列表中居中
cell-quantile-title = {label}：{high} 个赞以上为高，{low} 个赞及以下为低（按当前 {sample} 个条目）

failure-http-403 = 站点拒绝请求（HTTP 403）
failure-http-429 = 请求过于频繁（HTTP 429）
failure-http-4xx = 请求被拒绝（HTTP 4xx）
failure-http-5xx = 对方服务器错误（HTTP 5xx）
failure-network = 请求未到达站点（网络、DNS、代理或超时）
failure-empty = 对方返回空响应
failure-no-count = 页面里没有那个数字
failure-not-selected = 未选中时不查询 Google Scholar；选中它，或用右键刷新
cell-retry-in = 约 {minutes} 分钟后自动重试
cell-burst-pause = 这一批已读满，约 {minutes} 分钟后继续读取

# --- 刷新结果 ---------------------------------------------------------------

notify-refresh-likes-title = AlphaPulse · 点赞
notify-refresh-citations-title = AlphaPulse · 引用数
refresh-likes-updated = 已重新读取 {updated} 条点赞数
refresh-citations-updated = 已重新读取 {updated} 条引用数
refresh-failed = {failed} 条未能读取（保留原值）
refresh-failed-retry = {failed} 条未能读取（保留原值，约 {minutes} 分钟后自动重试）
refresh-missing = {missing} 条没有找到高置信度的对应文献
refresh-queued = {queued} 条已加入等待列表（读取按顺序进行，轮到时自动读取，无需操作）
refresh-missing-likes = {missing} 条不在 alphaXiv 上，没有点赞数可读
refresh-skipped-likes = {skipped} 条无法确定 arXiv ID，没有可读的点赞数
refresh-skipped = {skipped} 条标题太短，无法自动检索
refresh-nothing = 没有可刷新的条目。
refresh-joining = ；
progress-error = AlphaPulse 无法完成本次更新：{message}

notify-scholar-title = AlphaPulse · Google Scholar
notify-scholar-blocked = Google Scholar 要求人机验证，约 {minutes} 分钟后自动重试。
notify-scholar-rate-limited = Google Scholar 限流（HTTP 429），约 {minutes} 分钟后自动重试。
notify-scholar-paused = Google Scholar 连续被拒，已停止自动重试；稍后手动刷新一次就会重新自动重试。

# --- 清除 -------------------------------------------------------------------

notify-clear-title = AlphaPulse · 清除
clear-done = 已清除 {count} 个条目中的插件记录，其余内容原样保留；刷新前不会自动写入。
clear-none = 没有可清除的插件记录；这些条目在刷新前不会自动写入。

error-no-selection = 请先选择至少一个条目。
error-single-selection = 该操作只能用于单个条目。

# ===========================================================================
# 设置面板
# ===========================================================================

pref-pane-intro = 读取每篇文献在 alphaXiv 的点赞数与引用数，并写入条目的 Extra 字段。

pref-match-title = arXiv 匹配
pref-match-desc = 从链接、DOI 或 Extra 字段读取 arXiv 记录；没有时可通过学术 API 自动查找。
pref-match-auto =
    .label = 自动查找没有 arXiv ID 的条目
pref-match-auto-accept = 达到该置信度（%）时自动采用
pref-match-title-results = 每次标题搜索返回的结果数
pref-match-use-arxiv =
    .label = 标题搜索 arXiv API
pref-match-use-s2 =
    .label = Semantic Scholar（DOI 与标题）
pref-match-use-openalex =
    .label = OpenAlex（DOI 与标题）
pref-match-use-crossref =
    .label = Crossref（DOI 元数据）
pref-match-use-unpaywall =
    .label = Unpaywall（需要联系邮箱）
pref-match-contact = OpenAlex / Unpaywall 联系邮箱

pref-appearance-title = 外观
pref-appearance-desc = 点赞数与引用数在列中的显示方式。
pref-appearance-style = 显示样式
pref-style-plain =
    .label = 纯文本
pref-style-badge =
    .label = 玻璃胶囊
pref-style-ring =
    .label = 玻璃圆形
pref-style-bookmark =
    .label = 侧边强调块
pref-style-morandi =
    .label = 莫兰迪低饱和
pref-style-academic =
    .label = 学术严谨
pref-style-fresh =
    .label = 淡雅清新
pref-style-playful =
    .label = 活泼明快
pref-style-outline =
    .label = 细边框描边
pref-style-split =
    .label = 双色拼接
pref-style-dot =
    .label = 数字角标

pref-color-title = 颜色
pref-color-enabled =
    .label = 为点赞数着色
pref-color-mode = 着色依据
pref-color-mode-threshold =
    .label = 固定阈值
pref-color-mode-quantile =
    .label = 按当前列表排名（分位数）
pref-color-quantile-low = 低赞分位（%）
pref-color-quantile-high = 高赞分位（%）
pref-color-high-threshold = 高赞阈值
pref-color-low-threshold = 低赞阈值
pref-color-high = 颜色
pref-color-low = 颜色
pref-color-mid = 中间区间颜色（留空则使用主题色）
pref-color-quantile-note = 低于低分位算低、高于高分位算高；样本不足时退回固定阈值。
pref-color-picker = 点颜色框展开取色面板（色域 + 色相条），也可直接输入 CSS 颜色。
pref-color-reset = 恢复这个样式的默认颜色
pref-color-reset-note = 改过颜色后可以随时点这里恢复。

pref-trend-title = 点赞趋势
pref-trend-desc = 列里显示每日变化，如「2979 ↑12」。
pref-trend-show =
    .label = 在列里显示每日变化
pref-trend-hot = 每日增长达到该数值视为「近期热门」
pref-trend-history = 保留最近多少天的快照（最多 30）

pref-citations-title = 引用数
pref-citations-desc = 引用数据来自 Google Scholar、OpenAlex 与 Semantic Scholar。
pref-citations-enabled =
    .label = 显示「引用数」列并查询引用数据
pref-citations-ttl = 缓存多少天后重新读取（0 = 只读一次）
pref-citations-scholar-note = Google Scholar 没有公开 API，读取搜索结果页上的 Cited by 数字；被限流或要求人机验证时自动暂停并重试（10 分钟起，最长 2 小时），不会用其它来源顶替。
pref-citations-source = 引用数来源
pref-citations-source-scholar =
    .label = Google Scholar（默认）
pref-citations-source-openalex =
    .label = OpenAlex
pref-citations-source-s2 =
    .label = Semantic Scholar
pref-citations-source-note = 数字只来自勾选的来源；多选时显示最大的一个，悬停可见来源。
pref-citations-s2-note = Semantic Scholar 未提供 key 时会限流。
pref-citations-sources = 引用数来源（可多选；多选时显示最大的数字）


pref-refresh-title = 刷新与网络
pref-refresh-desc = 两个刷新动作互不影响，只作用于选中的条目。
pref-scholar-pacing = Google Scholar 读取节奏
pref-scholar-pacing-desc = 读取会按下面的范围随机安排，避免固定节奏；改完立即生效。
pref-scholar-dwell-min = 打开页面后停留下限（秒）
pref-scholar-dwell-min-hint = 建议 4
pref-scholar-dwell-max = 打开页面后停留上限（秒）
pref-scholar-dwell-max-hint = 建议 8（会先向下滚一小段再读）
pref-scholar-activity-list = 各条目的读取进度：{list}
pref-scholar-activity-empty = 没有正在读取或等待重试的条目。
pref-scholar-activity-item-reading = {title} 正在读取（本条已请求 {count} 次）
pref-scholar-activity-item-queued = {title} 排队等待读取（前面还有 {ahead} 条）
pref-scholar-activity-item-next = {title} 排在下一个，约 {minutes} 分钟后开始读取
pref-scholar-activity-item-next-now = {title} 排在下一个，马上开始读取
pref-scholar-activity-item-retry = {title} 约 {minutes} 分钟后重试（本条已请求 {count} 次）
pref-scholar-activity-item-paused = {title} 自动重试已暂停（本条已请求 {count} 次）
pref-scholar-activity-more = 等 {count} 条
pref-scholar-cancel = 清空等待时间（取消读取尝试）
pref-scholar-cancel-desc = 清掉等待列表和上面的倒计时：不会再自动重试，已经读到的数字和已写入的记录都不动。想再读一次就用右键 → 刷新引用数。
pref-scholar-cancel-done = 已取消 {count} 条等待，不会再自动重试。
pref-scholar-cancel-none = 没有在等待的条目。
pref-scholar-pace-current = 当前：两次搜索间隔 {min}–{max} 秒，页面停留 {dwellMin}–{dwellMax} 秒，每 {batchMin}–{batchMax} 次后暂停 {pauseMin}–{pauseMax} 分钟
pref-scholar-interval-min = 两次搜索最短间隔（秒）
pref-scholar-interval-min-hint = 建议 16
pref-scholar-interval-max = 两次搜索最长间隔（秒）
pref-scholar-interval-max-hint = 建议 30
pref-scholar-batch-min = 每批最多搜索次数（下限）
pref-scholar-batch-min-hint = 建议 8
pref-scholar-batch-max = 每批最多搜索次数（上限）
pref-scholar-batch-max-hint = 建议 15
pref-scholar-pause-min = 每批后暂停（分钟，下限）
pref-scholar-pause-min-hint = 建议 15
pref-scholar-pause-max = 每批后暂停（分钟，上限）
pref-scholar-pause-max-hint = 建议 40
pref-refresh-ttl = 缓存多少天后重新读取点赞数（0 = 不自动）
pref-refresh-interval = 同一域名请求的最小间隔（毫秒）
pref-refresh-timeout = 请求超时（毫秒）

pref-filter-title = 点赞数范围筛选
pref-filter-desc = 范围之外的条目整格变淡，数字本身不受影响。
pref-filter-enabled =
    .label = 启用点赞数范围筛选
pref-filter-min = 最少点赞数
pref-filter-max = 最多点赞数（0 = 不限制）

pref-citation-appearance-title = 引用数外观
pref-citation-appearance-desc = 引用数与点赞数差着数量级，可以单独设置外观与阈值。
pref-citation-appearance-linked =
    .label = 引用数跟随点赞的外观设置
pref-citation-appearance-style = 引用数显示样式
pref-citation-color-enabled =
    .label = 为引用数着色
pref-citation-color-mode = 着色依据
pref-citation-color-mode-note = 阈值在下面设置；分位数与「颜色」一节共用低/高百分位。
pref-citation-color-high-threshold = 高引阈值
pref-citation-color-low-threshold = 低引阈值
pref-citation-color-mid = 中间区间颜色（留空则使用主题色）
pref-citation-color-reset = 恢复引用样式的默认颜色
pref-citation-filter-enabled =
    .label = 启用引用数范围筛选
pref-citation-filter-min = 最少引用数
pref-citation-filter-max = 最多引用数（0 = 不限制）
pref-citation-filter-note = 范围之外的条目整格变淡。
