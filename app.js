"use strict";

const $ = (selector, root = document) => root.querySelector(selector);

// テーマは data-fs-theme に持つ(公開先が data-theme を独自に付けても衝突しないように)。
// 保存済みの選択が無ければ、表示環境のライト/ダークに合わせる。
function initialTheme() {
  try { const saved = localStorage.getItem("future-sight-theme"); if (saved) return saved; } catch { /* storage 不可 */ }
  const host = document.documentElement.getAttribute("data-theme");
  if (host === "dark" || host === "light") return host;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  data: null,
  comments: [],
  fundamentals: {},
  marketHistory: {},
  earnings: {},
  indices: [],
  relations: { companies: {} },
  options: { state: "not_connected" },
  system: { sources: [], steps: [] },
  page: "home",
  theme: initialTheme(),
  selectedCode: "7203",
  horizon: 20,
  chartPeriod: "6m",
  chartInterval: "1d",
  chartData: [],
  trades: [],
  indicator: "macd",
  selectedModel: "ADOPTED",   // 2026-09-24: 既定は期限ごとの採用模型(主役)。CURRENT固定をやめた
  hoverIndex: null,
  chartOnly: false,
  predictionSort: "volume",
  sortDesc: true,
  market: "",
  industry: "",
  modelHorizon: 20,
  indexHorizon: 20,
  lab: null,
  inventory: null,
  evidence: {},
  edinet: {},
};

const modelColors = { ADOPTED: "#d49a1f", CURRENT: "#2778ef", GBM: "#7954dc", DNN: "#e24fa3", NLG: "#22a88a", CLAUDE: "#e07a3a" };
// 2026-09-25: 本命 = 水準の主役 + Claude補正(未検証)。補正の中身を小さく示す
// 2026-09-25: 並列表示(ユーザー決定)。Claude の独自予測は模型の予測と別枠で出し、足し合わせない(「本命」は廃止)
function claudeBadge(pred) {
  const c = pred?.claude; if (!c) return "";
  const tip = `${c.legacy ? "旧方式(模型+補正)" : "Claude の独自予測"}・未検証(答え合わせ中) ${c.reason || ""} / 出典: ${c.sources || ""}`;
  return `<span class="pill claude" title="${escapeHtml(tip)}">Claude ${percent(c.return)}</span>`;
}
function modelLabel(model, pred) { return model === "ADOPTED" ? `模型・主役(水準 ${pred?.adopted || "—"} / 順位 ${pred?.adoptedRank || pred?.adopted || "—"})` : model === "NLG" ? "予測の解説" : model === "CLAUDE" ? "Claude の独自予測(未検証)" : model; }
// 2026-09-25: 物理的にありえない予測(−100%未満=負の株価)を出した模型の値は、export 側で「過去に実際に起きた範囲」の端に収めてある。
//   収めた値には range={clipped, raw, lo, hi} が付くので、数字の横に「⚠外挿」を出して生の値を示す。
function rangeNote(x) { const r = x?.range; return r?.clipped ? `模型の出力 ${percent(r.raw)} は、過去に実際に起きた範囲(${percent(r.lo)}〜${percent(r.hi)})の外。特徴量が学習範囲を外れたときの線形・DNN模型の外挿なので、範囲の端に収めて表示しています` : ""; }
function rangeBadge(x) { const t = rangeNote(x); return t ? `<span class="pill warning range-flag" title="${escapeHtml(t)}">⚠外挿</span>` : ""; }
function outsideBand(pred, price) { const p = number(price); return p !== null && number(pred?.low90) !== null && number(pred?.high90) !== null && (p < pred.low90 || p > pred.high90); }
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function yen(value) {
  const parsed = number(value);
  if (parsed === null) return "—";
  return `${Math.round(parsed).toLocaleString("ja-JP")}円`;
}

function percent(value, digits = 1) {
  const parsed = number(value);
  if (parsed === null) return "—";
  return `${parsed >= 0 ? "+" : ""}${(parsed * 100).toFixed(digits)}%`;
}

function metricPercent(value, digits = 1) {
  const parsed = number(value);
  return parsed === null ? "—" : `${(parsed * 100).toFixed(digits)}%`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function setTheme(theme) {
  const allowed = ["light", "dark", "prototype", "earth"];
  state.theme = allowed.includes(theme) ? theme : "light";
  document.documentElement.dataset.fsTheme = state.theme;
  try { localStorage.setItem("future-sight-theme", state.theme); } catch { /* 保存できない環境でも表示は続ける */ }
  $$("[data-theme-value]").forEach((button) => button.classList.toggle("active", button.dataset.themeValue === state.theme));
  requestAnimationFrame(drawAllCharts);
}

function navigate(page, opts = {}) {
  if (!$((`[data-page="${page}"]`))) return;
  state.page = page;
  $$(".page").forEach((section) => section.classList.toggle("active", section.dataset.page === page));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.nav === (page === "index" ? "indices" : page)));
  document.body.classList.remove("menu-open");
  if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: "auto" });
  if (!opts.keepHash) { if (page === "chart") state.stockView = ""; history.replaceState(null, "", `#${pageHash(page)}`); }
  // チャート(TradingView 型)は1つの部品を、表示中のページ(個別銘柄・チャート専用・指数)へ付け替えて使う
  if (page === "chart") requestAnimationFrame(() => { mountTv("tvHostStock"); loadChart(state.selectedCode); });
  if (page === "charts") requestAnimationFrame(() => { mountTv("tvHostCharts"); loadChartsPage(); });
  if (page === "index") requestAnimationFrame(() => { mountTv("tvHostIndex"); renderIndexPage(); });
  if (page === "research") requestAnimationFrame(() => renderResearch());
  if (page === "guidance") requestAnimationFrame(() => renderGuidance());
  if (page === "construction") requestAnimationFrame(() => renderConstruction());
  if (page === "experimental") requestAnimationFrame(() => renderExperimental());
  if (page === "models") requestAnimationFrame(drawModelChart);
  if (page === "indices") requestAnimationFrame(renderIndices);
  if (page === "lab") requestAnimationFrame(drawLabCharts);
  if (page === "data") requestAnimationFrame(drawDataCharts);
  hideTip();
}
async function loadData() {
  // 2026-09-25 最適化: dashboard.json が届いた時点でホームを先に描く(残りの約10MBは並行して読み込み続ける)。
  //   Pages 版は各 JSON を復号してから使うので、以前は全部そろうまで画面が空だった。
  const get = (path, fallback) => fetch(path, { cache: "no-store" }).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  const dashboardPromise = fetch("data/dashboard.json", { cache: "no-store" });
  const restPromise = Promise.all([
    get("data/comments.json", []), get("data/fundamentals.json", {}), get("data/market-history.json", {}), get("data/system.json", { sources: [], steps: [] }),
    get("data/earnings.json", {}), get("data/indices.json", []), get("data/relations.json", { companies: {} }), get("data/options.json", { state: "not_connected" }),
    get("data/model-lab.json", null), get("data/data-inventory.json", null), get("data/evidence.json", {}), get("data/edinet.json", {}), get("data/company.json", { stocks: {} }), get("data/field-catalog.json", {}),
  ]);
  const marketPromise = loadMarketData();
  const dashboardResponse = await dashboardPromise;
  if (!dashboardResponse.ok) throw new Error("dashboard.json を読み込めませんでした");
  state.data = await dashboardResponse.json();
  try { renderHome(); document.body.classList.add("fs-partial"); } catch (error) { console.warn(error); }
  [state.comments, state.fundamentals, state.marketHistory, state.system, state.earnings, state.indices, state.relations, state.options,
    state.lab, state.inventory, state.evidence, state.edinet, state.company, state.fieldCatalog] = await restPromise;
  await marketPromise;
  document.body.classList.remove("fs-partial");
  const preferred = state.data.predictions.find((row) => row.code === "7203") || state.data.predictions[0];
  if (preferred) state.selectedCode = preferred.code;
  state.sym = { type: "stock", code: state.selectedCode };
}
function renderHome() {
  const data = state.data;
  $("#headerAsOf").textContent = `${data.asOf || "—"} 更新`;
  $("#dataSummary").textContent = `${data.predictableCount}/${data.universeCount}銘柄 · ${data.featureCount || "—"}特徴量`;
  $("#heroPredictionCount").textContent = data.predictableCount ?? "—";
  $("#heroFeatureCount").textContent = data.featureCount ?? "—";
  const top = data.predictions.filter((row) => row.periods?.["20"]?.return !== null).slice(0, 3);
  $("#homePredictions").innerHTML = top.map((row, index) => `
    <div class="rank-row"><b>${index + 1}</b><span>${escapeHtml(row.code)}</span><strong>${escapeHtml(row.name)}</strong><em>${percent(row.periods["20"].return)}</em></div>
  `).join("");
  const picks = data.predictions.filter((row) => row.periods?.["20"]?.return !== null).slice(0, 10);
  $("#homePicks").innerHTML = picks.map((row, index) => `<button type="button" data-pick-code="${escapeHtml(row.code)}"><b>${index + 1}</b><span>${escapeHtml(row.code)} ${escapeHtml(row.name)}</span><em>${percent(row.periods["20"].return)}</em></button>`).join("");
  $$('[data-pick-code]').forEach((button) => button.addEventListener("click", () => openStockChart(button.dataset.pickCode)));
  $("#homeNews").innerHTML = data.news.slice(0, 2).map((item) => `
    <article><time>${escapeHtml(item.publishedAt.slice(0, 16).replace("T", " "))} · ${escapeHtml(item.source || "情報源不明")}</time><p>${escapeHtml(item.title)}</p></article>
  `).join("") || "<p>ニュースはありません。</p>";
  drawHomeMiniChart();
  drawHomeModelChart();
  try { renderHomeExtras(); } catch (error) { console.warn(error); }
  renderUpdateTimes();
}

function predictionAt(row, horizon = state.horizon) {
  return row.periods?.[String(horizon)] || null;
}

function ensembleForecast(row, horizon = state.horizon) {
  const pred = predictionAt(row, horizon);
  if (!pred) return null;
  // 2026-09-24: 中心値は3模型の中央値ではなく水準の主役の予測(pred.return)。
  //   主役は検定で選ばれているので、有意に劣る模型(例 h=1 の DNN)を中央値で混ぜない。
  const returns = ["CURRENT", "GBM", "DNN"].map((name) => number(pred.models?.[name]?.return)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!returns.length && !Number.isFinite(number(pred.return))) return null;
  const blendedReturn = Number.isFinite(number(pred.return)) ? number(pred.return) : returns[Math.floor(returns.length / 2)];
  return {
    return: blendedReturn,
    price: number(row.close) === null ? null : row.close * (1 + blendedReturn),
    low68: pred.low68,
    high68: pred.high68,
    low90: pred.low90,
    high90: pred.high90,
    touchUp: pred.touchUp,
    touchDown: pred.touchDown,
    rewardRisk: pred.rewardRisk,
    method: "3数値モデルの中央値 + 保存済み共通レンジ",
  };
}

function modelForecast(row, horizon, model) {
  const pred = predictionAt(row, horizon);
  if (!pred) return null;
  if (model === "NLG") return ensembleForecast(row, horizon);
  if (model === "ADOPTED") return { ...pred };   // 最上位の return/price は水準の主役(模型)の予測。補正は足していない
  if (model === "CLAUDE") return pred.claude ? { ...pred, range: null, return: pred.claude.return, price: pred.claude.price } : null;
  return { ...pred, range: null, ...(pred.models?.[model] || {}) };
}
function setupPredictionFilters() {
  const select = $("#predictionIndustry");
  const industries = [...new Set(state.data.predictions.map((row) => row.industry).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  select.innerHTML = '<option value="">すべて</option>' + industries.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
}

function renderPredictions() {
  renderPredUcNote();
  const horizon = Number($("#predictionHorizon")?.value || state.horizon);
  state.horizon = horizon;
  const selectedModel = $("#predictionModel")?.value || state.selectedModel;
  state.selectedModel = selectedModel === "ALL" ? state.selectedModel : selectedModel;
  const query = ($("#predictionSearch")?.value || "").trim().toLowerCase();
  const industry = $("#predictionIndustry")?.value || "";
  let rows = state.data.predictions.filter((row) => {
    const matchesText = !query || `${row.code} ${row.name}`.toLowerCase().includes(query);
    return matchesText && (!industry || row.industry === industry) && predictionAt(row, horizon);
  });
  // 主役表示の並び順は「順位の主役」の予測で並べる(水準の主役とは別に選ばれている。core/selection.py TARGETS)。Claude を選ぶと Claude 順
  const sortValue = (row) => { const p = predictionAt(row, horizon); if (!p) return -999; if (selectedModel === "ALL" || selectedModel === "ADOPTED") return p.rankReturn ?? p.return ?? -999; if (selectedModel === "CLAUDE") return p.claude?.return ?? -999; return p.models?.[selectedModel]?.return ?? p.return ?? -999; };
  if (state.predictionSort === "volume") rows.sort((a, b) => (a.rank || 99999) - (b.rank || 99999));
  else rows.sort((a, b) => (sortValue(b) - sortValue(a)) * (state.sortDesc ? 1 : -1));
  const nClaude = rows.filter((row) => predictionAt(row, horizon)?.claude).length;
  $("#predictionCount").textContent = `${rows.length}銘柄${nClaude ? ` · Claude ${nClaude}` : ""}`;
  $("#predictionRows").innerHTML = rows.map((row) => {
    const pred = predictionAt(row, horizon);
    const model = selectedModel === "ALL" ? null
      : selectedModel === "CLAUDE" ? (pred.claude ? { return: pred.claude.return, price: pred.claude.price } : { return: null, price: null })
      : selectedModel === "ADOPTED" ? { return: pred.return, price: pred.price, range: pred.range }
      : (pred.models?.[selectedModel] || {});
    const displayReturn = number(model?.return);
    const changeClass = displayReturn === null ? "" : displayReturn >= 0 ? "positive-text" : "negative-text";
    const trio = ["CURRENT", "GBM", "DNN"].map((name) => `<span title="★=水準(予測VWAP)の主役 / ◆=順位の主役${pred.models?.[name]?.range ? ` / ⚠=${escapeHtml(rangeNote(pred.models[name]))}` : ""}"><b>${name}${pred.adopted === name ? "★" : ""}${(pred.adoptedRank || pred.adopted) === name ? "◆" : ""}</b> ${percent(pred.models?.[name]?.return)}${pred.models?.[name]?.range ? '<i class="warn-text">⚠</i>' : ""}</span>`).join("");
    const accuracy = state.data.companyMetrics?.[row.code]?.[String(horizon)]?.[(selectedModel === "ALL" || selectedModel === "ADOPTED" || selectedModel === "CLAUDE") ? (pred.adopted || "CURRENT") : selectedModel];
    const c = pred.claude;
    const claudeCell = c ? `<span class="${c.return >= 0 ? "positive-text" : "negative-text"}" title="${escapeHtml(`${c.legacy ? "旧方式(模型+補正)" : "独自予測"}・未検証 ${c.reason || ""}`)}">${percent(c.return)}</span><small>${yen(c.price)}${c.legacy ? " · 旧方式" : ""}</small>` : '<span class="muted">—</span>';
    const band = selectedModel !== "ALL" && outsideBand(pred, model?.price) ? '<small class="warn-text" title="この点予測は同じ期限の90%区間の外">帯の外</small>' : "";
    return `<tr>
      <td><button class="company-link" data-open-chart="${escapeHtml(row.code)}"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.code)}</span></button></td>
      <td>${row.rank ? `#${row.rank}` : "—"}${row.volumeRank ? `<small>出来高 #${row.volumeRank}</small>` : ""}</td><td>${yen(row.close)}</td><td class="${changeClass}">${selectedModel === "ALL" ? "比較" : percent(displayReturn)}${model?.range ? rangeBadge(model) : ""}${band}</td><td>${yen(model?.price ?? pred.price)}</td><td class="claude-cell">${claudeCell}</td>
      <td class="range-cell">${yen(pred.low68)}〜${yen(pred.high68)}</td><td><div class="model-trio">${trio}</div></td><td>${accuracy ? `${metricPercent(accuracy.directionAccuracy)} <small>n=${accuracy.samples}</small>` : "—"}</td><td>${metricPercent(pred.touchUp)}</td><td>${pred.rewardRisk ?? "—"}</td>
      <td><button class="row-action" data-open-chart="${escapeHtml(row.code)}">個別</button></td>
    </tr>`;
  }).join("");
  $$('[data-open-chart]').forEach((button) => button.addEventListener("click", () => openStockChart(button.dataset.openChart)));
}
function renderIndustryGrid() {
  const counts = new Map();
  state.data.predictions.forEach((row) => counts.set(row.industry, (counts.get(row.industry) || 0) + 1));
  const items = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("#industryGrid").innerHTML = items.map(([name, count]) => `<button class="industry-chip ${state.industry === name ? "active" : ""}" data-industry="${escapeHtml(name)}"><strong>${escapeHtml(name)}</strong><span>${count}銘柄 ›</span></button>`).join("");
  $$("[data-industry]").forEach((button) => button.addEventListener("click", () => {
    state.industry = state.industry === button.dataset.industry ? "" : button.dataset.industry;
    renderIndustryGrid(); renderStocks();
  }));
}

function renderStocks() {
  const onlyForecast = $("#forecastOnly")?.checked ?? true;
  let rows = state.data.predictions.filter((row) => (!state.market || row.market === state.market) && (!state.industry || row.industry === state.industry));
  if (onlyForecast) rows = rows.filter((row) => predictionAt(row, 20));
  rows.sort((a, b) => (a.rank || 99999) - (b.rank || 99999));
  $("#stockResultCount").textContent = `${rows.length.toLocaleString("ja-JP")}件`;
  $("#stockGrid").innerHTML = rows.slice(0, 60).map((row) => {
    const pred = predictionAt(row, 20);
    const value = pred?.return;
    const financial = state.fundamentals?.[row.code]?.at(-1) || {};
    return `<tr tabindex="0" data-stock-card="${escapeHtml(row.code)}"><td>#${row.rank || "—"}</td><td><div class="company-cell"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.code)}</span></div></td><td>${escapeHtml(row.market)} · ${escapeHtml(row.industry)}</td><td>${yen(row.close)}</td><td>${financial.sales == null ? "—" : Math.round(financial.sales).toLocaleString("ja-JP")}</td><td>${financial.operatingProfit == null ? "—" : Math.round(financial.operatingProfit).toLocaleString("ja-JP")}</td><td>${financial.eps == null ? "—" : financial.eps.toLocaleString("ja-JP")}</td><td>${financial.dividend == null ? "—" : yen(financial.dividend)}</td><td class="${value >= 0 ? "positive-text" : "negative-text"}">${percent(value)}</td></tr>`;
  }).join("");
  $$('[data-stock-card]').forEach((card) => {
    const action = () => openStockChart(card.dataset.stockCard);
    card.addEventListener("click", action); card.addEventListener("keydown", (event) => { if (event.key === "Enter") action(); });
  });
}

function setupChartPicker() {
  const select = $("#chartStock"); if (!select) return;
  select.innerHTML = [...state.data.predictions].sort((a,b) => (a.rank || 99999) - (b.rank || 99999)).map((row) => `<option value="${escapeHtml(row.code)}">${escapeHtml(row.code)} ${escapeHtml(row.name)}</option>`).join("");
  select.value = state.selectedCode;
}

function openStockChart(code) {
  goStock(code);
}

async function loadChart(code) {
  if (!code) return;
  const company = state.data.predictions.find((row) => row.code === code);
  if (state.tv && (state.sym?.type !== "stock" || state.sym?.code !== code)) { state.tv.count = null; state.tv.offset = 0; state.tv.hover = null; state.tv.pending = null; }
  state.selectedCode = code; state.sym = { type: "stock", code };
  if (state.watchMode === "index" && state.page === "chart") state.watchMode = "stock";
  if (company) { $("#chartTitle").textContent = company.name; $("#chartSubhead").textContent = `${company.code} · ${company.market} · ${company.industry}`; }
  if (state.tvLoadedKey !== code) {
    try { state.chartData = await fetchChartPoints(code); } catch { state.chartData = []; }
    if (code !== state.selectedCode) return;
    state.tvLoadedKey = code;
  }
  if (code !== state.selectedCode || state.page !== "chart") return;
  syncTvControls();
  renderForecastDetails();
  renderStockDetails();
  renderCommentTimeline();
  applyStockView();
  renderStockCards(company);
  drawStockChart();
  drawIndicatorChart();
  await fetchStockDetail(code);
  if (code !== state.selectedCode || state.page !== "chart") return;
  renderStockHeader(company);
  renderInsights(company);
  renderEarnings(company);
  renderStockCards(company);
}
function renderStockDetailsCore() {
  const company = state.data.predictions.find((row) => row.code === state.selectedCode);
  if (!company) return;
  const latest = state.chartData.at(-1) || {}; const previous = state.chartData.at(-2) || {};
  const dayChange = latest.c && previous.c ? latest.c / previous.c - 1 : null;
  $("#stockSnapshot").innerHTML = `<div class="section-title"><span>市場スナップショット</span><em>売買代金 #${company.rank || "—"}</em></div><div class="snapshot-price"><strong>${yen(latest.c ?? company.close)}</strong><span class="${dayChange >= 0 ? "positive-text" : "negative-text"}">${percent(dayChange)}</span></div><div class="snapshot-grid"><span>高値<b>${yen(latest.h)}</b></span><span>安値<b>${yen(latest.l)}</b></span><span>出来高<b>${(latest.v || 0).toLocaleString("ja-JP")}</b></span><span>業種<b>${escapeHtml(company.industry)}</b></span></div>`;

  const models = ["ADOPTED", "CURRENT", "GBM", "DNN", "CLAUDE", "NLG"];
  const auditHs = [1, 5, 20, 60, 126, 252];
  const matrixRows = models.map((name) => {
    const label = name === "ADOPTED" ? "模型・主役(採用)" : name === "NLG" ? "予測の解説" : name === "CLAUDE" ? "Claude(未検証)" : name;
    const cells = auditHs.map((horizon) => {
      const forecast = modelForecast(company, horizon, name);
      const pred = predictionAt(company, horizon);
      const flag = forecast && (forecast.range || (name !== "NLG" && outsideBand(pred, forecast.price))) ? `<i class="warn-text" title="${escapeHtml(forecast.range ? rangeNote(forecast) : "点予測が90%区間の外")}">⚠</i>` : "";
      return `<td class="${forecast?.return == null ? "" : forecast.return >= 0 ? "positive-text" : "negative-text"}">${percent(forecast?.return)}${flag}</td>`;
    }).join("");
    const metric = state.data.companyMetrics?.[company.code]?.[String(state.horizon)]?.[name];
    return `<tr data-company-model="${name}" class="${state.selectedModel === name ? "active" : ""}"><th><button type="button" data-company-model-button="${name}">${label}</button></th>${cells}<td>${name === "NLG" ? "合議値" : name === "CLAUDE" ? "答え合わせ中" : metric ? `${metricPercent(metric.directionAccuracy)} / n=${metric.samples}` : "実績なし"}</td></tr>`;
  }).join("");
  const selectedLatest = modelForecast(company, state.horizon, state.selectedModel);
  $("#companyModelAudit").innerHTML = `<div class="section-title"><div><span>期間別モデル比較</span><small>値は期間VWAPの予測騰落率</small></div><em>PER STOCK</em></div><div class="audit-matrix-wrap"><table class="audit-matrix"><thead><tr><th>モデル</th>${auditHs.map((h) => `<th>${h >= 126 ? `${horizonLabel(h).replace(/\(.*\)/, "")}⚠` : `${h}日`}</th>`).join("")}<th>${state.horizon}日実績</th></tr></thead><tbody>${matrixRows}</tbody></table></div><div class="latest-forecast-detail"><span>選択中 ${escapeHtml(modelLabel(state.selectedModel, predictionAt(company, state.horizon)))} / ${state.horizon}営業日</span><strong>${percent(selectedLatest?.return)} · ${yen(selectedLatest?.price)}</strong><small>${state.selectedModel === "NLG" ? "水準の主役の予測を中心に、3模型の食い違いを文章で補う合議値。独立した学習モデルではありません。" : "予測対象は期間中の平均価格（VWAP）"}</small></div>`;
  $$('[data-company-model-button]').forEach((button) => button.addEventListener("click", () => { state.selectedModel = button.dataset.companyModelButton; if ($("#forecastModel")) $("#forecastModel").value = state.selectedModel; renderForecastDetails(); renderStockDetails(); drawStockChart(); }));

  const fundamentals = state.fundamentals?.[company.code] || [];
  if ($("#stockFundamentals")) $("#stockFundamentals").innerHTML = fundamentals.length ? `<p class="unit-note">金額単位: 百万円 / EPS・配当: 円</p><div class="financial-table-wrap"><table class="financial-table"><thead><tr><th>決算期</th><th>売上高</th><th>営業利益</th><th>純利益</th><th>EPS</th><th>1株配当</th></tr></thead><tbody>${fundamentals.slice(-3).reverse().map((row) => `<tr><th>${escapeHtml(row.period || "—")}</th><td>${row.sales == null ? "—" : Math.round(row.sales).toLocaleString("ja-JP")}</td><td>${row.operatingProfit == null ? "—" : Math.round(row.operatingProfit).toLocaleString("ja-JP")}</td><td>${row.netIncome == null ? "—" : Math.round(row.netIncome).toLocaleString("ja-JP")}</td><td>${row.eps ?? "—"}</td><td>${row.dividend ?? "—"}</td></tr>`).join("")}</tbody></table></div><details><summary>過去${fundamentals.length}期を表示</summary><div class="financial-table-wrap"><table class="financial-table"><thead><tr><th>決算期</th><th>売上高</th><th>営業利益</th><th>純利益</th><th>EPS</th><th>1株配当</th></tr></thead><tbody>${fundamentals.slice().reverse().map((row) => `<tr><th>${escapeHtml(row.period || "—")}</th><td>${row.sales == null ? "—" : Math.round(row.sales).toLocaleString("ja-JP")}</td><td>${row.operatingProfit == null ? "—" : Math.round(row.operatingProfit).toLocaleString("ja-JP")}</td><td>${row.netIncome == null ? "—" : Math.round(row.netIncome).toLocaleString("ja-JP")}</td><td>${row.eps ?? "—"}</td><td>${row.dividend ?? "—"}</td></tr>`).join("")}</tbody></table></div></details>` : '<div class="empty-state"><p>財務履歴はありません。</p></div>';

  const histories = state.marketHistory?.[company.code] || { credit: [], dividends: [] }; const credit = histories.credit || []; const dividends = histories.dividends || []; const latestCredit = credit.at(-1); const latestDividend = dividends.at(-1);
  if ($("#stockMarketHistory")) $("#stockMarketHistory").innerHTML = `<div class="market-history-summary"><article><span>信用倍率</span><strong>${latestCredit?.ratio ?? "—"}倍</strong><small>${latestCredit?.date || "履歴なし"}</small></article><article><span>調整後DPS</span><strong>${latestDividend?.dps == null ? "—" : yen(latestDividend.dps)}</strong><small>${latestDividend?.fiscalYear || "履歴なし"}</small></article></div><details><summary>信用・配当の過去データ</summary><div class="history-columns"><div><b>信用残</b>${credit.slice().reverse().map((row) => `<p>${row.date}　売 ${Math.round(row.sellBalance || 0).toLocaleString()} / 買 ${Math.round(row.buyBalance || 0).toLocaleString()}　${row.ratio ?? "—"}倍</p>`).join("") || "<p>なし</p>"}</div><div><b>配当</b>${dividends.slice().reverse().map((row) => `<p>${row.fiscalYear}　${row.dps ?? "—"}円　配当性向 ${row.payoutRatio ?? "—"}%</p>`).join("") || "<p>なし</p>"}</div></div></details>`;

  const news = state.data.news.filter((item) => item.code === company.code).slice(0, 5);
  $("#stockNews").innerHTML = news.length ? news.map((item) => `<article class="stock-news-row"><time>${escapeHtml(item.publishedAt.slice(0,10))}</time><a href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></article>`).join("") : '<div class="empty-state"><p>保存済みの関連ニュースはありません。</p></div>';

  renderEarnings(company);
  renderRelations(company);
  renderOptimizer(company);
  renderInsights(company);
  renderStockHeader(company);
  renderBroker(company);
  renderSymbolCard();
  renderWatchlist();
}

function formatFinancial(value) { return value == null ? "—" : Math.round(value).toLocaleString("ja-JP"); }

function renderEarnings(company) {
  const detailItems = state.detail?.[company.code]?.earnings;
  const doc = detailItems?.length ? { sourceLabel: "株探 決算・業績", sourceUrl: `https://kabutan.jp/stock/finance?code=${company.code}`, items: detailItems } : state.earnings?.[company.code];
  const source = $("#earningsSource");
  if (doc?.sourceUrl) { source.href = doc.sourceUrl; source.hidden = false; source.textContent = `${doc.sourceLabel} ↗`; } else source.hidden = true;
  if (!doc?.items?.length) { $("#earningsHistory").innerHTML = '<div class="empty-state"><p>決算履歴はありません。</p></div>'; return; }
  $("#earningsHistory").innerHTML = `<div class="earnings-table-wrap"><table class="earnings-table"><thead><tr><th>発表日 / 期<small>小さい数字は前年同期比</small></th><th>売上高</th><th>営業利益</th><th>純利益</th><th>EPS</th><th>発表後5日</th><th>直前GBM 20日</th><th></th></tr></thead><tbody>${doc.items.slice().reverse().map((item, index) => `<tr><th>${escapeHtml(item.announceDate || "—")}<small>${escapeHtml(item.period || item.table)}${item.yoyBase ? ` / 比較: ${escapeHtml(item.yoyBase.period || item.yoyBase.periodEnd || "")}` : " / 前年同期なし"}</small></th><td>${formatFinancial(item.sales)}<small>${percent(item.yoy?.sales)}</small></td><td>${formatFinancial(item.operatingProfit)}<small>${percent(item.yoy?.operatingProfit)}</small></td><td>${formatFinancial(item.netIncome)}<small>${percent(item.yoy?.netIncome)}</small></td><td>${item.eps ?? "—"}<small>${percent(item.yoy?.eps)}</small></td><td class="${item.marketReaction5d >= 0 ? "positive-text" : "negative-text"}">${percent(item.marketReaction5d)}</td><td class="${item.gbm20?.return >= 0 ? "positive-text" : "negative-text"}">${percent(item.gbm20?.return)}<small>${item.gbm20?.asOf || "保存なし"}</small></td><td><button class="row-action" type="button" data-earning-detail="${index}">詳細</button></td></tr><tr class="earning-detail-row" data-earning-detail-row="${index}" hidden><td colspan="8"><strong>独自分析</strong><p>${escapeHtml(item.summary)}</p><small>決算実績は発表後に得た情報、GBMは発表日以前の保存値のみを使用。保存値がない場合は空欄です。</small></td></tr>`).join("")}</tbody></table></div>`;
  $$('[data-earning-detail]').forEach((button) => button.addEventListener("click", () => { const row = $(`[data-earning-detail-row="${button.dataset.earningDetail}"]`); row.hidden = !row.hidden; button.textContent = row.hidden ? "詳細" : "閉じる"; }));
}

function renderRelations(company) {
  const box = $("#relationGraph"); if (!box) return;
  const rel = state.relations || {}; const c = rel.companies?.[company.code] || {}; const gnn = rel.gnn || {};
  const edges = c.edges || []; const stat = c.statPeers || [];
  const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toFixed(d));
  const corrCell = (v) => { const x = number(v); if (x === null) return "<td>—</td>"; const a = Math.min(Math.abs(x), 1); return `<td style="background:color-mix(in srgb, ${x >= 0 ? "var(--positive)" : "var(--negative)"} ${Math.round(a * 45)}%, transparent)">${x.toFixed(2)}</td>`; };
  const typeColor = { jv: "#e24fa3", peer: "#3f7cf0", customer: "#26a69a", supplier: "#d99016", user: "#26a69a", material: "#8a6cf0", indicator: "#8a8f98" };
  // ---- GNN の状態(正しく学習できていないときは重みを出さない)
  const gnnBox = gnn.state === "ok"
    ? `<div class="rel-status ok"><b>GNN(グラフ注意ネットワーク)</b><span>検証 ${escapeHtml(gnn.asof || "")}・日次IC ${fmt(gnn.meta?.val_ic, 3)}</span></div>`
    : `<div class="rel-status bad"><b>GNN の注意重みは表示を停止中</b><ul>${(gnn.reasons || ["GNN の出力がまだ無い"]).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>${gnn.walkforward ? `<p class="rel-wf"><b>ウォークフォワード検証(${gnn.walkforward.days}日)</b>: 実グラフ IC ${fmt(gnn.walkforward.real?.ic, 3)}(t ${fmt(gnn.walkforward.real?.t, 2)})/ 辺をランダムにした対照 ${fmt(gnn.walkforward.shuffled?.ic, 3)}(t ${fmt(gnn.walkforward.shuffled?.t, 2)})/ 差 ${fmt(gnn.walkforward.realMinusShuffled?.ic, 3)}(t ${fmt(gnn.walkforward.realMinusShuffled?.t, 2)})。${escapeHtml(gnn.walkforward.verdict || "")}</p>` : ""}<small>以前ここに出ていた「近傍」(例: キオクシア→デンソー・米10年金利)は、辺をランダムに張り替えた対照実験の結果だった。下の表は開示・報道にもとづく実際の関係と、その強さを株価データで測った値。</small><br><button type="button" class="secondary-button exp-open" data-exp-open>停止中の GNN 出力を注意書き付きで見る(⚠ 実験AIタブ) ›</button></div>`;
  // ---- ネットワーク図(開示された関係。線の太さ=直近1年の相関、点線=裏付けなし)
  const shown = edges.filter((e) => e.active).slice(0, 10);
  const W = 560, H = 300, cx = W / 2, cy = H / 2;
  const svg = shown.length ? `<svg class="rel-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(company.name)} の関係図">${shown.map((e, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / shown.length; const x = cx + Math.cos(ang) * 205, y = cy + Math.sin(ang) * 112;
    const w = 1 + Math.abs(number(e.stats?.corr250, 0)) * 7; const dash = e.evidence === "assumed" ? ' stroke-dasharray="5 4"' : "";
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${typeColor[e.role] || "#888"}" stroke-width="${w.toFixed(1)}" stroke-opacity=".75"${dash}/>`;
  }).join("")}${shown.map((e, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / shown.length; const x = cx + Math.cos(ang) * 205, y = cy + Math.sin(ang) * 112;
    const jp = !!state.data.predictions.find((p) => p.code === e.code);
    return `<g class="rel-node${jp ? " link" : ""}" ${jp ? `data-rel-go="${escapeHtml(e.code)}" tabindex="0"` : ""} transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="-58" y="-20" width="116" height="40" rx="9"/><text y="-4" class="c">${escapeHtml(e.code)}</text><text y="11" class="n">${escapeHtml(String(e.name).slice(0, 12))}</text></g>`;
  }).join("")}<g class="rel-node center" transform="translate(${cx},${cy})"><rect x="-64" y="-24" width="128" height="48" rx="11"/><text y="-4" class="c">${escapeHtml(company.code)}</text><text y="13" class="n">${escapeHtml(String(company.name).slice(0, 12))}</text></g></svg><div class="rel-legend">${Object.entries({ jv: "合弁", customer: "販売先", supplier: "調達先", peer: "同業・市況共有", material: "原材料", indicator: "為替・金利・商品" }).map(([k, v]) => `<span><i style="background:${typeColor[k]}"></i>${v}</span>`).join("")}<span>線の太さ=直近1年の日次相関 / 点線=裏付けなし(推定)</span></div>` : `<div class="empty-state"><strong>開示・報道ベースの関係はまだ登録されていません</strong><p>config/relations.json に辺がある銘柄は ${rel.graph?.universeWithEdges ?? "—"} / 400。下の「統計的な近傍」は株価の連動だけで選んだもので、取引関係を示すものではありません。</p></div>`;
  // ---- 関係の明細
  const table = edges.length ? `<div class="broker-table-wrap"><table class="broker-table rel-table"><thead><tr><th>相手</th><th>関係</th><th>根拠</th><th>相関60日</th><th>相関1年</th><th>β(60日)</th><th>20日騰落<small>自社−相手</small></th><th>相手のGBM20日</th></tr></thead><tbody>${edges.map((e, i) => `<tr class="${e.active ? "" : "muted-row"}"><th>${state.data.predictions.find((p) => p.code === e.code) ? `<button class="link-button" type="button" data-rel-go="${escapeHtml(e.code)}">${escapeHtml(e.code)}</button>` : escapeHtml(e.code)}<small>${escapeHtml(e.name)}${e.lagDays ? `・${escapeHtml(e.market)}(1日ずらし)` : ""}</small></th><td><span class="pill" style="border-color:${typeColor[e.role] || "#888"}">${escapeHtml(e.typeLabel)}</span><small>${e.direction === "both" ? "双方向に波及" : e.direction === "in" ? "相手→自社に波及" : "自社→相手に波及"}${e.active ? "" : "・期間外"}</small></td><td>${escapeHtml(e.evidenceLabel || "—")}<small>${escapeHtml(e.validFrom || "")}〜${escapeHtml(e.validTo || "")}</small></td>${corrCell(e.stats?.corr60)}${corrCell(e.stats?.corr250)}<td>${fmt(e.stats?.beta60)}</td><td class="${number(e.stats?.gap20, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(e.stats?.gap20, 1)}<small>${percent(e.stats?.ret20Focal, 1)} / ${percent(e.stats?.ret20Other, 1)}</small></td><td class="${number(e.gbm20, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(e.gbm20, 1)}</td></tr>${(e.shares?.length || e.notes?.length) ? `<tr class="rel-note-row"><td colspan="8">${e.shares?.length ? `<div class="rel-shares"><b>${escapeHtml(e.shares.at(-1).discloserName)} の売上に占める割合(有報)</b>${e.shares.map((x) => `<span class="${x.active ? "on" : ""}">${escapeHtml(String(x.filed).slice(0, 7))} <strong>${x.pct.toFixed(1)}%</strong></span>`).join("")}</div>` : ""}${e.notes?.length ? `<details><summary>メモ ${e.notes.length}件</summary>${e.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join("")}</details>` : ""}</td></tr>` : ""}`).join("")}</tbody></table></div><p class="lab-foot">相関・βは日次リターン。米国・韓国の相手は日本の引け後に動くので1営業日ずらして計算(その日の東証の引け時点で知り得る値だけ)。20日騰落の差がマイナス=自社が相手に出遅れ。${escapeHtml(rel.relationTower || "")}</p>` : "";
  // ---- 統計的な近傍
  const peers = stat.length ? `<div class="broker-row-head"><h3>統計的な近傍(株価の連動が強い銘柄)</h3><small>固定400銘柄・直近250日の日次相関。取引関係を意味しない</small></div><div class="rel-peers">${stat.slice(0, 8).map((p) => `<button type="button" data-rel-go="${escapeHtml(p.code)}"><strong>${escapeHtml(p.code)}</strong><span>${escapeHtml(p.name)}</span><small>${escapeHtml(p.industry || "")}${p.sameIndustry ? "(同業種)" : ""}${p.isEdge ? "・開示関係あり" : ""}</small><em>相関 ${fmt(p.corr250)}</em><em class="${number(p.gbm20, 0) >= 0 ? "positive-text" : "negative-text"}">GBM20日 ${percent(p.gbm20, 1)}</em></button>`).join("")}</div>` : "";
  // ---- Claude の分析
  const a = c.analysis;
  const analysis = a ? `<article class="rel-analysis"><header><span class="pill primary">Claude の分析</span><strong>${escapeHtml(a.title || "")}</strong><small>${escapeHtml(a.date || "")}${a.stance ? ` · ${escapeHtml(a.stance)}` : ""}</small></header>${(a.body || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${a.points?.length ? `<ul>${a.points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}${a.watch?.length ? `<div class="read-box"><b>次に確認すること</b><ul>${a.watch.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>` : ""}${a.caveats?.length ? `<p class="lab-foot">⚠ ${a.caveats.map((p) => escapeHtml(p)).join(" / ")}</p>` : ""}<p class="lab-foot">根拠: ${escapeHtml((a.sources || []).join("、") || "relations.json の数値")} · ${escapeHtml(a.author || "Claude")}</p></article>` : `<div class="read-box muted"><b>Claude の分析はまだありません</b><p>関係のある銘柄から順に、定期更新(朝8時)で追加されます。</p></div>`;
  box.innerHTML = `${gnnBox}${svg}${analysis}${table}${peers}`;
  box.querySelector("[data-exp-open]")?.addEventListener("click", openStockExpTab);
  if ($('[data-detail-group="exp"]') && !$('[data-detail-group="exp"]').hidden) renderStockExp(company);
  $$("#relationGraph [data-rel-go]").forEach((el) => { el.addEventListener("click", () => goStock(el.dataset.relGo)); el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") goStock(el.dataset.relGo); }); });
}

function renderOptimizer(company) {
  const capital = Math.max(number($("#optimizerCapital")?.value, 1000000), 0);
  const riskRate = Math.max(number($("#optimizerRisk")?.value, 1), 0) / 100;
  const forecast = modelForecast(company, state.horizon, state.selectedModel) || predictionAt(company, state.horizon);
  const price = number(state.chartData.at(-1)?.c, number(company.close)); // 2026-09-24: 1株リスクは「期間平均(VWAP)の下限」ではなく「保有中の途中安値」で測る。
  //   平均の下限は途中の急落をならすので損失を過小評価していた。値は過去約3年の同じ期間の最安値までの下落率(5%点)。モデル予測ではない。
  const pr = state.data.predictions.find((row) => row.code === state.selectedCode)?.periods?.[String(state.horizon)]?.pathRisk;
  const floor = price !== null && number(pr?.q05) !== null ? price * (1 + number(pr.q05)) : null;
  const riskPerShare = price !== null && floor !== null ? Math.max(price - floor, 0) : null;
  const budget = capital * riskRate;
  const sharesByRisk = riskPerShare > 0 ? Math.floor(budget / riskPerShare / 100) * 100 : 0;
  const sharesByCapital = price > 0 ? Math.floor(capital * .2 / price / 100) * 100 : 0;
  const shares = Math.max(0, Math.min(sharesByRisk || 0, sharesByCapital || 0));
  $("#optimizerResult").innerHTML = riskPerShare === null ? '<div class="empty-state"><p>この期間の途中安値の実績(過去約3年)が足りないため計算できません。</p></div>' : `<div class="optimizer-output"><article><span>許容損失額</span><strong>${yen(budget)}</strong></article><article><span>1株リスク<small>途中安値・過去5%点</small></span><strong>${yen(riskPerShare)}</strong><small>${percent(pr?.q05)}</small></article><article><span>検証用上限</span><strong>${shares.toLocaleString("ja-JP")}株</strong></article><article><span>想定投下額</span><strong>${yen(shares * price)}</strong></article></div><p>1株リスク = 現在値 × 「過去約3年で、${state.horizon}営業日保有したときに途中で付けた最安値までの下落率」の悪い方から5%点(${intJa(pr?.n)}窓・重複あり)。<strong>モデルの予測ではなく過去の値動きの幅</strong>で、損切り水準の推奨でもありません。1銘柄20%上限を適用。相関・流動性・決算ギャップは別途確認が必要です。</p>`;
}

function setupCanvas(canvas, height) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(canvas.clientWidth, 320);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function movingAverage(rows, size) {
  const result = [];
  let sum = 0;
  rows.forEach((row, index) => {
    sum += row.c;
    if (index >= size) sum -= rows[index - size].c;
    result.push(index >= size - 1 ? sum / size : null);
  });
  return result;
}

function periodStart(lastDate, period) {
  const last = new Date(`${lastDate}T00:00:00Z`);
  if (period === "all") return null;
  if (period === "ytd") return `${last.getUTCFullYear()}-01-01`;
  const months = { "1m":1, "3m":3, "6m":6, "1y":12, "3y":36, "5y":60 }[period] || 6;
  last.setUTCMonth(last.getUTCMonth() - months);
  return last.toISOString().slice(0,10);
}

function intervalKey(date, interval) {
  const value = new Date(`${date}T00:00:00Z`);
  if (interval === "1w") {
    const day = (value.getUTCDay() + 6) % 7;
    value.setUTCDate(value.getUTCDate() - day);
    return value.toISOString().slice(0,10);
  }
  if (interval === "1mo") return date.slice(0,7);
  if (interval === "1y") return date.slice(0,4);
  return date;
}

function pairTrades(trades) {
  const grouped = new Map();
  trades.forEach((trade) => { const key = `${trade.code}|${trade.currency || "JPY"}|${trade.account || trade.broker || ""}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(trade); });
  const pairs = [];
  grouped.forEach((items) => {
    const queue = [];
    items.sort((a, b) => a.date.localeCompare(b.date) || number(a.sourceOrder,0) - number(b.sourceOrder,0) || String(a.id).localeCompare(String(b.id))).forEach((trade) => {
      if (trade.side === "buy") queue.push({ ...trade, remaining: trade.qty });
      else if (!trade.realizedOnly) {
        let remaining = trade.qty;
        while (remaining > 0 && queue.length) {
          const buy = queue[0];
          const matched = Math.min(remaining, buy.remaining);
          pairs.push({ buy, sell: trade, qty: matched, pnl: (trade.price - buy.price) * matched });
          remaining -= matched; buy.remaining -= matched;
          if (buy.remaining <= 0) queue.shift();
        }
      }
    });
  });
  return pairs;
}

// 2026-09-25 作り直し(TradingView の約定表示に寄せる):
//   ・矢印の先が約定単価(買いは下から上、売りは上から下)、その先に B / S のラベル。同じ足・同じ売買はまとめて株数を出す
//   ・株式分割: チャートの価格は分割調整済みなので、分割前の約定は単価を割り、株数を掛けて同じ尺度に直す(以前は分割銘柄で線が画面外へ飛んでいた)
//   ・約定履歴形式(買いと売りの両方がある CSV)は FIFO で対応づけ、損益の色の点線で結ぶ。残っている建玉は平均取得単価の水平線
//   ・実現損益形式(売りだけ・取得日なし)は別取引へ推測接続しない。売りラベルの下に実現損益を出し、取得単価は凡例に出す
function drawTradeMarkers(ctx, rows, g, y, view, top, bottom) {
  state.tv.tradeBars = null; state.tv.position = null;
  const trades = chartTrades(); if (!trades.length) return null;
  const at = tradeBarIndex(rows);
  const bars = new Map();
  trades.forEach((t) => {
    const i = at(t.date); if (i < 0) return; const k = `${i}|${t.side}`;
    if (!bars.has(k)) bars.set(k, { i, side: t.side, qty: 0, amt: 0, items: [], pnl: 0, hasPnl: false });
    const b = bars.get(k); b.qty += t.qty; b.amt += t.price * t.qty; b.items.push(t);
    if (Number.isFinite(t.realizedPnl)) { b.pnl += t.realizedPnl; b.hasPnl = true; }
  });
  const byBar = new Map(); bars.forEach((b) => { if (!byBar.has(b.i)) byBar.set(b.i, []); byBar.get(b.i).push(b); }); state.tv.tradeBars = byBar;
  const up = tvColor("--tv-up", "#089981"), down = tvColor("--tv-down", "#f23645");
  pairTrades(trades).forEach((pair) => {
    const bi = at(pair.buy.date), si = at(pair.sell.date); if (bi < 0 || si < 0 || si < view.start || bi > view.end) return;
    ctx.save(); ctx.strokeStyle = pair.pnl >= 0 ? up : down; ctx.globalAlpha = .6; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(g.x(bi), y(pair.buy.price)); ctx.lineTo(g.x(si), y(pair.sell.price)); ctx.stroke(); ctx.restore();
  });
  const roomy = g.slot >= 7;
  ctx.font = "700 10px -apple-system, 'Segoe UI', sans-serif"; ctx.textAlign = "center";
  bars.forEach((b) => {
    if (b.i < view.start || b.i > view.end) return;
    const px = g.x(b.i); const price = b.amt / b.qty; const py = Math.max(top + 2, Math.min(bottom - 2, y(price)));
    const buy = b.side === "buy"; const color = buy ? TRADE_COLORS.buy : TRADE_COLORS.sell; const dir = buy ? 1 : -1;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 5, py + dir * 7); ctx.lineTo(px + 5, py + dir * 7); ctx.closePath(); ctx.fill();
    ctx.fillRect(px - 1, buy ? py + 7 : py - 13, 2, 6);
    const label = `${buy ? "B" : "S"}${roomy ? ` ${tvQty(b.qty)}` : b.items.length > 1 ? `×${b.items.length}` : ""}`;
    const w = ctx.measureText(label).width + 8; const lh = 15; const ly = buy ? py + 13 : py - 13 - lh;
    tvRoundRect(ctx, px - w / 2, ly, w, lh, 3); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(label, px, ly + 11);
    if (b.hasPnl && roomy) { const txt = `${b.pnl >= 0 ? "+" : "−"}${tvMoneyShort(Math.abs(b.pnl))}`; ctx.fillStyle = b.pnl >= 0 ? up : down; ctx.fillText(txt, px, buy ? ly + lh + 11 : ly - 4); }
  });
  ctx.textAlign = "left";
  const pos = openPosition(trades);
  if (pos) {
    const py = y(pos.avg);
    if (py >= top && py <= bottom) { ctx.save(); ctx.strokeStyle = TRADE_COLORS.buy; ctx.globalAlpha = .85; ctx.setLineDash([6, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(g.plotW, py); ctx.stroke(); ctx.restore(); }
    state.tv.position = pos;
  }
  return pos;
}
function rsi(rows, period = 14) {
  const values = Array(rows.length).fill(null); let gains = 0, losses = 0;
  for (let i = 1; i < rows.length; i++) { const diff = rows[i].c - rows[i - 1].c; gains += Math.max(diff, 0); losses += Math.max(-diff, 0); if (i > period) { const old = rows[i - period].c - rows[i - period - 1].c; gains -= Math.max(old, 0); losses -= Math.max(-old, 0); } if (i >= period) values[i] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses); }
  return values;
}

function ema(values, period) {
  const result = Array(values.length).fill(null); const alpha = 2 / (period + 1); let current = null;
  values.forEach((value, index) => { if (!Number.isFinite(value)) return; current = current === null ? value : alpha * value + (1 - alpha) * current; result[index] = current; });
  return result;
}

function macd(rows) {
  const closes = rows.map((row) => row.c); const fast = ema(closes, 12); const slow = ema(closes, 26);
  const line = closes.map((_, index) => index < 25 ? null : fast[index] - slow[index]); const signal = ema(line, 9);
  return { line, signal, histogram: line.map((value, index) => value === null || signal[index] === null ? null : value - signal[index]) };
}

function stochastic(rows, period = 14) {
  const k = rows.map((row, index) => {
    if (index < period - 1) return null;
    const window = rows.slice(index - period + 1, index + 1); const low = Math.min(...window.map((item) => item.l)); const high = Math.max(...window.map((item) => item.h));
    return high === low ? 50 : (row.c - low) / (high - low) * 100;
  });
  const d = k.map((_, index) => { const window = k.slice(Math.max(0, index - 2), index + 1).filter(Number.isFinite); return window.length === 3 ? window.reduce((sum, value) => sum + value, 0) / 3 : null; });
  return { k, d };
}

function drawIndicatorLine(ctx, values, x, y, color, width = 1.8) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); let started = false;
  values.forEach((value, index) => { if (!Number.isFinite(value)) return; if (!started) { ctx.moveTo(x(index), y(value)); started = true; } else ctx.lineTo(x(index), y(value)); });
  if (started) ctx.stroke();
}

function renderForecastDetailsCore() {
  const row = state.data.predictions.find((item) => item.code === state.selectedCode); const pred = row?.periods?.[String(state.horizon)];
  if (!pred) { $("#forecastDetails").innerHTML = '<div class="empty-state"><p>この期間の予測はありません。</p></div>'; return; }
  const selected = $("#forecastModel")?.value || state.selectedModel; state.selectedModel = selected;
  const rangeTrack = (price) => {
    const lo = number(pred.low90), hi = number(pred.high90); const p = number(price);
    if (lo === null || hi === null || hi <= lo) return '<div class="range-track"><i></i></div>';
    const pos = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    const a = pos(number(pred.low68, lo)), b = pos(number(pred.high68, hi));
    return `<div class="range-track"><em style="left:${a}%;width:${Math.max(0, b - a)}%"></em>${p === null ? "" : `<i class="${p < lo || p > hi ? "out" : ""}" style="left:${pos(p)}%"></i>`}</div>`;
  };
  if (selected === "NLG") {
    const comments = state.comments.filter((item) => item.code === state.selectedCode);
    const ensemble = ensembleForecast(row, state.horizon);
    $("#forecastDetails").innerHTML = `<div class="forecast-price"><article><span>統合予測騰落</span><strong class="${ensemble?.return >= 0 ? "positive-text" : "negative-text"}">${percent(ensemble?.return)}</strong></article><article><span>統合予測VWAP</span><strong>${yen(ensemble?.price)}</strong></article></div><div class="forecast-range"><header><span>${yen(ensemble?.low68)}</span><strong>68%共通レンジ</strong><span>${yen(ensemble?.high68)}</span></header>${rangeTrack(ensemble?.price)}<header class="range-secondary"><span>${yen(ensemble?.low90)}</span><strong>90%共通レンジ</strong><span>${yen(ensemble?.high90)}</span></header></div><div class="nlg-forecast"><span>予測の解説 · ${state.horizon}営業日</span>${comments.length ? `<h3>${escapeHtml(comments[0].title)}</h3><p>${escapeHtml(comments[0].summary)}</p><small>${escapeHtml(comments[0].from)}〜${escapeHtml(comments[0].to || "継続中")}</small>` : '<p>保存済み文章コメントはありません。数値は水準の主役の予測で、独立した学習済み価格モデルではありません。</p>'}<small>${escapeHtml(ensemble?.method || "")}</small></div>`;
    return;
  }
  const claude = pred.claude;
  const useClaude = selected === "CLAUDE" && claude;
  const isAdopted = selected === "ADOPTED" || (selected === "CLAUDE" && !claude);
  const m = useClaude ? { return: claude.return, price: claude.price } : isAdopted ? { return: pred.return, price: pred.price, range: pred.range } : (pred.models?.[selected] || {});
  const name = useClaude ? "Claude" : isAdopted ? `模型・主役 ${pred.adopted || "—"}` : selected;
  const warn = [];
  if (selected === "CLAUDE" && !claude) warn.push(`<b>Claude の予測は未記入</b> この期限の記入がないため、模型(主役)の予測を表示しています。${UC_LONG.has(Number(state.horizon)) ? "長期は週1回(週の最初の営業日の朝)に記入します。" : "毎営業日の朝9:00までに記入します。"}`);
  if (m.range?.clipped) warn.push(`<b>⚠ 外挿</b> ${escapeHtml(rangeNote(m))}。`);
  if (outsideBand(pred, m.price)) warn.push(`<b>⚠ 区間の外</b> この点予測(${yen(m.price)})は同じ期限の90%区間(${yen(pred.low90)}〜${yen(pred.high90)})の外。模型どうしの食い違いが大きい状態なので、単独の数字として使わず下の3模型も見てください。`);
  const others = ["CURRENT", "GBM", "DNN"].map((k) => { const v = pred.models?.[k]; return `<button type="button" class="fm-chip ${selected === k ? "active" : ""}" data-fm="${k}" style="--mc:${modelColors[k]}"><b>${k}${pred.adopted === k ? "★" : ""}</b><span class="${number(v?.return, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(v?.return)}</span>${v?.range ? '<i class="warn-text" title="範囲外の出力を端に収めた値">⚠</i>' : ""}</button>`; }).join("");
  const claudeBox = claude ? `<article class="claude-box"><span>Claude の独自予測${claude.legacy ? "(旧方式: 模型+補正)" : ""}</span><strong class="${claude.return >= 0 ? "positive-text" : "negative-text"}">${percent(claude.return)}</strong><small>予測VWAP ${yen(claude.price)}${claude.conf != null ? ` · 確信度 ${claude.conf}` : ""}${claude.view ? ` · ${escapeHtml(claude.view)}` : ""}</small>${claude.reason ? `<p>${escapeHtml(claude.reason)}</p>` : ""}<small class="muted">${escapeHtml(String(claude.writtenAt || "").slice(0, 16).replace("T", " "))} 記入 · ${escapeHtml(claude.status || "未検証")}</small></article>`
    : `<article class="claude-box empty"><span>Claude の独自予測</span><strong>—</strong><small>${UC_LONG.has(Number(state.horizon)) ? "長期は週1回(週初めの朝)に記入" : "毎朝9:00までに記入。この期限は未記入"}</small></article>`;
  $("#forecastDetails").innerHTML = `${warn.length ? `<div class="forecast-warn">${warn.map((w) => `<p>${w}</p>`).join("")}</div>` : ""}<div class="forecast-price parallel"><article><span>${escapeHtml(name)} 予測騰落</span><strong class="${number(m.return, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(m.return)}</strong><small>予測VWAP ${yen(m.price)}</small></article>${claudeBox}</div><div class="fm-chips" aria-label="模型別の予測(押すと切り替え)">${others}</div><div class="forecast-range"><header><span>${yen(pred.low68)}</span><strong>68%共通レンジ</strong><span>${yen(pred.high68)}</span></header>${rangeTrack(m.price)}<header class="range-secondary"><span>${yen(pred.low90)}</span><strong>90%共通レンジ</strong><span>${yen(pred.high90)}</span></header></div><div class="prob-grid"><div><span>上抜け確率</span><strong>${metricPercent(pred.touchUp)}</strong></div><div><span>下抜け確率</span><strong>${metricPercent(pred.touchDown)}</strong></div><div><span>Reward/Risk</span><strong>${pred.rewardRisk ?? "—"}</strong></div><div><span>基準日</span><strong>${escapeHtml(state.data.asOf)}</strong></div></div>`;
  $$("#forecastDetails [data-fm]").forEach((b) => b.addEventListener("click", () => { state.selectedModel = b.dataset.fm; if ($("#forecastModel")) $("#forecastModel").value = state.selectedModel; syncTvControls(); renderForecastDetails(); renderStockDetails(); drawStockChart(); }));
}
function renderCommentTimeline() {
  const comments = state.comments.filter((item) => item.code === state.selectedCode);
  $("#commentTimeline").innerHTML = comments.length ? comments.map((item) => `<article class="timeline-item"><time>${escapeHtml(item.from)}〜${escapeHtml(item.to || "継続中")}</time><h4><span class="stance ${item.stance}">${item.stance === "positive" ? "堅調" : item.stance === "negative" ? "慎重" : "中立"}</span> ${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></article>`).join("") : '<div class="empty-state"><p>保存済みコメントはありません。</p></div>';
}

function renderComments() {
  const query = ($("#commentSearch")?.value || "").trim().toLowerCase(); const stance = $("#commentStance")?.value || "";
  const rows = state.comments.filter((item) => (!stance || item.stance === stance) && (!query || `${item.code} ${item.title} ${item.summary}`.toLowerCase().includes(query)));
  $("#commentList").innerHTML = rows.length ? rows.map((item) => { const company = state.data.predictions.find((row) => row.code === item.code); return `<article class="panel comment-card"><header><div><span>${escapeHtml(item.code)} · ${escapeHtml(company?.name || "")}</span><time>${escapeHtml(item.from)}〜${escapeHtml(item.to || "継続中")}</time></div><span class="stance ${item.stance}">${item.stance === "positive" ? "堅調" : item.stance === "negative" ? "慎重" : "中立"}</span></header><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p><button type="button" class="row-action" data-comment-stock="${escapeHtml(item.code)}">個別銘柄で確認</button></article>`; }).join("") : '<div class="empty-state panel"><strong>該当するAIコメントはありません</strong><p>生成済みのコメントだけを表示します。</p></div>';
  $$('[data-comment-stock]').forEach((button) => button.addEventListener("click", () => openStockChart(button.dataset.commentStock)));
}

function renderSystem() {
  const steps = state.system.steps || []; const sources = state.system.sources || [];
  const sourceNodes = sources.slice(0, 9).map((source) => `<button type="button" class="power-node ${source.state}" data-network-source="${escapeHtml(source.name)}"><span class="status-dot ${source.state}"></span><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.detail)}</small></button>`).join("");
  const stepNodes = steps.map((step) => `<button type="button" class="power-node core ${step.state}" data-network-step="${escapeHtml(step.id)}"><span class="status-dot ${step.state}"></span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.output)}</small></button>`).join("");
  $("#systemFlow").innerHTML = `<div class="power-column inputs"><h3>DATA INPUT</h3>${sourceNodes}</div><div class="power-bus active-bus"><span>収集・PIT整合</span></div><div class="power-column process"><h3>PROCESS / MODEL</h3>${stepNodes}</div><div class="power-bus output-bus"><span>監査済み出力</span></div><div class="power-column outputs"><h3>OUTPUT</h3><button class="power-node active" data-network-output="予測"><span class="status-dot active"></span><strong>価格・レンジ</strong><small>5 / 20 / 60日</small></button><button class="power-node manual" data-network-output="コメント"><span class="status-dot manual"></span><strong>AIコメント</strong><small>主要銘柄を週次</small></button><button class="power-node active" data-network-output="最適化"><span class="status-dot active"></span><strong>リスク最適化</strong><small>許容損失→株数</small></button></div>`;
  const showNetworkDetail = (title, detail, stateName = "active") => { $("#networkDetail").innerHTML = `<span class="status-dot ${stateName}"></span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`; };
  $$('[data-network-source]').forEach((button) => button.addEventListener("click", () => { const source = sources.find((item) => item.name === button.dataset.networkSource); if (source) showNetworkDetail(source.name, source.detail, source.state); }));
  $$('[data-network-step]').forEach((button) => button.addEventListener("click", () => { const step = steps.find((item) => item.id === button.dataset.networkStep); if (step) showNetworkDetail(step.label, `入力: ${step.inputs} / 処理: ${step.process} / 出力: ${step.output}`, step.state); }));
  $$('[data-network-output]').forEach((button) => button.addEventListener("click", () => showNetworkDetail(button.dataset.networkOutput, button.querySelector("small")?.textContent || "", button.classList.contains("manual") ? "manual" : "active")));
  if (steps[0]) showNetworkDetail(steps[0].label, `入力: ${steps[0].inputs} / 処理: ${steps[0].process}`, steps[0].state);
  $("#systemSteps").innerHTML = steps.map((step) => `<details><summary><span class="status-dot ${step.state}"></span>${escapeHtml(step.label)}<small>${escapeHtml(step.output)}</small></summary><dl><div><dt>入力</dt><dd>${escapeHtml(step.inputs)}</dd></div><div><dt>処理</dt><dd>${escapeHtml(step.process)}</dd></div><div><dt>出力先</dt><dd>${escapeHtml(step.output)}</dd></div></dl></details>`).join("");
  const stateLabel = { active:"稼働", collecting:"蓄積中", paused:"停止/未接続", experimental:"実験", manual:"手動" };
  $("#sourceStatus").innerHTML = sources.map((source) => `<article><span class="status-dot ${source.state}"></span><div><strong>${escapeHtml(source.name)}</strong><p>${escapeHtml(source.detail)}</p><small>${source.updatedAt ? `更新 ${escapeHtml(source.updatedAt.replace("T"," "))}` : "更新時刻なし"}</small></div><em class="status-badge ${source.state}">${stateLabel[source.state] || source.state}</em></article>`).join("");
  const checks = state.system.checks || [];
  $("#debugChecks").innerHTML = checks.map((check) => `<article class="${check.state}"><span>${check.state === "pass" ? "✓" : check.state === "fail" ? "×" : "!"}</span><div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.value)}</small></div></article>`).join("");
  const connections = [
    ["価格・出来高", "OHLCV・期間VWAP", "リターン、ボラ、移動平均、出来高比率", "全モデルの共通土台", "価格予測・レンジ", "active"],
    ["IRBANKバックフィル", "2020年以降の財務・指標・配当・セグメント", "原本保存と無料ソースの欠損監査", "訂正反映値はPIT学習へ直結しない", "履歴確認・不足把握", "active"],
    ["指数", "日経平均・NASDAQ総合・VIX", "リターン・ボラ・GBM基準", "個別銘柄の市場文脈", "INDEX画面", "active"],
    ["オプション", "IV・スキュー・建玉・Put/Call", "未接続", "NLG・リスク管理へ接続予定", "現在は出力なし", "paused"],
    ["CURRENT", "期限別に採用済みの特徴量", "中央値補完→標準化→Ridge", "区間予測・動的選択", "透明な基準予測", "active"],
    ["GBM", "全特徴量塔", "LightGBM 300本", "CURRENT/DNNと実績比較", "非線形予測", "active"],
    ["DNN", "価格・決算等の複数タワー", "塔別正規化→融合層", "可用性マスクで欠損塔を遮断", "複合要因予測", "active"],
    ["Quantile + Conformal", "分位点予測・過去誤差", "68%/90%区間を補正", "選択モデル予測へ付加", "レンジ・タッチ確率", "active"],
    ["GNN", "企業関係グラフ・価格特徴", "2層GAT", "数値モデルとは混ぜず独立(不採用)", "実験AI画面で参考表示", "experimental"],
    ["予測の解説", "予測・寄与特徴・ニュース・関係", "根拠ファイル→人/AIが週次要約", "主要銘柄コメントとして保存", "文章予測", "manual"],
    ["リスク最適化", "90%レンジ・許容損失・資金", "1銘柄20%上限と損失予算の小さい方", "選択モデルへ連動", "検証用株数上限", "active"],
    ["Transformer", "価格特徴の時系列", "Self-Attention単体評価", "日次系統へ未接続(不採用)", "検証記録を実験AI画面に表示", "paused"],
  ];
  $("#connectionRows").innerHTML = connections.map((row) => `<tr>${row.slice(0,5).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}<td><span class="status-badge ${row[5]}">${stateLabel[row[5]]}</span></td></tr>`).join("");
}

function renderNews() {
  const query = ($("#newsSearch")?.value || "").trim().toLowerCase(); const quality = Number($("#newsQuality")?.value || 0);
  const rows = state.data.news.filter((item) => (!quality || item.quality >= quality) && (!query || `${item.code} ${item.title} ${item.source}`.toLowerCase().includes(query)));
  $("#newsList").innerHTML = rows.slice(0, 80).map((item) => `<article class="news-item"><time>${escapeHtml(item.publishedAt.slice(0, 16).replace("T", " "))}<br>${escapeHtml(item.code || "市場")}</time><div><h3>${escapeHtml(item.title)}<span class="source-badge">${escapeHtml(item.source || "不明")}</span></h3><p>${item.bucket === "stock" ? "個別銘柄" : "市場関連"} · 品質レベル ${item.quality}</p></div>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">元記事 ↗</a>` : ""}</article>`).join("") || '<div class="empty-state"><strong>該当するニュースはありません</strong></div>';
}

// 2026-09-25: カード全体を押すと指数ページへ。模型別の表は横にはみ出していたので、幅に収まる行に組み直した
function renderIndices() {
  const grid = $("#indexGrid"); if (!grid || !state.indices) return;
  grid.innerHTML = state.indices.map((item, index) => {
    const id = INDEX_PAGES.find((p) => p.symbol === item.symbol)?.id;
    const horizon = item.ai?.horizons?.[String(state.indexHorizon)];
    const selected = horizon?.selectedModel;
    const forecast = horizon?.forecasts?.[selected];
    const modelRows = horizon ? ["CURRENT", "GBM", "DNN"].map((model) => { const value = horizon.forecasts?.[model]; const metric = horizon.metrics?.[model]; return `<div class="idx-row ${model === selected ? "selected" : ""}"><b style="color:${modelColors[model]}">${model}${model === selected ? " ★" : ""}</b><span class="${number(value?.return) >= 0 ? "positive-text" : "negative-text"}">${percent(value?.return)}</span><span>${number(value?.price)?.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) ?? "—"}</span><span>MAPE ${metricPercent(metric?.mapePrice, 2)}</span><span>方向 ${metricPercent(metric?.directionAccuracy)}</span></div>`; }).join("") : "";
    const forecastBlock = horizon ? `<div class="index-ai"><div class="index-ai-head"><span>${state.indexHorizon}営業日・期間平均価格予測</span><b>採用 ${escapeHtml(selected || "—")}(検証MAE最小)</b></div><strong>${number(forecast?.price)?.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) || "—"}</strong><p>68%残差帯 ${number(forecast?.low68)?.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) || "—"}〜${number(forecast?.high68)?.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) || "—"} · 基準日 ${escapeHtml(item.ai?.asOf || "—")}</p><div class="idx-rows">${modelRows}</div><small>時系列4分割・各400標本。価格/出来高、市場横断、VIX、信用、ニュースを利用。</small></div>` : (item.baseline ? `<div class="index-baseline"><div><span>GBM参考 ${item.baseline.horizon}日</span><strong>${number(item.baseline.price)?.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}</strong></div><small>${escapeHtml(item.baseline.method)}</small></div>` : '<div class="empty-state"><p>予測なし</p></div>');
    return `<article class="panel index-card ${id ? "clickable" : ""}" ${id ? `data-index-card="${id}" tabindex="0" role="link" aria-label="${escapeHtml(item.label)}の詳細ページへ"` : ""}><header><div><span>${escapeHtml(item.symbol)}</span><h2>${escapeHtml(item.label)}</h2></div><strong class="${item.change1d >= 0 ? "positive-text" : "negative-text"}">${percent(item.change1d)}</strong></header><div class="index-price">${number(item.close)?.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) || "—"}<small>${escapeHtml(item.asOf || "")}</small></div><canvas id="indexChart${index}" aria-label="${escapeHtml(item.label)}の推移"></canvas><div class="index-stats"><span>20日騰落<b>${percent(item.change20d)}</b></span><span>年率ボラ20日<b>${metricPercent(item.volatility20)}</b></span></div>${forecastBlock}${id ? `<div class="index-card-actions"><button type="button" class="secondary-button" data-index-go-page="${id}">詳細ページ ›</button><button type="button" class="text-button" data-index-go-chart="${id}">チャート ⤢</button></div>` : ""}</article>`;
  }).join("");
  state.indices.forEach((item, index) => drawIndexChart($("#indexChart" + index), item.points || []));
  grid.querySelectorAll("[data-index-card]").forEach((card) => {
    const go = () => goIndex(card.dataset.indexCard);
    card.addEventListener("click", (event) => { if (event.target.closest("[data-index-go-chart]")) return; go(); });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
  });
  grid.querySelectorAll("[data-index-go-chart]").forEach((b) => b.addEventListener("click", (event) => { event.stopPropagation(); goChart({ type: "index", code: b.dataset.indexGoChart }); }));
  const connected = ["available", "proxy_available"].includes(state.options?.state);
  $("#optionsState").textContent = state.options?.state === "proxy_available" ? "VIX代理変数で稼働" : connected ? "原本検出" : "未接続";
  const sources = (state.options?.sources || []).map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)} ↗</a> <small>${source.state === "not_connected" ? "未接続" : "短期履歴"}</small></li>`).join("");
  $("#optionsBody").innerHTML = `<div class="options-empty"><span class="status-dot ${connected ? "collecting" : "paused"}"></span><div><strong>${connected ? "オプション由来特徴を限定利用中" : "オプション原本はまだありません"}</strong><p>${escapeHtml(state.options?.message || "")}</p><ul>${sources}<li>大口動向は断定せず、IV・スキュー・建玉を観測可能な代理変数として扱います。</li></ul></div></div>`;
}
function drawIndexChart(canvas, points) {
  if (!canvas || !points.length) return; const { ctx, width, height } = setupCanvas(canvas, 150); ctx.clearRect(0,0,width,height);
  const values = points.slice(-120).map((item) => item.c).filter(Number.isFinite); if (!values.length) return;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(max-min,1); const x = (i) => 8 + i / Math.max(values.length-1,1) * (width-16); const y = (v) => 8 + (max-v)/span*(height-20);
  const gradient = ctx.createLinearGradient(0,0,0,height); gradient.addColorStop(0,"rgba(69,123,255,.28)"); gradient.addColorStop(1,"rgba(69,123,255,0)");
  ctx.beginPath(); values.forEach((value,index) => index ? ctx.lineTo(x(index),y(value)) : ctx.moveTo(x(index),y(value))); ctx.lineTo(x(values.length-1),height); ctx.lineTo(x(0),height); ctx.closePath(); ctx.fillStyle=gradient; ctx.fill();
  ctx.beginPath(); values.forEach((value,index) => index ? ctx.lineTo(x(index),y(value)) : ctx.moveTo(x(index),y(value))); ctx.strokeStyle=css("--primary"); ctx.lineWidth=2; ctx.stroke();
}

function renderModelsCore() {
  const metrics = state.data.metrics;
  const selectedMetric = metrics.find((row) => row.model === "CURRENT" && row.horizon === state.modelHorizon) || metrics[0] || {};
  $("#modelKpis").innerHTML = `<article><span>${state.modelHorizon}日 CURRENT MAPE</span><strong>${metricPercent(selectedMetric.mape)}</strong></article><article><span>方向一致率</span><strong>${metricPercent(selectedMetric.directionAccuracy)}</strong></article><article><span>Rank IC</span><strong>${number(selectedMetric.rankIc)?.toFixed(3) || "—"}</strong></article><article><span>検証標本</span><strong>${(selectedMetric.samples || 0).toLocaleString("ja-JP")}</strong></article>`;
  $("#modelRows").innerHTML = metrics.map((row) => `<tr><td><strong>${escapeHtml(row.model)}</strong></td><td>${row.horizon}日</td><td>${row.samples.toLocaleString("ja-JP")}</td><td>${metricPercent(row.mape, 2)}</td><td>${metricPercent(row.directionAccuracy)}</td><td>${number(row.rankIc)?.toFixed(3) || "—"}</td><td>${number(row.brier)?.toFixed(3) || "—"}</td><td>${percent(row.bias, 2)}</td></tr>`).join("");
  drawModelChart();
}

function drawBars(canvas, rows, valueKey, invert = false) {
  if (!canvas) return; rows = rows.slice().sort((a, b) => ["CURRENT", "GBM", "DNN"].indexOf(a.model) - ["CURRENT", "GBM", "DNN"].indexOf(b.model)); const { ctx, width, height } = setupCanvas(canvas, canvas.id === "modelChart" ? 300 : 122); ctx.clearRect(0, 0, width, height);
  if (!rows.length) return; const pad = { l: 42, r: 16, t: 18, b: 36 }; const max = Math.max(...rows.map((row) => Math.abs(number(row[valueKey], 0))), .01); const gap = 18; const barW = Math.min(70, (width - pad.l - pad.r - gap * (rows.length - 1)) / rows.length);
  rows.forEach((row, index) => { const value = Math.abs(number(row[valueKey], 0)); const h = value / max * (height - pad.t - pad.b); const x = pad.l + index * (barW + gap) + 10; const y = height - pad.b - h; ctx.fillStyle = modelColors[row.model] || css("--primary"); ctx.fillRect(x, y, barW, h); ctx.fillStyle = css("--muted"); ctx.font = "10px Inter"; ctx.textAlign = "center"; ctx.fillText(row.model, x + barW / 2, height - 14); ctx.fillStyle = css("--text"); ctx.fillText(invert ? metricPercent(value, 1) : value.toFixed(3), x + barW / 2, y - 6); }); ctx.textAlign = "left";
}

function drawModelChart() { if (!state.data) return; const rows = state.data.metrics.filter((row) => row.horizon === state.modelHorizon); if ($("#modelComparisonTitle")) $("#modelComparisonTitle").textContent = `${state.modelHorizon}営業日後の期間VWAP予測誤差`; drawBars($("#modelChart"), rows, "mape", true); }
function drawHomeModelChart() { const rows = state.data.metrics.filter((row) => row.horizon === 20); drawBars($("#homeModelChart"), rows, "mape", true); }

// 2026-09-25: 以前は固定の見本の線と B/S の絵だった。日経平均の直近と指数モデルの20日予測(期間平均の帯)を実データで描く
function drawHomeMiniChart() {
  const canvas = $("#homeMiniChart"); if (!canvas) return; const { ctx, width, height } = setupCanvas(canvas, 122); ctx.clearRect(0, 0, width, height);
  const page = indexPage("N225"); const pts = (page?.points || []).slice(-70).map((a) => a[4]).filter(Number.isFinite);
  const H = page?.ai?.horizons?.["20"]; const f = H?.forecasts?.[H?.selectedModel];
  if (pts.length < 5) { ctx.fillStyle = css("--muted"); ctx.font = "11px Inter, sans-serif"; ctx.fillText("指数データの読み込み中…", 8, 20); return; }
  const lows = [...pts, f?.low68, f?.high68].map(number).filter((v) => v !== null);
  const min = Math.min(...lows), max = Math.max(...lows), span = max - min || 1; const n = pts.length; const futureW = width * .22;
  const x = (i) => 4 + i / (n - 1) * (width - futureW - 8); const y = (v) => 8 + (max - v) / span * (height - 22);
  if (f) { ctx.fillStyle = css("--cyan"); ctx.globalAlpha = .16; ctx.fillRect(width - futureW + 4, y(f.high68), futureW - 8, y(f.low68) - y(f.high68)); ctx.globalAlpha = 1; }
  ctx.strokeStyle = css("--primary"); ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)))); ctx.stroke();
  if (f) { ctx.setLineDash([5, 4]); ctx.strokeStyle = css("--primary-2"); ctx.beginPath(); ctx.moveTo(x(n - 1), y(pts[n - 1])); ctx.lineTo(width - 8, y(f.price)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = css("--primary-2"); ctx.beginPath(); ctx.arc(width - 8, y(f.price), 3.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = css("--muted"); ctx.font = "10px Inter, 'Noto Sans JP', sans-serif"; ctx.textAlign = "left";
  ctx.fillText(`日経平均 ${tvFmt(pts[n - 1])}${f ? ` → 20日平均 ${tvFmt(f.price)}(${H.selectedModel})` : ""}`, 6, height - 3);
  if ($("#homeChartSub")) $("#homeChartSub").textContent = "銘柄・指数を切り替えて予測VWAP・売買履歴を重ねる";
}
function parseCsv(text) {
  const rows = []; let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) { const char = text[i]; if (char === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; } else if (char === "," && !quoted) { row.push(value); value = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = ""; } else value += char; }
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); return rows;
}

function findColumn(headers, names) { return headers.findIndex((header) => names.some((name) => header.replace(/[\s　]/g, "").toLowerCase().includes(name.toLowerCase()))); }
function cleanNumber(value) { return number(String(value || "").replace(/[￥¥円,$株\s]/g, "").replace(/[−–]/g, "-").trim(), 0); }
function normalizeDate(value) { const source = String(value || "").trim().replace(/[./年]/g, "-").replace(/月/g, "-").replace(/日/g, ""); const match = source.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); return match ? `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}` : ""; }
function tradeMoney(value, currency = "JPY") { return Number.isFinite(value) ? (currency === "USD" ? `$${value.toLocaleString("en-US", {maximumFractionDigits:4})}` : yen(value)) : "—"; }

async function importTradeFile(file) {
  const bytes = await file.arrayBuffer(); let text = new TextDecoder("utf-8").decode(bytes); if ((text.match(/\uFFFD/g) || []).length > 2) text = new TextDecoder("shift_jis").decode(bytes);
  const rows = parseCsv(text); if (rows.length < 2) throw new Error("CSVに取引行が見つかりません");
  const headers = rows[0].map((value) => value.trim());
  const columns = { date: findColumn(headers,["約定日","取引日","date"]), code: findColumn(headers,["銘柄コード","ティッカーコード","コード","ticker","code"]), side: findColumn(headers,["売買","取引区分","取引","side"]), price: findColumn(headers,["約定単価","売却/決済単価","単価","価格","price"]), qty: findColumn(headers,["約定数量","数量","株数","qty"]), name: findColumn(headers,["銘柄名","銘柄","name"]), cost: findColumn(headers,["平均取得価額","取得価額","取得単価","cost"]), pnl: findColumn(headers,["実現損益","損益","profit","pnl"]), account: findColumn(headers,["口座","預り区分","account"]) };
  if ([columns.date, columns.code, columns.side, columns.price].some((index) => index < 0)) throw new Error("約定日・銘柄コード・売買・価格の列を判定できませんでした");
  const realizedFormat = columns.cost >= 0 || columns.pnl >= 0;
  const currency = /USドル|USD/i.test(headers[columns.price] || "") ? "USD" : "JPY";
  const parsed = rows.slice(1).map((cells, sourceOrder) => { const date = normalizeDate(cells[columns.date]); const code = String(cells[columns.code] || "").match(/[0-9A-Za-z.]{1,12}/)?.[0] || ""; const sideText = String(cells[columns.side] || ""); const side = sideText.includes("買") ? "buy" : (sideText.includes("売") || sideText.includes("決済") || sideText.includes("返済") ? "sell" : (realizedFormat ? "sell" : "")); const price = cleanNumber(cells[columns.price]); const qty = columns.qty >= 0 ? cleanNumber(cells[columns.qty]) || 1 : 1; const name = columns.name >= 0 ? cells[columns.name] : code; const costPrice = columns.cost >= 0 ? cleanNumber(cells[columns.cost]) : null; const realizedPnl = columns.pnl >= 0 ? cleanNumber(cells[columns.pnl]) : null; const broker = realizedFormat ? "SBI/実現損益形式" : "楽天/約定履歴形式"; const account = columns.account >= 0 ? String(cells[columns.account] || "").trim() : broker; const realizedOnly = realizedFormat; return { id: `${file.name}-${sourceOrder}-${date}-${code}-${side}-${price}-${qty}`, sourceOrder, date, code, side, price, qty, name: String(name || code).trim(), costPrice, realizedPnl, realizedOnly, broker, account, currency }; }).filter((item) => item.date && item.code && item.side && item.price > 0);
  if (!parsed.length) throw new Error("有効な売買取引を読み込めませんでした");
  const merged = new Map(state.trades.map((item) => [item.id, item])); parsed.forEach((item) => merged.set(item.id, item)); state.trades = [...merged.values()].sort((a,b) => b.date.localeCompare(a.date)); await saveTrades(state.trades); renderTrades(); showToast(`${parsed.length}件を端末内に読み込みました`); drawStockChart();
}

function openTradeDb() { return new Promise((resolve, reject) => { const request = indexedDB.open("future-sight-local", 1); request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains("trades")) db.createObjectStore("trades", { keyPath: "id" }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function saveTrades(trades) { const db = await openTradeDb(); await new Promise((resolve, reject) => { const tx = db.transaction("trades", "readwrite"); const store = tx.objectStore("trades"); store.clear(); trades.forEach((trade) => store.put(trade)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); }
async function loadTrades() { try { const db = await openTradeDb(); state.trades = await new Promise((resolve, reject) => { const request = db.transaction("trades").objectStore("trades").getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error); }); db.close(); } catch { state.trades = []; } renderTrades(); }

function renderTrades() {
  const pairs = pairTrades(state.trades); const realized = state.trades.filter((trade) => Number.isFinite(trade.realizedPnl)); const settled = [...pairs.map((pair) => pair.pnl), ...realized.map((trade) => trade.realizedPnl)]; const wins = settled.filter((pnl) => pnl >= 0); const holdingDays = pairs.map((pair) => Math.max(0, Math.round((new Date(pair.sell.date) - new Date(pair.buy.date)) / 86400000)));
  const values = [state.trades.length, settled.length, settled.length ? `${(wins.length / settled.length * 100).toFixed(1)}%` : "—", holdingDays.length ? `${Math.round(holdingDays.reduce((a,b)=>a+b,0)/holdingDays.length)}日` : "取得日なし"];
  $$("#tradeKpis strong").forEach((node, index) => node.textContent = values[index]);
  $("#tradeEmpty").style.display = state.trades.length ? "none" : "block";
  $("#tradeList").innerHTML = state.trades.slice(0, 100).map((trade) => `<article class="trade-row"><time>${escapeHtml(trade.date)}</time><span class="${trade.side}">${trade.side === "buy" ? "買い B" : "売り S"}</span><strong>${escapeHtml(trade.code)} ${escapeHtml(trade.name)}<small>${escapeHtml(trade.broker || "")}</small></strong><span>${trade.qty.toLocaleString()}株</span><span>${tradeMoney(trade.price, trade.currency)}${Number.isFinite(trade.realizedPnl) ? `<small class="${trade.realizedPnl >= 0 ? "positive-text" : "negative-text"}">損益 ${yen(trade.realizedPnl)}</small>` : ""}</span><button class="row-action" data-trade-chart="${escapeHtml(trade.code)}">個別</button></article>`).join("");
  $$('[data-trade-chart]').forEach((button) => button.addEventListener("click", () => openStockChart(button.dataset.tradeChart)));
}

function bindEvents() {
  $$('[data-nav]').forEach((element) => { const action = () => navigate(element.dataset.nav); element.addEventListener("click", action); if (!element.matches("button")) element.addEventListener("keydown", (event) => { if (event.key === "Enter") action(); }); });
  $$("[data-theme-value]").forEach((button) => button.addEventListener("click", () => setTheme(button.dataset.themeValue)));
  $("#mobileMenu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("#predictionHorizon").addEventListener("change", renderPredictions); $("#predictionModel").addEventListener("change", renderPredictions); $("#predictionIndustry").addEventListener("change", renderPredictions); $("#predictionSearch").addEventListener("input", renderPredictions);
  $("#predictionSort").addEventListener("click", () => {
    if (state.predictionSort === "volume") { state.predictionSort = "forecast"; state.sortDesc = true; }
    else if (state.sortDesc) state.sortDesc = false;
    else state.predictionSort = "volume";
    $("#predictionSort").textContent = state.predictionSort === "volume" ? "売買代金順" : `予測順 ${state.sortDesc ? "↓" : "↑"}`;
    renderPredictions();
  });
  $$("[data-market]").forEach((button) => button.addEventListener("click", () => { state.market = button.dataset.market; $$('[data-market]').forEach((item) => item.classList.toggle("active", item === button)); renderStocks(); }));
  $("#forecastOnly").addEventListener("change", renderStocks);
  $$("#chartRange button").forEach((button) => button.addEventListener("click", () => { state.chartPeriod = button.dataset.range; $$("#chartRange button").forEach((item) => item.classList.toggle("active", item === button)); tvResetView(); }));
  $$("#chartInterval button").forEach((button) => button.addEventListener("click", () => { state.chartInterval = button.dataset.interval; $$("#chartInterval button").forEach((item) => item.classList.toggle("active", item === button)); tvResetView(); }));
  ["toggleMa","toggleBb","toggleVolume","toggleProfile","toggleForecast","toggleTrades"].forEach((id) => $(`#${id}`).addEventListener("change", drawStockChart));
  $$("#forecastTabs button").forEach((button) => button.addEventListener("click", () => { state.horizon = Number(button.dataset.horizon); $$("#forecastTabs button").forEach((item) => item.classList.toggle("active", item === button)); syncTvControls(); renderForecastDetails(); renderStockDetails(); renderStockCards(state.data.predictions.find((r) => r.code === state.selectedCode)); drawStockChart(); }));
  $("#forecastModel").addEventListener("change", (event) => { state.selectedModel = event.target.value; syncTvControls(); renderForecastDetails(); renderStockDetails(); drawStockChart(); });
  $$(".indicator-tabs button").forEach((button) => button.addEventListener("click", () => { state.indicator = button.dataset.indicator; $$(".indicator-tabs button").forEach((item) => item.classList.toggle("active", item === button)); if ($("#tvIndicator")) $("#tvIndicator").value = state.indicator; drawIndicatorChart(); drawStockChart(); }));
  $("#newsSearch").addEventListener("input", renderNews); $("#newsQuality").addEventListener("change", renderNews);
  $$('[data-model-horizon]').forEach((button) => button.addEventListener("click", () => { state.modelHorizon = Number(button.dataset.modelHorizon); $$('[data-model-horizon]').forEach((item) => item.classList.toggle("active", item === button)); renderModels(); }));
  $$('[data-index-horizon]').forEach((button) => button.addEventListener("click", () => { state.indexHorizon = Number(button.dataset.indexHorizon); $$('[data-index-horizon]').forEach((item) => item.classList.toggle("active", item === button)); renderIndices(); }));
  $("#commentSearch").addEventListener("input", renderComments); $("#commentStance").addEventListener("change", renderComments);
  $("#chooseCsv").addEventListener("click", () => $("#tradeCsv").click()); $("#tradeCsv").addEventListener("change", (event) => event.target.files[0] && importTradeFile(event.target.files[0]).catch((error) => showToast(error.message)));
  const drop = $("#tradeDropZone"); ["dragenter","dragover"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("dragover"); })); ["dragleave","drop"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove("dragover"); })); drop.addEventListener("drop", (event) => event.dataTransfer.files[0] && importTradeFile(event.dataTransfer.files[0]).catch((error) => showToast(error.message)));
  $("#clearTrades").addEventListener("click", async () => { state.trades = []; await saveTrades([]); renderTrades(); drawStockChart(); showToast("端末内の取引履歴を削除しました"); });
  bindSymbolSearch();
  document.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#globalSearch").focus(); } });
  // 2026-09-25: 「チャートオンリー」は「チャート専用ページ」(#chart-コード)に置き換えた(bindTvExtras)
  bindTvChart();
  $$('[data-expand]').forEach((button) => button.addEventListener("click", () => { const card = button.closest(".detail-card"); const details = card?.querySelector("details"); if (details) details.open = !details.open; }));
  ["optimizerCapital","optimizerRisk"].forEach((id) => $(`#${id}`)?.addEventListener("input", () => { const company = state.data?.predictions?.find((row) => row.code === state.selectedCode); if (company) renderOptimizer(company); }));
  window.addEventListener("hashchange", applyRoute);
  $$('[data-nlp]').forEach((b) => b.addEventListener("click", () => { state.nlpTab = b.dataset.nlp; renderNlp(); }));
  window.addEventListener("resize", () => requestAnimationFrame(drawAllCharts));
  $$('[data-lab-horizon]').forEach((button) => button.addEventListener("click", () => { labState.horizon = Number(button.dataset.labHorizon); $$('[data-lab-horizon]').forEach((item) => item.classList.toggle("active", item === button)); renderLab(); }));
  $("#ablationTower")?.addEventListener("change", (event) => { labState.ablationTower = event.target.value; renderLab(); });
  $("#ablationScope")?.addEventListener("change", (event) => { labState.ablationScope = event.target.value; renderLab(); });
}

function drawAllCharts() { drawHomeMiniChart(); if (state.data) { drawHomeModelChart(); drawStockChart(); drawIndicatorChart(); drawModelChart(); drawLabCharts(); drawDataCharts(); if (state.page === "index") { const p = indexPage(state.indexId); if (p) drawSeason(p); } } }

// ===================== モデル内部 / データ / 個別銘柄の読み筋 (2026-09-23 追加) =====================
const labState = { horizon: 20, area: "", ablationTower: "", ablationScope: "h" };
const MODEL_LIST = ["CURRENT", "GBM", "DNN"];
const statusMeta = {
  adopted: ["採用", "positive"], rejected: ["不採用", "negative"], shadow: ["シャドー", "experimental"],
  pending: ["反映待ち", "warning"], decision: ["要判断", "warning"], done: ["完了", "primary"],
};
const ablationTowerMap = { "": "fundamentals", earn: "fundamentals", estat: "estat", news: "news", news_adaptive: "news_adaptive", relations: "relations", shinyo: "shinyo", similar: "similar", valuation: "valuation" };

function fmtTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function signed(value, digits = 3) { const parsed = number(value); return parsed === null ? "—" : `${parsed >= 0 ? "+" : ""}${parsed.toFixed(digits)}`; }
function intJa(value) { const parsed = number(value); return parsed === null ? "—" : Math.round(parsed).toLocaleString("ja-JP"); }
function towerLabel(tower) { return state.lab?.models?.towerLabels?.[tower] || tower; }
function pill(status) { const [label, tone] = statusMeta[status] || [status, "primary"]; return `<span class="pill ${tone}">${escapeHtml(label)}</span>`; }
function verdictPill(text) { const tone = /改善|優位/.test(text) && !/CURRENT/.test(text) ? "positive" : /悪化|劣る|CURRENT/.test(text) ? "negative" : "muted"; return `<span class="pill ${tone}">${escapeHtml(text || "—")}</span>`; }

function shortVerdict(text = "", challenger) {
  if (/CURRENTが有意/.test(text)) return "CURRENT優位★";
  if (new RegExp(`${challenger}が有意`).test(text)) return `${challenger}優位★`;
  return text ? "有意差なし" : "—";
}

function showTip(html, x, y) {
  const tip = $("#floatTip"); if (!tip) return;
  tip.innerHTML = html; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - w - 8))}px`;
  tip.style.top = `${Math.max(8, y - h - 12)}px`;
}
function hideTip() { const tip = $("#floatTip"); if (tip) tip.hidden = true; }

function drawLines(canvas, cfg) {
  if (!canvas || !canvas.clientWidth || !cfg?.series?.length) return;
  const { ctx, width, height } = setupCanvas(canvas, cfg.height || 240);
  ctx.clearRect(0, 0, width, height);
  const values = cfg.series.flatMap((s) => s.points.map((p) => p[1])).filter(Number.isFinite);
  if (!values.length) return;
  let min = Math.min(...values), max = Math.max(...values);
  if (cfg.zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (Number.isFinite(cfg.baseline)) { min = Math.min(min, cfg.baseline); max = Math.max(max, cfg.baseline); }
  const rawStep = (max - min || Math.abs(max) || 1) / 4; const mag = 10 ** Math.floor(Math.log10(rawStep)); const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rawStep) || rawStep;
  min = Math.floor(min / step) * step; max = Math.ceil(max / step) * step; if (max === min) max = min + step;
  const tickCount = Math.round((max - min) / step);
  const pad = { l: 54, r: 14, t: 12, b: 26 };
  const ref = cfg.series.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  const len = ref.points.length;
  const x = (i) => pad.l + (len <= 1 ? 0 : i / (len - 1)) * (width - pad.l - pad.r);
  const y = (v) => pad.t + (max - v) / (max - min) * (height - pad.t - pad.b);
  const fmt = (v) => (Number.isFinite(v) ? (cfg.yFormat ? cfg.yFormat(v) : v.toFixed(2)) : "—");
  ctx.lineWidth = 1; ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "right";
  for (let k = 0; k <= tickCount; k++) {
    const v = min + step * k; const yy = y(v);
    ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(width - pad.r, yy); ctx.stroke();
    ctx.fillStyle = css("--muted"); ctx.fillText(fmt(v), pad.l - 6, yy + 3);
  }
  if (cfg.zero && min < 0 && max > 0) { ctx.strokeStyle = css("--line-strong"); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.l, y(0)); ctx.lineTo(width - pad.r, y(0)); ctx.stroke(); ctx.setLineDash([]); }
  if (Number.isFinite(cfg.baseline)) { ctx.strokeStyle = css("--line-strong"); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.l, y(cfg.baseline)); ctx.lineTo(width - pad.r, y(cfg.baseline)); ctx.stroke(); ctx.setLineDash([]); }
  ctx.fillStyle = css("--muted"); ctx.textAlign = "center";
  const ticks = len > 2 ? [0, Math.floor((len - 1) / 2), len - 1] : [...Array(len).keys()];
  ticks.forEach((i) => { const label = ref.points[i]?.[0]; if (label != null) ctx.fillText(cfg.xFormat ? cfg.xFormat(label) : String(label), Math.min(Math.max(x(i), pad.l + 24), width - pad.r - 24), height - 8); });
  cfg.series.forEach((s) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath(); let started = false;
    s.points.forEach((p, i) => { if (!Number.isFinite(p[1])) { started = false; return; } if (!started) { ctx.moveTo(x(i), y(p[1])); started = true; } else ctx.lineTo(x(i), y(p[1])); });
    ctx.stroke();
    if (cfg.markers) { ctx.fillStyle = s.color; s.points.forEach((p, i) => { if (Number.isFinite(p[1])) { ctx.beginPath(); ctx.arc(x(i), y(p[1]), 4, 0, Math.PI * 2); ctx.fill(); } }); }
  });
  const hover = canvas._hoverIndex;
  if (hover != null && hover < len) {
    ctx.strokeStyle = css("--line-strong"); ctx.beginPath(); ctx.moveTo(x(hover), pad.t); ctx.lineTo(x(hover), height - pad.b); ctx.stroke();
    cfg.series.forEach((s) => { const p = s.points[hover]; if (p && Number.isFinite(p[1])) { ctx.fillStyle = css("--panel-solid"); ctx.beginPath(); ctx.arc(x(hover), y(p[1]), 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x(hover), y(p[1]), 4, 0, Math.PI * 2); ctx.fill(); } });
  }
  canvas._chart = { cfg, pad, width, len, ref, fmt };
  if (!canvas._hoverBound) {
    canvas._hoverBound = true;
    canvas.addEventListener("mousemove", (event) => {
      const c = canvas._chart; if (!c) return;
      const rect = canvas.getBoundingClientRect();
      const i = Math.round((event.clientX - rect.left - c.pad.l) / (c.width - c.pad.l - c.pad.r) * (c.len - 1));
      if (i < 0 || i >= c.len) { canvas._hoverIndex = null; hideTip(); drawLines(canvas, c.cfg); return; }
      canvas._hoverIndex = i; drawLines(canvas, c.cfg);
      const label = c.ref.points[i]?.[0];
      const rows = c.cfg.series.map((s) => `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}<b>${escapeHtml(c.fmt(s.points[i]?.[1]))}</b></span>`).join("");
      showTip(`<strong>${escapeHtml(c.cfg.tipFormat ? c.cfg.tipFormat(label) : c.cfg.xFormat ? c.cfg.xFormat(label) : String(label))}</strong>${rows}`, event.clientX, event.clientY);
    });
    canvas.addEventListener("mouseleave", () => { canvas._hoverIndex = null; hideTip(); if (canvas._chart) drawLines(canvas, canvas._chart.cfg); });
  }
}

function drawColumns(canvas, rows, cfg = {}) {
  if (!canvas || !canvas.clientWidth || !rows.length) return;
  const { ctx, width, height } = setupCanvas(canvas, cfg.height || 220);
  ctx.clearRect(0, 0, width, height);
  const pad = { l: 46, r: 10, t: 12, b: 26 };
  const max = Math.max(...rows.map((r) => r.value), 1);
  const slot = (width - pad.l - pad.r) / rows.length; const bw = Math.max(2, slot - 3);
  ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "right";
  for (let k = 0; k <= 3; k++) { const v = max * k / 3; const yy = pad.t + (1 - k / 3) * (height - pad.t - pad.b); ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(width - pad.r, yy); ctx.stroke(); ctx.fillStyle = css("--muted"); ctx.fillText(intJa(v), pad.l - 6, yy + 3); }
  rows.forEach((r, i) => {
    const h = r.value / max * (height - pad.t - pad.b); const x0 = pad.l + i * slot + 1.5; const y0 = height - pad.b - h;
    ctx.fillStyle = canvas._hoverIndex === i ? css("--primary-2") : css("--primary");
    const radius = Math.min(4, bw / 2, h); ctx.beginPath(); ctx.moveTo(x0, height - pad.b); ctx.lineTo(x0, y0 + radius); ctx.quadraticCurveTo(x0, y0, x0 + radius, y0); ctx.lineTo(x0 + bw - radius, y0); ctx.quadraticCurveTo(x0 + bw, y0, x0 + bw, y0 + radius); ctx.lineTo(x0 + bw, height - pad.b); ctx.closePath(); ctx.fill();
  });
  ctx.fillStyle = css("--muted"); ctx.textAlign = "center";
  [0, Math.floor(rows.length / 2), rows.length - 1].forEach((i) => ctx.fillText(rows[i].label.slice(5), pad.l + i * slot + slot / 2, height - 8));
  canvas._cols = { rows, pad, slot };
  if (!canvas._hoverBound) {
    canvas._hoverBound = true;
    canvas.addEventListener("mousemove", (event) => { const c = canvas._cols; const rect = canvas.getBoundingClientRect(); const i = Math.floor((event.clientX - rect.left - c.pad.l) / c.slot); if (i < 0 || i >= c.rows.length) { hideTip(); return; } if (canvas._hoverIndex !== i) { canvas._hoverIndex = i; drawColumns(canvas, c.rows, cfg); } showTip(`<strong>${escapeHtml(c.rows[i].label)}</strong><span>${escapeHtml(cfg.unit || "件数")}<b>${intJa(c.rows[i].value)}</b></span>`, event.clientX, event.clientY); });
    canvas.addEventListener("mouseleave", () => { canvas._hoverIndex = null; hideTip(); drawColumns(canvas, canvas._cols.rows, cfg); });
  }
}

function barList(rows, { valueKey, format, diverging = false }) {
  if (!rows?.length) return '<div class="empty-state"><p>データがありません。</p></div>';
  const max = Math.max(...rows.map((r) => Math.abs(number(r[valueKey], 0))), 1e-9);
  return rows.map((r, index) => {
    const value = number(r[valueKey], 0); const share = Math.abs(value) / max * 100;
    const bar = diverging
      ? `<div class="bar-track diverging"><i class="${value >= 0 ? "pos" : "neg"}" style="width:${(share / 2).toFixed(1)}%"></i></div>`
      : `<div class="bar-track"><i style="width:${share.toFixed(1)}%"></i></div>`;
    return `<div class="bar-row" title="${escapeHtml(r.name)} / ${escapeHtml(towerLabel(r.tower))}"><b>${index + 1}</b><div class="bar-label"><strong>${escapeHtml(r.label || r.name)}</strong><small>${escapeHtml(towerLabel(r.tower))} · <code>${escapeHtml(r.name)}</code></small></div>${bar}<em class="${diverging ? (value >= 0 ? "positive-text" : "negative-text") : ""}">${format(value)}</em></div>`;
  }).join("");
}

function codeAllows(model, tower, horizon) {
  const gate = state.lab?.codeGates?.[model];
  if (!gate || !(tower in gate)) return true;
  return gate[tower].includes(Number(horizon));
}

function renderHomeUpdates() {
  const lab = state.lab; const inv = state.inventory;
  const items = (lab?.changelog || []).slice(0, 4);
  $("#homeUpdates").innerHTML = items.length ? `<div class="section-title"><div><span>最新の更新</span><small>stockAI 側の変更と検証結果(${escapeHtml(items[0].date)}時点)</small></div><button class="text-button" type="button" data-nav-inline="lab">更新ログ ›</button></div><div class="update-list">${items.map((item) => `<button type="button" class="update-item" data-nav-inline="lab">${pill(item.status)}<strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.date)} · ${escapeHtml(item.area)}</small></button>`).join("")}</div>` : "";
  const h20 = lab?.models?.horizons?.["20"];
  const topGbm = h20?.gbm?.top?.slice(0, 3) || [];
  $("#homeLabPreview").innerHTML = h20 ? `<div class="rank-row"><b>学</b><span>学習</span><strong>${escapeHtml(fmtTime(lab.meta?.trained_at))}</strong><em>${intJa(h20.trainRows)}行</em></div>${topGbm.map((row, i) => `<div class="rank-row"><b>${i + 1}</b><span>GBM20日</span><strong>${escapeHtml(row.label)}</strong><em>${metricPercent(row.gainShare)}</em></div>`).join("")}` : '<p class="caution">モデル情報を読み込めませんでした。</p>';
  const edinet = inv?.edinetSummary; const news = inv?.sources?.find((s) => s.name === "ニュース");
  $("#homeDataPreview").innerHTML = inv ? `<div class="rank-row"><b>E</b><span>EDINET</span><strong>${intJa(edinet?.rows)}行 · ${inv.edinetItems.filter((i) => i.rows > 0).length}項目</strong><em>${intJa(edinet?.codes)}社</em></div><div class="rank-row"><b>N</b><span>ニュース</span><strong>累計 ${intJa(news?.rows)}件</strong><em>+${intJa(news?.addedToday)}</em></div><div class="rank-row"><b>B</b><span>BERT</span><strong>${intJa(inv.sources.find((s) => s.name === "ニュースBERT埋め込み")?.rows)}記事</strong><em>埋め込み</em></div>` : '<p class="caution">データ一覧を読み込めませんでした。</p>';
  $$('[data-nav-inline]').forEach((el) => el.addEventListener("click", (event) => { event.stopPropagation(); navigate(el.dataset.navInline); }));
}

function renderChangelog() {
  const items = state.lab?.changelog || [];
  const areas = [...new Set(items.map((item) => item.area))];
  $("#changelogFilter").innerHTML = [["", "すべて"], ...areas.map((a) => [a, a])].map(([value, label]) => `<button type="button" class="${labState.area === value ? "active" : ""}" data-changelog-area="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join("");
  $$('[data-changelog-area]').forEach((button) => button.addEventListener("click", () => { labState.area = button.dataset.changelogArea; renderChangelog(); }));
  const rows = items.filter((item) => !labState.area || item.area === labState.area);
  $("#labChangelog").innerHTML = rows.map((item) => `<article class="changelog-item"><div class="changelog-date"><time>${escapeHtml(item.date)}</time><span>${escapeHtml(item.area)}</span></div><div class="changelog-body"><h3>${pill(item.status)} ${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p>${item.caveat ? `<p class="changelog-caveat"><b>注意</b>${escapeHtml(item.caveat)}</p>` : ""}<small>出典: ${escapeHtml(item.source || "—")}</small></div></article>`).join("") || '<div class="empty-state"><p>更新ログはありません。</p></div>';
}

function renderLab() {
  const lab = state.lab;
  if (!lab?.models?.available) { $("#labKpis").innerHTML = `<article><span>モデル</span><strong>未読込</strong></article>`; $("#labNotice").hidden = false; $("#labNotice").textContent = lab?.models?.error || "model-lab.json を読み込めませんでした。"; return; }
  const meta = lab.meta || {}; const H = String(labState.horizon); const h = lab.models.horizons?.[H];
  $("#labBadge").textContent = `学習 ${fmtTime(meta.trained_at)}`;
  const stale = meta.runDailyUpdatedAt && meta.trained_at && new Date(meta.runDailyUpdatedAt) > new Date(meta.trained_at);
  const mismatches = [];
  (lab.models.towerOrder || []).forEach((tower) => MODEL_LIST.forEach((model) => { Object.entries(lab.models.horizons || {}).forEach(([hz, entry]) => { const saved = entry.gates?.[tower]?.[model]; if (saved && !codeAllows(model, tower, hz)) mismatches.push(`${model}/${towerLabel(tower)}/${hz}日`); }); }));
  const notice = $("#labNotice");
  if (stale) {
    notice.hidden = false;
    notice.innerHTML = `<strong>保存モデルはコード変更前の学習です</strong><p>run_daily.py は ${escapeHtml(fmtTime(meta.runDailyUpdatedAt))} に更新(BLEND_LOGIC_VERSION = <code>${escapeHtml(meta.blendLogicVersionInCode || "—")}</code>)。現在の models.pkl は ${escapeHtml(fmtTime(meta.trained_at))} の学習なので、次回の日次実行で自動的に再学習されます。${mismatches.length ? `コード上は閉じたのに保存モデルがまだ使っている塔: ${escapeHtml([...new Set(mismatches.map((m) => m.split("/").slice(0, 2).join("/")))].join("、"))}。` : ""}</p>`;
  } else notice.hidden = true;
  const adopted = lab.forward?.adopted?.[H] || {};
  const adoptedModel = Object.entries(adopted).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  $("#labKpis").innerHTML = h ? `<article><span>${H}日モデルの学習</span><strong>${escapeHtml(fmtTime(h.trainedAt))}</strong><small>学習行 ${intJa(h.trainRows)}</small></article><article><span>使用特徴量 CURRENT / GBM / DNN</span><strong>${h.featureCounts.CURRENT} / ${h.featureCounts.GBM} / ${h.featureCounts.DNN}</strong><small>CURRENTは検証済みの塔だけ</small></article><article><span>本番で採用中のモデル</span><strong>${escapeHtml(adoptedModel)}</strong><small>オフライン検定の勝者が既定。本番実績で有意に上回る模型が出たら乗り換え</small></article><article><span>予測基準日</span><strong>${escapeHtml(lab.asOf || "—")}</strong><small>最終実行 ${escapeHtml(fmtTime(lab.forward?.latestRun))}</small></article>` : "";
  if (!h) return;

  const g = h.gbm || {}; const c = h.current || {}; const d = h.dnn || {}; const iv = h.interval || {};
  const corr = (band) => iv.corrections?.find((item) => item.band === band)?.correction;
  $("#labPipeline").innerHTML = [
    ["入力", "PIT整合パネル", [`${(lab.models.towerOrder || []).length}の特徴量塔・最大${h.featureCounts.GBM}列`, `学習 ${intJa(h.trainRows)}行(銘柄×日)`, `目的変数: ${H}営業日先までの期間VWAP騰落率`, "その日に知り得た情報だけを as-of 結合"], "input"],
    ["CURRENT", "中央値補完 → 標準化 → Ridge", [`α = ${c.alpha ?? "—"}`, `使用 ${c.nUsed ?? "—"} / ${c.nFeatures ?? "—"}列`, c.droppedAllMissing?.length ? `学習期間で全欠損のため除外 ${c.droppedAllMissing.length}列` : "全欠損による除外なし", "線形なので寄与を分解できる(下の係数)"], "CURRENT"],
    ["GBM", "LightGBM 回帰", [`${g.trees ?? "—"}本の木・葉${g.params?.num_leaves ?? "—"}・深さ${g.params?.max_depth ?? "—"}`, `学習率 ${g.params?.learning_rate ?? "—"}・葉の最小 ${intJa(g.params?.min_data_in_leaf)}行`, `列サンプリング ${g.params?.feature_fraction ?? "—"}・行サンプリング ${g.params?.bagging_fraction ?? "—"}・L2 ${g.params?.lambda_l2 ?? "—"}`, `一度も分割に使われない列 ${g.unusedFeatures ?? "—"}`], "GBM"],
    ["DNN", "マルチタワーMLP", [`${d.towers?.length ?? "—"}塔 × (入力→${d.hidden?.[0] ?? "—"}→${d.hidden?.[1] ?? "—"})`, `融合層 ${d.fusion ?? "—"} → 出力1`, `${d.epochs ?? "—"}エポック・バッチ${d.batch ?? "—"}・学習率${d.lr ?? "—"}・L2 ${d.l2 ?? "—"}`, `最終損失 ${number(d.lossHistory?.at(-1))?.toFixed(3) ?? "—"}(初回 ${number(d.lossHistory?.[0])?.toFixed(3) ?? "—"})`], "DNN"],
    ["区間", "分位点GBM + コンフォーマル", [`分位 ${(iv.quantiles || []).join(" / ")}`, `較正用に学習データの${Math.round((iv.calibrationFraction || 0) * 100)}%を確保`, `補正幅 68%帯 ${signed(corr("68%"), 4)} / 90%帯 ${signed(corr("90%"), 4)}`, `タッチ確率は最大上昇・最大下落の分位点GBM`], "NLG"],
  ].map(([title, subtitle, lines, color], index) => `<article class="pipe-card" style="--accent:${modelColors[color] || "var(--faint)"}"><span class="pipe-step">${index + 1}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></article>`).join('<i class="pipe-arrow" aria-hidden="true">→</i>');

  const shares = { CURRENT: c.towerShare || {}, GBM: g.towerShare || {}, DNN: d.fusionWeightShare || {} };
  const maxShare = Math.max(...Object.values(shares).flatMap((m) => Object.values(m)).map((v) => number(v, 0)), 0.01);
  const ablations = lab.ablations || [];
  $("#labGates").innerHTML = (lab.models.towerOrder || []).map((tower) => {
    const inputs = d.towers?.find((t) => t.tower === tower)?.inputs ?? "—";
    const cells = MODEL_LIST.map((model) => {
      const open = h.gates?.[tower]?.[model]; const planned = codeAllows(model, tower, H); const value = number(shares[model]?.[tower]);
      if (!open) return `<td class="gate-cell closed">閉${planned ? '<small>次回 開</small>' : ""}</td>`;
      // 2026-09-24: 抽出に失敗した/計測していない値を 0% と表示しない
      const failed = { CURRENT: c.error, GBM: g.error, DNN: d.error }[model];
      if (failed) return `<td class="gate-cell unknown" title="${escapeHtml(String(failed))}">抽出不能</td>`;
      if (value === null || value === undefined) return `<td class="gate-cell unknown">未計測</td>`;
      const alpha = Math.round((value ?? 0) / maxShare * 42);
      return `<td class="gate-cell" style="background:color-mix(in srgb, ${modelColors[model]} ${alpha}%, transparent)">${metricPercent(value)}${planned ? "" : '<small class="warn">次回 閉</small>'}</td>`;
    }).join("");
    const related = ablations.filter((row) => ablationTowerMap[row.tower] === tower);
    const exact = related.filter((row) => row.horizon === Number(H));
    const pool = exact.length ? exact : related;
    const latest = pool.map((row) => row.testedAt || "").sort().at(-1);
    const pick = pool.filter((row) => (row.testedAt || "") === latest).sort((a, b) => (b.condition.startsWith("B") - a.condition.startsWith("B")) || Math.abs(number(b.tNw, 0)) - Math.abs(number(a.tNw, 0)))[0];
    const measured = MODEL_LIST.filter((model) => h.gates?.[tower]?.[model] && number(shares[model]?.[tower]) !== null);
    const empty = measured.length > 0 && MODEL_LIST.every((model) => !h.gates?.[tower]?.[model] || (number(shares[model]?.[tower]) !== null && number(shares[model]?.[tower]) < 0.0005));
    const note = (pick ? `${verdictPill(pick.verdict)}<small>${escapeHtml(pick.model)} h=${pick.horizon} ${escapeHtml(pick.condition.slice(0, 1))} t=${signed(pick.tNw, 2)} · ${escapeHtml((pick.testedAt || "").slice(5, 10).replace("-", "/"))}${exact.length ? "" : "(他期限)"}${pool.length > 1 ? ` ほか${pool.length - 1}件` : ""}</small>` : '<small class="muted">個別の追加検証なし</small>') + (empty ? '<small class="negative-text">学習データで値が無く、どのモデルも使えていない</small>' : "");
    return `<tr class="${empty ? "warn-row" : ""}"><th>${escapeHtml(towerLabel(tower))}<small>${escapeHtml(tower)}</small></th><td>${inputs}</td>${cells}<td class="gate-note">${note}</td></tr>`;
  }).join("");
  $("#labGateFoot").innerHTML = `比重の定義: CURRENT=標準化係数の絶対値の合計に占める割合 / GBM=分割ゲインの合計に占める割合 / DNN=融合層の入力重みのノルム比(構造上の参考値で、寄与の大きさそのものではない)。${c.droppedAllMissing?.length ? `CURRENTで全欠損のため除外: <code>${c.droppedAllMissing.map(escapeHtml).join("</code> <code>")}</code>` : ""}`;

  $("#labGbmTop").innerHTML = barList(g.top, { valueKey: "gainShare", format: (v) => metricPercent(v, 1) });
  $("#labRidgeTop").innerHTML = barList(c.top, { valueKey: "coef", format: (v) => signed(v, 4), diverging: true });
  $("#labDnnMeta").innerHTML = `<span>標準化前の目的変数 平均 <b>${percent(d.targetMean, 2)}</b> / 標準偏差 <b>${metricPercent(d.targetSd, 2)}</b></span><span>学習ステップ <b>${intJa(d.steps)}</b></span>`;

  $("#labChoice").innerHTML = [...new Set((lab.modelChoice || []).map((r) => r.horizon))].map((hz) => {
    const gb = lab.modelChoice.find((r) => r.horizon === hz && r.challenger === "GBM") || {}; const dn = lab.modelChoice.find((r) => r.horizon === hz && r.challenger === "DNN") || {};
    return `<tr class="${hz === Number(H) ? "selected" : ""}"><td>${hz}日</td><td>${intJa(gb.days)}</td><td>${signed(gb.icCurrent, 4)}</td><td>${signed(gb.icChallenger, 4)}</td><td class="${number(gb.diff) >= 0 ? "positive-text" : "negative-text"}">${signed(gb.diff, 4)}</td><td>${signed(gb.tNw, 2)}</td><td>${verdictPill(shortVerdict(gb.verdict, "GBM"))}</td><td>${signed(dn.icChallenger, 4)}</td><td class="${number(dn.diff) >= 0 ? "positive-text" : "negative-text"}">${signed(dn.diff, 4)}</td><td>${signed(dn.tNw, 2)}</td><td>${verdictPill(shortVerdict(dn.verdict, "DNN"))}</td></tr>`;
  }).join("");

  $("#labIcTitle").textContent = `日次ICの推移(${H}日)`;
  $("#labIcLegend").innerHTML = MODEL_LIST.map((m) => { const s = lab.dailyIc?.summary?.find((r) => r.model === m && r.horizon === Number(H)); return `<span><i style="background:${modelColors[m]}"></i>${m} <strong>${signed(s?.ic, 4)}</strong> <small>t_NW ${signed(s?.tNw, 2)}</small></span>`; }).join("");
  const years = [...new Set((lab.dailyIc?.byYear || []).map((r) => r.year))].sort();
  const yearRows = (lab.dailyIc?.byYear || []).filter((r) => r.horizon === Number(H));
  const yMax = Math.max(...yearRows.map((r) => Math.abs(number(r.ic, 0))), 0.01);
  $("#labYearHead").innerHTML = `<tr><th>モデル</th>${years.map((y) => `<th>${escapeHtml(y)}</th>`).join("")}</tr>`;
  $("#labYear").innerHTML = MODEL_LIST.map((m) => `<tr><th>${m}</th>${years.map((y) => { const r = yearRows.find((row) => row.model === m && row.year === y); const v = number(r?.ic); const tone = v === null ? "" : v >= 0 ? "var(--positive)" : "var(--negative)"; return `<td title="${m} ${y}年 ${r?.days ?? 0}日 / 正の日 ${metricPercent(r?.posRate)}" style="${v === null ? "" : `background:color-mix(in srgb, ${tone} ${Math.round(Math.abs(v) / yMax * 38)}%, transparent)`}">${signed(v, 3)}</td>`; }).join("")}</tr>`).join("");

  const towers = [...new Set(ablations.map((r) => r.towerLabel))];
  const select = $("#ablationTower");
  if (select.options.length <= 1) select.innerHTML = '<option value="">すべての塔</option>' + towers.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  const abl = ablations.filter((r) => (!labState.ablationTower || r.towerLabel === labState.ablationTower) && (labState.ablationScope === "all" || r.horizon === Number(H))).sort((a, b) => (b.testedAt || "").localeCompare(a.testedAt || "") || a.horizon - b.horizon);
  $("#labAblation").innerHTML = abl.length ? abl.map((r) => `<tr class="${r.horizon === Number(H) ? "selected" : ""}"><td>${escapeHtml(r.towerLabel)}</td><td>${escapeHtml(r.model)}</td><td>${r.horizon}日</td><td>${escapeHtml(r.condition)}${r.note ? `<small>${escapeHtml(r.note)}</small>` : ""}</td><td>${intJa(r.days)}</td><td class="${number(r.diff) >= 0 ? "positive-text" : "negative-text"}">${signed(r.diff, 4)}</td><td>${signed(r.tNw, 2)}</td><td>${metricPercent(r.improveRate)}</td><td>${verdictPill(r.verdict)}</td><td>${escapeHtml((r.testedAt || "").slice(5, 10).replace("-", "/"))}</td></tr>`).join("") : `<tr><td colspan="10" class="empty-cell">この期限(${H}日)の塔検証はありません。「すべての期限」で過去の検証を表示できます。</td></tr>`;

  /* 2026-09-24: ポートフォリオ検証は削除(VWAP比を保有リターンとして複利計算していた等、数値が無効)
  const pf = lab.portfolio || {}; const sum = pf.summary || {};
  const pfColors = { A: modelColors.CURRENT, B: modelColors.NLG, C: css("--faint") || "#9aa6ba" };
  $("#labPfLegend").innerHTML = [["A", "A 最適化"], ["B", "B 等金額"], ["C", "C TOPIX買い持ち"]].map(([k, label]) => `<span><i style="background:${pfColors[k]}"></i>${label} <strong>${percent((pf.curve?.at(-1)?.[k] ?? 1) - 1, 0)}</strong></span>`).join("");
  $("#labPfRows").innerHTML = [["A 最適化", sum.A_optimized], ["B 等金額", sum.B_equal_weight], ["C TOPIX", sum.C_topix_buyhold]].map(([label, s]) => `<tr><td>${label}</td><td>${percent(s?.total_return, 0)}</td><td>${percent(s?.annualized_return)}</td><td>${metricPercent(s?.annualized_vol)}</td><td>${number(s?.sharpe)?.toFixed(2) ?? "—"}</td><td>${percent(s?.max_drawdown)}</td></tr>`).join(""); */

  const fw = lab.forward || {};
  $("#labForward").innerHTML = `<div class="forward-grid">${(fw.live || []).map((r) => `<article><span>${r.horizon}日先 · n=${intJa(r.n)}</span><strong>${metricPercent(r.directionAccuracy)}</strong><small>方向一致</small><dl><div><dt>68%帯に入った割合</dt><dd>${metricPercent(r.cov68)}</dd></div><div><dt>90%帯に入った割合</dt><dd>${metricPercent(r.cov90)}</dd></div><div><dt>日次IC</dt><dd>${signed(r.dailyIc, 3)} <small>(${r.icDays}日分)</small></dd></div></dl></article>`).join("") || '<div class="empty-state"><p>まだ確定した実績がありません。</p></div>'}</div><p class="lab-foot">答えが確定した予測: ${Object.entries(fw.settledByHorizon || {}).map(([k, v]) => `${k}日先 ${intJa(v)}件`).join(" / ") || "なし"}。5日以上の期限は確定待ちです。IC日数がまだ1〜3日と短いため、数字は参考値です。</p><div class="table-panel inner"><table class="compact-table"><thead><tr><th>実行時刻</th><th>保存した予測行</th></tr></thead><tbody>${(fw.runs || []).slice(-6).reverse().map((r) => `<tr><td>${escapeHtml(fmtTime(r.runAt + ":00Z"))}</td><td>${intJa(r.rows)}</td></tr>`).join("")}</tbody></table></div>`;
  drawLabCharts();
}


function drawLabCharts() {
  const lab = state.lab; if (!lab?.models?.available || state.page !== "lab") return;
  const H = String(labState.horizon); const h = lab.models.horizons?.[H];
  drawLines($("#labLossChart"), { height: 200, series: [{ name: "DNN 訓練損失", color: modelColors.DNN, points: (h?.dnn?.lossHistory || []).map((v, i) => [`エポック ${i + 1}`, v]) }], yFormat: (v) => v.toFixed(3), xFormat: (v) => String(v).replace("エポック ", "ep "), markers: true });
  const rolling = lab.dailyIc?.rolling60?.[H] || {};
  drawLines($("#labIcChart"), { height: 260, zero: true, series: MODEL_LIST.filter((m) => rolling[m]).map((m) => ({ name: m, color: modelColors[m], points: rolling[m] })), yFormat: (v) => v.toFixed(3), xFormat: (v) => String(v).slice(0, 7), tipFormat: (v) => String(v) });
  // 2026-09-24: ポートフォリオ曲線は削除
}

function renderDataPage() {
  const inv = state.inventory; if (!inv) { $("#dataBadge").textContent = "未読込"; return; }
  $("#dataBadge").textContent = `集計 ${fmtTime(inv.generatedAt)}`;
  const find = (name) => inv.sources.find((s) => s.name === name) || {};
  const news = find("ニュース"), embed = find("ニュースBERT埋め込み"), shinyo = find("信用残");
  $("#dataKpis").innerHTML = `<article><span>ニュース累計</span><strong>${intJa(news.rows)}件</strong><small>9/22取得 +${intJa(news.addedToday)}</small></article><article><span>BERT埋め込み済み</span><strong>${intJa(embed.rows)}記事</strong><small>${intJa(embed.codes)}銘柄</small></article><article><span>EDINET 有報XBRL</span><strong>${intJa(inv.edinetSummary?.rows)}行</strong><small>${intJa(inv.edinetSummary?.codes)}銘柄 · ${inv.edinetItems.filter((i) => i.rows > 0).length}/${inv.edinetItems.length}項目に値あり</small></article><article><span>信用残</span><strong>${intJa(shinyo.rows)}行</strong><small>${escapeHtml(shinyo.start || "—")}〜${escapeHtml(shinyo.end || "—")}</small></article>`;
  const stateLabel = { active: "稼働", collecting: "蓄積中", paused: "停止", experimental: "実験", manual: "手動" };
  $("#dataSources").innerHTML = inv.sources.map((s) => `<article class="panel source-card"><header><span class="status-dot ${s.state}"></span><div><span>${escapeHtml(s.group)}</span><h3>${escapeHtml(s.name)}</h3></div><em class="status-badge ${s.state}">${stateLabel[s.state] || s.state}</em></header><div class="source-figures"><span>件数<b>${s.rows == null ? "—" : intJa(s.rows)}</b></span><span>銘柄/ファイル<b>${s.codes == null ? "—" : intJa(s.codes)}</b></span><span>期間<b>${s.start || s.end ? `${escapeHtml(s.start || "…")}〜${escapeHtml(s.end || "…")}` : "—"}</b></span></div><p>${escapeHtml(s.note)}</p><small>更新 ${escapeHtml(fmtTime(s.updatedAt))} · <code>${escapeHtml(s.path)}</code></small></article>`).join("");
  if ($("#edinetItemCount")) $("#edinetItemCount").textContent = `${(inv.edinetItems || []).length} ITEMS`;
  $("#edinetSummary").textContent = `${intJa(inv.edinetSummary?.rows)}行 / ${intJa(inv.edinetSummary?.codes)}銘柄 / 提出 ${String(inv.edinetSummary?.submitRange?.[0] || "").slice(0, 10)}〜${String(inv.edinetSummary?.submitRange?.[1] || "").slice(0, 10)}`;
  $("#dataEdinet").innerHTML = inv.edinetItems.map((i) => `<tr class="${i.rows ? "" : "warn-row"}"><td><strong>${escapeHtml(i.label)}</strong><small><code>${escapeHtml(i.key)}</code></small></td><td>${escapeHtml(i.origin)}</td><td>${i.added === "既存" ? '<span class="pill muted">既存</span>' : `<span class="pill primary">追加 ${escapeHtml(i.added.slice(5).replace("-", "/"))}</span>`}</td><td>${intJa(i.rows)}</td><td>${intJa(i.codes)}</td><td><div class="coverage"><div class="bar-track"><i style="width:${(i.coverage * 100).toFixed(1)}%"></i></div><b>${metricPercent(i.coverage)}</b></div>${i.rows ? "" : '<small class="negative-text">取得0件・要確認</small>'}</td><td>${Object.entries(i.bases || {}).map(([k, v]) => `<span class="basis">${escapeHtml(k)} ${intJa(v)}</span>`).join("") || "—"}</td></tr>`).join("");
  $("#dataFetchLog").innerHTML = (inv.newsFetchLog || []).slice().reverse().map((r) => `<tr><td>${escapeHtml(r.fetchedAt)}</td><td>${intJa(r.rows)}</td></tr>`).join("");
  drawDataCharts();
}

function drawDataCharts() {
  if (!state.inventory || state.page !== "data") return;
  drawColumns($("#dataNewsChart"), (state.inventory.newsDaily || []).slice(-30).map((r) => ({ label: r.date, value: r.count })), { height: 220, unit: "公開記事数" });
}

const edinetFormat = (unit, value) => {
  const v = number(value); if (v === null) return "—";
  if (unit === "円") return Math.abs(v) >= 1e8 ? `${(v / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}億円` : `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円`;
  if (unit === "比率") return `${(v * 100).toFixed(1)}%`;
  if (unit === "%") return `${(v <= 1 ? v * 100 : v).toFixed(1)}%`;
  if (unit === "倍") return `${v.toFixed(1)}倍`;
  if (unit === "人") return `${Math.round(v).toLocaleString("ja-JP")}人`;
  return v.toLocaleString("ja-JP");
};

function renderInsights(company) {
  if (!company) return;
  const ev = state.evidence?.stocks?.[company.code];
  const horizon = String(state.horizon);
  const rows = ev?.contrib?.[horizon] || [];
  const meth = ev?.method?.[horizon];
  $("#contribNote").textContent = `${meth ? `${meth.model}(${meth.method})` : "水準の主役の模型で分解"} · ${horizon}日 · ${state.evidence?.file || ""}`;
  $("#stockContrib").innerHTML = rows.length ? `<div class="bar-list diverging compact">${barList(rows.map((r) => ({ ...r, tower: (state.lab?.models?.features || []).find((f) => f.name === r.name)?.tower || "" })), { valueKey: "contribution", format: (v) => signed(v, 3), diverging: true })}</div><p class="lab-foot">右=予測を押し上げ、左=押し下げ。${meth ? `${escapeHtml(meth.model)} の予測を ${escapeHtml(meth.method)} で分解した値。` : ""}</p>` : `<div class="empty-state"><p>${ev ? "この期限の寄与は根拠ファイルにありません。" : "根拠ファイル(注目銘柄のみ)の対象外です。"}</p><small>対象: ${escapeHtml(Object.keys(state.evidence?.stocks || {}).join(" / ") || "なし")}</small></div>`;

  const items = state.detail?.[company.code]?.edinet || state.edinet?.stocks?.[company.code] || {};
  const catalog = state.inventory?.edinetItems || [];
  const order = ["roe", "eps", "bps", "per", "equity_ratio", "operating_income", "ordinary_income", "net_income_parent", "revenue_ifrs", "net_sales", "gross_profit", "cf_op", "cf_inv", "contract_liab", "capex", "rnd", "n_employees", "foreign_own_pct", "inventories", "wc_recv_chg", "wc_inv_chg", "wc_pay_chg", "total_assets", "net_assets", "contract_liab_chg", "cf_fin", "revenue_stmt"];
  const present = order.filter((key) => items[key]?.length);
  $("#stockEdinet").innerHTML = present.length ? `<div class="edinet-stock"><table class="financial-table"><thead><tr><th>項目</th><th>最新期</th><th>値</th><th>前期</th></tr></thead><tbody>${present.map((key) => { const meta = catalog.find((c) => c.key === key) || { label: key, unit: "", added: "" }; const series = items[key]; const last = series.at(-1); const prev = series.at(-2); return `<tr><th>${escapeHtml(meta.label)}${meta.added && meta.added !== "既存" ? '<i class="new-dot" title="9/23追加">NEW</i>' : ""}</th><td>${escapeHtml(String(last[0]).slice(0, 7))}</td><td>${edinetFormat(meta.unit, last[1])}</td><td>${prev ? edinetFormat(meta.unit, prev[1]) : "—"}</td></tr>`; }).join("")}</tbody></table></div><p class="lab-foot">値は有報提出の翌日(available_from)から予測に使えます。${escapeHtml(state.inventory?.edinetSummary?.unitNote || "")}</p>` : '<div class="empty-state"><p>この銘柄の有報データはまだありません。</p></div>';

  const facts = state.evidence?.relations?.stocks?.[company.code] || [];
  const typeLabel = { jv: "合弁", supplier: "仕入先", customer: "顧客・販売先", peer: "同業", material: "素材・部材" };
  const evidenceLabel = { disclosed: "開示", reported: "報道", assumed: "仮定" };
  $("#stockRelationFacts").innerHTML = facts.length ? `<div class="fact-list">${facts.slice(0, 8).map((f) => `<article><header><strong>${escapeHtml(f.name)}</strong><span>${escapeHtml(f.code)} · ${escapeHtml(f.market || "")}</span><em>${escapeHtml(typeLabel[f.type] || f.type || "関係")}${f.direction === "in" ? "(被参照)" : ""}</em></header><p>${escapeHtml(f.note || "")}</p><small>有効 ${escapeHtml(f.validFrom || "—")}〜${escapeHtml(f.validTo || "")} · 根拠 ${escapeHtml(evidenceLabel[f.evidence] || f.evidence || "—")}</small></article>`).join("")}</div>${facts.length > 8 ? `<p class="lab-foot">ほか${facts.length - 8}件</p>` : ""}` : '<div class="empty-state"><p>この銘柄には登録済みの関係エッジがありません(推測で埋めません)。</p></div>';
}

// ===================== TradingView 風チャート (2026-09-23) =====================
// 1枚目のキャンバス=価格ペイン(ローソク・出来高・移動平均・BB・予測帯・描画)、2枚目=サブ指標+時間軸。
// ホイール/ボタンで拡大縮小、ドラッグで左右移動。十字線は両ペインで同期する。
const TV_AXIS_W = 72;
const TV_TIME_H = 26;
state.tv = { count: null, offset: 0, hover: null, drag: null, tool: "cursor", pending: null };
state.chartWeekly = [];

function tvColor(name, fallback) { return css(name) || fallback; }
function tvFmt(value) {
  let v = number(value); if (v === null) return "—";
  if (Math.abs(v) < 1e-9) v = 0;   // 軸の「-0」を出さない
  const abs = Math.abs(v);
  return v.toLocaleString("ja-JP", { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 100 ? 1 : 2 });
}
function tvVolume(value) {
  const v = number(value, 0);
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}億`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return v.toLocaleString("ja-JP");
}
function tvNiceStep(span, target) { const raw = span / Math.max(target, 1); const mag = 10 ** Math.floor(Math.log10(raw || 1)); return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || raw; }

function decodeChartDoc(doc) {
  if (Array.isArray(doc)) return { daily: doc, weekly: [] };
  const toRow = (a) => ({ d: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] });
  const preds = doc?.p || {};
  const daily = (doc?.d || []).map((a) => { const row = toRow(a); if (preds[row.d]) row.p = preds[row.d]; return row; });
  return { daily, weekly: (doc?.w || []).map(toRow) };
}

async function fetchChartPoints(code) {
  let doc = null;
  try {
    if (!state.chartIndex) { const r = await fetch("data/chart-index.json", { cache: "no-store" }); state.chartIndex = r.ok ? await r.json() : {}; }
    const chunk = state.chartIndex?.[code];
    if (chunk) {
      state.chartChunks = state.chartChunks || {};
      if (!state.chartChunks[chunk]) { const r = await fetch(`data/chart-chunks/${chunk}.json`, { cache: "no-store" }); state.chartChunks[chunk] = r.ok ? await r.json() : {}; }
      doc = state.chartChunks[chunk][code] || null;
    }
  } catch { doc = null; }
  if (!doc) { try { const r = await fetch(`data/charts/${encodeURIComponent(code)}.json`, { cache: "no-store" }); doc = r.ok ? await r.json() : []; } catch { doc = []; } }
  const decoded = decodeChartDoc(doc);
  state.chartWeekly = decoded.weekly;
  state.chartSplits = Array.isArray(doc?.s) ? doc.s : [];   // 2026-09-25: 株式分割(売買履歴の単価を割り戻す)
  return decoded.daily;
}
function chartRows() {
  const daily = state.chartData || [];
  if (!daily.length) return [];
  if (state.chartInterval === "1d") return daily.map((row) => ({ ...row, start: row.d, end: row.d }));
  const source = [...(state.chartWeekly || []), ...daily];
  const groups = [];
  source.forEach((row) => {
    const key = intervalKey(row.d, state.chartInterval);
    let group = groups.at(-1);
    if (!group || group.key !== key) { group = { key, d: row.d, start: row.d, end: row.d, o: row.o, h: row.h, l: row.l, c: row.c, v: 0, p: null }; groups.push(group); }
    group.end = row.d; group.d = row.d; group.h = Math.max(group.h, row.h); group.l = Math.min(group.l, row.l); group.c = row.c; group.v += row.v || 0; if (row.p) group.p = row.p;
  });
  return groups;
}

function tvDefaultCount(rows) {
  if (!rows.length) return 0;
  const start = periodStart(rows.at(-1).d, state.chartPeriod);
  const count = start ? rows.filter((row) => row.d >= start).length : rows.length;
  return Math.max(Math.min(count, rows.length), Math.min(rows.length, 12));
}
function tvView(rows) {
  const n = rows.length;
  if (state.tv.count == null) state.tv.count = tvDefaultCount(rows);
  const count = Math.max(10, Math.min(state.tv.count, n));
  state.tv.count = count;
  state.tv.offset = Math.max(0, Math.min(state.tv.offset, Math.max(0, n - count)));
  const end = n - 1 - state.tv.offset;
  return { start: Math.max(0, end - count + 1), end, count };
}
function tvResetView() { state.tv.count = null; state.tv.offset = 0; state.tv.hover = null; drawStockChart(); drawIndicatorChart(); }

function tvIndicators(rows) {
  const ma = (size) => movingAverage(rows, size);
  const basis = ma(20); const upper = [], lower = [];
  rows.forEach((_, i) => {
    if (i < 19) { upper.push(null); lower.push(null); return; }
    const win = rows.slice(i - 19, i + 1).map((r) => r.c); const mean = basis[i];
    const sd = Math.sqrt(win.reduce((s, v) => s + (v - mean) ** 2, 0) / win.length);
    upper.push(mean + 2 * sd); lower.push(mean - 2 * sd);
  });
  return { ma5: ma(5), ma25: ma(25), ma75: ma(75), bbU: upper, bbM: basis, bbL: lower };
}

function tvGeometry(canvas, rows, view, extraW) {
  const width = canvas.clientWidth;
  const plotW = Math.max(60, width - TV_AXIS_W - extraW);
  const slot = plotW / view.count;
  const x = (i) => (i - view.start + 0.5) * slot;
  const indexAt = (px) => Math.max(view.start, Math.min(view.end, Math.floor(px / slot) + view.start));
  return { width, plotW, slot, x, indexAt };
}

function tvDrawings() {
  try { return JSON.parse(localStorage.getItem(`fs-drawings-${symKey()}`) || "[]"); } catch { return state.tv.memDrawings?.[symKey()] || []; }
}
function tvSaveDrawings(list) {
  state.tv.memDrawings = state.tv.memDrawings || {}; state.tv.memDrawings[symKey()] = list;
  try { localStorage.setItem(`fs-drawings-${symKey()}`, JSON.stringify(list)); } catch { /* 保存不可でも表示は続ける */ }
}
function drawStockChart() {
  const canvas = $("#stockChart");
  if (!canvas || !TV_PAGES.has(state.page) || !canvas.clientWidth) return;
  const subOn = state.indicator !== "none";
  const H = Math.round(canvas.clientHeight || 470);
  const { ctx, width, height } = setupCanvas(canvas, H);
  const bg = tvColor("--tv-bg", "#131722");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  const rows = chartRows();
  if (!rows.length) { ctx.fillStyle = tvColor("--tv-muted", "#787b86"); ctx.font = "13px sans-serif"; ctx.fillText("価格データがありません", 20, 32); renderTvLegend(null); return; }
  const view = tvView(rows);
  const show = { forecast: $("#toggleForecast")?.checked, volume: $("#toggleVolume")?.checked, profile: $("#toggleProfile")?.checked, ma: $("#toggleMa")?.checked, bb: $("#toggleBb")?.checked, trades: $("#toggleTrades")?.checked && !isIndexSym(), past: $("#togglePast")?.checked };
  const fc = tvForecast();
  const hasFc = !!(show.forecast && fc && number(fc.price) !== null);
  const futureW = hasFc && state.tv.offset === 0 ? Math.min(150, Math.max(96, width * .12)) : 0;
  const g = tvGeometry(canvas, rows, view, futureW);
  const timeH = subOn ? 0 : TV_TIME_H;
  const top = 10, bottom = height - timeH - 6;
  const visible = rows.slice(view.start, view.end + 1);
  const ind = tvIndicators(rows);
  let lo = Math.min(...visible.map((r) => r.l)); let hi = Math.max(...visible.map((r) => r.h));
  if (show.bb) for (let i = view.start; i <= view.end; i++) { if (Number.isFinite(ind.bbU[i])) { hi = Math.max(hi, ind.bbU[i]); lo = Math.min(lo, ind.bbL[i]); } }
  if (futureW) [fc.low90, fc.high90, fc.low68, fc.high68].forEach((v) => { const n = number(v); if (n !== null) { lo = Math.min(lo, n); hi = Math.max(hi, n); } });
  // 点予測・他の模型・過去の予測は、表示範囲を大きく歪める値(外挿など)では広げず、端に矢印で示す
  const span0 = hi - lo || hi * .02 || 1; const allowLo = lo - span0 * .35, allowHi = hi + span0 * .35;
  const fcPts = futureW ? [fc.price, ...Object.values(fc.models || {}).map((m) => m.price), fc.claude?.price].map(number).filter((v) => v !== null) : [];
  fcPts.forEach((v) => { if (v >= allowLo && v <= allowHi) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  const past = show.past && state.chartInterval === "1d" ? tvPastPoints(rows, view, fc) : null;
  if (past) [...past.pts.map((p) => p.price), ...past.ma.filter((v, i) => i >= view.start && i <= view.end && Number.isFinite(v))].forEach((v) => { if (v >= allowLo && v <= allowHi) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  (tvDrawings() || []).forEach((d) => { if (d.type === "h" && d.price > lo * .7 && d.price < hi * 1.3) { lo = Math.min(lo, d.price); hi = Math.max(hi, d.price); } });
  const padP = (hi - lo) * 0.08 || hi * 0.02 || 1; lo -= padP; hi += padP;
  const volH = show.volume ? (bottom - top) * 0.2 : 0;
  const priceBottom = bottom;
  const y = (v) => top + (hi - v) / (hi - lo) * (priceBottom - top);
  const yInv = (py) => hi - (py - top) / (priceBottom - top) * (hi - lo);
  state.tv.main = { g, view, rows, y, yInv, top, bottom, lo, hi, futureW, ind };

  const grid = tvColor("--tv-grid", "#1e222d"); const text = tvColor("--tv-muted", "#787b86");
  const up = tvColor("--tv-up", "#089981"); const down = tvColor("--tv-down", "#f23645");
  const step = tvNiceStep(hi - lo, Math.max(4, Math.round((bottom - top) / 55)));
  ctx.font = "11px -apple-system, 'Segoe UI', Inter, sans-serif"; ctx.textAlign = "left"; ctx.lineWidth = 1;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const py = Math.round(y(v)) + .5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(g.plotW + futureW, py); ctx.stroke();
    ctx.fillStyle = text; ctx.fillText(tvFmt(v), g.plotW + futureW + 8, py + 4);
  }
  tvMonthTicks(rows, view).forEach((i) => { const px = Math.round(g.x(i)) + .5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke(); });
  ctx.strokeStyle = tvColor("--tv-border", "#2a2e39"); ctx.beginPath(); ctx.moveTo(g.plotW + futureW + .5, 0); ctx.lineTo(g.plotW + futureW + .5, height); ctx.stroke();

  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, g.plotW, bottom); ctx.clip();
  if (show.volume) {
    const vmax = Math.max(...visible.map((r) => r.v || 0), 1);
    visible.forEach((r, k) => { const i = view.start + k; const h = (r.v || 0) / vmax * volH; ctx.fillStyle = r.c >= r.o ? up : down; ctx.globalAlpha = .28; ctx.fillRect(g.x(i) - g.slot * .38, bottom - h, Math.max(1, g.slot * .76), h); });
    ctx.globalAlpha = 1;
  }
  if (show.profile) {
    const bins = 24; const vols = Array(bins).fill(0);
    visible.forEach((r) => { const c = (r.h + r.l + r.c) / 3; const b = Math.min(bins - 1, Math.max(0, Math.floor((c - lo) / (hi - lo) * bins))); vols[b] += r.v || 0; });
    const vm = Math.max(...vols, 1); const bh = (priceBottom - top) / bins; const pw = Math.min(140, g.plotW * .22);
    vols.forEach((v, b) => { const w = v / vm * pw; ctx.fillStyle = tvColor("--tv-profile", "rgba(120,123,134,.25)"); ctx.fillRect(g.plotW - w, y(lo + (b + 1) / bins * (hi - lo)) + 1, w, bh - 2); });
  }
  if (show.bb) {
    ctx.fillStyle = tvColor("--tv-bb-fill", "rgba(41,98,255,.06)"); ctx.beginPath(); let started = false;
    for (let i = view.start; i <= view.end; i++) if (Number.isFinite(ind.bbU[i])) { const px = g.x(i); if (!started) { ctx.moveTo(px, y(ind.bbU[i])); started = true; } else ctx.lineTo(px, y(ind.bbU[i])); }
    for (let i = view.end; i >= view.start; i--) if (Number.isFinite(ind.bbL[i])) ctx.lineTo(g.x(i), y(ind.bbL[i]));
    if (started) { ctx.closePath(); ctx.fill(); }
    [[ind.bbU, 1], [ind.bbL, 1], [ind.bbM, .6]].forEach(([vals, alpha]) => { ctx.globalAlpha = alpha; tvLine(ctx, vals, view, g.x, y, tvColor("--tv-bb", "#2962ff"), 1); ctx.globalAlpha = 1; });
  }
  const bodyW = Math.max(1, Math.min(g.slot * .72, 18));
  visible.forEach((r, k) => {
    const i = view.start + k; const px = Math.round(g.x(i)); const color = r.c >= r.o ? up : down;
    ctx.fillStyle = color; ctx.fillRect(px, y(r.h), 1, Math.max(1, y(r.l) - y(r.h)));
    const t = y(Math.max(r.o, r.c)); const b = y(Math.min(r.o, r.c)); ctx.fillRect(Math.round(px - bodyW / 2 + .5), t, Math.max(1, Math.round(bodyW)), Math.max(1, b - t));
  });
  if (show.ma) {
    tvLine(ctx, ind.ma5, view, g.x, y, tvColor("--tv-ma1", "#2962ff"), 1.4);
    tvLine(ctx, ind.ma25, view, g.x, y, tvColor("--tv-ma2", "#ff9800"), 1.4);
    tvLine(ctx, ind.ma75, view, g.x, y, tvColor("--tv-ma3", "#ab47bc"), 1.4);
  }
  if (past) drawPastPredictions(ctx, past, view, g, y, fc);
  const position = show.trades ? drawTradeMarkers(ctx, rows, g, y, view, top, bottom) : null;
  if (!show.trades) { state.tv.tradeBars = null; state.tv.position = null; }
  tvDrawDrawings(ctx, rows, g, y);
  ctx.restore();

  const last = rows.at(-1); const lastColor = last.c >= (rows.at(-2)?.c ?? last.o) ? up : down;
  if (futureW) drawFutureZone(ctx, { fc, g, y, top, bottom, futureW, rows, last, lo, hi, text });
  ctx.setLineDash([1, 3]); ctx.strokeStyle = lastColor; ctx.beginPath(); ctx.moveTo(0, Math.round(y(last.c)) + .5); ctx.lineTo(g.plotW + futureW, Math.round(y(last.c)) + .5); ctx.stroke(); ctx.setLineDash([]);
  tvAxisLabel(ctx, g.plotW + futureW, y(last.c), tvFmt(last.c), lastColor, "#fff");
  if (position && y(position.avg) >= top && y(position.avg) <= bottom) {
    const pnl = last.c / position.avg - 1; const label = `保有 ${tvQty(position.qty)}株 · 平均 ${tvFmt(position.avg)} · ${percent(pnl, 2)}`;
    ctx.font = "600 11px -apple-system, 'Segoe UI', sans-serif"; const w = ctx.measureText(label).width + 12; const py = y(position.avg);
    const lx = Math.max(6, g.plotW - w - 8);
    ctx.fillStyle = TRADE_COLORS.buy; ctx.globalAlpha = .92; ctx.fillRect(lx, py - 9, w, 18); ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.fillText(label, lx + 6, py + 4);
    tvAxisLabel(ctx, g.plotW + futureW, py, tvFmt(position.avg), TRADE_COLORS.buy, "#fff");
  }

  const hover = state.tv.hover;
  if (hover && hover.i >= view.start && hover.i <= view.end) {
    const hx = Math.round(g.x(hover.i)) + .5; const cross = tvColor("--tv-cross", "#9598a1");
    ctx.strokeStyle = cross; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, bottom); ctx.stroke();
    if (hover.pane === "main" && hover.y != null && hover.y < bottom) { ctx.beginPath(); ctx.moveTo(0, hover.y + .5); ctx.lineTo(g.plotW + futureW, hover.y + .5); ctx.stroke(); ctx.setLineDash([]); tvAxisLabel(ctx, g.plotW + futureW, hover.y, tvFmt(yInv(hover.y)), tvColor("--tv-label-bg", "#363a45"), tvColor("--tv-label-fg", "#fff")); }
    ctx.setLineDash([]);
  }
  if (!subOn) tvTimeAxis(ctx, rows, view, g, height - TV_TIME_H, width);
  if (state.tv.pending) { ctx.fillStyle = tvColor("--tv-muted", "#787b86"); ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.fillText("トレンドライン: 終点をクリック", 10, bottom - 8); }
  renderTvLegend(hover && hover.i >= view.start && hover.i <= view.end ? hover.i : rows.length - 1, fc, show, past);
}
function tvLine(ctx, values, view, x, y, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); let started = false;
  for (let i = Math.max(0, view.start - 1); i <= Math.min(values.length - 1, view.end + 1); i++) { const v = values[i]; if (!Number.isFinite(v)) { started = false; continue; } if (!started) { ctx.moveTo(x(i), y(v)); started = true; } else ctx.lineTo(x(i), y(v)); }
  ctx.stroke();
}

function tvAxisLabel(ctx, x0, py, label, bgColor, fg) {
  ctx.font = "600 11px -apple-system, 'Segoe UI', Inter, sans-serif"; const h = 20;
  ctx.fillStyle = bgColor; ctx.fillRect(x0 + 1, py - h / 2, TV_AXIS_W - 2, h);
  ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.fillText(label, x0 + 8, py + 4);
}

function tvMonthTicks(rows, view) {
  const ticks = []; let lastKey = null;
  const long = state.chartInterval === "1mo" || state.chartInterval === "1y" || view.count > 400;
  for (let i = view.start; i <= view.end; i++) {
    const key = long ? rows[i].d.slice(0, 4) : rows[i].d.slice(0, 7);
    if (lastKey !== null && key !== lastKey) ticks.push(i);
    lastKey = key;
  }
  const maxTicks = 12; const stride = Math.max(1, Math.ceil(ticks.length / maxTicks));
  return ticks.filter((_, k) => k % stride === 0);
}

function tvTimeAxis(ctx, rows, view, g, y0, width) {
  ctx.fillStyle = tvColor("--tv-bg", "#131722"); ctx.fillRect(0, y0, width, TV_TIME_H);
  ctx.strokeStyle = tvColor("--tv-border", "#2a2e39"); ctx.beginPath(); ctx.moveTo(0, y0 + .5); ctx.lineTo(width, y0 + .5); ctx.stroke();
  ctx.fillStyle = tvColor("--tv-muted", "#787b86"); ctx.font = "11px -apple-system, 'Segoe UI', Inter, sans-serif"; ctx.textAlign = "center";
  const long = state.chartInterval === "1mo" || state.chartInterval === "1y" || view.count > 400;
  tvMonthTicks(rows, view).forEach((i) => { const d = rows[i].d; const label = long ? d.slice(0, 4) : (d.slice(5, 7) === "01" ? d.slice(0, 4) : `${Number(d.slice(5, 7))}月`); ctx.fillText(label, g.x(i), y0 + 17); });
  const hover = state.tv.hover;
  if (hover && hover.i >= view.start && hover.i <= view.end) {
    const r = rows[hover.i]; const label = state.chartInterval === "1d" ? `${r.d} (${"日月火水木金土"[new Date(`${r.d}T00:00:00Z`).getUTCDay()]})` : `${r.start || r.d}〜${r.end || r.d}`;
    ctx.font = "600 11px -apple-system, 'Segoe UI', Inter, sans-serif"; const w = ctx.measureText(label).width + 16; const cx = Math.min(Math.max(g.x(hover.i), w / 2), g.plotW - w / 2);
    ctx.fillStyle = tvColor("--tv-label-bg", "#363a45"); ctx.fillRect(cx - w / 2, y0 + 3, w, TV_TIME_H - 6); ctx.fillStyle = tvColor("--tv-label-fg", "#fff"); ctx.fillText(label, cx, y0 + 17);
  }
}

function tvDrawDrawings(ctx, rows, g, y) {
  const list = tvDrawings(); if (!list.length && !state.tv.pending) return;
  const idx = (date) => { let best = -1; for (let i = 0; i < rows.length; i++) { if ((rows[i].start || rows[i].d) <= date) best = i; else break; } return best; };
  ctx.lineWidth = 1.5; ctx.strokeStyle = tvColor("--tv-draw", "#f7a600");
  list.forEach((d) => {
    if (d.type === "h") { ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(0, y(d.price)); ctx.lineTo(g.plotW, y(d.price)); ctx.stroke(); ctx.fillStyle = tvColor("--tv-draw", "#f7a600"); ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.fillText(tvFmt(d.price), 6, y(d.price) - 4); }
    if (d.type === "t") { const a = idx(d.a.d), b = idx(d.b.d); if (a < 0 || b < 0) return; ctx.beginPath(); ctx.moveTo(g.x(a), y(d.a.p)); ctx.lineTo(g.x(b), y(d.b.p)); ctx.stroke(); [[a, d.a.p], [b, d.b.p]].forEach(([i, p]) => { ctx.beginPath(); ctx.arc(g.x(i), y(p), 3, 0, Math.PI * 2); ctx.stroke(); }); }
  });
  if (state.tv.pending) { const a = idx(state.tv.pending.d); if (a >= 0) { ctx.beginPath(); ctx.arc(g.x(a), y(state.tv.pending.p), 4, 0, Math.PI * 2); ctx.stroke(); } }
}

function renderTvLegend(i, fc, show = {}, past = null) {
  const box = $("#chartLegend"); if (!box) return;
  const info = tvSymInfo();
  const rows = state.tv.main?.rows || []; const r = rows[i];
  if (!r) { box.innerHTML = `<div class="tv-legend-line"><strong>${escapeHtml(info.title)}</strong></div>`; return; }
  const prev = rows[i - 1]; const chg = prev ? r.c - prev.c : null; const pct = prev ? r.c / prev.c - 1 : null;
  const cls = chg == null ? "" : chg >= 0 ? "tv-up" : "tv-down";
  const intervalLabel = { "1d": "1日", "1w": "1週", "1mo": "1ヶ月", "1y": "1年" }[state.chartInterval];
  const ind = state.tv.main.ind;
  const maLine = show.ma ? `<span class="tv-ind"><em>MA</em> <b style="color:var(--tv-ma1)">5 ${tvFmt(ind.ma5[i])}</b> <b style="color:var(--tv-ma2)">25 ${tvFmt(ind.ma25[i])}</b> <b style="color:var(--tv-ma3)">75 ${tvFmt(ind.ma75[i])}</b></span>` : "";
  const bbLine = show.bb ? `<span class="tv-ind"><em>BB 20 2</em> <b style="color:var(--tv-bb)">${tvFmt(ind.bbU[i])} ${tvFmt(ind.bbM[i])} ${tvFmt(ind.bbL[i])}</b></span>` : "";
  let fcLine = "";
  if (show.forecast && fc) {
    const key = fc.model === "ADOPTED" ? "ADOPTED" : fc.model === "CLAUDE" ? "CLAUDE" : fc.key;
    const saved = r.p?.[String(fc.h)]?.[key];
    const others = Object.entries(fc.models || {}).filter(([m]) => m !== fc.key || fc.model === "CLAUDE").map(([m, v]) => `<span style="color:${modelColors[m]}">● ${m} ${percent(v.return)}${v.clipped ? "⚠" : ""}</span>`).join(" ");
    const claude = fc.claude && fc.model !== "CLAUDE" ? ` <span style="color:${modelColors.CLAUDE}">◆ Claude ${percent(fc.claude.return)}</span>` : "";
    const measure = isIndexSym() ? "期間平均" : "期間VWAP";
    fcLine = `<div class="tv-legend-line tv-ai"><em>AI予測 ${escapeHtml(horizonLabel(fc.h))}</em> <b style="color:${fc.color}">${escapeHtml(fc.label)} ${measure} ${tvFmt(fc.price)} (${percent(fc.return)})</b>${fc.clipped?.clipped ? ` <span class="tv-warn" title="${escapeHtml(rangeNote({ range: fc.clipped }))}">⚠外挿(生の値 ${percent(fc.clipped.raw)})</span>` : ""} <span>68% ${tvFmt(fc.low68)}–${tvFmt(fc.high68)}</span> ${others}${claude}${fc.uc ? ' <span class="tv-warn">⚠検証中の期限</span>' : ""}${fc.fallback ? ` <span class="tv-warn">${escapeHtml(fc.fallback)}</span>` : ""}${saved && i !== rows.length - 1 ? ` <span>· この日の予測 ${percent(saved.return)}${number(saved.actual) !== null ? ` → 実績 ${percent(saved.actual)}` : ""}</span>` : ""}</div>`;
  }
  const pastLine = past ? `<div class="tv-legend-line tv-past"><em>過去の予測</em> <span>点線=その日に出した${past.h}日先の予測(${escapeHtml(past.label)})を期限の日に表示 · 実線=実際の${past.h}日平均(終値${isIndexSym() ? "" : "。予測の対象はVWAPなので近似"}) · ${past.pts.length}点${past.mae !== null ? ` · 平均誤差 ${metricPercent(past.mae, 2)}` : ""}</span></div>` : "";
  const bars = state.tv.tradeBars?.get(i) || [];
  const items = bars.flatMap((b) => b.items);
  const tradeLine = items.length ? `<div class="tv-legend-line tv-trade">${items.slice(0, 6).map((t) => `<span class="${t.side}"><b>${t.side === "buy" ? "買" : "売"}</b> ${tvQty(t.qty)}株 @${tvFmt(t.price)}${t.splitFactor !== 1 ? `<small>(分割前 ${tvFmt(t.rawPrice)}×${tvQty(t.rawQty)}株)</small>` : ""}${t.side === "sell" && Number.isFinite(t.costPrice) && t.costPrice > 0 ? ` 取得 ${tvFmt(t.costPrice)}` : ""}${Number.isFinite(t.realizedPnl) ? ` <b class="${t.realizedPnl >= 0 ? "tv-up" : "tv-down"}">${t.realizedPnl >= 0 ? "+" : ""}${Math.round(t.realizedPnl).toLocaleString("ja-JP")}円</b>` : ""} <small>${escapeHtml(t.account || t.broker || "")}</small></span>`).join(" ")}${items.length > 6 ? ` <span>ほか${items.length - 6}件</span>` : ""}</div>` : "";
  const pos = state.tv.position; const lastC = rows.at(-1)?.c;
  const posLine = pos && show.trades ? `<div class="tv-legend-line tv-trade"><em>建玉</em> <span>保有 ${tvQty(pos.qty)}株 · 平均取得 ${tvFmt(pos.avg)} · 含み損益 <b class="${lastC >= pos.avg ? "tv-up" : "tv-down"}">${percent(lastC / pos.avg - 1, 2)}(${Math.round((lastC - pos.avg) * pos.qty).toLocaleString("ja-JP")}円)</b> · 取得日 ${escapeHtml(pos.since || "—")}〜</span></div>` : "";
  box.innerHTML = `<div class="tv-legend-line"><strong>${escapeHtml(info.title)} · ${intervalLabel} · ${escapeHtml(info.venue)}</strong><span>始<b class="${cls}">${tvFmt(r.o)}</b></span><span>高<b class="${cls}">${tvFmt(r.h)}</b></span><span>安<b class="${cls}">${tvFmt(r.l)}</b></span><span>終<b class="${cls}">${tvFmt(r.c)}</b></span>${chg == null ? "" : `<b class="${cls}">${chg >= 0 ? "+" : ""}${tvFmt(chg)} (${percent(pct, 2)})</b>`}${r.v ? `<span>出来高<b class="${cls}">${tvVolume(r.v)}</b></span>` : ""}</div>${maLine || bbLine ? `<div class="tv-legend-line">${maLine}${bbLine}</div>` : ""}${fcLine}${pastLine}${posLine}${tradeLine}`;
}
function drawIndicatorChart() {
  const canvas = $("#indicatorChart"); if (!canvas || !TV_PAGES.has(state.page) || !canvas.clientWidth) return;
  const pane = canvas.closest(".tv-pane"); if (pane) pane.hidden = state.indicator === "none";
  if (state.indicator === "none") { requestAnimationFrame(() => drawStockChart()); return; }
  const H = Math.round(canvas.clientHeight || 170);
  const { ctx, width, height } = setupCanvas(canvas, H);
  ctx.fillStyle = tvColor("--tv-bg", "#131722"); ctx.fillRect(0, 0, width, height);
  const main = state.tv.main; if (!main || !main.rows.length) return;
  const { rows, view, g } = main; const top = 8, bottom = height - TV_TIME_H - 4;
  const grid = tvColor("--tv-grid", "#1e222d"), text = tvColor("--tv-muted", "#787b86");
  let series = [], lo = 0, hi = 100, legend = "";
  const at = state.tv.hover ? state.tv.hover.i : rows.length - 1;
  if (state.indicator === "macd") {
    const m = macd(rows); const vals = []; for (let i = view.start; i <= view.end; i++) [m.line[i], m.signal[i], m.histogram[i]].forEach((v) => Number.isFinite(v) && vals.push(v));
    const ext = Math.max(...vals.map(Math.abs), 1e-9); lo = -ext * 1.1; hi = ext * 1.1; series = [["hist", m.histogram], [tvColor("--tv-macd", "#2962ff"), m.line], [tvColor("--tv-signal", "#ff6d00"), m.signal]];
    legend = `<em>MACD 12 26 9</em> <b style="color:var(--tv-macd)">${tvFmt(m.line[at])}</b> <b style="color:var(--tv-signal)">${tvFmt(m.signal[at])}</b> <b class="${number(m.histogram[at], 0) >= 0 ? "tv-up" : "tv-down"}">${tvFmt(m.histogram[at])}</b>`;
  } else if (state.indicator === "rsi") {
    const r = rsi(rows); series = [[tvColor("--tv-rsi", "#7e57c2"), r]]; legend = `<em>RSI 14</em> <b style="color:var(--tv-rsi)">${number(r[at])?.toFixed(2) ?? "—"}</b>`;
  } else {
    const s = stochastic(rows); series = [[tvColor("--tv-macd", "#2962ff"), s.k], [tvColor("--tv-signal", "#ff6d00"), s.d]]; legend = `<em>Stoch 14 3</em> <b style="color:var(--tv-macd)">${number(s.k[at])?.toFixed(2) ?? "—"}</b> <b style="color:var(--tv-signal)">${number(s.d[at])?.toFixed(2) ?? "—"}</b>`;
  }
  const y = (v) => top + (hi - v) / (hi - lo) * (bottom - top);
  const levels = state.indicator === "macd" ? [0] : state.indicator === "rsi" ? [30, 50, 70] : [20, 50, 80];
  if (state.indicator !== "macd") { const [a, , b] = levels; ctx.fillStyle = tvColor("--tv-band", "rgba(126,87,194,.08)"); ctx.fillRect(0, y(b), g.plotW, y(a) - y(b)); }
  ctx.font = "11px -apple-system, 'Segoe UI', Inter, sans-serif"; ctx.textAlign = "left";
  levels.forEach((lv) => { ctx.strokeStyle = grid; ctx.setLineDash(lv === 0 ? [] : [4, 4]); ctx.beginPath(); ctx.moveTo(0, y(lv) + .5); ctx.lineTo(g.plotW + main.futureW, y(lv) + .5); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = text; ctx.fillText(state.indicator === "macd" ? "0" : String(lv), g.plotW + main.futureW + 8, y(lv) + 4); });
  if (state.indicator === "macd") { ctx.fillStyle = text; ctx.fillText(tvFmt(hi / 1.1), g.plotW + main.futureW + 8, top + 10); ctx.fillText(tvFmt(lo / 1.1), g.plotW + main.futureW + 8, bottom - 2); }
  tvMonthTicks(rows, view).forEach((i) => { const px = Math.round(g.x(i)) + .5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke(); });
  ctx.strokeStyle = tvColor("--tv-border", "#2a2e39"); ctx.beginPath(); ctx.moveTo(g.plotW + main.futureW + .5, 0); ctx.lineTo(g.plotW + main.futureW + .5, height); ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, g.plotW, bottom); ctx.clip();
  series.forEach(([color, values]) => {
    if (color === "hist") {
      const zero = y(0); const w = Math.max(1, g.slot * .6);
      for (let i = view.start; i <= view.end; i++) { const v = values[i]; if (!Number.isFinite(v)) continue; const prevV = values[i - 1] ?? v; const rising = v >= prevV;
        ctx.fillStyle = v >= 0 ? (rising ? tvColor("--tv-hist-up", "#26a69a") : tvColor("--tv-hist-up2", "#b2dfdb")) : (rising ? tvColor("--tv-hist-dn2", "#ffcdd2") : tvColor("--tv-hist-dn", "#ff5252"));
        ctx.fillRect(g.x(i) - w / 2, Math.min(zero, y(v)), w, Math.max(1, Math.abs(y(v) - zero))); }
    } else tvLine(ctx, values, view, g.x, y, color, 1.5);
  });
  ctx.restore();
  const hover = state.tv.hover;
  if (hover && hover.i >= view.start && hover.i <= view.end) {
    const hx = Math.round(g.x(hover.i)) + .5; ctx.strokeStyle = tvColor("--tv-cross", "#9598a1"); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, bottom); ctx.stroke();
    if (hover.pane === "sub" && hover.y != null && hover.y < bottom) { ctx.beginPath(); ctx.moveTo(0, hover.y + .5); ctx.lineTo(g.plotW + main.futureW, hover.y + .5); ctx.stroke(); ctx.setLineDash([]); tvAxisLabel(ctx, g.plotW + main.futureW, hover.y, tvFmt(hi - (hover.y - top) / (bottom - top) * (hi - lo)), tvColor("--tv-label-bg", "#363a45"), tvColor("--tv-label-fg", "#fff")); }
    ctx.setLineDash([]);
  }
  tvTimeAxis(ctx, rows, view, g, height - TV_TIME_H, width);
  const lg = $("#indicatorLegend"); if (lg) lg.innerHTML = legend;
}

function bindTvChart() {
  const main = $("#stockChart"), sub = $("#indicatorChart");
  const redraw = () => { drawStockChart(); drawIndicatorChart(); };
  const locate = (canvas, event, pane) => {
    const m = state.tv.main; if (!m) return null; const rect = canvas.getBoundingClientRect(); const px = event.clientX - rect.left; const py = event.clientY - rect.top;
    if (px > m.g.plotW + m.futureW) return { axis: true, py, pane };
    return { i: m.g.indexAt(Math.min(px, m.g.plotW - 1)), px, py, pane };
  };
  [[main, "main"], [sub, "sub"]].forEach(([canvas, pane]) => {
    if (!canvas) return;
    canvas.addEventListener("pointermove", (event) => {
      const m = state.tv.main; if (!m) return;
      if (state.tv.drag && state.tv.drag.canvas === canvas) {
        const dx = event.clientX - state.tv.drag.x; const bars = Math.round(dx / m.g.slot);
        state.tv.offset = Math.max(0, state.tv.drag.offset + bars); state.tv.hover = null; redraw(); return;
      }
      const p = locate(canvas, event, pane); if (!p || p.axis) { state.tv.hover = null; redraw(); return; }
      state.tv.hover = { i: p.i, y: p.py, pane }; redraw();
    });
    canvas.addEventListener("pointerleave", () => { if (!state.tv.drag) { state.tv.hover = null; redraw(); } });
    canvas.addEventListener("pointerdown", (event) => {
      const m = state.tv.main; if (!m) return; const p = locate(canvas, event, pane); if (!p || p.axis) return;
      if (pane === "main" && state.tv.tool !== "cursor") {
        const row = m.rows[p.i]; const price = m.yInv(p.py); const list = tvDrawings();
        if (state.tv.tool === "hline") { list.push({ type: "h", price }); tvSaveDrawings(list); setTvTool("cursor"); }
        else if (state.tv.tool === "trend") {
          if (!state.tv.pending) state.tv.pending = { d: row.start || row.d, p: price };
          else { list.push({ type: "t", a: state.tv.pending, b: { d: row.start || row.d, p: price } }); tvSaveDrawings(list); state.tv.pending = null; setTvTool("cursor"); }
        }
        redraw(); return;
      }
      state.tv.drag = { x: event.clientX, offset: state.tv.offset, canvas }; canvas.setPointerCapture?.(event.pointerId); canvas.classList.add("dragging");
    });
    const end = (event) => { if (state.tv.drag) { state.tv.drag = null; canvas.releasePointerCapture?.(event.pointerId); canvas.classList.remove("dragging"); } };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("wheel", (event) => {
      if (!state.tv.main) return; event.preventDefault();
      const n = state.tv.main.rows.length; const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
      state.tv.count = Math.max(10, Math.min(n, Math.round((state.tv.count || 60) * factor))); redraw();
    }, { passive: false });
  });
  $$("[data-tv-nav]").forEach((button) => button.addEventListener("click", () => {
    const m = state.tv.main; if (!m) return; const n = m.rows.length; const action = button.dataset.tvNav;
    if (action === "in") state.tv.count = Math.max(10, Math.round(state.tv.count / 1.25));
    if (action === "out") state.tv.count = Math.min(n, Math.round(state.tv.count * 1.25));
    if (action === "left") state.tv.offset = Math.min(n - state.tv.count, state.tv.offset + Math.max(1, Math.round(state.tv.count / 4)));
    if (action === "right") state.tv.offset = Math.max(0, state.tv.offset - Math.max(1, Math.round(state.tv.count / 4)));
    if (action === "reset") { state.tv.count = null; state.tv.offset = 0; }
    redraw();
  }));
  $$("[data-tv-tool]").forEach((button) => button.addEventListener("click", () => {
    const tool = button.dataset.tvTool;
    if (tool === "clear") { tvSaveDrawings([]); state.tv.pending = null; setTvTool("cursor"); redraw(); showToast("この銘柄の描画を消去しました"); return; }
    setTvTool(tool); redraw();
  }));
  $("#tvIndicator")?.addEventListener("change", (event) => { state.indicator = event.target.value; $$(".indicator-tabs button").forEach((item) => item.classList.toggle("active", item.dataset.indicator === state.indicator)); drawIndicatorChart(); drawStockChart(); });
  $("#watchSort")?.addEventListener("change", renderWatchlist);
  setInterval(() => { const clock = $("#tvClock"); if (clock) clock.textContent = `${new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" })} (UTC+9)`; }, 1000);
}

function setTvTool(tool) {
  state.tv.tool = tool; if (tool !== "trend") state.tv.pending = null;
  $$("[data-tv-tool]").forEach((item) => item.classList.toggle("active", item.dataset.tvTool === tool));
  $("#stockChart")?.classList.toggle("drawing", tool !== "cursor");
}

function renderWatchlist() {
  const list = $("#watchList"); if (!list || !state.data) return;
  $$("[data-watch-mode]").forEach((b) => b.classList.toggle("active", b.dataset.watchMode === state.watchMode));
  const sortSel = $("#watchSort"); if (sortSel) sortSel.hidden = state.watchMode === "index";
  if (state.watchMode === "index") {
    list.innerHTML = watchOrder("index").map((p) => {
      const c = number(p.stats?.chg1d); const cls = c === null ? "" : c >= 0 ? "tv-up" : "tv-down";
      return `<button type="button" class="watch-row ${isIndexSym() && state.sym.code === p.id ? "active" : ""}" data-watch-index="${escapeHtml(p.id)}"><span class="watch-sym"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.symbol)}${p.ai ? " · AI予測あり" : ""}</small></span><span class="watch-last">${tvFmt(p.stats?.last)}</span><span class="watch-chg ${cls}">${c === null ? "—" : percent(c, 2)}</span></button>`;
    }).join("") || '<p class="watch-empty">指数データがありません</p>';
  } else {
    list.innerHTML = watchOrder("stock").slice(0, 80).map((row) => {
      const c = number(row.change1d); const cls = c === null ? "" : c >= 0 ? "tv-up" : "tv-down";
      return `<button type="button" class="watch-row ${!isIndexSym() && row.code === state.sym?.code ? "active" : ""}" data-watch="${escapeHtml(row.code)}"><span class="watch-sym"><b>${escapeHtml(row.code)}</b><small>${escapeHtml(row.name)}</small></span><span class="watch-last">${tvFmt(row.lastClose ?? row.close)}</span><span class="watch-chg ${cls}">${c === null ? "—" : percent(c, 2)}</span></button>`;
    }).join("");
  }
  $$("[data-watch]").forEach((button) => button.addEventListener("click", () => openSymbol({ type: "stock", code: button.dataset.watch })));
  $$("[data-watch-index]").forEach((button) => button.addEventListener("click", () => openSymbol({ type: "index", code: button.dataset.watchIndex })));
  // 選択中の行が見えるように一覧の中だけをスクロールする(scrollIntoView はページごと動くので使わない)
  const act = list.querySelector(".watch-row.active");
  if (act) { const r = act.getBoundingClientRect(), lr = list.getBoundingClientRect(); if (r.top < lr.top || r.bottom > lr.bottom) list.scrollTop += (r.top - lr.top) - lr.height / 2 + r.height / 2; }
}
function renderSymbolCard() {
  const box = $("#symbolCard"); if (!box) return;
  const cm = $("#tvComments"); if (cm) cm.hidden = isIndexSym();
  const daily = state.chartData || []; const last = daily.at(-1) || {}; const prev = daily.at(-2) || {};
  const chg = last.c != null && prev.c != null ? last.c - prev.c : null; const pct = chg != null ? last.c / prev.c - 1 : null; const cls = chg == null ? "" : chg >= 0 ? "tv-up" : "tv-down";
  const year = daily.slice(-250); const hi52 = year.length ? Math.max(...year.map((r) => r.h)) : null; const lo52 = year.length ? Math.min(...year.map((r) => r.l)) : null;
  if (isIndexSym()) {
    const page = indexPage(state.sym.code); if (!page) { box.innerHTML = ""; return; }
    const s = page.stats || {}; const H = page.ai?.horizons?.[String(tvHorizon())]; const f = H?.forecasts?.[H?.selectedModel];
    box.innerHTML = `<div class="sym-head"><span class="sym-badge">${escapeHtml(page.id)}</span><div><strong>${escapeHtml(page.name)}</strong><small>${escapeHtml(page.kind)} · ${escapeHtml(page.symbol)}</small></div></div><div class="sym-price"><strong>${tvFmt(last.c)}</strong><small>${escapeHtml(page.ccy || "")}</small></div><div class="sym-change ${cls}">${chg == null ? "—" : `${chg >= 0 ? "+" : ""}${tvFmt(chg)}　${percent(pct, 2)}`}</div><p class="sym-status">${s.partial ? "場中の取得値" : "終値"} · ${escapeHtml(last.d || "—")} 時点(日足)</p><dl class="sym-stats"><div><dt>前日終値</dt><dd>${tvFmt(prev.c)}</dd></div><div><dt>20日騰落</dt><dd>${percent(s.chg20d, 1)}</dd></div><div><dt>52週高値</dt><dd>${tvFmt(hi52)}</dd></div><div><dt>52週安値</dt><dd>${tvFmt(lo52)}</dd></div><div><dt>実現ボラ20日</dt><dd>${metricPercent(s.vol20, 1)}</dd></div><div><dt>RSI(14)</dt><dd>${number(s.rsi14)?.toFixed(1) ?? "—"}</dd></div><div><dt>AI ${escapeHtml(H?.selectedModel || "—")} ${tvHorizon()}日</dt><dd class="${number(f?.return, 0) >= 0 ? "tv-up" : "tv-down"}">${percent(f?.return, 2)}</dd></div><div><dt>予測の基準日</dt><dd>${escapeHtml(page.ai?.asOf || "—")}</dd></div></dl>`;
    return;
  }
  const company = state.data.predictions.find((row) => row.code === state.sym?.code); if (!company) return;
  const vol20 = daily.slice(-20).reduce((s, r) => s + (r.v || 0), 0) / Math.max(1, Math.min(20, daily.length));
  const f = modelForecast(company, 20, "ADOPTED"); const c = company.periods?.["20"]?.claude;
  const pos = openPosition(chartTrades());
  box.innerHTML = `<div class="sym-head"><span class="sym-badge">${escapeHtml(company.code)}</span><div><strong>${escapeHtml(company.name)}</strong><small>${escapeHtml(company.market)} · ${escapeHtml(company.industry)}</small></div></div><div class="sym-price"><strong>${tvFmt(last.c)}</strong><small>JPY</small></div><div class="sym-change ${cls}">${chg == null ? "—" : `${chg >= 0 ? "+" : ""}${tvFmt(chg)}　${percent(pct, 2)}`}</div><p class="sym-status">終値 · ${escapeHtml(last.d || "—")} 時点(日足)</p><dl class="sym-stats"><div><dt>前日終値</dt><dd>${tvFmt(prev.c)}</dd></div><div><dt>始値</dt><dd>${tvFmt(last.o)}</dd></div><div><dt>高値</dt><dd>${tvFmt(last.h)}</dd></div><div><dt>安値</dt><dd>${tvFmt(last.l)}</dd></div><div><dt>出来高</dt><dd>${tvVolume(last.v)}</dd></div><div><dt>20日平均出来高</dt><dd>${tvVolume(vol20)}</dd></div><div><dt>52週高値</dt><dd>${tvFmt(hi52)}</dd></div><div><dt>52週安値</dt><dd>${tvFmt(lo52)}</dd></div><div><dt>売買代金順位</dt><dd>#${company.rank ?? "—"}</dd></div><div><dt>模型 20日(${escapeHtml(f?.adopted || "—")})</dt><dd class="${number(f?.return, 0) >= 0 ? "tv-up" : "tv-down"}">${percent(f?.return)}</dd></div><div><dt>Claude 20日</dt><dd class="${c ? (c.return >= 0 ? "tv-up" : "tv-down") : ""}">${c ? percent(c.return) : "—"}</dd></div>${pos ? `<div><dt>保有(CSV)</dt><dd>${tvQty(pos.qty)}株 @${tvFmt(pos.avg)}</dd></div>` : ""}</dl>`;
}
// ===================== 企業情報(証券会社の銘柄ページ型) =====================

function brokerMoney(v) { const n = number(v); return n === null ? "—" : Math.round(n).toLocaleString("ja-JP"); }
function brokerPct(cur, prev) {
  const a = number(cur), b = number(prev);
  if (a === null || b === null || b === 0) return { text: "—", cls: "" };
  // 株探と同じく、赤字をまたぐ場合は率ではなく「黒転・赤転・赤拡・赤縮」で表す
  if (b > 0 && a < 0) return { text: "赤転", cls: "negative-text" };
  if (b < 0 && a >= 0) return { text: "黒転", cls: "positive-text" };
  if (b < 0 && a < 0) return a < b ? { text: "赤拡", cls: "negative-text" } : { text: "赤縮", cls: "positive-text" };
  const v = (a - b) / Math.abs(b); return { text: `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`, cls: v >= 0 ? "positive-text" : "negative-text" };
}

function drawBrokerBars(canvas, items) {
  if (!canvas || !canvas.clientWidth || !items.length) return;
  const { ctx, width, height } = setupCanvas(canvas, 150); ctx.clearRect(0, 0, width, height);
  const vals = items.map((it) => number(it.value, 0)); const max = Math.max(...vals, 0), min = Math.min(...vals, 0); const span = max - min || 1;
  const pad = { t: 16, b: 22 }; const y = (v) => pad.t + (max - v) / span * (height - pad.t - pad.b); const slot = width / items.length; const bw = Math.min(34, slot * .6);
  ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(0, y(0) + .5); ctx.lineTo(width, y(0) + .5); ctx.stroke();
  ctx.font = "10px Inter, 'Noto Sans JP', sans-serif"; ctx.textAlign = "center";
  items.forEach((it, i) => {
    const v = number(it.value); const cx = slot * i + slot / 2;
    if (v !== null) {
      const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      ctx.fillStyle = v < 0 ? css("--negative") : css("--primary"); ctx.globalAlpha = it.forecast ? .35 : .9; ctx.fillRect(cx - bw / 2, top, bw, h); ctx.globalAlpha = 1;
      if (it.forecast) { ctx.setLineDash([3, 2]); ctx.strokeStyle = css("--primary"); ctx.strokeRect(cx - bw / 2 + .5, top + .5, bw - 1, h - 1); ctx.setLineDash([]); }
      if (i === items.length - 1 || it.forecast) { ctx.fillStyle = css("--text"); ctx.fillText(Math.round(v).toLocaleString("ja-JP"), cx, v >= 0 ? top - 4 : top + h + 11); }
    }
    ctx.fillStyle = css("--muted"); ctx.fillText(`${it.forecast ? "予" : ""}${it.label}`, cx, height - 6);
  });
}

// ===================== 銘柄ページ遷移・常設の銘柄検索・全期間の詳細データ (2026-09-23) =====================
const INDEX_PAGES = [
  { id: "N225", symbol: "^N225", name: "日経平均", kind: "日本株指数" },
  { id: "TPX", symbol: "^TPX", name: "TOPIX", kind: "日本株指数" },
  { id: "IXIC", symbol: "^IXIC", name: "NASDAQ総合", kind: "米国株指数" },
  { id: "GSPC", symbol: "^GSPC", name: "S&P 500", kind: "米国株指数" },
  { id: "VIX", symbol: "^VIX", name: "VIX 恐怖指数", kind: "ボラティリティ" },
  { id: "TNX", symbol: "^TNX", name: "米10年国債利回り", kind: "金利" },
  { id: "USDJPY", symbol: "JPY=X", name: "ドル円", kind: "為替" },
];
state.detail = {};
state.detailIndex = null;
state.brokerTab = "perf";

function parseRoute(hash = location.hash.slice(1)) {
  hash = decodeURIComponent(hash || "");
  let match = hash.match(/^stock-([0-9A-Za-z]{4,6})(?:\/([a-z]+))?$/);
  if (match) return { page: "chart", code: match[1].toUpperCase(), view: match[2] || "" };
  match = hash.match(/^chart-index-([A-Za-z0-9]+)$/);
  if (match) return { page: "charts", sym: { type: "index", code: match[1].toUpperCase() } };
  match = hash.match(/^chart-([0-9A-Za-z]{4,6})$/);
  if (match) return { page: "charts", sym: { type: "stock", code: match[1].toUpperCase() } };
  match = hash.match(/^index-([A-Za-z0-9]+)$/);
  if (match) return { page: "index", id: match[1].toUpperCase() };
  return { page: hash || "home" };
}
function goStock(code, view = "") { if (!code) return; const target = `stock-${code}${view ? `/${view}` : ""}`; if (location.hash.slice(1) === target) applyRoute(); else location.hash = target; }
function goChart(sym) { if (!sym?.code) return; const target = sym.type === "index" ? `chart-index-${sym.code}` : `chart-${sym.code}`; if (location.hash.slice(1) === target) applyRoute(); else location.hash = target; }
function openSymbol(sym) { if (state.page === "charts") goChart(sym); else if (sym.type === "index") goIndex(sym.code); else goStock(sym.code); }
function pageHash(page) {
  if (page === "chart") return `stock-${state.selectedCode}${state.stockView ? `/${state.stockView}` : ""}`;
  if (page === "charts") { const s = state.chartsSym || { type: "stock", code: state.selectedCode }; return s.type === "index" ? `chart-index-${s.code}` : `chart-${s.code}`; }
  if (page === "index") return `index-${state.indexId || "N225"}`;
  return page;
}
function goIndex(id) { const target = `index-${id}`; if (location.hash.slice(1) === target) applyRoute(); else location.hash = target; }

function applyRoute() {
  const route = parseRoute();
  hideSymbolResults();
  if (route.page === "chart" && route.code) {
    const known = state.data?.predictions?.some((row) => row.code === route.code);
    if (!known) { showToast(`${route.code} は予測対象の銘柄に含まれていません`); return; }
    const view = STOCK_VIEW_ALIAS[route.view] ? STOCK_VIEW_ALIAS[route.view][0] : STOCK_VIEWS[route.view] ? route.view : "";
    if (STOCK_VIEW_ALIAS[route.view]) state.brokerTab = STOCK_VIEW_ALIAS[route.view][1];
    const sameStock = state.page === "chart" && state.selectedCode === route.code;
    state.selectedCode = route.code; state.stockView = view;
    document.title = `${route.code} ${state.data.predictions.find((r) => r.code === route.code)?.name || ""} | Future Sight`;
    if (sameStock) { applyStockView(); window.scrollTo({ top: 0, behavior: "auto" }); return; }   // 同じ銘柄の中のページ移動は再読込しない
    navigate("chart", { keepHash: true });
    return;
  }
  if (route.page === "charts") {
    let sym = route.sym || state.chartsSym || { type: "stock", code: state.selectedCode };
    if (sym.type === "index" && !INDEX_PAGES.some((p) => p.id === sym.code)) { showToast(`${sym.code} の指数ページはありません`); sym = { type: "index", code: "N225" }; }
    if (sym.type === "stock" && !state.data?.predictions?.some((row) => row.code === sym.code)) { showToast(`${sym.code} は予測対象の銘柄に含まれていません`); sym = { type: "stock", code: state.selectedCode }; }
    state.chartsSym = sym;
    if (sym.type === "stock") state.selectedCode = sym.code;
    document.title = `チャート ${sym.type === "index" ? (INDEX_PAGES.find((p) => p.id === sym.code)?.name || sym.code) : sym.code} | Future Sight`;
    if (state.page === "charts") { loadChartsPage(); return; }
    navigate("charts", { keepHash: true });
    return;
  }
  if (route.page === "index" && route.id) {
    state.indexId = INDEX_PAGES.some((p) => p.id === route.id) ? route.id : "N225";
    navigate("index", { keepHash: true });
    document.title = `${INDEX_PAGES.find((p) => p.id === state.indexId)?.name || "指数"} | Future Sight`;
    return;
  }
  document.title = "Future Sight";
  if ($(`[data-page="${route.page}"]`)) navigate(route.page);
}
// ---------- 常設の銘柄検索 ----------
function symbolCandidates(query) {
  const q = query.trim().toLowerCase().normalize("NFKC");
  const indices = INDEX_PAGES.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.symbol.toLowerCase().includes(q)).map((p) => ({ type: "index", id: p.id, code: p.id, name: p.name, sub: p.kind }));
  const stocks = (state.data?.predictions || []).filter((row) => !q || row.code.toLowerCase().startsWith(q) || String(row.name).toLowerCase().normalize("NFKC").includes(q) || String(row.industry).includes(query.trim()))
    .sort((a, b) => (a.code.toLowerCase().startsWith(q) ? 0 : 1) - (b.code.toLowerCase().startsWith(q) ? 0 : 1) || (a.rank || 9999) - (b.rank || 9999))
    .slice(0, 12).map((row) => ({ type: "stock", id: row.code, code: row.code, name: row.name, sub: `${row.market} · ${row.industry}`, change: row.change1d, price: row.lastClose ?? row.close }));
  return q ? [...stocks, ...indices].slice(0, 14) : [...indices, ...stocks.slice(0, 7)];
}

function renderSymbolResults() {
  const box = $("#symbolResults"); const input = $("#globalSearch"); if (!box || !input) return;
  const items = symbolCandidates(input.value); state.symbolItems = items; state.symbolActive = Math.min(state.symbolActive ?? 0, items.length - 1);
  box.innerHTML = items.length ? items.map((item, i) => `<button type="button" role="option" class="symbol-option ${i === state.symbolActive ? "active" : ""}" data-symbol-index="${i}"><span class="symbol-type ${item.type}">${item.type === "index" ? "指数" : "株"}</span><b>${escapeHtml(item.code)}</b><span class="symbol-name">${escapeHtml(item.name)}<small>${escapeHtml(item.sub || "")}</small></span>${item.type === "stock" ? `<em class="${number(item.change, 0) >= 0 ? "positive-text" : "negative-text"}">${tvFmt(item.price)} ${percent(item.change, 2)}</em>` : "<em>個別ページ</em>"}</button>`).join("") : '<div class="symbol-empty">該当する銘柄・指数がありません</div>';
  box.hidden = false; input.setAttribute("aria-expanded", "true");
  $$('[data-symbol-index]').forEach((button) => button.addEventListener("mousedown", (event) => { event.preventDefault(); chooseSymbol(Number(button.dataset.symbolIndex)); }));
}
function hideSymbolResults() { const box = $("#symbolResults"); if (box) box.hidden = true; $("#globalSearch")?.setAttribute("aria-expanded", "false"); }
function chooseSymbol(index) {
  const item = state.symbolItems?.[index]; if (!item) return;
  const input = $("#globalSearch"); input.value = ""; input.blur(); hideSymbolResults();
  if (state.page === "charts") { goChart({ type: item.type === "index" ? "index" : "stock", code: item.type === "index" ? item.id : item.code }); return; }
  if (item.type === "index") goIndex(item.id); else goStock(item.code);
}
function bindSymbolSearch() {
  const input = $("#globalSearch"); if (!input) return;
  input.addEventListener("focus", () => { state.symbolActive = 0; renderSymbolResults(); });
  input.addEventListener("input", () => { state.symbolActive = 0; renderSymbolResults(); });
  input.addEventListener("blur", () => setTimeout(hideSymbolResults, 120));
  input.addEventListener("keydown", (event) => {
    const n = state.symbolItems?.length || 0;
    if (event.key === "ArrowDown") { event.preventDefault(); state.symbolActive = (state.symbolActive + 1) % Math.max(n, 1); renderSymbolResults(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); state.symbolActive = (state.symbolActive - 1 + n) % Math.max(n, 1); renderSymbolResults(); }
    else if (event.key === "Enter") { event.preventDefault(); chooseSymbol(state.symbolActive || 0); }
    else if (event.key === "Escape") { hideSymbolResults(); input.blur(); }
  });
}

// ---------- 詳細データの読み込み ----------
async function fetchStockDetail(code) {
  if (state.detail[code]) return state.detail[code];
  try {
    if (!state.detailIndex) { const r = await fetch("data/stock-detail-index.json", { cache: "no-store" }); state.detailIndex = r.ok ? await r.json() : {}; }
    const chunk = state.detailIndex[code]; if (!chunk) return null;
    state.detailChunks = state.detailChunks || {};
    if (!state.detailChunks[chunk]) { const r = await fetch(`data/stock-detail/${chunk}.json`, { cache: "no-store" }); state.detailChunks[chunk] = r.ok ? await r.json() : {}; }
    state.detail[code] = state.detailChunks[chunk][code] || null;
  } catch { state.detail[code] = null; }
  return state.detail[code];
}

function renderStockHeader(company) {
  const box = $("#stockHeadPrice"); if (!box || !company) return;
  const daily = state.chartData || []; const last = daily.at(-1) || {}; const prev = daily.at(-2) || {};
  const chg = last.c != null && prev.c != null ? last.c - prev.c : null; const pct = chg != null ? last.c / prev.c - 1 : null;
  const sec = state.detail[company.code]?.irbank?.security || {};
  $("#chartTitle").textContent = company.name;
  $("#chartSubhead").innerHTML = `<span class="code-pill">${escapeHtml(company.code)}</span> 東証${escapeHtml(company.market)} · ${escapeHtml(company.industry)}${sec.fiscal_year_end_month ? ` · ${sec.fiscal_year_end_month}月決算` : ""}${sec.listing_month ? ` · 上場 ${escapeHtml(sec.listing_month)}` : ""}`;
  box.innerHTML = `<strong>${tvFmt(last.c ?? company.close)}<small>円</small></strong><span class="${chg == null ? "" : chg >= 0 ? "positive-text" : "negative-text"}">${chg == null ? "—" : `${chg >= 0 ? "+" : ""}${tvFmt(chg)} (${percent(pct, 2)})`}</span><small>${escapeHtml(last.d || "")} 終値</small>`;
}

// ---------- 数値の表示 ----------
function unitFmt(value, unit) {
  const v = number(value); if (v === null) return "—";
  switch (unit) {
    case "jpy": return Math.abs(v) >= 1e6 ? Math.round(v / 1e6).toLocaleString("ja-JP") : (v / 1e6).toFixed(2);
    case "jpy_per_share": return v.toLocaleString("ja-JP", { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 2 });
    case "ratio": case "percent": return `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
    case "times": return `${v.toFixed(2)}倍`;
    case "people": return `${Math.round(v).toLocaleString("ja-JP")}人`;
    case "shares": return Math.abs(v) >= 1e4 ? `${Math.round(v / 1e4).toLocaleString("ja-JP")}万株` : `${v}株`;
    case "years": return `${v.toFixed(1)}年`;
    case "t_co2e": return `${Math.round(v).toLocaleString("ja-JP")}t`;
    case "days": return `${v.toFixed(0)}日`;
    case "months": return `${v.toFixed(1)}か月`;
    default: return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("ja-JP") : v.toLocaleString("ja-JP", { maximumFractionDigits: 3 });
  }
}
function unitLabel(unit) { return { jpy: "百万円", jpy_per_share: "円", ratio: "%", percent: "%", times: "倍", people: "人", shares: "株", years: "年", t_co2e: "t-CO2" }[unit] || ""; }
function fyShort(fy) { return String(fy || "").replace(/^20/, "").replace("/", "."); }

function periodGrid({ periods, rows, note = "" }) {
  if (!periods?.length || !rows.length) return '<div class="empty-state"><p>この銘柄のデータはありません。</p></div>';
  return `<div class="broker-table-wrap"><table class="broker-table period-grid"><thead><tr><th>項目</th>${periods.map((p) => `<th>${escapeHtml(p)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr${row.strong ? ' class="strong-row"' : ""}><th title="${escapeHtml(row.note || "")}">${escapeHtml(row.label)}${row.unit ? `<small>${escapeHtml(row.unit)}</small>` : ""}</th>${row.values.map((v, i) => { const prev = row.values[i - 1]; const neg = number(v?.raw, 0) < 0; return `<td class="${neg ? "negative-text" : ""}">${v?.text ?? "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>${note ? `<p class="lab-foot">${note}</p>` : ""}`;
}

function irbankRows(block, keys, catalogKind) {
  const cat = state.fieldCatalog?.[catalogKind] || {};
  return keys.filter((k) => block.values?.[k]).map((k) => ({ key: k, label: cat[k]?.label || k, unit: unitLabel(cat[k]?.unit), note: cat[k]?.note, values: block.values[k].map((v) => ({ raw: v, text: unitFmt(v, cat[k]?.unit) })) }));
}

// ---------- 企業情報タブ ----------
const BROKER_TABS = [
  ["perf", "業績"], ["quarter", "四半期"], ["financials", "財務3表"], ["indicators", "指標"], ["valuation", "株価指標"],
  ["segments", "セグメント"], ["peers", "競合"], ["credit", "信用残"], ["dividend", "配当"], ["edinet", "有報"], ["people", "人的資本"], ["profile", "会社情報"], ["research", "AI・NLP"],
];

async function renderBroker(company) {
  const body = $("#brokerBody"); if (!body || !company) return;
  const tabs = $("#brokerTabs");
  if (tabs && !tabs.dataset.built) { tabs.innerHTML = BROKER_TABS.map(([id, label]) => `<button type="button" data-broker-tab="${id}">${label}</button>`).join(""); tabs.dataset.built = "1"; $$("[data-broker-tab]").forEach((b) => b.addEventListener("click", () => { state.brokerTab = b.dataset.brokerTab; const c = state.data.predictions.find((row) => row.code === state.selectedCode); renderBroker(c); })); }
  $$("[data-broker-tab]").forEach((b) => b.classList.toggle("active", b.dataset.brokerTab === state.brokerTab));
  $("#brokerTitle").textContent = `${company.name}(${company.code})の企業情報`;
  const code = company.code;
  const doc = await fetchStockDetail(code);
  if (code !== state.selectedCode) return;
  if (!doc) { body.innerHTML = '<div class="empty-state"><p>この銘柄の詳細データはまだありません。</p></div>'; return; }
  const price = number(state.chartData.at(-1)?.c, number(company.close));
  const renderers = { perf: tabPerf, quarter: tabQuarter, financials: tabFinancials, indicators: tabIndicators, valuation: tabValuation, segments: tabSegments, peers: tabPeers, credit: tabCredit, dividend: tabDividend, edinet: tabEdinet, people: tabPeople, profile: tabProfile, research: tabResearch };
  body.innerHTML = (renderers[state.brokerTab] || tabPerf)(doc, company, price);
  $("#brokerNote").innerHTML = brokerSourceNote(state.brokerTab);
  body.querySelectorAll("[data-perf-mode]").forEach((b) => b.addEventListener("click", () => { state.brokerPerfMode = b.dataset.perfMode; renderBroker(company); }));
  body.querySelectorAll("[data-ind-cat]").forEach((b) => b.addEventListener("click", () => { state.indCat = b.dataset.indCat; renderBroker(company); }));
  body.querySelectorAll("[data-fin-group]").forEach((b) => b.addEventListener("click", () => { state.finGroup = b.dataset.finGroup; renderBroker(company); }));
  body.querySelectorAll("[data-credit-range]").forEach((b) => b.addEventListener("click", () => { state.creditRange = b.dataset.creditRange; renderBroker(company); }));
  body.querySelectorAll("[data-pred-h]").forEach((b) => b.addEventListener("click", () => { state.predH = Number(b.dataset.predH); renderBroker(company); }));
  body.querySelectorAll("[data-go-stock]").forEach((b) => b.addEventListener("click", () => goStock(b.dataset.goStock)));
  requestAnimationFrame(() => drawDetailCharts(doc));
}

function brokerSourceNote(tab) {
  const irb = state.fieldCatalog?.irbankAttribution || "出典: EDINET / TDnet / JPX(加工: IRBANK)";
  const map = {
    perf: "株探の決算(発表日つき・百万円)。株探に無い古い期は IRBANK(EDINET・TDnet 由来)で補完し、行に「IRBANK」と表示。",
    quarter: "株探の四半期決算(百万円)。株探の無料範囲は直近約2年のため、累積アーカイブにある分だけ表示。",
    financials: irb, indicators: irb, valuation: irb, segments: irb, peers: `${irb}。競合理由の文章も IRBANK 提供。`, people: irb, profile: irb,
    credit: "信用残は週次(申込日基準。2026-09-28〜日次になる可能性)。予測モデルは公表日(available_from)以降だけ使用。",
    dividend: "株探の配当(円)と IRBANK の配当履歴(分割調整後)。",
    edinet: "EDINET 有価証券報告書の XBRL から直接抽出(提出翌日から利用可)。",
    research: "stockAI が保存した予測・シャドー予測・ニュースの BERT 分類。外部の生成AIは使っていない数値。",
  };
  return escapeHtml(map[tab] || "");
}

function mergedAnnual(doc) {
  const kab = (doc.kabutan?.annual || []).filter((r) => !r.forecast);
  const fc = (doc.kabutan?.annual || []).filter((r) => r.forecast).at(-1);
  const seen = new Set(kab.map((r) => (r.end || "").slice(0, 7)));
  const fin = doc.irbank?.fin; const rows = [];
  if (fin) fin.periods.forEach((fy, i) => {
    const key = String(fy).replace("/", "-"); if (seen.has(key)) return;
    const v = (k) => { const x = fin.values?.[k]?.[i]; return x == null ? null : x; };
    const m = (k) => (v(k) == null ? null : v(k) / 1e6);
    rows.push({ period: String(fy).replace("/", "."), end: `${key}-31`, sales: m("sales"), op: m("operating_profit"), ord: m("ordinary_income"), net: m("net_income"), eps: v("eps"), dps: v("dps"), source: "IRBANK", std: fin.meta?.[i]?.std });
  });
  const all = [...rows, ...kab.map((r) => ({ ...r, source: "株探" }))].sort((a, b) => (a.end || "").localeCompare(b.end || ""));
  return { rows: all, forecast: fc && ["sales", "op", "net", "eps", "dps"].some((k) => number(fc[k]) !== null) ? fc : null };
}

function tabPerf(doc) {
  const { rows, forecast } = mergedAnnual(doc);
  const lastA = rows.at(-1);
  const progress = [...(doc.kabutan?.q1cum || []), ...(doc.kabutan?.half || [])].filter((r) => number(r.progress) !== null).sort((a, b) => (a.end || "").localeCompare(b.end || "")).at(-1);
  const summary = `<div class="broker-summary"><div><span>会計基準</span><b>${escapeHtml((doc.kabutan?.annual || []).at(-1)?.acct || doc.irbank?.fin?.meta?.at(-1)?.std || "—")}</b></div><div><span>今期 会社予想 売上高</span><b>${forecast ? brokerMoney(forecast.sales) : "予想なし"}</b>${forecast && lastA ? `<small class="${brokerPct(forecast.sales, lastA.sales).cls}">前期比 ${brokerPct(forecast.sales, lastA.sales).text}</small>` : ""}</div><div><span>今期 会社予想 営業利益</span><b>${forecast ? brokerMoney(forecast.op) : "予想なし"}</b>${forecast && lastA ? `<small class="${brokerPct(forecast.op, lastA.op).cls}">前期比 ${brokerPct(forecast.op, lastA.op).text}</small>` : ""}</div><div><span>通期予想に対する進捗(営業利益)</span><b>${progress ? `${number(progress.progress).toFixed(1)}%` : "—"}</b>${progress ? `<small>${escapeHtml(progress.period)} 累計</small>` : ""}</div><div><span>表示期間</span><b>${escapeHtml(rows[0]?.period || "—")}〜</b><small>${rows.length}期分</small></div></div>`;
  const charts = `<div class="broker-charts"><figure><figcaption>売上高<small>百万円・点線は会社予想</small></figcaption><canvas id="brokerSales"></canvas></figure><figure><figcaption>営業利益<small>百万円</small></figcaption><canvas id="brokerOp"></canvas></figure></div>`;
  const list = rows.map((r, i) => ({ ...r, prev: rows[i - 1] })); if (forecast) list.push({ ...forecast, prev: lastA, isForecast: true, source: "株探" });
  const table = `<div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>決算期</th><th>売上高</th><th>前期比</th><th>営業利益</th><th>前期比</th><th>経常利益<small>IFRSは税引前</small></th><th>純利益</th><th>1株益(円)</th><th>1株配(円)</th><th>発表日</th><th>出典</th></tr></thead><tbody>${list.slice().reverse().map((r) => { const s = brokerPct(r.sales, r.prev?.sales), o = brokerPct(r.op, r.prev?.op); return `<tr class="${r.isForecast ? "forecast-row" : ""}"><th>${r.isForecast ? '<span class="fc-tag">予</span>' : ""}${escapeHtml(r.period)}${r.irregular ? '<small title="変則決算(株探の * 表記)">*</small>' : ""}</th><td>${brokerMoney(r.sales)}</td><td class="${s.cls}">${s.text}</td><td class="${number(r.op, 0) < 0 ? "negative-text" : ""}">${brokerMoney(r.op)}</td><td class="${o.cls}">${o.text}</td><td>${brokerMoney(r.ord)}</td><td class="${number(r.net, 0) < 0 ? "negative-text" : ""}">${brokerMoney(r.net)}</td><td>${tvFmt(r.eps)}</td><td>${tvFmt(r.dps)}</td><td>${escapeHtml(r.announce || "—")}</td><td><span class="src-tag">${escapeHtml(r.source || "")}</span></td></tr>`; }).join("")}</tbody></table></div>`;
  return `${summary}<div class="broker-row-head"><h3>業績推移(通期・全期間)</h3></div>${charts}${table}`;
}

// 2026-09-24: 前年同期は「4行前」ではなく期末日が1年前(±20日)の行。欠けた四半期があると4行前はずれる
function sameQuarterLastYear(rows, r) {
  const end = Date.parse(r?.end || ""); if (!Number.isFinite(end)) { const i = rows.indexOf(r); return rows[i - 4]; }
  const target = end - 365 * 864e5; return rows.find((x) => Math.abs(Date.parse(x.end || "") - target) <= 20 * 864e5) || null;
}
function tabQuarter(doc) {
  const q = doc.kabutan?.quarter || []; const cum = [...(doc.kabutan?.q1cum || []), ...(doc.kabutan?.half || [])].filter((r) => !r.forecast).sort((a, b) => (a.end || "").localeCompare(b.end || ""));
  const qt = q.length ? `<div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>四半期</th><th>売上高</th><th>前年同期比</th><th>営業利益</th><th>前年同期比</th><th>営業利益率</th><th>経常利益</th><th>純利益</th><th>1株益(円)</th><th>発表日</th></tr></thead><tbody>${q.slice().reverse().map((r) => { const yoy = sameQuarterLastYear(q, r); const s = brokerPct(r.sales, yoy?.sales), o = brokerPct(r.op, yoy?.op); const margin = number(r.sales) ? number(r.op, 0) / number(r.sales) : null; return `<tr><th>${escapeHtml(r.period)}</th><td>${brokerMoney(r.sales)}</td><td class="${s.cls}">${s.text}</td><td>${brokerMoney(r.op)}</td><td class="${o.cls}">${o.text}</td><td>${margin === null ? "—" : `${(margin * 100).toFixed(1)}%`}</td><td>${brokerMoney(r.ord)}</td><td>${brokerMoney(r.net)}</td><td>${tvFmt(r.eps)}</td><td>${escapeHtml(r.announce || "—")}</td></tr>`; }).join("")}</tbody></table></div>` : '<div class="empty-state"><p>四半期データはありません。</p></div>';
  const ct = cum.length ? `<div class="broker-row-head"><h3>累計決算(第1四半期累計・上期)</h3></div><div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>期間</th><th>売上高</th><th>営業利益</th><th>経常利益</th><th>純利益</th><th>1株益(円)</th><th>通期進捗</th><th>発表日</th></tr></thead><tbody>${cum.slice().reverse().map((r) => `<tr><th>${escapeHtml(r.period)}</th><td>${brokerMoney(r.sales)}</td><td>${brokerMoney(r.op)}</td><td>${brokerMoney(r.ord)}</td><td>${brokerMoney(r.net)}</td><td>${tvFmt(r.eps)}</td><td>${number(r.progress) === null ? "—" : `${number(r.progress).toFixed(1)}%`}</td><td>${escapeHtml(r.announce || "—")}</td></tr>`).join("")}</tbody></table></div>` : "";
  return `<div class="broker-row-head"><h3>四半期業績(3か月ごと)</h3><small>${q.length}四半期</small></div><div class="broker-charts"><figure><figcaption>四半期 売上高<small>百万円</small></figcaption><canvas id="brokerSales"></canvas></figure><figure><figcaption>四半期 営業利益<small>百万円</small></figcaption><canvas id="brokerOp"></canvas></figure></div>${qt}${ct}`;
}

function tabFinancials(doc) {
  const fin = doc.irbank?.fin; const groups = state.fieldCatalog?.finGroups || [];
  if (!fin) return '<div class="empty-state"><p>財務3表のデータはありません。</p></div>';
  const group = groups.find((g) => g.id === (state.finGroup || "pl")) || groups[0];
  const seg = `<div class="broker-seg wide">${groups.filter((g) => g.id !== "people").map((g) => `<button type="button" data-fin-group="${g.id}" class="${g.id === group.id ? "active" : ""}">${escapeHtml(g.label)}</button>`).join("")}</div>`;
  const rows = irbankRows(fin, group.keys, "fin");
  const bal = doc.kabutan?.balance || [];
  const balTable = group.id === "bs" && bal.length ? `<div class="broker-row-head"><h3>財政状態(株探・四半期末を含む)</h3></div><div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>期</th><th>総資産</th><th>自己資本</th><th>自己資本比率</th><th>BPS(円)</th><th>有利子負債倍率</th><th>発表日</th></tr></thead><tbody>${bal.slice().reverse().map((b) => `<tr><th>${escapeHtml(b.period)}</th><td>${brokerMoney(b.total_assets)}</td><td>${brokerMoney(b.equity)}</td><td>${number(b.equity_ratio) === null ? "—" : `${number(b.equity_ratio).toFixed(1)}%`}</td><td>${tvFmt(b.bps)}</td><td>${number(b.debt_ratio) === null ? "—" : `${number(b.debt_ratio).toFixed(2)}倍`}</td><td>${escapeHtml(b.announce || "—")}</td></tr>`).join("")}</tbody></table></div>` : "";
  return `<div class="broker-row-head"><h3>${escapeHtml(group.label)}(通期・${fin.periods.length}期)</h3>${seg}</div>${periodGrid({ periods: fin.periods.map(fyShort), rows, note: `会計基準: ${fin.meta.map((m) => `${fyShort(m.fy)} ${m.std || "—"}`).join(" / ")}` })}${balTable}`;
}

function tabIndicators(doc) {
  const ind = doc.irbank?.ind; const cat = state.fieldCatalog?.ind || {}; const labels = state.fieldCatalog?.indCategories || {};
  if (!ind) return '<div class="empty-state"><p>指標データはありません。</p></div>';
  const cats = Object.keys(labels).filter((c) => c !== "valuation" && Object.keys(ind.values).some((k) => cat[k]?.category === c));
  const current = cats.includes(state.indCat) ? state.indCat : "profitability";
  const seg = `<div class="broker-seg wide">${cats.map((c) => `<button type="button" data-ind-cat="${c}" class="${c === current ? "active" : ""}">${escapeHtml(labels[c])}</button>`).join("")}</div>`;
  const keys = Object.keys(ind.values).filter((k) => cat[k]?.category === current && !/_adjusted$/.test(k));
  return `<div class="broker-row-head"><h3>${escapeHtml(labels[current] || current)}の指標</h3>${seg}</div>${periodGrid({ periods: ind.periods.map(fyShort), rows: irbankRows(ind, keys, "ind"), note: "項目名にマウスを乗せると定義(IRBANK の注記)が表示されます。分割調整済みの重複項目は省略。" })}`;
}

function tabValuation(doc, company, price) {
  const val = doc.irbank?.val; const cat = state.fieldCatalog?.val || {};
  const { rows: annual, forecast } = mergedAnnual(doc); const lastA = annual.at(-1);
  const bal = (doc.kabutan?.balance || []).filter((b) => number(b.bps) !== null).at(-1);
  const ed = doc.edinet || {}; const edLast = (k) => ed[k]?.at(-1);
  const ratio = (a, b) => { const x = number(a), y = number(b); return x === null || y === null || y <= 0 ? null : x / y; };
  const perF = forecast ? ratio(price, forecast.eps) : null; const perA = ratio(price, lastA?.eps); const pbr = ratio(price, bal?.bps);
  const dps = number(forecast?.dps) ?? number(lastA?.dps); const shares = number(doc.irbank?.security?.issued_shares);
  const item = (label, value, note = "") => `<div><dt>${label}</dt><dd>${value}</dd>${note ? `<small>${note}</small>` : ""}</div>`;
  const grid = `<dl class="broker-metrics">${[
    item("株価(終値)", `${tvFmt(price)}円`, escapeHtml(state.chartData.at(-1)?.d || "")),
    item("時価総額", shares && price ? `${Math.round(shares * price / 1e8).toLocaleString("ja-JP")}億円` : "—", shares ? "発行済株式数ベース" : ""),
    item("PER(会社予想)", perF === null ? "—" : `${perF.toFixed(1)}倍`, forecast ? `予想EPS ${tvFmt(forecast.eps)}円` : "会社予想なし"),
    item("PER(実績)", perA === null ? "—" : `${perA.toFixed(1)}倍`, lastA ? `${escapeHtml(lastA.period)} EPS ${tvFmt(lastA.eps)}円` : ""),
    item("PBR(実績)", pbr === null ? "—" : `${pbr.toFixed(2)}倍`, bal ? `BPS ${tvFmt(bal.bps)}円(${escapeHtml(bal.period)})` : ""),
    item("配当利回り", dps !== null && price ? `${(dps / price * 100).toFixed(2)}%` : "—", dps === null ? "" : `${forecast ? "予想" : "実績"}配当 ${tvFmt(dps)}円`),
    item("PER 5年平均", number(val?.per5yAvg) === null ? "—" : `${number(val.per5yAvg).toFixed(1)}倍`, "IRBANK"),
    item("ROE(実績)", edLast("roe") ? `${(edLast("roe")[1] * 100).toFixed(1)}%` : "—", edLast("roe") ? `有報 ${escapeHtml(String(edLast("roe")[0]).slice(0, 7))}` : ""),
  ].join("")}</dl>`;
  const keys = ["stock_price", "stock_price_high", "stock_price_low", "market_cap", "per", "per_high", "per_low", "pbr_reported", "pbr_high_reported", "pbr_low_reported", "dividend_yield_reported", "dividend_yield_high_reported", "dividend_yield_low_reported", "eps", "bps_reported", "roe", "shares_outstanding"];
  const hist = val ? periodGrid({ periods: val.periods.map(fyShort), rows: irbankRows(val, keys, "val"), note: "各決算期末時点の株価・時価総額と、期中の高値/安値に対する PER・PBR・配当利回りのレンジ。" }) : "";
  return `<div class="broker-row-head"><h3>現在の株価指標</h3><small>株価は直近終値。予想値は株探の会社予想</small></div>${grid}${val ? `<div class="broker-row-head"><h3>決算期ごとのバリュエーション</h3><small>${val.periods.length}期</small></div><div class="broker-charts one"><figure><figcaption>PER の期中レンジ<small>高値〜安値・決算期末</small></figcaption><canvas id="brokerValChart"></canvas></figure></div>${hist}` : ""}`;
}

function tabSegments(doc) {
  const seg = doc.irbank?.seg || []; if (!seg.length) return '<div class="empty-state"><p>セグメント情報はありません(単一セグメントの会社を含む)。</p></div>';
  const years = [...new Set(seg.map((s) => s.fiscal_year))].sort(); const latest = years.at(-1);
  const names = [...new Set(seg.map((s) => s.segment_name))];
  const cell = (name, fy, key, fmt) => { const s = seg.find((x) => x.segment_name === name && x.fiscal_year === fy); return s ? fmt(s[key]) : "—"; };
  const money = (v) => (number(v) === null ? "—" : Math.round(number(v) / 1e6).toLocaleString("ja-JP"));
  const pct = (v) => (number(v) === null ? "—" : `${number(v).toFixed(1)}%`);
  const latestRows = seg.filter((s) => s.fiscal_year === latest).sort((a, b) => number(b.revenue, 0) - number(a.revenue, 0));
  const mix = `<div class="seg-mix">${latestRows.map((s, i) => `<span style="flex:${Math.max(number(s.revenue_share, 0), .5)};background:hsl(${(i * 47 + 210) % 360} 55% 55%)" title="${escapeHtml(s.segment_name)} ${pct(s.revenue_share)}"></span>`).join("")}</div><div class="seg-legend">${latestRows.map((s, i) => `<span><i style="background:hsl(${(i * 47 + 210) % 360} 55% 55%)"></i>${escapeHtml(s.segment_name)} ${pct(s.revenue_share)}</span>`).join("")}</div>`;
  const table = (key, title, fmt) => `<div class="broker-row-head"><h3>${title}</h3></div><div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>セグメント</th>${years.map((y) => `<th>${fyShort(y)}</th>`).join("")}</tr></thead><tbody>${names.map((n) => `<tr><th>${escapeHtml(n)}</th>${years.map((y) => `<td>${cell(n, y, key, fmt)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return `<div class="broker-row-head"><h3>売上構成(${fyShort(latest)})</h3></div>${mix}${table("revenue", "セグメント別 売上(百万円)", money)}${table("operating_income", "セグメント別 利益(百万円)", money)}${table("yoy_growth", "セグメント別 売上成長率", pct)}`;
}

function tabPeers(doc, company) {
  const peers = doc.irbank?.peers || []; const facts = state.evidence?.relations?.stocks?.[company.code] || [];
  const inUniverse = (code) => state.data.predictions.some((r) => r.code === code);
  const peerCards = peers.length ? `<div class="peer-grid">${peers.map((p) => { const row = state.data.predictions.find((r) => r.code === p.security_code); return `<article><header><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.security_code)} · ${escapeHtml(p.industry || "")}</span>${row ? `<em class="${number(row.change1d, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(row.change1d, 2)}</em>` : ""}</header><p>${escapeHtml(p.competition_reason || "")}</p><footer>${(p.segments || []).map((s) => `<span class="basis">${escapeHtml(s)}</span>`).join("")}${inUniverse(p.security_code) ? `<button type="button" class="text-button" data-go-stock="${escapeHtml(p.security_code)}">銘柄ページ ›</button>` : '<small>予測対象外</small>'}</footer></article>`; }).join("")}</div>` : '<div class="empty-state"><p>競合情報はありません。</p></div>';
  const factList = facts.length ? `<div class="broker-row-head"><h3>開示ベースの関係(取引先・合弁など)</h3><small>config/relations.json</small></div><div class="fact-list wide">${facts.map((f) => `<article><header><strong>${escapeHtml(f.name)}</strong><span>${escapeHtml(f.code)} · ${escapeHtml(f.market || "")}</span><em>${escapeHtml(f.type || "")}${f.direction === "in" ? "(被参照)" : ""}</em></header><p>${escapeHtml(f.note || "")}</p><small>有効 ${escapeHtml(f.validFrom || "—")}〜${escapeHtml(f.validTo || "")}</small></article>`).join("")}</div>` : "";
  return `<div class="broker-row-head"><h3>競合他社</h3><small>${peers.length}社</small></div>${peerCards}${factList}`;
}

function tabCredit(doc) {
  const all = doc.credit || []; if (!all.length) return '<div class="empty-state"><p>信用残の履歴はありません。</p></div>';
  const range = state.creditRange || "all"; const credit = range === "all" ? all : all.slice(-Number(range));
  const last = all.at(-1), prev = all.at(-2);
  const diff = (a, b) => { const x = number(a), y = number(b); if (x === null || y === null) return { text: "—", cls: "" }; const d = x - y; return { text: `${d >= 0 ? "+" : ""}${Math.round(d).toLocaleString("ja-JP")}`, cls: d >= 0 ? "positive-text" : "negative-text" }; };
  const vol20 = state.chartData.slice(-20).reduce((s, r) => s + (r.v || 0), 0) / Math.max(1, Math.min(20, state.chartData.length));
  const cards = `<div class="broker-cards"><article><span>信用買残</span><strong>${brokerMoney(last.buy)}<small>株</small></strong><em class="${diff(last.buy, prev?.buy).cls}">前週比 ${diff(last.buy, prev?.buy).text}</em></article><article><span>信用売残</span><strong>${brokerMoney(last.sell)}<small>株</small></strong><em class="${diff(last.sell, prev?.sell).cls}">前週比 ${diff(last.sell, prev?.sell).text}</em></article><article><span>信用倍率</span><strong>${number(last.ratio)?.toFixed(2) ?? "—"}<small>倍</small></strong><em>前週 ${number(prev?.ratio)?.toFixed(2) ?? "—"}倍</em></article><article><span>買残の出来高比</span><strong>${vol20 ? (last.buy / vol20).toFixed(1) : "—"}<small>日分</small></strong><em>買残 ÷ 20日平均出来高</em></article></div>`;
  const ranges = `<div class="broker-seg">${[["13", "3か月"], ["26", "半年"], ["52", "1年"], ["all", "全期間"]].map(([v, l]) => `<button type="button" data-credit-range="${v}" class="${range === v ? "active" : ""}">${l}</button>`).join("")}</div>`;
  const chart = `<figure class="broker-credit-chart"><figcaption><span><i class="sw-buy"></i>買残</span><span><i class="sw-sell"></i>売残</span><span><i class="sw-price"></i>株価(週末終値)</span><small>${escapeHtml(credit[0].date)}〜${escapeHtml(last.date)} ・ ${credit.length}週</small></figcaption><canvas id="brokerCreditPrice"></canvas><canvas id="brokerCredit"></canvas></figure>`;
  const table = `<div class="broker-table-wrap tall"><table class="broker-table"><thead><tr><th>申込日(週末)</th><th>売残(株)</th><th>前週比</th><th>買残(株)</th><th>前週比</th><th>信用倍率</th><th>公表後に利用</th></tr></thead><tbody>${all.slice().reverse().map((r) => { const i = all.indexOf(r); const p = all[i - 1]; const s = diff(r.sell, p?.sell), b = diff(r.buy, p?.buy); return `<tr><th>${escapeHtml(r.date)}</th><td>${brokerMoney(r.sell)}</td><td class="${s.cls}">${s.text}</td><td>${brokerMoney(r.buy)}</td><td class="${b.cls}">${b.text}</td><td>${number(r.ratio)?.toFixed(2) ?? "—"}倍</td><td>${escapeHtml(r.availableFrom || "—")}</td></tr>`; }).join("")}</tbody></table></div>`;
  state.creditView = credit;
  return `${cards}<div class="broker-row-head"><h3>信用残の推移</h3>${ranges}</div>${chart}<div class="broker-row-head"><h3>全履歴(${all.length}週)</h3><small>取得できている全期間</small></div>${table}`;
}

function tabDividend(doc, company, price) {
  const { rows, forecast } = mergedAnnual(doc); const lastA = rows.at(-1); const div = doc.irbank?.div || [];
  const dps = number(forecast?.dps) ?? number(lastA?.dps);
  const payout = (r) => { const d = number(r.dps), e = number(r.eps); return d === null || e === null || e <= 0 ? null : d / e; };
  const lastDiv = div.at(-1) || {};
  const cards = `<div class="broker-cards"><article><span>1株配当(会社予想)</span><strong>${forecast ? tvFmt(forecast.dps) : "—"}<small>円</small></strong><em>${forecast ? escapeHtml(forecast.period) : "予想なし"}</em></article><article><span>配当利回り</span><strong>${dps !== null && price ? (dps / price * 100).toFixed(2) : "—"}<small>%</small></strong><em>${forecast ? "予想" : "実績"}配当 ÷ 終値</em></article><article><span>連続増配</span><strong>${lastDiv.consecutive_dividend_increase_years ?? "—"}<small>年</small></strong><em>IRBANK ${escapeHtml(String(lastDiv.fiscal_year ?? ""))}</em></article><article><span>DOE(純資産配当率)</span><strong>${number(lastDiv.doe) === null ? "—" : number(lastDiv.doe).toFixed(2)}<small>%</small></strong><em>IRBANK</em></article></div>`;
  const list = rows.map((r, i) => ({ ...r, prev: rows[i - 1] })); if (forecast) list.push({ ...forecast, prev: lastA, isForecast: true });
  const table = `<div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>決算期</th><th>1株配当(円)</th><th>前期比</th><th>1株益(円)</th><th>配当性向</th><th>出典</th></tr></thead><tbody>${list.slice().reverse().map((r) => { const c = brokerPct(r.dps, r.prev?.dps); const p = payout(r); return `<tr class="${r.isForecast ? "forecast-row" : ""}"><th>${r.isForecast ? '<span class="fc-tag">予</span>' : ""}${escapeHtml(r.period)}</th><td>${tvFmt(r.dps)}</td><td class="${c.cls}">${c.text}</td><td>${tvFmt(r.eps)}</td><td>${p === null ? "—" : `${(p * 100).toFixed(1)}%`}</td><td><span class="src-tag">${escapeHtml(r.source || "株探")}</span></td></tr>`; }).join("")}</tbody></table></div>`;
  const hist = div.length ? `<div class="broker-row-head"><h3>配当履歴(IRBANK・分割調整後)</h3></div><div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>年度</th><th>年間配当(報告値)</th><th>分割調整後</th><th>配当性向</th><th>DOE</th><th>連続増配</th><th>区分</th></tr></thead><tbody>${div.slice().reverse().map((r) => `<tr><th>${escapeHtml(String(r.fiscal_year ?? "—"))}</th><td>${tvFmt(r.annual_dps)}</td><td>${tvFmt(r.annual_dps_adjusted)}</td><td>${number(r.payout_ratio) === null ? "—" : `${number(r.payout_ratio).toFixed(1)}%`}</td><td>${number(r.doe) === null ? "—" : `${number(r.doe).toFixed(2)}%`}</td><td>${r.consecutive_dividend_increase_years ?? "—"}年</td><td>${escapeHtml({ increase: "増配", decrease: "減配", flat: "据え置き", initiate: "初配", suspend: "無配化" }[r.change_type] || r.change_type || "—")}</td></tr>`).join("")}</tbody></table></div>` : "";
  return `${cards}<div class="broker-row-head"><h3>配当の推移</h3></div>${table}${hist}`;
}

function tabEdinet(doc) {
  const ed = doc.edinet || {}; const catalog = state.inventory?.edinetItems || [];
  const keys = catalog.map((c) => c.key).filter((k) => ed[k]?.length);
  if (!keys.length) return '<div class="empty-state"><p>有報データはありません。</p></div>';
  const years = [...new Set(keys.flatMap((k) => ed[k].map((r) => String(r[0]).slice(0, 7))))].sort();
  const rows = keys.map((k) => { const meta = catalog.find((c) => c.key === k); const map = Object.fromEntries(ed[k].map((r) => [String(r[0]).slice(0, 7), r])); return { label: meta?.label || k, unit: meta?.unit === "円" ? "" : "", note: `${k} / ${meta?.origin || ""}`, values: years.map((y) => ({ raw: map[y]?.[1], text: map[y] ? edinetFormat(meta?.unit, map[y][1]) : "—" })) }; });
  return `<div class="broker-row-head"><h3>有価証券報告書(XBRL)の全項目</h3><small>${keys.length}項目 × ${years.length}期</small></div>${periodGrid({ periods: years.map((y) => y.replace(/^20/, "").replace("-", ".")), rows, note: "金額は円を億円に換算して表示。経営指標等の推移(5年分)と本表(2年分)を合わせて、書類に載っている期をすべて表示。" })}`;
}

function tabPeople(doc) {
  const fin = doc.irbank?.fin; const groups = state.fieldCatalog?.finGroups || []; const g = groups.find((x) => x.id === "people");
  const ind = doc.irbank?.ind; const cat = state.fieldCatalog?.ind || {};
  const hc = ind ? Object.keys(ind.values).filter((k) => cat[k]?.category === "human_capital") : [];
  return `<div class="broker-row-head"><h3>従業員・ガバナンス・環境</h3></div>${fin && g ? periodGrid({ periods: fin.periods.map(fyShort), rows: irbankRows(fin, g.keys, "fin") }) : ""}${hc.length ? `<div class="broker-row-head"><h3>人的資本の指標</h3></div>${periodGrid({ periods: ind.periods.map(fyShort), rows: irbankRows(ind, hc, "ind") })}` : ""}`;
}

function tabProfile(doc, company) {
  const s = doc.irbank?.security || {}; const k = doc.kabutan || {};
  const item = (label, value) => `<div><dt>${label}</dt><dd>${value ?? "—"}</dd></div>`;
  return `<div class="broker-row-head"><h3>会社概要</h3></div><dl class="broker-metrics">${[
    item("会社名", escapeHtml(s.name || company.name)), item("証券コード", escapeHtml(company.code)), item("市場", escapeHtml(s.market || company.market)), item("業種", escapeHtml(s.industry || company.industry)),
    item("決算月", s.fiscal_year_end_month ? `${s.fiscal_year_end_month}月` : "—"), item("上場年月", escapeHtml(s.listing_month || "—")), item("発行済株式数", number(s.issued_shares) === null ? "—" : `${Math.round(s.issued_shares / 1e4).toLocaleString("ja-JP")}万株`), item("EDINETコード", escapeHtml(s.edinet_code || "—")),
    item("会計基準(直近)", escapeHtml((k.annual || []).at(-1)?.acct || "—")), item("売買代金順位(固定)", `#${company.rank ?? "—"}`),
  ].join("")}</dl>`;
}

function tabResearch(doc, company) {
  const r = doc.research || {}; const H = state.predH || 20;
  const preds = (r.predictions || []).filter((p) => p[1] === H);
  const hs = [...new Set((r.predictions || []).map((p) => p[1]))].sort((a, b) => a - b);
  const settled = preds.filter((p) => number(p[7]) !== null);
  const hit = settled.filter((p) => Math.sign(p[3]) === Math.sign(p[7])).length;
  const predTable = `<div class="broker-row-head"><h3>保存済み予測の履歴(${H}日先・期間VWAP)</h3><div class="broker-seg">${hs.map((h) => `<button type="button" data-pred-h="${h}" class="${h === H ? "active" : ""}">${h}日</button>`).join("")}</div></div><div class="broker-cards"><article><span>保存した予測</span><strong>${preds.length}<small>回</small></strong><em>基準日ごとの最新実行</em></article><article><span>答えが確定</span><strong>${settled.length}<small>回</small></strong><em>${settled.length ? `方向一致 ${hit}/${settled.length}` : "確定待ち"}</em></article></div><div class="broker-table-wrap tall"><table class="broker-table"><thead><tr><th>基準日</th><th>採用</th><th>採用予測</th><th>CURRENT</th><th>GBM</th><th>DNN</th><th>実績</th><th>基準日終値</th><th>上抜け確率</th><th>下抜け確率</th></tr></thead><tbody>${preds.slice().reverse().map((p) => `<tr><th>${escapeHtml(p[0])}</th><td>${escapeHtml(p[2] || "")}</td><td class="${number(p[3], 0) >= 0 ? "positive-text" : "negative-text"}">${percent(p[3], 2)}</td><td>${percent(p[4], 2)}</td><td>${percent(p[5], 2)}</td><td>${percent(p[6], 2)}</td><td class="${number(p[7]) === null ? "" : number(p[7]) >= 0 ? "positive-text" : "negative-text"}">${number(p[7]) === null ? "確定待ち" : percent(p[7], 2)}</td><td>${tvFmt(p[8])}</td><td>${metricPercent(p[9])}</td><td>${metricPercent(p[10])}</td></tr>`).join("")}</tbody></table></div>`;
  const shadow = (r.earnShadow || []).filter((s) => s[1] === H);
  const shadowTable = shadow.length ? `<div class="broker-row-head"><h3>決算塔のシャドー予測(${H}日)</h3><small>本番には未使用。価格系のみ vs 決算込みの比較用</small></div><div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>基準日</th><th>価格系モデル</th><th>決算込みモデル</th><th>差</th></tr></thead><tbody>${shadow.slice().reverse().map((s) => `<tr><th>${escapeHtml(s[0])}</th><td>${percent(s[2], 2)}</td><td>${percent(s[3], 2)}</td><td>${percent(number(s[3], 0) - number(s[2], 0), 2)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const cats = ["国策・制度・規制", "構造需要・長期投資", "業績・ガイダンス", "資本政策", "短期イベント"];
  const ad = r.newsAdaptive || [];
  const adTable = ad.length ? `<div class="broker-row-head"><h3>ニュースの BERT 分類と固有半減期</h3><small>意味アンカー版(シャドー)。半減期が長いほど長く効くと推定</small></div><div class="broker-table-wrap tall"><table class="broker-table left"><thead><tr><th>利用可能日</th><th>見出し</th><th>分類</th><th>確信度</th><th>半減期</th><th>分類確率(国策/構造/業績/資本/短期)</th></tr></thead><tbody>${ad.map((a) => `<tr><th>${escapeHtml(a.at || "")}</th><td class="wrap">${escapeHtml(a.title || "(見出しなし)")}</td><td>${escapeHtml(a.cat || "")}</td><td>${metricPercent(a.conf)}</td><td>${number(a.halfLife)?.toFixed(1) ?? "—"}日</td><td><div class="prob-bars">${(a.p || []).map((p, i) => `<i title="${cats[i]} ${metricPercent(p)}" style="width:${Math.max(2, number(p, 0) * 100)}%"></i>`).join("")}</div></td></tr>`).join("")}</tbody></table></div>` : "";
  const news = r.news || [];
  const newsList = news.length ? `<div class="broker-row-head"><h3>保存済みニュース(新しい順・最大50件)</h3><small>BERT でベクトル化済み ${r.bertArticles || 0}件</small></div><div class="news-mini">${news.map((n) => `<div><time>${escapeHtml(n.at)}</time>${n.url ? `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)}</a>` : `<span>${escapeHtml(n.title)}</span>`}<small>${escapeHtml(n.source || "")}</small></div>`).join("")}</div>` : "";
  const evidence = r.evidence ? `<div class="broker-row-head"><h3>最終まとめ用の根拠ファイル(自然言語生成の入力)</h3><small>${escapeHtml(r.evidenceFile || "")}</small></div><div class="md-body">${mdToHtml(r.evidence)}</div>` : '<div class="broker-row-head"><h3>最終まとめ用の根拠ファイル</h3><small>この銘柄は根拠ファイルの対象外(注目銘柄のみ生成)</small></div>';
  return `${predTable}${shadowTable}${evidence}${adTable}${newsList}`;
}

function mdToHtml(md) {
  const lines = String(md || "").split(/\r?\n/); let html = ""; let table = null; let list = false;
  const inline = (s) => escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const flushTable = () => { if (!table) return; html += `<div class="broker-table-wrap"><table class="broker-table left"><thead><tr>${table[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${table.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; table = null; };
  const flushList = () => { if (list) { html += "</ul>"; list = false; } };
  lines.forEach((line) => {
    if (/^\|/.test(line)) { flushList(); const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()); if (cells.every((c) => /^-+$/.test(c))) return; (table = table || []).push(cells); return; }
    flushTable();
    if (/^#{2,4} /.test(line)) { flushList(); const level = line.match(/^#+/)[0].length; html += `<h${level + 1}>${inline(line.replace(/^#+ /, ""))}</h${level + 1}>`; return; }
    if (/^- /.test(line)) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(line.slice(2))}</li>`; return; }
    flushList();
    if (line.trim()) html += `<p>${inline(line)}</p>`;
  });
  flushTable(); flushList(); return html;
}

function drawDetailCharts(doc) {
  if (state.brokerTab === "perf") {
    const { rows, forecast } = mergedAnnual(doc); const base = [...rows, ...(forecast ? [{ ...forecast, forecast: true }] : [])];
    drawBrokerBars($("#brokerSales"), base.map((r) => ({ label: String(r.period).slice(2, 7), value: r.sales, forecast: r.forecast })));
    drawBrokerBars($("#brokerOp"), base.map((r) => ({ label: String(r.period).slice(2, 7), value: r.op, forecast: r.forecast })));
  }
  if (state.brokerTab === "quarter") {
    const q = doc.kabutan?.quarter || [];
    drawBrokerBars($("#brokerSales"), q.map((r) => ({ label: r.period, value: r.sales })));
    drawBrokerBars($("#brokerOp"), q.map((r) => ({ label: r.period, value: r.op })));
  }
  if (state.brokerTab === "valuation" && doc.irbank?.val) {
    const v = doc.irbank.val; const canvas = $("#brokerValChart"); if (!canvas || !canvas.clientWidth) return;
    const { ctx, width, height } = setupCanvas(canvas, 170); ctx.clearRect(0, 0, width, height);
    const hi = v.values.per_high || [], lo = v.values.per_low || [], mid = v.values.per || [];
    const all = [...hi, ...lo, ...mid].map((x) => number(x)).filter((x) => x !== null && x > 0 && x < 500); if (!all.length) return;
    const max = Math.max(...all) * 1.1, min = 0; const y = (x) => 12 + (max - x) / (max - min) * (height - 34); const slot = width / v.periods.length;
    ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "center";
    v.periods.forEach((p, i) => { const cx = slot * i + slot / 2; const a = number(hi[i]), b = number(lo[i]), m = number(mid[i]);
      if (a !== null && b !== null && a > 0 && b > 0 && a < 500) { ctx.strokeStyle = css("--primary"); ctx.lineWidth = 6; ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(cx, y(a)); ctx.lineTo(cx, y(b)); ctx.stroke(); ctx.globalAlpha = 1; }
      if (m !== null && m > 0 && m < 500) { ctx.fillStyle = css("--primary"); ctx.beginPath(); ctx.arc(cx, y(m), 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = css("--text"); ctx.fillText(`${m.toFixed(1)}`, cx + 18, y(m) + 3); }
      ctx.fillStyle = css("--muted"); ctx.fillText(fyShort(p), cx, height - 6); });
    if (number(v.per5yAvg) !== null) { ctx.strokeStyle = css("--warning"); ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y(v.per5yAvg)); ctx.lineTo(width, y(v.per5yAvg)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = css("--warning"); ctx.textAlign = "left"; ctx.fillText(`5年平均 ${number(v.per5yAvg).toFixed(1)}倍`, 4, y(v.per5yAvg) - 4); }
  }
  if (state.brokerTab === "credit") {
    const credit = state.creditView || doc.credit || []; const cv = $("#brokerCredit"), pv = $("#brokerCreditPrice"); if (!cv || !cv.clientWidth || !credit.length) return;
    const daily = state.chartData || [];
    const closeAt = (date) => { let c = null; for (const r of daily) { if (r.d <= date) c = r.c; else break; } return c; };
    const slot = cv.clientWidth / credit.length;
    { const { ctx, width, height } = setupCanvas(pv, 90); ctx.clearRect(0, 0, width, height); const vals = credit.map((r) => closeAt(r.date)); const f = vals.filter(Number.isFinite); if (f.length) { const lo = Math.min(...f), hi = Math.max(...f); const y = (v) => 8 + (hi - v) / (hi - lo || 1) * (height - 16); ctx.strokeStyle = css("--text"); ctx.lineWidth = 1.5; ctx.beginPath(); let s = false; vals.forEach((v, i) => { if (!Number.isFinite(v)) return; const x = slot * i + slot / 2; if (!s) { ctx.moveTo(x, y(v)); s = true; } else ctx.lineTo(x, y(v)); }); ctx.stroke(); ctx.fillStyle = css("--muted"); ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "right"; ctx.fillText(`${tvFmt(hi)}円`, width - 2, 12); ctx.fillText(`${tvFmt(lo)}円`, width - 2, height - 4); } }
    { const { ctx, width, height } = setupCanvas(cv, 150); ctx.clearRect(0, 0, width, height); const max = Math.max(...credit.map((r) => Math.max(number(r.buy, 0), number(r.sell, 0))), 1); const base = height - 22; const bw = Math.max(1, slot * .36);
      ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(0, base + .5); ctx.lineTo(width, base + .5); ctx.stroke();
      credit.forEach((r, i) => { const x = slot * i + slot / 2; const hb = number(r.buy, 0) / max * (base - 10); const hs = number(r.sell, 0) / max * (base - 10); ctx.fillStyle = "#e0584f"; ctx.fillRect(x - bw - .5, base - hb, bw, hb); ctx.fillStyle = "#3f7cf0"; ctx.fillRect(x + .5, base - hs, bw, hs); });
      ctx.fillStyle = css("--muted"); ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "center"; [0, Math.floor(credit.length / 2), credit.length - 1].forEach((i) => ctx.fillText(credit[i].date.slice(2).replace(/-/g, "/"), Math.min(Math.max(slot * i + slot / 2, 24), width - 24), height - 6)); ctx.textAlign = "right"; ctx.fillText(`最大 ${brokerMoney(max)}株`, width - 2, 10); }
  }
}

// ===================== 指数ページ・リサーチ・NLP (2026-09-23) =====================
state.indexId = "N225";
state.indexRange = "1y";
state.researchType = "";
state.researchId = null;
state.nlpTab = "evidence";

async function loadMarketData() {
  const get = async (path, fallback) => { try { const r = await fetch(path, { cache: "no-store" }); return r.ok ? await r.json() : fallback; } catch { return fallback; } };
  [state.indexPages, state.marketData, state.research, state.researchPack] = await Promise.all([
    get("data/index-pages.json", { pages: [] }), get("data/market.json", {}), get("data/research.json", { reports: [] }), get("data/research-pack.json", {}),
  ]);
  state.guidance = await get("data/guidance.json", null);
}

function renderGuidance() {
  const g = state.guidance; const box = $("#guidanceRows"); if (!box) return;
  if (!g?.summary) { $("#guidanceKpis").innerHTML = '<div class="empty-state"><strong>まだ計算されていません</strong><p>python scripts/run_guidance_surprise.py</p></div>'; return; }
  const s = g.summary; const m = s.models || {};
  const f2 = (v, d = 3) => (v == null ? "—" : Number(v).toFixed(d));
  $("#guidanceBadge").textContent = `学習 ${s.period?.[0] || ""}〜${s.period?.[1] || ""}・${s.codes}社`;
  $("#guidanceKpis").innerHTML = [["検証した予想", `${s.evaluated}件`, `答えが出た ${s.labeled}件のうち、学習データが足りた分`], ["実際に上回った割合", metricPercent(s.baseRate, 0), "会社予想は保守的に出されやすい"], ["AUC(モデル)", f2(m.B_own?.auc), `進捗だけの基準 ${f2(m.A_prog?.auc)}`], ["正解率(モデル)", metricPercent(m.B_own?.acc, 1), `「常に上回る」と答えた場合 ${metricPercent(s.baseRate, 1)}`]].map(([a, b, c]) => `<article><span>${a}</span><strong>${b}</strong><small>${escapeHtml(c)}</small></article>`).join("");
  const names = { A_prog: "進捗だけ(去年の同時点との差)", B_own: "自社のみ GBM(採用)", C_graph: "自社+関係先・同業種", D_fake: "自社+偽の関係先(対照)" };
  const qn = { 0: "期初予想", 1: "1Q後", 2: "2Q後", 3: "3Q後" };
  const bq = s.byQuarter || {};
  $("#guidanceEval").innerHTML = `<div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>モデル</th><th>AUC</th><th>正解率</th><th>順位相関</th>${Object.keys(bq).map((q) => `<th>${qn[q] || q}<small>n=${bq[q].n}</small></th>`).join("")}</tr></thead><tbody>${Object.entries(names).map(([k, l]) => `<tr${k === "B_own" ? ' class="sel-row"' : ""}><th>${l}</th><td>${f2(m[k]?.auc)}</td><td>${metricPercent(m[k]?.acc, 1)}</td><td>${f2(m[k]?.rankIC, 2)}</td>${Object.keys(bq).map((q) => `<td>${f2(bq[q][k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="read-box"><b>読み方</b><p>AUC 0.5 はでたらめ、1.0 は完全に当たる。モデルの AUC ${f2(m.B_own?.auc)} は「当てずっぽうよりは明確に良いが、強くはない」水準で、実は <b>進捗の去年比だけ(${f2(m.A_prog?.auc)})とほぼ同じ</b>。上振れを見分ける情報のほとんどは「今年の進捗が去年の同じ時点より速いか」に入っている。</p><p>関係先(取引先・同業種)が直前に出した決算の強さを足しても改善しなかった(差 ${f2(s.C_vs_B?.diff)}、95%区間 ${f2(s.C_vs_B?.lo95)}〜${f2(s.C_vs_B?.hi95)})。取引関係の辺を持つ相手のうち、同じ期間に決算データがある会社が 3% しかなく、関係の効果をまだ検証できる状態にない。</p><p>期初予想(1Q前)の時点では、ほぼ当たらない(AUC ${f2(bq[0]?.B_own)})。進捗の情報が無いため。</p></div>`;
  const cal = s.calibration || [];
  $("#guidanceCalib").innerHTML = `<div class="calib-bars">${cal.map((c, i) => `<div class="calib-row"><span>${["最も低い", "低い", "中", "高い", "最も高い"][i] || i}<small>予測 ${metricPercent(c.p, 0)}</small></span><div class="bar-track"><i style="width:${(c.beat * 100).toFixed(1)}%"></i></div><em>${metricPercent(c.beat, 0)}<small>n=${c.n}</small></em></div>`).join("")}</div><p class="lab-foot">予測確率が高い組ほど、実際に上回った割合も高い(${metricPercent(cal[0]?.beat, 0)} → ${metricPercent(cal.at(-1)?.beat, 0)})。ただし高い側は予測が実際より強気(例: 予測 ${metricPercent(cal.at(-1)?.p, 0)} に対して実際 ${metricPercent(cal.at(-1)?.beat, 0)})なので、確率は順位として読むのが安全。</p>`;
  const sg = g.significance; const sigEl = $("#guidanceSig");
  if (sigEl) sigEl.innerHTML = !sg ? '<div class="read-box muted"><p>まだ計算されていません(python scripts/guidance_significance.py)</p></div>' : (() => {
    const pct = (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
    const sgn = (v, d = 3) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(d)}`);
    const ok = (b) => (b ? '<b style="color:var(--up,#16a34a)">有意</b>' : '<b style="color:var(--muted,#888)">有意でない</b>');
    const rows = [
      ["AUC(GBM)が 0.5 より大きいか", f2(sg.auc?.model?.obs), `${f2(sg.auc?.model?.lo95)}〜${f2(sg.auc?.model?.hi95)}`, ok(sg.auc?.model?.significant)],
      ["AUC(単純規則=進捗の去年差)が 0.5 より大きいか", f2(sg.auc?.simple?.obs), `${f2(sg.auc?.simple?.lo95)}〜${f2(sg.auc?.simple?.hi95)}`, ok(sg.auc?.simple?.significant)],
      ["同じ月の中だけで比べた AUC(GBM)", f2(sg.within_month?.auc_model), `並べ替え検定 p ${sg.within_month?.perm_p < 0.001 ? "< 0.001" : "= " + f2(sg.within_month?.perm_p)}`, ok(sg.within_month?.perm_p < 0.05)],
      ["GBM − 単純規則(AUC の差)", sgn(sg.model_minus_simple?.mean), `${sgn(sg.model_minus_simple?.lo95)}〜${sgn(sg.model_minus_simple?.hi95)}`, ok(sg.model_minus_simple?.significant)],
      ["正解率 − 「常に上振れ」と答えた場合", sgn(sg.acc?.gain?.mean * 100, 1) + "pt", `${sgn(sg.acc?.gain?.lo95 * 100, 1)}〜${sgn(sg.acc?.gain?.hi95 * 100, 1)}pt`, ok(sg.acc?.significant)],
    ];
    const qn2 = { 0: "期初予想", 1: "1Q後", 2: "2Q後", 3: "3Q後" };
    return `<div class="broker-cards"><article><span>上振れを見分ける情報</span><strong>${sg.auc?.model?.significant ? "有意" : "有意でない"}</strong><em>AUC ${f2(sg.auc?.model?.obs)}(95%区間 ${f2(sg.auc?.model?.lo95)}〜${f2(sg.auc?.model?.hi95)})</em></article><article><span>GBM は単純規則より良いか</span><strong>${sg.model_minus_simple?.significant ? "有意" : "有意でない"}</strong><em>差 ${sgn(sg.model_minus_simple?.mean)}</em></article><article><span>検証の偏り</span><strong>${pct(sg.fy_concentration?.share, 0)}</strong><em>${sg.fy_concentration?.n}/${sg.n}件が ${sg.fy_concentration?.fy}年期末の同じ決算年度</em></article><article><span>本番記録で確かめるのに要る件数</span><strong>約${sg.power?.n_needed ?? "—"}件</strong><em>答えの付いた記録(AUC ${f2(sg.power?.auc_assumed)} を仮定)</em></article></div>
<div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>検定</th><th>値</th><th>95%区間 など</th><th>判定</th></tr></thead><tbody>${rows.map(([a, b, c, d]) => `<tr><th>${a}</th><td>${b}</td><td>${c}</td><td>${d}</td></tr>`).join("")}</tbody></table></div>
<div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>区分</th><th>件数</th><th>AUC(GBM)</th><th>95%区間</th><th>AUC(単純規則)</th><th>判定(GBM)</th></tr></thead><tbody>${(sg.byQuarter || []).map((r) => `<tr><th>${qn2[r.q] || r.q}</th><td>${r.n}</td><td>${f2(r.auc_model)}</td><td>${f2(r.lo95)}〜${f2(r.hi95)}</td><td>${f2(r.auc_simple)}</td><td>${ok(r.significant)}</td></tr>`).join("")}${(sg.byFY || []).map((r) => `<tr><th>${r.fy}年期末</th><td>${r.n}</td><td>${f2(r.auc_model)}</td><td>—</td><td>${f2(r.auc_simple)}</td><td>—</td></tr>`).join("")}</tbody></table></div>
<div class="read-box"><b>読み方</b><p><b>「上振れを見分ける情報がある」は有意、「GBM だから当たる」は有意でない。</b>情報のほとんどは「今年の進捗が去年の同じ時点より速いか」の1本に入っていて、GBM はそれを上乗せできていない。正解率も「常に上振れ」と答えた場合(${pct(sg.acc?.always_beat)})と区別できない。</p><p>検定の方法: 同じ会社の 1Q・2Q・3Q は独立でないので、会社ごとまとめて抜き差しするブートストラップ(${sg.n_boot}回)で区間を出した。上振れが多い月に高い確率を付けただけでも AUC は上がるので、月の中だけで比べた AUC と、月の中で答えを並べ替える検定(${sg.n_perm}回、実際の値を超えたのは ${sg.within_month?.perm_exceed}回)で、時期のずれによる水増しでないことを確かめた。</p><p>決算年度で見ると、GBM と単純規則のどちらが良いかが入れ替わる(上の表の下2行)。本番の記録でも両方を並べて採点する。</p></div>
${(sg.caveats || []).map((c) => `<p class="lab-foot">⚠ ${escapeHtml(c)}</p>`).join("")}<p class="lab-foot">計算日 ${escapeHtml(sg.asof || "")}・検証 ${sg.n}件 / ${sg.codes}社 / ${sg.months}か月(${escapeHtml((sg.period || []).join("〜"))})・出典 ${escapeHtml(sg.source || "")}</p>`;
  })();
  const lv = g.live; const lm = lv?.live || {};
  $("#guidanceLive").innerHTML = lv ? `<div class="broker-cards"><article><span>最終実行</span><strong>${escapeHtml(lv.asof || "—")}</strong><em>${escapeHtml(lv.model_version || "")}</em></article><article><span>学習データ</span><strong>${lv.n_train ?? "—"}件</strong><em>J-Quants ${lv.n_jquants ?? 0} + 自分の記録 ${lv.n_live ?? 0}</em></article><article><span>記録した予測</span><strong>${(lv.history_rows ?? 0).toLocaleString("ja-JP")}行</strong><em>今日 ${lv.n_predicted_today ?? 0}銘柄・新たに答えが付いた ${lv.verified_today ?? 0}件</em></article><article><span>答えが出た記録</span><strong>${lm.n ?? 0}件</strong><em>${lm.auc_model != null ? `AUC ${Number(lm.auc_model).toFixed(3)}・Brier ${Number(lm.brier_model).toFixed(3)}` : "10件以上たまると採点を表示"}</em></article></div>${lm.claude?.n ? `<p class="lab-foot">Claude の補正 ${lm.claude.n}件: AUC モデル ${f2(lm.claude.auc_model)} → 補正後 ${f2(lm.claude.auc_claude)} / Brier ${f2(lm.claude.brier_model)} → ${f2(lm.claude.brier_claude)}</p>` : ""}<p class="lab-foot">答えは本決算(株探の通期実績)が公表された日に付き、その日以降の学習にだけ使う。Claude の補正(決算資料などモデルが見ていない情報からの確率の付け直し)は state/guidance_claude.csv に記録し、学習には使わずモデル単体と並べて採点する。</p>` : '<div class="read-box muted"><p>stockAI の日次実行(run_daily.py の 6b)がまだ走っていません。</p></div>';
  const draw = () => {
    const q = $("#guidanceQ").value; const term = ($("#guidanceSearch").value || "").trim().toLowerCase();
    const rows = (g.now || []).filter((r) => (q === "" || String(r.q) === q) && (!term || `${r.code} ${r.name}`.toLowerCase().includes(term)));
    $("#guidanceNowNote").textContent = `${g.now?.length || 0}銘柄・株探の最新開示(〜${(g.now || []).reduce((a, r) => (r.t > a ? r.t : a), "")})で計算。表示 ${rows.length}件`;
    const pc = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
    box.innerHTML = rows.map((r) => { const p = number(r.p_beat, 0); const tone = p >= .8 ? "positive" : p <= .5 ? "negative" : "muted";
      return `<tr><th><button class="link-button" type="button" data-guid-go="${escapeHtml(r.code)}">${escapeHtml(r.code)}</button><small>${escapeHtml(r.name || "")}</small></th><td><span class="pill ${tone}">${(p * 100).toFixed(0)}%</span></td><td>${r.claude?.p_claude != null ? `<span class="pill primary" title="${escapeHtml(r.claude.reason || "")}">${(r.claude.p_claude * 100).toFixed(0)}%</span><small>${escapeHtml((r.claude.reason || "").slice(0, 40))}</small>` : "—"}</td><td>${qn[r.q] || r.q}<small>${escapeHtml(r.fye || "")}期・${escapeHtml(r.t || "")}</small></td><td>${r.fop == null ? "—" : Math.round(r.fop).toLocaleString("ja-JP")}${r.initial_fop ? `<small>期初 ${Math.round(r.initial_fop).toLocaleString("ja-JP")}</small>` : ""}</td><td class="${number(r.rev_since_initial, 0) > 0 ? "positive-text" : number(r.rev_since_initial, 0) < 0 ? "negative-text" : ""}">${pc(r.rev_since_initial)}</td><td>${r.prog_op == null ? "—" : `${(r.prog_op * 100).toFixed(1)}%`}</td><td>${r.prog_prev == null ? "—" : `${(r.prog_prev * 100).toFixed(1)}%`}<small class="${number(r.prog_gap, 0) >= 0 ? "positive-text" : "negative-text"}">差 ${r.prog_gap == null ? "—" : `${r.prog_gap >= 0 ? "+" : ""}${(r.prog_gap * 100).toFixed(1)}pt`}</small></td><td>${pc(r.cum_yoy)}</td><td>${pc(r.need_rest_yoy)}</td><td class="${number(r.ret60_pre, 0) >= 0 ? "positive-text" : "negative-text"}">${pc(r.ret60_pre)}</td></tr>`; }).join("") || '<tr><td colspan="11">該当なし</td></tr>';
    $$("#guidanceRows [data-guid-go]").forEach((b) => b.addEventListener("click", () => goStock(b.dataset.guidGo)));
  };
  if (!box.dataset.bound) { $("#guidanceQ").addEventListener("change", draw); $("#guidanceSearch").addEventListener("input", draw); box.dataset.bound = "1"; }
  draw();
}

function indexPage(id) { return (state.indexPages?.pages || []).find((p) => p.id === id); }
function indexRows(page) { return (page?.points || []).map((a) => ({ d: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })); }
function pctText(v, d = 2) { return percent(v, d); }

function renderIndexPage() {
  const page = indexPage(state.indexId) || indexPage("N225"); if (!page) return;
  state.indexId = page.id;
  $("#indexSwitch").innerHTML = (state.indexPages?.pages || []).map((p) => `<button type="button" class="${p.id === page.id ? "active" : ""}" data-index-go="${p.id}"><b>${escapeHtml(p.name)}</b><span class="${number(p.stats?.chg1d, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(p.stats?.chg1d, 2)}</span></button>`).join("");
  $$('[data-index-go]').forEach((b) => b.addEventListener("click", () => goIndex(b.dataset.indexGo)));
  const s = page.stats || {};
  $("#indexKind").textContent = `${page.kind} · ${page.symbol}`;
  $("#indexTitle").textContent = page.name;
  $("#indexSubhead").textContent = `${s.date || ""} ${s.partial ? "場中の取得値(引け前)" : "終値"} · データは2020年以降の日足(Yahoo Finance)`;
  const unit = page.id === "TNX" ? "%" : page.id === "USDJPY" ? "円" : "";
  $("#indexHeadPrice").innerHTML = `<strong>${tvFmt(s.last)}<small>${unit}</small></strong><span class="${number(s.chg1d, 0) >= 0 ? "positive-text" : "negative-text"}">${s.prev != null ? `${s.last - s.prev >= 0 ? "+" : ""}${tvFmt(s.last - s.prev)} (${percent(s.chg1d, 2)})` : "—"}</span><small>前日 ${tvFmt(s.prev)}</small>`;
  const k = (label, v, note = "") => `<article><span>${label}</span><strong class="${number(v, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(v, 1)}</strong>${note ? `<small>${note}</small>` : ""}</article>`;
  $("#indexKpis").innerHTML = [k("5日", s.chg5d), k("20日", s.chg20d), k("60日", s.chg60d), k("年初来", s.chgYtd), k("1年", s.chg250d), k("52週高値から", s.fromHigh52, `高値 ${tvFmt(s.high52)}`)].join("");
  const row = (label, value, note = "") => `<div><dt>${label}</dt><dd>${value}</dd>${note ? `<small>${note}</small>` : ""}</div>`;
  $("#indexStats").innerHTML = `<dl class="broker-metrics compact">${[
    row("52週高値 / 安値", `${tvFmt(s.high52)} / ${tvFmt(s.low52)}`), row("全期間での水準", `${metricPercent(s.pctRank, 0)}`, "2020年以降でこの値より低かった日の割合"),
    row("実現ボラ 20日", metricPercent(s.vol20, 1), "年率"), row("実現ボラ 60日", metricPercent(s.vol60, 1), "年率"), row("実現ボラ 1年", metricPercent(s.vol250, 1), "年率"),
    row("ATR(14)", tvFmt(s.atr14), "1日の平均的な値幅"), row("RSI(14)", number(s.rsi14)?.toFixed(1) ?? "—", number(s.rsi14, 50) >= 70 ? "70以上: 過熱の目安" : number(s.rsi14, 50) <= 30 ? "30以下: 売られすぎの目安" : ""),
    row("25日線乖離", percent(s.ma25dev, 2)), row("75日線乖離", percent(s.ma75dev, 2)), row("200日線乖離", percent(s.ma200dev, 2)), row("1年の最大下落", percent(s.maxDd250, 1), "高値からの最大の落ち込み"),
  ].join("")}</dl>`;
  // チャート: 個別銘柄と同じエンジンに指数の日足と AI 予測(模型別)を載せる
  if (state.sym?.type !== "index" || state.sym.code !== page.id) { state.sym = { type: "index", code: page.id }; if (state.tv) { state.tv.count = null; state.tv.offset = 0; state.tv.hover = null; state.tv.pending = null; } }
  if (state.tvLoadedKey !== `idx-${page.id}`) { state.chartData = indexChartRows(page); state.chartWeekly = []; state.chartSplits = []; state.tvLoadedKey = `idx-${page.id}`; }
  state.watchMode = "index";
  syncTvControls();
  renderIndexForecast(page); renderIndexForecastTable(page); renderIndexOptions(page); renderIndexBreadth(page); renderIndexCorr(page); renderIndexReports(page);
  renderWatchlist(); renderSymbolCard();
  requestAnimationFrame(() => { drawStockChart(); drawIndicatorChart(); drawSeason(page); });
}
// 2026-09-25: 模型別(CURRENT/GBM/DNN)の予測をカードで並べる。カードを押すとチャートに重ねる模型が切り替わる
function renderIndexForecast(page) {
  const box = $("#indexForecast"); const ai = page.ai;
  if (!ai) { box.innerHTML = `<div class="empty-state"><p>${escapeHtml(page.name)} は予測対象外(市場の特徴量としてのみ使用)。</p><small>日経平均・TOPIX・NASDAQ・S&P 500 に専用モデルがあります。</small></div>`; return; }
  const h = String(tvHorizon()); const H = ai.horizons?.[h] || {}; const sel = H.selectedModel;
  const current = ["CURRENT", "GBM", "DNN"].includes(state.selectedModel) ? state.selectedModel : sel;
  const f = H.forecasts?.[sel] || {};
  const stale = ai.asOf && page.stats?.date && ai.asOf < page.stats.date;
  const cards = ["CURRENT", "GBM", "DNN"].map((m) => {
    const x = H.forecasts?.[m] || {}; const mt = H.metrics?.[m] || {};
    return `<button type="button" class="idx-model-card ${m === current ? "active" : ""}" data-idx-model="${m}" style="--mc:${modelColors[m]}"><header><b>${m}</b>${m === sel ? '<span class="pill primary">採用</span>' : ""}</header><strong class="${number(x.return, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(x.return, 2)}</strong><span class="idx-price">${tvFmt(x.price)}</span><small>68% ${tvFmt(x.low68)}〜${tvFmt(x.high68)}</small><small>90% ${tvFmt(x.low90)}〜${tvFmt(x.high90)}</small><dl><div><dt>検証MAE</dt><dd>${metricPercent(mt.maeReturn, 2)}</dd></div><div><dt>方向一致</dt><dd>${metricPercent(mt.directionAccuracy, 1)}</dd></div><div><dt>相関</dt><dd>${number(mt.correlation)?.toFixed(2) ?? "—"}</dd></div></dl></button>`;
  }).join("");
  box.innerHTML = `<div class="idx-fc-head"><div class="horizon-tabs">${INDEX_HORIZONS.map((x) => `<button type="button" data-idx-h="${x}" class="${String(x) === h ? "active" : ""}">${x}営業日</button>`).join("")}</div><p>採用 <b>${escapeHtml(sel || "—")}</b>: ${h}営業日の平均 <b>${tvFmt(f.price)}</b>(${percent(f.return, 2)}) · 基準日 ${escapeHtml(ai.asOf || "—")}</p></div>${stale ? `<p class="forecast-warn"><b>⚠ 予測が古い</b> 予測の基準日(${escapeHtml(ai.asOf)})が価格の最終日(${escapeHtml(page.stats.date)})より前です。指数モデルは次の日次更新で作り直されます。</p>` : ""}<div class="idx-model-grid">${cards}</div><p class="lab-foot">予測は「期限までの終値の単純平均」の騰落率(個別銘柄の VWAP とは定義が違う)。帯は各模型の時系列検証の残差の分位点(68%=16〜84%、90%=5〜95%)。チャートの「過去の予測」で検証期間の当たり外れを確認できます。</p>`;
  box.querySelectorAll("[data-idx-h]").forEach((b) => b.addEventListener("click", () => { state.horizon = Number(b.dataset.idxH); syncTvControls(); renderIndexForecast(page); renderSymbolCard(); drawStockChart(); drawIndicatorChart(); }));
  box.querySelectorAll("[data-idx-model]").forEach((b) => b.addEventListener("click", () => { state.selectedModel = b.dataset.idxModel === sel ? "ADOPTED" : b.dataset.idxModel; syncTvControls(); renderIndexForecast(page); drawStockChart(); drawIndicatorChart(); $("#tvHostIndex")?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
}
function renderIndexForecastTable(page) {
  const box = $("#indexForecastTable"); if (!box) return; const ai = page.ai;
  if (!ai) { box.innerHTML = '<div class="empty-state"><p>この指数には専用モデルがありません。</p></div>'; return; }
  const hs = Object.keys(ai.horizons || {});
  box.innerHTML = `<div class="broker-table-wrap"><table class="broker-table idx-table"><thead><tr><th>期限</th><th>採用</th><th>予測(期間平均)</th><th>予測値</th><th>68%帯</th><th>90%帯</th><th>方向一致</th><th>相関</th><th>CURRENT</th><th>GBM</th><th>DNN</th></tr></thead><tbody>${hs.map((h) => { const x = ai.horizons[h]; const sel = x.selectedModel; const f = x.forecasts?.[sel] || {}; const m = x.metrics?.[sel] || {}; return `<tr><th>${h}営業日</th><td><span class="pill primary">${escapeHtml(sel || "—")}</span></td><td class="${number(f.return, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(f.return, 2)}</td><td>${tvFmt(f.price)}</td><td>${tvFmt(f.low68)}〜${tvFmt(f.high68)}</td><td>${tvFmt(f.low90)}〜${tvFmt(f.high90)}</td><td>${metricPercent(m.directionAccuracy, 1)}</td><td>${number(m.correlation)?.toFixed(2) ?? "—"}</td>${["CURRENT", "GBM", "DNN"].map((mm) => `<td class="${mm === sel ? "sel-cell" : ""}">${percent(x.forecasts?.[mm]?.return, 2)}<small>MAE ${metricPercent(x.metrics?.[mm]?.maeReturn, 2)}</small></td>`).join("")}</tr>`; }).join("")}</tbody></table></div><p class="lab-foot">検証: 拡大型の時系列分割(最後の4ブロック×100日)。採用は検証 MAE が最小のモデル。塔: ${Object.entries(ai.towerCoverage || {}).map(([k, v]) => `${escapeHtml(k)} ${metricPercent(v, 0)}`).join(" / ")}${ai.optionsTower ? " · オプション塔あり" : " · オプション塔は未使用(比較で有意な改善なし)"}</p>${ablationHtml(page.optionsAblation)}`;
}
function renderIndexOptions(page) {
  const opt = state.marketData?.options || {}; const vols = opt.volIndices || []; const chains = opt.chains || {};
  const show = ["VIX", "GSPC", "IXIC", "N225", "TPX"].includes(page.id);
  $("#indexOptionsSection").hidden = !show; if (!show) return;
  const jp = page.id === "N225" || page.id === "TPX";
  const avail = vols.filter((v) => v.available); const missing = vols.filter((v) => !v.available);
  const chainKey = page.id === "IXIC" ? "QQQ" : page.id === "GSPC" ? "SPX" : page.id === "VIX" ? "SPY" : jp ? "EWJ" : null;
  let chain = chainKey ? chains[chainKey] : null; let chainNote = "";
  if (chain?.metrics?.quality === "poor") { chainNote = `${chain.symbol} は取得時点で気配・建玉がほぼ無く(気配あり ${metricPercent(chain.metrics.quoted_share, 0)}・建玉あり ${metricPercent(chain.metrics.oi_share, 0)})、品質判定で除外。同じ指数に連動する SPY で代替表示。`; chain = chains.SPY; }
  if (jp && chain) chainNote = "日経225オプション(JPX)の建玉は未接続のため、米国上場の日本株ETF(EWJ)のオプションを参考表示。EWJ はドル建てなので IV には為替の変動も含まれる。";
  const m = chain?.metrics;
  const pick = (sym) => avail.find((v) => v.symbol === sym);
  const order = jp ? ["NKVI", "^JNIV", "^VIX", "^VIX3M", "^VVIX", "^SKEW", "^MOVE"] : ["^VIX", "^VIX9D", "^VIX3M", "^VIX6M", "^VVIX", "^SKEW", "^VXN", "^MOVE", "^OVX", "^GVZ"];
  const cardsSrc = order.map(pick).filter(Boolean);
  const volCards = cardsSrc.map((v) => `<article><span>${escapeHtml(v.label)}</span><strong>${number(v.last)?.toFixed(2)}</strong><em class="${number(v.chg5d, 0) >= 0 ? "negative-text" : "positive-text"}">5日 ${number(v.chg5d, 0) >= 0 ? "+" : ""}${number(v.chg5d)?.toFixed(2) ?? "—"}</em><small>過去1年の${metricPercent(v.pct1y, 0)}の日より高い</small></article>`).join("");
  const vix = pick("^VIX"); const us = indexPage("GSPC")?.stats;
  const vrp = vix && us ? number(vix.last) - number(us.vol20) * 100 : null;
  const v9 = pick("^VIX9D"), v3 = pick("^VIX3M"), v6 = pick("^VIX6M");
  const slope = vix && v3 ? number(vix.last) / number(v3.last) - 1 : null;
  const read = vix ? `<div class="read-box"><b>読み方</b><p>VIX ${number(vix.last).toFixed(2)} は S&P 500 の1日あたり約±${(number(vix.last) / Math.sqrt(252)).toFixed(2)}% の変動を織り込む水準。${vrp !== null ? `20日実現ボラ(${(us.vol20 * 100).toFixed(1)}%)との差は ${vrp >= 0 ? "+" : ""}${vrp.toFixed(1)}pt で、${vrp > 6 ? "保険料が割高(不安が実際の値動き以上)" : vrp < 0 ? "実際の値動きが織り込みを上回る(警戒不足)" : "平常の範囲"}。` : ""}${slope !== null ? ` 期間構造は VIX ÷ VIX3M − 1 = ${(slope * 100).toFixed(1)}% で${slope > 0 ? "<b>逆転(短期の不安が長期を上回る)</b>。過去には急落局面の最中に出やすい形" : slope < -0.15 ? "急な順イールド(先ほど高い)。目先の不安は小さく、ボラの売り手が優勢" : "緩やかな順イールド(平常)"}。` : ""}</p></div>` : "";
  const termPts = [["9日", v9], ["30日", vix], ["3か月", v3], ["6か月", v6]].filter(([, v]) => v).map(([k, v]) => [k, number(v.last)]);
  const nk = chains.N225?.metrics;
  const nkBlock = jp ? (nk ? `<div class="broker-row-head"><h3>日経225オプション(JPX 理論価格等情報・${escapeHtml(nk.asof)})</h3><small>清算値算出時のボラティリティ</small></div><dl class="broker-metrics compact">${[["ATM IV(期近 " + escapeHtml(nk.front_month) + ")", metricPercent(nk.atm_iv_front, 1)], ["ATM IV 30日(補間)", metricPercent(nk.atm_iv_30, 1)], ["10%OTM スキュー(期近)", nk.skew_front == null ? "—" : `${(nk.skew_front * 100).toFixed(1)}pt`], ["原資産終値", tvFmt(nk.spot)]].map(([a, b]) => `<div><dt>${a}</dt><dd>${b ?? "—"}</dd></div>`).join("")}</dl><canvas id="indexSmileChart" class="lab-canvas" aria-label="日経225オプションのボラティリティ・スマイル"></canvas>` : `<div class="read-box muted"><b>日経225オプション・日経平均VI</b><p>取得処理(fetch_options.py --jp)を追加済み。次回の朝の定期取得(07:10)から、日経平均VI の日足・投資部門別売買・日経225オプションの IV が入る。${(() => { const r = opt.jpFetchReport || {}; const bits = Object.entries(r).filter(([k]) => k !== "fetched_at").map(([k, v]) => `${k}: ${v.ok === false ? "失敗" : v.status || (v.ok ? "OK" : "—")}`); return bits.length ? `前回の取得: ${escapeHtml(bits.join(" / "))}` : ""; })()}</p></div>`) : "";
  const q = m ? `<span class="pill ${m.quality === "ok" ? "positive" : "negative"}">品質 ${escapeHtml(m.quality || "—")}</span> <small>ATM±10%で気配あり ${metricPercent(m.quoted_share, 0)}・建玉あり ${metricPercent(m.oi_share, 0)}</small>` : "";
  const spot = m ? number(m.spot) : null;
  const rel = (k) => (k == null || !spot ? "" : `<small> (${((k / spot - 1) * 100).toFixed(1)}%)</small>`);
  const chainBlock = m ? `<div class="broker-row-head"><h3>オプション建玉(${escapeHtml(chain.symbol)}・${escapeHtml(chain.asof)}・原資産 ${tvFmt(spot)})</h3><div>${q}</div></div>${chainNote ? `<p class="lab-foot">${escapeHtml(chainNote)}</p>` : ""}<dl class="broker-metrics compact">${[
    ["プット/コール比率(建玉)", number(m.pcr_oi)?.toFixed(2)], ["プット/コール比率(出来高)", number(m.pcr_vol)?.toFixed(2)], ["ATM IV 30日", metricPercent(m.atm_iv_30, 1)], ["ATM IV 90日", metricPercent(m.atm_iv_90, 1)],
    ["10%OTM スキュー(30日)", m.skew_10pct_30d == null ? "—" : `${(m.skew_10pct_30d * 100).toFixed(1)}pt`], [`想定変動(${escapeHtml(m.next_expiry || "直近満期")}まで)`, m.implied_move_next == null ? "—" : `±${(m.implied_move_next * 100).toFixed(2)}%`], ["マックスペイン(" + escapeHtml(m.monthly_expiry || "月次") + ")", tvFmt(m.max_pain_next) + rel(m.max_pain_next)], ["コールの壁(+20%内)", tvFmt(m.call_wall) + rel(m.call_wall)], ["プットの壁(−20%内)", tvFmt(m.put_wall) + rel(m.put_wall)],
    ["ガンマ・エクスポージャー", m.gex_total == null ? "—" : `${(m.gex_total / 1e9).toFixed(2)}十億ドル/1%`], ["ガンマ反転水準", tvFmt(m.gamma_flip) + rel(m.gamma_flip)],
  ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b ?? "—"}</dd></div>`).join("")}</dl>${optionReadHtml(m)}<canvas id="indexOiChart" class="lab-canvas" aria-label="権利行使価格別の建玉"></canvas><p class="lab-foot">緑=コール建玉・赤=プット建玉(残存60日以内・現値±20%)。点線が現値。ガンマの符号は「コールは+、プットは−」という慣行上の仮定に依存します(実際のディーラーの持ち高は非公表)。Yahoo のチェーンは米国引け後の取得で、^SPX のように気配が消える銘柄は品質判定で除外しています。</p>` : `<div class="read-box muted"><b>建玉・IV はまだ取得していません</b><p>${escapeHtml(opt.howToFetch || "")}</p></div>`;
  $("#indexOptionsNote").textContent = jp ? "日経平均VI・日経225オプション(JPX)+ 米国VIX系列 + EWJ オプション" : "VIX 期間構造・ボラ指数・米国オプションの建玉";
  $("#indexOptions").innerHTML = `<div class="broker-cards">${volCards}</div>${read}<div class="lab-grid even"><div><div class="broker-row-head"><h3>VIX の推移</h3><small>2年</small></div><canvas id="indexVixChart" class="lab-canvas" aria-label="VIXの推移"></canvas></div><div><div class="broker-row-head"><h3>VIX 期間構造</h3><small>9日・30日・3か月・6か月</small></div><canvas id="indexTermChart" class="lab-canvas" aria-label="VIX期間構造"></canvas></div></div>${nkBlock}${chainBlock}${missing.length ? `<p class="lab-foot">未取得の系列: ${missing.map((v) => escapeHtml(v.label)).join("、")}</p>` : ""}`;
  requestAnimationFrame(() => {
    const nkvi = pick("NKVI") || pick("^JNIV");
    const series = [{ name: "VIX", color: modelColors.DNN, points: vix?.series || [] }];
    if (jp && nkvi) series.push({ name: "日経VI", color: "#e0584f", points: nkvi.series });
    if (vix) drawLines($("#indexVixChart"), { height: 180, series, yFormat: (v) => v.toFixed(1), xFormat: (v) => String(v).slice(2, 7), tipFormat: (v) => String(v) });
    drawTerm($("#indexTermChart"), termPts);
    if (m && chain.profile?.strikes?.length) drawOi($("#indexOiChart"), chain.profile, chain.spot);
    if (nk?.smiles) drawSmile($("#indexSmileChart"), nk.smiles, nk.spot);
  });
}

function optionReadHtml(m) {
  if (!m || m.quality !== "ok") return "";
  const s = number(m.spot); const out = [];
  if (m.gamma_flip != null) { const d = (s / m.gamma_flip - 1) * 100; out.push(d >= 0 ? `現値はガンマ反転水準の ${d.toFixed(1)}% 上。ディーラーが「ロング・ガンマ」(上がれば売り・下がれば買いでヘッジ)とみなせる領域で、値動きは抑えられやすい。反転水準を割り込むと逆にヘッジが値動きを増幅しやすい。` : `現値はガンマ反転水準の ${Math.abs(d).toFixed(1)}% 下。ディーラーが「ショート・ガンマ」とみなせる領域で、ヘッジ売買が値動きを増幅しやすい(下落が下落を呼ぶ)。`); }
  if (m.call_wall != null && m.put_wall != null) out.push(`建玉の集中は上 ${tvFmt(m.call_wall)}(${((m.call_wall / s - 1) * 100).toFixed(1)}%)・下 ${tvFmt(m.put_wall)}(${((m.put_wall / s - 1) * 100).toFixed(1)}%)。満期が近づくほど、こうした行使価格に価格が引き寄せられる/跳ね返される傾向(ピン留め)が言われるが、確実な支持・抵抗ではない。`);
  if (m.implied_move_next != null) out.push(`直近満期(${escapeHtml(m.next_expiry)})までに市場が織り込む変動は ±${(m.implied_move_next * 100).toFixed(2)}%(ATM ストラドル価格÷原資産)。ポジションの損切り幅をこれより狭く置くと、通常の揺れで刈られやすい。`);
  if (m.pcr_oi != null) out.push(`プット/コール建玉比率 ${m.pcr_oi.toFixed(2)}。指数・ETF のオプションは機関投資家のヘッジ(プット買い)が多く、1を大きく上回るのは常態。水準より「前日からの変化」を見る(日々の取得で履歴が溜まる)。`);
  return out.length ? `<div class="read-box"><b>建玉から読めること</b>${out.map((x) => `<p>${x}</p>`).join("")}</div>` : "";
}

function drawTerm(canvas, pts) {
  if (!canvas || !canvas.clientWidth || pts.length < 2) return; const { ctx, width, height } = setupCanvas(canvas, 180); ctx.clearRect(0, 0, width, height);
  const vals = pts.map((p) => p[1]); let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * .25 || 1; lo -= pad; hi += pad;
  const left = 34, right = 14, top = 14, bottom = height - 26; const x = (i) => left + (width - left - right) * i / (pts.length - 1); const y = (v) => top + (hi - v) / (hi - lo) * (bottom - top);
  ctx.strokeStyle = css("--line"); ctx.lineWidth = 1; [lo + pad, hi - pad].forEach((v) => { ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(width - right, y(v)); ctx.stroke(); });
  ctx.strokeStyle = modelColors.DNN; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p[1])) : ctx.moveTo(x(i), y(p[1])))); ctx.stroke();
  ctx.fillStyle = css("--text"); ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "center";
  pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(x(i), y(p[1]), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillText(p[1].toFixed(2), x(i), y(p[1]) - 8); ctx.fillStyle = css("--muted"); ctx.fillText(p[0], x(i), height - 8); ctx.fillStyle = css("--text"); });
}

function drawSmile(canvas, smiles, spot) {
  if (!canvas || !canvas.clientWidth) return; const keys = Object.keys(smiles || {}); if (!keys.length) return;
  const colors = [modelColors.DNN, "#e0584f", "#26a69a"];
  drawLines(canvas, { height: 200, series: keys.map((k, i) => ({ name: `${k.slice(0, 4)}/${k.slice(4)}限月`, color: colors[i % 3], points: smiles[k].strikes.map((s, j) => [s, smiles[k].iv[j] * 100]) })), yFormat: (v) => `${v.toFixed(0)}%`, xFormat: (v) => tvFmt(v), tipFormat: (v) => `行使 ${tvFmt(v)}` });
}

function ablationHtml(ab) {
  if (!ab?.horizons) return "";
  const rows = Object.entries(ab.horizons).flatMap(([h, ms]) => Object.entries(ms).map(([mm, v]) => `<tr><th>${h}日・${escapeHtml(mm)}</th><td>${metricPercent(v.maeWithout, 2)} → ${metricPercent(v.maeWith, 2)}</td><td>${metricPercent(v.dirWithout, 0)} → ${metricPercent(v.dirWith, 0)}</td><td>${v.nwT == null ? "—" : v.nwT.toFixed(2)}</td><td><span class="pill ${v.verdict?.includes("良い") ? "positive" : v.verdict?.includes("悪い") ? "negative" : "muted"}">${v.verdict?.includes("良い") ? "改善" : v.verdict?.includes("悪い") ? "悪化" : "差なし"}</span></td></tr>`)).join("");
  return `<details class="lab-details"><summary>オプション塔(VIX期間構造・VVIX・SKEW・MOVE 等)の追加効果を検証 ― 採用せず</summary><div class="broker-table-wrap"><table class="broker-table"><thead><tr><th>期限・モデル</th><th>MAE なし→あり</th><th>方向一致</th><th>t(NW)</th><th>判定</th></tr></thead><tbody>${rows}</tbody></table></div><p class="lab-foot">同じ日付の |誤差| の差を Newey-West(ラグ=期間−1)で検定。|t|≥2 で有意。有意な改善が無いため本番の予測にはオプション塔を入れていない(未検証の塔で本番を変えない規則)。</p></details>`;
}

function flowsHtml() {
  const f = state.marketData?.flows; const w = f?.weeks || []; if (!w.length) return "";
  const last = w.at(-1); const labels = { foreigners: "海外投資家", individuals: "個人", proprietary: "自己(証券)", trust_banks: "信託銀行(年金)", investment_trusts: "投資信託", business_cos: "事業法人(自社株買い等)", life_nonlife: "生保・損保", city_regional_banks: "都銀・地銀" };
  const fmt = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("ja-JP")}`);
  const table = `<table class="broker-table"><thead><tr><th>主体(東証プライム)</th>${w.slice(-6).map((x) => `<th>${escapeHtml(x.weekEnd.slice(5))}週</th>`).join("")}</tr></thead><tbody>${Object.entries(labels).map(([k, l]) => `<tr><th>${l}</th>${w.slice(-6).map((x) => `<td class="${number(x[k], 0) >= 0 ? "positive-text" : "negative-text"}">${fmt(x[k])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return `<div class="broker-row-head"><h3>投資部門別 売買差引き(億円・週次)</h3><small>JPX 公表。最新 ${escapeHtml(last.weekEnd)} 週(公表は翌週・利用可能日 ${escapeHtml(last.availableFrom || "—")} 扱い)・${w.length}週分</small></div><div class="broker-table-wrap">${table}</div>${w.length >= 4 ? `<canvas id="indexFlowsChart" class="lab-canvas" aria-label="海外投資家と個人の累積差引き"></canvas>` : `<p class="lab-foot">履歴は次回の朝の定期取得(fetch_options.py --jp)で JPX に掲載中の全週(約1年分)が入ります。</p>`}`;
}

function drawOi(canvas, profile, spot) {
  if (!canvas || !canvas.clientWidth || !profile?.strikes?.length) return; const { ctx, width, height } = setupCanvas(canvas, 220); ctx.clearRect(0, 0, width, height);
  // 行使価格が細かすぎる(SPY は1ドル刻みで数百本)ので、表示幅に合わせて最大60本の帯に集計する
  const ks = profile.strikes; const lo = Math.min(...ks), hi = Math.max(...ks); const nb = Math.max(1, Math.min(60, ks.length)); const step = (hi - lo) / nb || 1;
  const bins = Array.from({ length: nb }, (_, i) => ({ k0: lo + step * i, c: 0, p: 0 }));
  ks.forEach((k, i) => { const j = Math.min(nb - 1, Math.floor((k - lo) / step)); bins[j].c += profile.call_oi[i]; bins[j].p += profile.put_oi[i]; });
  const left = 8, right = 8, base = height - 22; const slot = (width - left - right) / nb; const max = Math.max(...bins.map((b) => Math.max(b.c, b.p)), 1);
  bins.forEach((b, i) => { const x = left + slot * i; const hc = b.c / max * (base - 12); const hp = b.p / max * (base - 12); ctx.fillStyle = "#26a69a"; ctx.fillRect(x + 1, base - hc, Math.max(1, slot / 2 - 1), hc); ctx.fillStyle = "#ef5350"; ctx.fillRect(x + slot / 2, base - hp, Math.max(1, slot / 2 - 1), hp); });
  const xs = (k) => left + (k - lo) / (hi - lo || 1) * (width - left - right);
  ctx.strokeStyle = css("--text"); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xs(spot), 0); ctx.lineTo(xs(spot), base); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = css("--text"); ctx.font = "11px Inter, sans-serif"; ctx.textAlign = "left"; ctx.fillText(`現値 ${tvFmt(spot)}`, Math.min(xs(spot) + 4, width - 90), 12);
  ctx.fillStyle = css("--muted"); ctx.font = "10px Inter, sans-serif";
  [0, .25, .5, .75, 1].forEach((t) => { const k = lo + (hi - lo) * t; ctx.textAlign = t === 0 ? "left" : t === 1 ? "right" : "center"; ctx.fillText(tvFmt(k), xs(k), height - 6); });
}

function renderIndexBreadth(page) {
  const jp = page.id === "N225" || page.id === "TPX"; $("#indexBreadthSection").hidden = !jp; if (!jp) return;
  const b = state.marketData?.breadth || {}; const sectors = state.marketData?.sectors || []; const credit = state.marketData?.credit || [];
  const last = credit.at(-1), prev = credit.at(-3);
  const cards = `<div class="broker-cards"><article><span>値上がり / 値下がり</span><strong>${b.advancers ?? "—"} / ${b.decliners ?? "—"}</strong><em>${escapeHtml(b.date || "")}・${b.n}銘柄</em></article><article><span>25日線より上</span><strong>${metricPercent(b.above25, 0)}</strong><em>75日線 ${metricPercent(b.above75, 0)} / 200日線 ${metricPercent(b.above200, 0)}</em></article><article><span>52週高値 / 安値の更新</span><strong>${b.newHigh52 ?? "—"} / ${b.newLow52 ?? "—"}</strong><em>銘柄数</em></article><article><span>信用倍率(400銘柄合計)</span><strong>${number(last?.ratio)?.toFixed(2) ?? "—"}<small>倍</small></strong><em>2週前 ${number(prev?.ratio)?.toFixed(2) ?? "—"}倍・買残 ${last ? (last.buy / 1e8).toFixed(2) : "—"}億株</em></article></div>`;
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(number(s.chg20d, 0))), .01);
  const sec = `<div class="broker-row-head"><h3>業種別の20日騰落(中央値)</h3><small>固定400銘柄を東証33業種で集計</small></div><div class="sector-bars">${sectors.map((s) => `<div class="sector-row"><span>${escapeHtml(s.industry)}<small>${s.n}</small></span><div class="bar-track diverging"><i class="${number(s.chg20d, 0) >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(number(s.chg20d, 0)) / maxAbs * 50).toFixed(1)}%"></i></div><em class="${number(s.chg20d, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(s.chg20d, 1)}</em></div>`).join("")}</div>`;
  $("#indexBreadth").innerHTML = `${cards}<div class="lab-grid even"><div>${sec}</div><div><div class="broker-row-head"><h3>信用買残・売残(400銘柄合計)</h3><small>週次(9/28〜日次の可能性)</small></div><canvas id="indexCreditChart" class="lab-canvas" aria-label="信用残合計"></canvas></div></div>${flowsHtml()}`;
  requestAnimationFrame(() => { const w = state.marketData?.flows?.weeks || []; if (w.length >= 4) { let a = 0, b = 0, c = 0; drawLines($("#indexFlowsChart"), { height: 200, series: [{ name: "海外投資家(累積)", color: "#3f7cf0", points: w.map((x) => [x.weekEnd, (a += number(x.foreigners, 0))]) }, { name: "個人(累積)", color: "#e0584f", points: w.map((x) => [x.weekEnd, (b += number(x.individuals, 0))]) }, { name: "信託銀行(累積)", color: "#26a69a", points: w.map((x) => [x.weekEnd, (c += number(x.trust_banks, 0))]) }], yFormat: (v) => `${(v / 1e4).toFixed(1)}兆`, xFormat: (v) => String(v).slice(2, 7), tipFormat: (v) => String(v) }); } });
  requestAnimationFrame(() => drawLines($("#indexCreditChart"), { height: 220, series: [{ name: "買残(億株)", color: "#e0584f", points: credit.map((c) => [c.date, c.buy / 1e8]) }, { name: "売残(億株)", color: "#3f7cf0", points: credit.map((c) => [c.date, c.sell / 1e8]) }], yFormat: (v) => v.toFixed(1), xFormat: (v) => String(v).slice(2, 7), tipFormat: (v) => String(v) }));
}

function renderIndexCorr(page) {
  const names = Object.fromEntries((state.indexPages?.pages || []).map((p) => [p.id, p.name]));
  const keys = Object.keys(page.corr250 || {});
  $("#indexCorr").innerHTML = `<table class="broker-table"><thead><tr><th>相手</th><th>直近60日</th><th>直近1年</th></tr></thead><tbody>${keys.map((k) => { const a = number(page.corr60?.[k]), b = number(page.corr250?.[k]); const tone = (v) => v === null ? "" : `background:color-mix(in srgb, ${v >= 0 ? "var(--positive)" : "var(--negative)"} ${Math.round(Math.abs(v) * 45)}%, transparent)`; return `<tr><th>${escapeHtml(names[k] || k)}</th><td style="${tone(a)}">${a?.toFixed(2) ?? "—"}</td><td style="${tone(b)}">${b?.toFixed(2) ?? "—"}</td></tr>`; }).join("")}</tbody></table>`;
}

function renderIndexReports(page) {
  const map = { N225: ["market", "index", "flows", "options"], TPX: ["market", "index", "flows"], IXIC: ["market", "index", "options"], GSPC: ["market", "index", "options"], VIX: ["options", "risk"], TNX: ["market"], USDJPY: ["market"] };
  const types = map[page.id] || ["market"];
  const rows = (state.research?.reports || []).filter((r) => types.includes(r.type)).slice(0, 4);
  $("#indexReports").innerHTML = rows.length ? `<div class="report-mini">${rows.map((r) => `<button type="button" data-open-report="${escapeHtml(r.id)}"><span class="pill ${r.stance === "positive" ? "positive" : r.stance === "negative" ? "negative" : "muted"}">${escapeHtml(r.typeLabel)}</span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.date)}</small></button>`).join("")}</div>` : '<div class="empty-state"><p>関連レポートはまだありません。</p></div>';
  $$('#indexReports [data-open-report]').forEach((b) => b.addEventListener("click", () => openReport(b.dataset.openReport)));
}

function drawIndexDetail() { /* 2026-09-25: 指数ページのチャートは個別銘柄と同じ TradingView 型エンジン(drawStockChart)に統合 */ }
function drawSeason(page) {
  const rows = page.seasonality || []; const canvas = $("#indexSeason"); if (!canvas || !canvas.clientWidth || !rows.length) return;
  const { ctx, width, height } = setupCanvas(canvas, 220); ctx.clearRect(0, 0, width, height);
  const max = Math.max(...rows.map((r) => Math.abs(number(r.avg, 0))), .005); const base = (height - 30) / 2 + 8; const slot = width / 12; const bw = Math.min(28, slot * .6);
  ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(width, base); ctx.stroke(); ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "center";
  rows.forEach((r) => { const i = r.month - 1; const h = number(r.avg, 0) / max * (height - 40) / 2; const cx = slot * i + slot / 2; ctx.fillStyle = h >= 0 ? css("--positive") : css("--negative"); ctx.fillRect(cx - bw / 2, h >= 0 ? base - h : base, bw, Math.abs(h)); ctx.fillStyle = css("--muted"); ctx.fillText(`${r.month}月`, cx, height - 16); ctx.fillText(`勝率${Math.round(number(r.win, 0) * 100)}%`, cx, height - 4); ctx.fillStyle = css("--text"); ctx.fillText(percent(r.avg, 1), cx, h >= 0 ? base - h - 4 : base - h + 12); });
}

// ---------- リサーチ ----------
function renderResearch() {
  const reports = state.research?.reports || [];
  const types = [...new Map(reports.map((r) => [r.type, r.typeLabel])).entries()];
  $("#researchBadge").textContent = reports.length ? `${reports.length}本 · ${reports[0].date}` : "レポートなし";
  $("#researchTypes").innerHTML = [["", "すべて"], ...types].map(([t, l]) => `<button type="button" class="${state.researchType === t ? "active" : ""}" data-rtype="${escapeHtml(t)}">${escapeHtml(l)}</button>`).join("");
  $$('[data-rtype]').forEach((b) => b.addEventListener("click", () => { state.researchType = b.dataset.rtype; renderResearch(); }));
  const rows = reports.filter((r) => !state.researchType || r.type === state.researchType);
  if (!state.researchId || !rows.some((r) => r.id === state.researchId)) state.researchId = rows[0]?.id || null;
  $("#researchList").innerHTML = rows.map((r) => `<button type="button" class="report-card ${r.id === state.researchId ? "active" : ""}" data-report="${escapeHtml(r.id)}"><span class="pill ${r.stance === "positive" ? "positive" : r.stance === "negative" ? "negative" : "muted"}">${escapeHtml(r.typeLabel)}</span><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.summary)}</p><small>${escapeHtml(r.date)} · ${escapeHtml(r.author || "")}</small></button>`).join("") || '<div class="empty-state"><p>レポートはまだありません。</p></div>';
  $$('[data-report]').forEach((b) => b.addEventListener("click", () => { state.researchId = b.dataset.report; renderResearch(); if (window.innerWidth < 900) $("#researchView").scrollIntoView({ behavior: "smooth" }); }));
  const r = reports.find((x) => x.id === state.researchId);
  $("#researchView").innerHTML = r ? reportHtml(r) : '<div class="empty-state"><p>左の一覧からレポートを選んでください。</p></div>';
}

function reportHtml(r) {
  const stance = { positive: "強気寄り", negative: "弱気寄り・警戒", neutral: "中立" }[r.stance] || "";
  const para = (t) => `<p>${escapeHtml(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")}</p>`;
  return `<header class="report-head"><div><span class="pill primary">${escapeHtml(r.typeLabel)}</span>${stance ? `<span class="pill ${r.stance === "positive" ? "positive" : r.stance === "negative" ? "negative" : "muted"}">${stance}</span>` : ""}<time>${escapeHtml(r.date)}</time></div><h2>${escapeHtml(r.title)}</h2><p class="report-summary">${escapeHtml(r.summary)}</p></header>${r.metrics?.length ? `<dl class="report-metrics">${r.metrics.map((m) => `<div><dt>${escapeHtml(m.label)}</dt><dd>${escapeHtml(m.value)}</dd>${m.note ? `<small>${escapeHtml(m.note)}</small>` : ""}</div>`).join("")}</dl>` : ""}${(r.sections || []).map((s) => `<section class="report-section"><h3>${escapeHtml(s.heading)}</h3>${(s.body || []).map(para).join("")}${s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}</section>`).join("")}${r.caveats?.length ? `<aside class="report-caveats"><b>注意・限界</b><ul>${r.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul></aside>` : ""}<footer class="report-foot"><span>確度: ${escapeHtml(r.confidence || "—")}</span><span>作成: ${escapeHtml(r.author || "—")}</span><span>根拠: ${(r.sources || []).map(escapeHtml).join(" / ")}</span><span>本レポートは情報提供であり、売買の推奨ではありません。</span></footer>`;
}

function renderHomeResearch() {
  const box = $("#homeUpdates"); if (!box) return; const reports = (state.research?.reports || []).slice(0, 4);
  if (!reports.length) return;
  box.insertAdjacentHTML("beforeend", `<div class="section-title home-research-title"><div><span>最新のリサーチ</span><small>Claude が stockAI の数値から作成</small></div><button class="text-button" type="button" data-nav-inline="research">すべて ›</button></div><div class="update-list">${reports.map((r) => `<button type="button" class="update-item" data-open-report="${escapeHtml(r.id)}"><span class="pill ${r.stance === "positive" ? "positive" : r.stance === "negative" ? "negative" : "muted"}">${escapeHtml(r.typeLabel)}</span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.date)}</small></button>`).join("")}</div>`);
  box.querySelectorAll("[data-open-report]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openReport(b.dataset.openReport); }));
  box.querySelectorAll("[data-nav-inline]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); navigate(b.dataset.navInline); }));
}

function decorateIndexCards() {
  // 指数カードの遷移は renderIndices が持つ。ここでは見出しの指数チップ(押すと各指数のページへ)だけを付ける
  const heading = document.querySelector('[data-page="indices"] .page-heading');
  if (heading && !heading.querySelector(".index-quick")) heading.insertAdjacentHTML("beforeend", `<div class="index-quick">${INDEX_PAGES.map((p) => `<button type="button" class="secondary-button" data-index-quick="${p.id}">${escapeHtml(p.name)} ›</button>`).join("")}</div>`);
  $$('[data-index-quick]').forEach((b) => { if (b.dataset.bound) return; b.dataset.bound = "1"; b.addEventListener("click", () => goIndex(b.dataset.indexQuick)); });
}
function openReport(id) { state.researchId = id; state.researchType = ""; navigate("research"); renderResearch(); }

// ---------- NLP / NLG ----------
function renderNlp() {
  const body = $("#nlpBody"); if (!body) return; const tab = state.nlpTab; const nlp = state.marketData?.nlp || {};
  $$('[data-nlp]').forEach((b) => b.classList.toggle("active", b.dataset.nlp === tab));
  const newsTable = (rows) => `<div class="broker-table-wrap tall"><table class="broker-table left"><thead><tr><th>銘柄</th><th>利用可能日</th><th>見出し</th><th>分類</th><th>確信度</th><th>半減期</th></tr></thead><tbody>${rows.map((r) => `<tr><th><button type="button" class="text-button" data-go-stock="${escapeHtml(r.code)}">${escapeHtml(r.code)}</button></th><td>${escapeHtml(r.at || "")}</td><td class="wrap">${escapeHtml(r.title || "")}<small> ${escapeHtml(r.source || "")}</small></td><td>${escapeHtml(r.cat || "")}</td><td>${metricPercent(r.conf)}</td><td>${number(r.halfLife)?.toFixed(1) ?? "—"}日</td></tr>`).join("")}</tbody></table></div>`;
  if (tab === "evidence") {
    const stocks = Object.keys(state.evidence?.stocks || {}); const sel = state.nlpStock && stocks.includes(state.nlpStock) ? state.nlpStock : stocks[0];
    body.innerHTML = stocks.length ? `<div class="broker-seg wide">${stocks.map((c) => `<button type="button" data-nlp-stock="${c}" class="${c === sel ? "active" : ""}">${c} ${escapeHtml(state.data.predictions.find((p) => p.code === c)?.name || "")}</button>`).join("")}</div><p class="lab-foot">build_evidence.py が毎日生成する「最終まとめ用根拠ファイル」。自然言語での最終出力(チャットでの要約)はこれを入力にする。</p><div class="md-body" id="nlpEvidence">読み込み中…</div>` : '<div class="empty-state"><p>根拠ファイルはありません。</p></div>';
    $$('[data-nlp-stock]').forEach((b) => b.addEventListener("click", () => { state.nlpStock = b.dataset.nlpStock; renderNlp(); }));
    if (sel) fetchStockDetail(sel).then((doc) => { const box = $("#nlpEvidence"); if (box) box.innerHTML = doc?.research?.evidence ? mdToHtml(doc.research.evidence) : "<p>この銘柄の根拠はありません。</p>"; });
  }
  if (tab === "long") body.innerHTML = `<p class="lab-foot">BERT の意味アンカーで推定した「記事の効き目の長さ(半減期)」が長いニュース。国策・構造需要などが上位に来やすい。検証の結果、予測には使っていない(シャドー)。</p>${newsTable(nlp.long || [])}`;
  if (tab === "short") body.innerHTML = `<p class="lab-foot">半減期が短い(すぐ織り込まれる)と推定されたニュース。</p>${newsTable(nlp.short || [])}`;
  if (tab === "cats") { const cats = Object.entries(nlp.categories || {}).sort((a, b) => b[1] - a[1]); const total = cats.reduce((s, [, v]) => s + v, 0) || 1; body.innerHTML = `<div class="sector-bars">${cats.map(([k, v]) => `<div class="sector-row"><span>${escapeHtml(k)}</span><div class="bar-track"><i style="width:${(v / total * 100).toFixed(1)}%"></i></div><em>${v.toLocaleString("ja-JP")}件</em></div>`).join("")}</div><p class="lab-foot">方式 ${escapeHtml(nlp.meta?.version || "—")}。記事ごとの分類は個別銘柄ページの「AI・NLP」タブで確認できる。</p>`; }
  if (tab === "shadow") { const rows = nlp.earnShadowIc || []; body.innerHTML = rows.length ? `<table class="broker-table"><thead><tr><th>基準日</th><th>期限</th><th>銘柄数</th><th>価格系モデルのIC</th><th>決算込みモデルのIC</th></tr></thead><tbody>${rows.map((r) => `<tr><th>${escapeHtml(r.date)}</th><td>${escapeHtml(r.horizon)}日</td><td>${escapeHtml(r.n)}</td><td>${number(r.ic_price)?.toFixed(3) ?? "—"}</td><td>${number(r.ic_earn)?.toFixed(3) ?? "—"}</td></tr>`).join("")}</tbody></table><p class="lab-foot">決算塔を本番に入れる前の前向き検証(state/earn_shadow_ic.csv)。まだ日数が少ない。</p>` : '<div class="empty-state"><p>まだ確定したシャドー実績はありません。</p></div>'; }
  if (tab === "pack") { const p = state.researchPack || {}; body.innerHTML = `<p class="lab-foot">リサーチレポートを書くときに Claude が読む根拠データ(${escapeHtml(p.generatedAt || "")})。レポートの数値はここから引用している。</p>${Object.entries(p).filter(([k]) => !["riskByCode"].includes(k)).map(([k, v]) => `<details class="json-block"><summary>${escapeHtml(k)}</summary><pre>${escapeHtml(JSON.stringify(v, null, 1)).slice(0, 20000)}</pre></details>`).join("")}`; }
  body.querySelectorAll("[data-go-stock]").forEach((b) => b.addEventListener("click", () => goStock(b.dataset.goStock)));
}

function registerWebMcp() {
  const context = document.modelContext; if (!context?.registerTool) return;
  const controller = new AbortController(); const pages = ["home","predictions","stocks","chart","indices","index","research","guidance","comments","trades","news","models","lab","construction","experimental","data","functions"];
  Promise.resolve(context.registerTool({ name:"navigate_future_sight", title:"Future Sightの画面を開く", description:"Future Sight内の指定画面へ移動する。", inputSchema:{type:"object",properties:{page:{type:"string",enum:pages}},required:["page"],additionalProperties:false}, annotations:{readOnlyHint:true,untrustedContentHint:false}, execute({page}){ if(!pages.includes(page)) throw new Error("unknown page"); navigate(page); return {page}; } },{signal:controller.signal})).catch(()=>{});
  Promise.resolve(context.registerTool({ name:"set_future_sight_theme", title:"表示モードを変更", description:"ライト、ダーク、プロトタイプ、Earthの表示テーマを変更する。", inputSchema:{type:"object",properties:{theme:{type:"string",enum:["light","dark","prototype","earth"]}},required:["theme"],additionalProperties:false}, annotations:{readOnlyHint:false,untrustedContentHint:false}, execute({theme}){ setTheme(theme); return {theme:state.theme}; } },{signal:controller.signal})).catch(()=>{});
  Promise.resolve(context.registerTool({ name:"open_stock_chart", title:"銘柄チャートを開く", description:"証券コードを指定して銘柄チャートを表示する。", inputSchema:{type:"object",properties:{code:{type:"string",pattern:"^[0-9A-Za-z.]{3,12}$"}},required:["code"],additionalProperties:false}, annotations:{readOnlyHint:true,untrustedContentHint:false}, async execute({code}){ if(!state.data.predictions.some((row)=>row.code===code)) throw new Error("unknown code"); openStockChart(code); await loadChart(code); return {code,page:"chart"}; } },{signal:controller.signal})).catch(()=>{});
}

async function init() {
  setTheme(state.theme); bindEvents(); bindTvExtras(); bindChartsPage(); bindStockNav(); await loadTrades();
  try { await loadData(); await loadReliability(); setupPredictionFilters(); setupChartPicker(); renderHome(); renderPredictions(); renderIndustryGrid(); renderStocks(); renderNews(); renderModels(); renderIndices(); renderComments(); renderSystem(); renderHomeUpdates(); renderChangelog(); renderLab(); renderDataPage(); renderResearch(); renderNlp(); renderHomeResearch(); decorateIndexCards(); applyRoute(); registerWebMcp(); }
  catch (error) { console.error(error); $("#dataSummary").textContent = "データ読込エラー"; showToast("データを読み込めませんでした"); }
}

// ===== 2026-09-25 実験AI(不採用・停止中のモデルの出力を注意書き付きで表示) =====
// 方針: GNN・Transformer は検証で予測力が確認できず本番予測に混ぜていない。それでも「裏で何が出ているか」は
//   見られるようにする。出すときは必ず UNDER CONSTRUCTION と「対照(辺をランダムにしたもの)・コイントス」を並べ、
//   単独の数字だけが目に入らないようにする。データは dist/data/experimental.json(scripts/export_experimental.py)。
state.experimental = null; state.expPromise = null;
function loadExperimental() {
  if (!state.expPromise) {
    state.expPromise = fetch("data/experimental.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
      .then((d) => { state.experimental = d || {}; return state.experimental; });
  }
  return state.expPromise;
}
const expFx = (v, n = 3) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(n));
const expPct = (v) => (v === null || v === undefined ? "—" : `${Math.round(Number(v) * 100)}%`);
const expCls = (v) => (v > 0 ? "positive-text" : v < 0 ? "negative-text" : "");
const expTop = (v) => (v === null || v === undefined ? "—" : `上位${Math.max(1, Math.round((1 - Number(v)) * 100))}%`);

// 折れ線(SVG)。series: [{name, color, dash, points:[[x(0..1), y]]}]
function expLineSvg({ series, yMin, yMax, xLabels = [], zero = true, height = 220, yFmt = (v) => v.toFixed(2), aria = "" }) {
  const W = 760, H = height, L = 46, R = 12, T = 12, B = 26;
  const sx = (x) => L + x * (W - L - R); const sy = (y) => T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${sy(t).toFixed(1)}" y2="${sy(t).toFixed(1)}" class="exp-grid"/><text x="${L - 6}" y="${(sy(t) + 3).toFixed(1)}" class="exp-ax" text-anchor="end">${yFmt(t)}</text>`).join("");
  const z = zero && yMin < 0 && yMax > 0 ? `<line x1="${L}" x2="${W - R}" y1="${sy(0).toFixed(1)}" y2="${sy(0).toFixed(1)}" class="exp-zero"/>` : "";
  const xl = xLabels.map(([x, t]) => `<line x1="${sx(x).toFixed(1)}" x2="${sx(x).toFixed(1)}" y1="${T}" y2="${H - B}" class="exp-grid v"/><text x="${sx(x).toFixed(1)}" y="${H - 8}" class="exp-ax" text-anchor="middle">${escapeHtml(t)}</text>`).join("");
  const lines = series.map((s) => {
    const pts = s.points.filter((p) => p[1] !== null && p[1] !== undefined);
    if (!pts.length) return "";
    return `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 2}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} points="${pts.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ")}"/>`;
  }).join("");
  const legend = `<div class="exp-legend">${series.map((s) => `<span><i style="border-top:2px ${s.dash ? "dashed" : "solid"} ${s.color}"></i>${escapeHtml(s.name)}</span>`).join("")}</div>`;
  return `<svg class="exp-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(aria)}">${grid}${xl}${z}${lines}</svg>${legend}`;
}

function expGnnSection(d) {
  const g = d.gnn || {}; const s = g.summary || {}; const esc = escapeHtml;
  if (!g.available) return `<section class="panel lab-section"><div class="empty-state"><p>GNN の検証予測ファイル(output/gnn_val_predictions_walkforward.csv)がありません。</p></div></section>`;
  // ---- 日次IC(60日移動平均)
  const ser = g.icSeries || []; const n = ser.length;
  const vals = ser.flatMap((r) => [r[1], r[2]]).filter((v) => v !== null && v !== undefined);
  const m = Math.max(0.1, ...vals.map((v) => Math.abs(v))); const lim = Math.ceil(m * 20) / 20;
  const years = []; ser.forEach((r, i) => { const y = r[0].slice(0, 4); if (!years.length || years.at(-1)[1] !== y) years.push([i / Math.max(1, n - 1), y]); });
  const icChart = expLineSvg({
    series: [
      { name: "GNN(実際の取引関係グラフ)", color: "var(--primary)", points: ser.map((r, i) => [i / Math.max(1, n - 1), r[1]]) },
      { name: "対照: 辺をランダムに張り替えたGNN", color: "var(--muted)", dash: "6 4", points: ser.map((r, i) => [i / Math.max(1, n - 1), r[2]]) },
    ], yMin: -lim, yMax: lim, xLabels: years.slice(1), yFmt: (v) => v.toFixed(2), aria: "GNNの日次IC 60日移動平均",
  });
  // ---- 年別
  const by = Object.keys(s.byYearReal || {}).sort();
  const yearRows = by.map((y) => { const a = s.byYearReal?.[y], b = s.byYearShuffled?.[y]; return `<tr><th>${esc(y)}</th><td class="${expCls(a)}">${expFx(a, 3)}</td><td>${expFx(b, 3)}</td><td class="${expCls(a - b)}">${expFx(a - b, 3)}</td></tr>`; }).join("");
  // ---- フォールド
  const foldRows = (g.folds || []).map((f) => `<tr><th>${esc(f.fold)}</th><td>${esc(f.from)}〜${esc(f.to)}</td><td>${f.days}</td><td class="${expCls(f.icReal)}">${expFx(f.icReal, 3)}</td><td>${expFx(f.icShuffled, 3)}</td></tr>`).join("");
  // ---- 最後の検証日の断面
  const L = g.latest || {}; const rows = L.rows || [];
  const top = rows.slice(0, 10), bot = rows.slice(-10).reverse();
  const hitTop = top.filter((r) => r.actPct > 0.5).length, hitBot = bot.filter((r) => r.actPct < 0.5).length;
  const rowHtml = (r) => `<tr><th><button class="link-button" type="button" data-exp-go="${esc(r.code)}">${esc(r.code)}</button><small>${esc(r.name)}</small></th><td>${expTop(r.predPct)}</td><td class="${r.actPct >= 0.5 ? "positive-text" : "negative-text"}">${expTop(r.actPct)}</td><td>${expTop(r.shufPct)}</td></tr>`;
  const head = `<thead><tr><th>銘柄</th><th>GNNの予測順位</th><th>実際の順位</th><th>対照の予測順位</th></tr></thead>`;
  // ---- 注意重み
  const A = g.attention || {};
  const attn = Object.entries(A.focal || {}).map(([code, f]) => `<details class="exp-attn"><summary><b>${esc(code)}</b> ${esc(f.name)}<small>近傍${f.rows.length}件・実在する取引関係 ${f.rows.filter((r) => r.realEdge).length}件</small></summary><table class="broker-table"><thead><tr><th>近傍</th><th>注意重み</th><th>取引関係は実在するか</th></tr></thead><tbody>${f.rows.map((r) => `<tr><th>${esc(r.neighbor)}<small>${esc(r.name)}</small></th><td>${expFx(r.weight, 4)}</td><td>${r.self ? "自分自身" : r.realEdge ? '<span class="pill positive">実在</span>' : '<span class="pill negative">実在しない</span>'}</td></tr>`).join("")}</tbody></table></details>`).join("");
  // ---- 学習曲線(方向一致率)
  const H = g.history || {}; const hr = H.real || [], hs = H.shuffled || [];
  const ep = Math.max(hr.length, hs.length);
  const accVals = [...hr, ...hs].map((x) => x.valDirAcc).filter((v) => v !== null);
  const hist = ep ? expLineSvg({
    series: [
      { name: "GNN(旧版・単一分割)の検証方向一致率", color: "var(--primary)", points: hr.map((x, i) => [i / Math.max(1, ep - 1), x.valDirAcc]) },
      { name: "対照(辺ランダム)", color: "var(--muted)", dash: "6 4", points: hs.map((x, i) => [i / Math.max(1, ep - 1), x.valDirAcc]) },
      { name: "コイントス 0.5", color: "var(--warning)", dash: "2 4", width: 1.5, points: [[0, 0.5], [1, 0.5]] },
    ], yMin: Math.min(0.48, ...accVals) , yMax: Math.max(0.54, ...accVals), zero: false, height: 170, yFmt: (v) => v.toFixed(3),
    xLabels: [[0, "1"], [1, String(ep)]], aria: "GNN学習曲線",
  }) : "";

  return `
  <section class="panel lab-section exp-section">
    <div class="section-title"><div><span>GNN(グラフ注意ネットワーク)― 企業の取引関係から株価の順位を当てられるか</span><small>対象: 開示された取引関係がある ${g.stocks ?? "—"} 銘柄・${esc(g.label || "")}・検証 ${esc(g.from || "")}〜${esc(g.to || "")}(${g.days ?? "—"}日)</small></div><span class="pill negative">不採用</span></div>
    <div class="exp-verdict"><b>判定</b><p>${esc(s.verdict || "—")}</p></div>
    <div class="model-kpis">
      <article><span>日次IC 平均(GNN)</span><strong class="${expCls(g.meanIc?.real)}">${expFx(g.meanIc?.real, 4)}</strong><small>t値 ${expFx(s.real?.t, 2)}(|t|≥2 で有意)</small></article>
      <article><span>日次IC 平均(対照: 辺ランダム)</span><strong>${expFx(g.meanIc?.shuffled, 4)}</strong><small>t値 ${expFx(s.shuffled?.t, 2)}</small></article>
      <article><span>差(GNN − 対照)</span><strong class="${expCls(s.realMinusShuffled?.ic)}">${expFx(s.realMinusShuffled?.ic, 4)}</strong><small>t値 ${expFx(s.realMinusShuffled?.t, 2)}</small></article>
      <article><span>ICがプラスだった日</span><strong>${expPct(g.meanIc?.positiveDaysReal)}</strong><small>50%なら当たり外れ半々</small></article>
    </div>
    <h3 class="exp-h">日次IC の推移(${g.rollWindow || 60}営業日移動平均)</h3>
    <p class="lab-foot">0 より上なら「予測で上位にした銘柄が実際にも上位」。実線(本物の取引関係)が点線(でたらめな関係)を上回り続けていれば関係グラフが効いている証拠になるが、そうなっていない。</p>
    ${icChart}
    <div class="lab-grid even exp-grid2">
      <div><h3 class="exp-h">年別の平均IC</h3><div class="table-panel inner"><table><thead><tr><th>年</th><th>GNN</th><th>対照</th><th>差</th></tr></thead><tbody>${yearRows || '<tr><td colspan="4">—</td></tr>'}</tbody></table></div><p class="lab-foot">2026年だけプラスだが、対照(でたらめな関係)の方がさらに高い。関係グラフのおかげとは言えない。</p></div>
      <div><h3 class="exp-h">検証の区切り(フォールド)ごと</h3><div class="table-panel inner scroll-box exp-scroll"><table><thead><tr><th>#</th><th>検証期間</th><th>日数</th><th>GNN</th><th>対照</th></tr></thead><tbody>${foldRows}</tbody></table></div><p class="lab-foot">各区切りでは、その期間より前のデータだけで学習し直している(未来を見ない)。</p></div>
    </div>
    <h3 class="exp-h">最後の検証日(${esc(L.date || "—")})の予測と答え合わせ</h3>
    <p class="lab-foot">この日の断面IC ${expFx(L.ic, 3)}。予測上位10のうち実際に上位半分だったのは <b>${hitTop}/10</b>、予測下位10のうち実際に下位半分だったのは <b>${hitBot}/10</b>(でたらめでも平均5/10)。1日分だけでは良し悪しは言えないので、上の長期の推移で判断する。</p>
    <div class="lab-grid even exp-grid2">
      <div><h4 class="exp-h4">GNN が「上がりやすい」とした10銘柄</h4><div class="table-panel inner"><table class="broker-table">${head}<tbody>${top.map(rowHtml).join("")}</tbody></table></div></div>
      <div><h4 class="exp-h4">GNN が「上がりにくい」とした10銘柄</h4><div class="table-panel inner"><table class="broker-table">${head}<tbody>${bot.map(rowHtml).join("")}</tbody></table></div></div>
    </div>
    <p class="exp-caveat">⚠ これは約1か月前(${esc(L.date || "—")})時点の検証用の予測で、今日の予測ではありません。GNN は毎日の予測(stockAI の日次実行)には接続していません。</p>
  </section>

  <section class="panel lab-section exp-section">
    <div class="section-title"><div><span>GNN の「注意重み」(どの近傍企業に注目したか)</span><small>基準日 ${esc(A.asof || "—")}・${A.updatedAt ? `出力 ${esc(A.updatedAt.slice(0, 10))}` : ""}</small></div><span class="pill ${A.state === "ok" ? "positive" : "negative"}">${A.state === "ok" ? "健全性チェック合格" : "健全性チェック不合格"}</span></div>
    ${A.state === "ok" ? "" : `<div class="rel-status bad"><b>この表は意味のある重みではありません(参考として残しています)</b><ul>${(A.reasons || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul><small>近傍が「実在しない」になっているのは、辺をランダムに張り替えた対照実験の出力で上書きされていたため。重みがどれも約 1/近傍数 で横並びなのは、どの相手も区別できていないということ。本物の関係は各銘柄ページの「決算検証・関係・リスク」タブ(開示ベースの関係)を見てください。</small></div>`}
    ${attn || '<div class="empty-state"><p>注意重みのファイルがありません。</p></div>'}
  </section>

  <section class="panel lab-section exp-section">
    <div class="section-title"><div><span>GNN(旧版)の学習の様子</span><small>2026-09-22 以前の単一分割の実行。学習が空回りしていた証拠として残す</small></div><em>TRAINING</em></div>
    ${hist}
    <p class="lab-foot">方向一致率がどのエポックでもほぼ同じ値のまま動いていない = 全銘柄に同じ向きの予測を出し続けていた(検証期間に上がった銘柄の割合をなぞっていただけ)。2026-09-23 に特徴量とラベルを日次断面で標準化して直した後の結果が、上の日次IC。</p>
  </section>`;
}

function expTransformerSection(d) {
  const T = d.transformer || {}; const rec = T.record; const esc = escapeHtml;
  const runs = (T.runs || []).map((r) => `<tr><th>${esc(r.date || (r.updatedAt || "").slice(0, 10))}</th><td>${esc(r.preset || "")}・${esc(r.label || "")}</td><td>${r.days ?? "—"}</td><td>${expFx(r.icCurrent, 4)}</td><td class="${expCls(r.icTransformer - r.icCurrent)}">${expFx(r.icTransformer, 4)}</td><td>${expFx(r.tNW, 2)}</td><td><small>${esc(r.file || "")}</small></td></tr>`).join("");
  const folds = (rec?.folds || []).map((f) => `<tr><th>${f.fold}</th><td>${esc(f.from)}〜${esc(f.to)}</td><td class="${expCls(f.icCurrent)}">${expFx(f.icCurrent, 4)}</td><td class="${expCls(f.icTransformer)}">${expFx(f.icTransformer, 4)}</td><td class="${expCls(f.icTransformer - f.icCurrent)}">${expFx(f.icTransformer - f.icCurrent, 4)}</td></tr>`).join("");
  return `
  <section class="panel lab-section exp-section">
    <div class="section-title"><div><span>Transformer ― 直近20日の値動きの「並び」から順位を当てられるか</span><small>${esc(rec?.setup || "価格特徴の時系列を Self-Attention で読むモデル")}</small></div><span class="pill negative">不採用</span></div>
    ${rec ? `<div class="exp-verdict"><b>判定(${esc(rec.date)})</b><p>${esc(rec.verdict)}</p></div>
    <div class="model-kpis"><article><span>日次IC 平均(CURRENT)</span><strong>${expFx(rec.total?.icCurrent, 4)}</strong><small>${rec.total?.days ?? "—"}日</small></article><article><span>日次IC 平均(Transformer)</span><strong>${expFx(rec.total?.icTransformer, 4)}</strong><small>3seedの予測平均</small></article><article><span>差の t値</span><strong>${expFx(rec.total?.tNW, 2)}</strong><small>採用の目安 |t|≥2</small></article></div>
    <div class="table-panel inner"><table><thead><tr><th>#</th><th>検証期間</th><th>CURRENT</th><th>Transformer</th><th>差</th></tr></thead><tbody>${folds}</tbody></table></div>
    <p class="exp-caveat">⚠ つまずきやすい点: ${esc(rec.pitfall || "")}</p>
    <p class="lab-foot">出典: ${esc(rec.source || "")}。この実行は結果をファイルに保存していなかったため、記録からの転記です。銘柄ごとの予測は残っていません。</p>` : '<div class="empty-state"><p>記録がありません。</p></div>'}
    ${runs ? `<h3 class="exp-h">保存された再実行の結果</h3><div class="table-panel inner"><table><thead><tr><th>日付</th><th>設定</th><th>日数</th><th>IC CURRENT</th><th>IC Transformer</th><th>t値</th><th>ファイル</th></tr></thead><tbody>${runs}</tbody></table></div>` : `<p class="lab-foot">再実行すると(python scripts\\run_transformer_eval.py)、結果が output\\transformer_eval_*.json に保存され、ここに自動で並びます。</p>`}
  </section>`;
}

async function renderExperimental() {
  const body = $("#expBody"); if (!body) return;
  const d = await loadExperimental();
  $("#expBadge").textContent = d.generatedAt ? `更新 ${d.generatedAt.slice(0, 16).replace("T", " ")} UTC` : "データなし";
  if (d.banner) $("#expBanner").innerHTML = `<strong>UNDER CONSTRUCTION</strong><span>${escapeHtml(d.banner.replace(/^UNDER CONSTRUCTION ― /, ""))}</span>`;
  body.innerHTML = expGnnSection(d) + expTransformerSection(d);
  body.querySelectorAll("[data-exp-go]").forEach((b) => b.addEventListener("click", () => goStock(b.dataset.expGo)));
}

// 個別銘柄の「実験AI」タブ
async function renderStockExp(company) {
  const box = $("#stockExp"); if (!box || !company) return;
  const code = company.code; box.dataset.code = code;
  const d = await loadExperimental(); if (box.dataset.code !== code) return; // 読み込み中に銘柄が変わった
  const g = d.gnn || {}; const p = g.perStock?.[code]; const A = g.attention?.focal?.[code]; const esc = escapeHtml;
  const spark = p?.recent?.length ? expLineSvg({
    series: [
      { name: "GNNの予測順位(上が上位)", color: "var(--primary)", points: p.recent.map((r, i) => [i / Math.max(1, p.recent.length - 1), r[1]]) },
      { name: "実際の順位", color: "var(--warning)", dash: "5 4", points: p.recent.map((r, i) => [i / Math.max(1, p.recent.length - 1), r[2]]) },
    ], yMin: 0, yMax: 1, zero: false, height: 160, yFmt: (v) => (v === 1 ? "上位" : v === 0 ? "下位" : "中位"),
    xLabels: [[0, p.recent[0][0].slice(5)], [1, p.recent.at(-1)[0].slice(5)]], aria: "GNN予測順位と実績順位",
  }) : "";
  const gnnHtml = p ? `
    <div class="model-kpis">
      <article><span>上位半分/下位半分の当たり率</span><strong>${expPct(p.hitRate)}</strong><small>検証 ${p.days}日分</small></article>
      <article><span>対照(辺ランダム)の当たり率</span><strong>${expPct(p.hitRateShuffled)}</strong><small>でたらめな関係で学習したもの</small></article>
      <article><span>コイントス</span><strong>50%</strong><small>これを安定して超えないと意味がない</small></article>
      <article><span>最後の検証日 ${esc(p.lastDate)}</span><strong>${expTop(p.lastPredPct)}</strong><small>実際は ${expTop(p.lastActPct)}</small></article>
    </div>
    <h4 class="exp-h4">直近20検証日: 予測順位と実際の順位(${g.stocks}銘柄中の位置)</h4>${spark}
    <p class="lab-foot">⚠ 20日先を毎日予測しているので、隣り合う日の当たり外れはほぼ同じ答えを数え直している。独立な標本はおよそ ${p.days}÷20 ≈ ${Math.max(1, Math.round(p.days / 20))} 個しかなく、でたらめでも 50% ± ${Math.round(100 / Math.sqrt(Math.max(1, p.days / 20)))}% くらいはぶれる。この範囲内の差なら「当たっている」とは言えない(対照の当たり率と比べるのが公平)。</p>`
    : `<div class="empty-state"><p>この銘柄は GNN の対象外です(開示された取引関係がある ${g.stocks ?? "—"} 銘柄だけが対象)。</p></div>`;
  const attnHtml = A ? `<h4 class="exp-h4">注意重み(停止中の出力・${esc(g.attention?.asof || "")})</h4><div class="rel-status bad"><b>意味のある重みではありません</b><small>${esc((g.attention?.reasons || [])[0] || "健全性チェック不合格")}</small></div><table class="broker-table"><thead><tr><th>近傍</th><th>注意重み</th><th>取引関係</th></tr></thead><tbody>${A.rows.map((r) => `<tr><th>${esc(r.neighbor)}<small>${esc(r.name)}</small></th><td>${expFx(r.weight, 4)}</td><td>${r.self ? "自分自身" : r.realEdge ? "実在" : "実在しない"}</td></tr>`).join("")}</tbody></table>` : "";
  box.innerHTML = `<div class="uc-banner slim"><strong>UNDER CONSTRUCTION</strong><span>不採用の実験モデル(GNN・Transformer)の出力です。この銘柄の予測値・レンジには一切使っていません。</span><button type="button" class="text-button" data-nav-inline="experimental">全体の検証結果 ›</button></div>
    <div class="section-title"><div><span>GNN(企業関係グラフ)の検証予測</span><small>20営業日先VWAPの「順位」を当てるモデル。全体の判定は不採用(日次IC ${expFx(g.meanIc?.real, 3)}、対照 ${expFx(g.meanIc?.shuffled, 3)})</small></div><span class="pill negative">不採用</span></div>
    ${gnnHtml}${attnHtml}
    <div class="section-title exp-tf"><div><span>Transformer</span><small>銘柄ごとの予測は保存していません(全体の成績だけ)。CURRENT との差 t=${expFx(d.transformer?.record?.total?.tNW, 2)} で不採用</small></div><span class="pill negative">不採用</span></div>`;
  bindUcLinks(box);
}
function openStockExpTab() { goStock(state.selectedCode, "exp"); }

// ===== 2026-09-24 検証中(UNDER CONSTRUCTION) =====
const UC_LONG = new Set([126, 180, 252]);
function ucNoteHtml(h) {
  return `<strong>UNDER CONSTRUCTION</strong><span>${h}営業日予測は答え合わせ前(最初の確定は${h === 126 ? "2027年3月" : h === 180 ? "2027年5月" : "2027年9月"}ごろ)。どの模型も本番での有効性の証拠はまだなく、線形模型は外挿で極端な値を出しやすい期限です。検証用の参考値として見てください。</span><button type="button" class="text-button" data-nav-inline="construction">詳細 ›</button>`;
}
function bindUcLinks(root) { root?.querySelectorAll("[data-nav-inline]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); navigate(b.dataset.navInline); })); }
function renderForecastDetails() {
  renderForecastDetailsCore();
  const box = $("#forecastDetails"); if (!box || !UC_LONG.has(Number(state.horizon))) return;
  box.insertAdjacentHTML("afterbegin", `<div class="uc-banner slim">${ucNoteHtml(Number(state.horizon))}</div>`); bindUcLinks(box);
}
function renderPredUcNote() {
  const el = $("#predUcNote"); if (!el) return; const h = Number($("#predictionHorizon")?.value || 0);
  el.hidden = !UC_LONG.has(h); if (!el.hidden) { el.innerHTML = ucNoteHtml(h); bindUcLinks(el); }
}
let ucLoaded = null;
async function renderConstruction() {
  if (!ucLoaded) { try { const r = await fetch("data/construction.json", { cache: "no-store" }); ucLoaded = r.ok ? await r.json() : {}; } catch { ucLoaded = {}; } }
  const d = ucLoaded || {}; const esc = escapeHtml; const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);
  const fx = (v, n = 4) => (v === null || v === undefined ? "—" : Number(v).toFixed(n));
  $("#ucBadge").textContent = d.generatedAt ? `更新 ${d.generatedAt.slice(0, 16).replace("T", " ")} UTC` : "データなし";
  if (d.banner) $("#ucBanner").innerHTML = `<strong>UNDER CONSTRUCTION</strong><span>${esc(d.banner.replace(/^UNDER CONSTRUCTION ― /, ""))}</span>`;
  const stateMeta = { "answer-wait": ["答え合わせ待ち", "warning"], queued: ["検証キュー追加待ち", "warning"], shadow: ["シャドー運用", "experimental"], validating: ["検証中", "primary"], hold: ["判定保留", "warning"], accumulating: ["データ蓄積中", "muted"], "rejected-ref": ["不採用・追試中", "negative"] };
  $("#ucCards").innerHTML = (d.cards || []).map((c) => { const [lab, tone] = stateMeta[c.state] || [c.state, "muted"]; return `<article class="uc-card panel"><header><span class="pill ${tone}">${esc(lab)}</span><h3>${esc(c.title)}</h3></header><dl><div><dt>予測への使用</dt><dd>${esc(c.used)}</dd></div><div><dt>状況</dt><dd>${esc(c.detail)}</dd></div><div><dt>判定の条件</dt><dd>${esc(c.judge)}</dd></div></dl><p class="uc-caveat">⚠ ${esc(c.caveat)}</p></article>`; }).join("") || '<div class="empty-state"><p>construction.json がありません。</p></div>';
  $("#ucLong").innerHTML = (d.longHorizons?.rows || []).map((r) => `<tr class="${r.long ? "uc-row" : ""}"><th>${r.horizon}日${r.long ? ' <span class="pill warning">UC</span>' : ""}</th><td>${esc(dash(r.firstDate))}</td><td>${r.predDays}</td><td>${r.maturedDays}</td><td>${esc(Object.entries(r.adopted || {}).map(([k]) => k).join(" / ") || "—")}</td><td>${esc(dash(r.firstCheck))}</td><td>${esc(dash(r.selectReady))}</td><td>${esc(dash(r.ladderReady))}</td></tr>`).join("");
  const hs = d.horizons || [];
  $("#ucGateHead").innerHTML = `<tr><th>塔</th>${hs.map((h) => `<th class="${UC_LONG.has(h) ? "uc-col" : ""}">${h}日</th>`).join("")}</tr>`;
  $("#ucGate").innerHTML = (d.gateMatrix || []).map((r) => `<tr><th>${esc(r.label)}<small>${esc(r.tower)}</small></th>${hs.map((h) => { const c = r.cells?.[String(h)] || {}; const sym = c.CURRENT ? "●" : (c.GBM || c.DNN) ? "◐" : "○"; const tip = `CURRENT ${c.CURRENT ? "使用" : "閉"} / GBM ${c.GBM ? "使用" : "閉"} / DNN ${c.DNN ? "使用" : "閉"}`; return `<td class="uc-g ${sym === "●" ? "on" : sym === "◐" ? "shadow" : "off"}${UC_LONG.has(h) ? " uc-col" : ""}" title="${tip}">${sym}</td>`; }).join("")}</tr>`).join("");
  $("#ucEarn").innerHTML = (d.earnShadow || []).map((r) => { const diff = r.diff; return `<tr class="${UC_LONG.has(r.horizon) ? "uc-row" : ""}"><th>${r.horizon}日</th><td>${esc(dash(r.firstDate))}</td><td>${r.recordedDays}</td><td>${r.scoredDays}</td><td>${fx(r.icPrice)}</td><td>${fx(r.icEarn)}</td><td class="${diff > 0 ? "positive-text" : diff < 0 ? "negative-text" : ""}">${fx(diff)}</td><td>${Math.max(0, r.needDays - r.scoredDays)}日</td></tr>`; }).join("");
  const q = d.validation || {}; const qs = { done: ["完了", "positive"], running: ["実行中", "primary"], pending: ["待ち", "muted"], failed: ["失敗", "negative"], stalled: ["停止?", "warning"] };
  $("#ucQueueNote").textContent = q.run ? `実行 ${q.run}(logs/validation)` : "未実行";
  $("#ucQueue").innerHTML = (q.steps || []).map((s) => { const [lab, tone] = qs[s.state] || [s.state, "muted"]; return `<div class="uc-step ${s.state}"><b>${String(s.no).padStart(2, "0")}</b><span>${esc(s.name)}</span><span class="pill ${tone}">${lab}${s.minutes !== undefined ? ` ${s.minutes}分` : ""}</span></div>`; }).join("");
  const abH = [5, 20, 60, 126, 180, 252];
  $("#ucAblHead").innerHTML = `<tr><th>塔</th><th>模型</th>${abH.map((h) => `<th class="${UC_LONG.has(h) ? "uc-col" : ""}">${h}日<small>A / B / C</small></th>`).join("")}</tr>`;
  const tcell = (c) => { if (!c || c.t === null || c.t === undefined) return "—"; const v = Number(c.t); return `<span class="${Math.abs(v) >= 2 ? "uc-sig" : ""} ${v > 0 ? "positive-text" : v < 0 ? "negative-text" : ""}">${v.toFixed(2)}</span>`; };
  $("#ucAbl").innerHTML = (d.ablations || []).map((r) => `<tr class="${r.tower === "peers_shuffled" ? "uc-control" : ""}"><th>${esc(r.label)}<small>${esc(r.tower)}</small></th><td>${esc(r.model)}</td>${abH.map((h) => { const c = r.cells?.[String(h)]; return `<td class="${UC_LONG.has(h) ? "uc-col" : ""}">${c ? `${tcell(c.A)} / ${tcell(c.B)} / ${tcell(c.C)}` : "—"}</td>`; }).join("")}</tr>`).join("");
  $("#ucAcc").innerHTML = (d.accumulation || []).map((a) => { const s = a.stats || {}; return `<tr><th>${esc(a.label)}</th><td>${s.rows?.toLocaleString?.("ja-JP") ?? "—"}</td><td>${dash(s.codes)}</td><td>${esc(s.from ? `${s.from}〜${s.to}` : "—")}</td><td>${esc(s.updated ? s.updated.slice(0, 10) : "—")}</td><td class="uc-note">${esc(a.note)}</td></tr>`; }).join("");
}

// ===== 2026-09-24 参考度・判断メモ(参考AIとしての出力) =====
// 方針: 予測値を見た後に「何を確認すればよいか」を出す。事実・推定・検証・仮説・未検証を区別し、
//   データ不足やモデルの不一致があれば参考度を下げる。複数モデルの一致は信頼度の根拠にしない。
state.reliability = null;
async function loadReliability() {
  try { const r = await fetch("data/reliability.json", { cache: "no-store" }); state.reliability = r.ok ? await r.json() : null; } catch { state.reliability = null; }
}
const KIND = { fact: ["事実", "kind-fact"], est: ["推定", "kind-est"], check: ["検証", "kind-check"], hypo: ["仮説", "kind-hypo"], unver: ["未検証", "kind-unver"] };
function kindTag(k) { const [l, c] = KIND[k] || [k, ""]; return `<span class="kind-tag ${c}">${l}</span>`; }
function relFor(h, model) { return state.reliability?.backtest?.horizons?.[String(h)]?.models?.[model] || null; }
function regimeFor(h, model) {
  const bt = state.reliability?.backtest; const rg = bt?.currentRegime; if (!rg) return null;
  const R = bt?.horizons?.[String(h)]?.regimes?.[rg]; return R ? { name: rg, days: R.days, judged: R.judged, ...(R.models?.[model] || {}) } : { name: rg, days: 0, judged: false };
}
function nextEarningsGuess(code) {
  const items = (state.earnings?.[code]?.items || []).filter((x) => x.announceDate);
  const last = items.at(-1); if (!last) return null;
  const t = Date.parse(last.announceDate); if (!Number.isFinite(t)) return null;
  let next = t + 91 * 864e5; const now = Date.now(); while (next < now - 7 * 864e5) next += 91 * 864e5;
  return { last, next: new Date(next).toISOString().slice(0, 10) };
}
function judgment(company) {
  const h = Number(state.horizon); const H = String(h); const p = company?.periods?.[H]; if (!p) return null;
  const adopted = p.adopted || "CURRENT"; const vals = ["CURRENT", "GBM", "DNN"].map((m) => [m, number(p.models?.[m]?.return)]).filter(([, v]) => v !== null);
  const ret = number(p.return); const signs = new Set(vals.map(([, v]) => Math.sign(v)).filter((s) => s !== 0));
  const split = signs.size > 1; const spread = vals.length ? Math.max(...vals.map(([, v]) => v)) - Math.min(...vals.map(([, v]) => v)) : null;
  const rel = relFor(h, adopted); const rg = regimeFor(h, adopted); const uc = h >= 126;
  const close = number(company.lastClose ?? company.close);
  const width90 = close && number(p.high90) !== null && number(p.low90) !== null ? (p.high90 - p.low90) / close : null;
  const pr = p.pathRisk || null;
  const ev = state.evidence?.stocks?.[company.code]?.contrib?.[H] || [];
  const pos = ev.filter((r) => number(r.contribution, 0) > 0).slice(0, 3); const neg = ev.filter((r) => number(r.contribution, 0) < 0).slice(0, 3);
  const ne = nextEarningsGuess(company.code); const lastE = ne?.last;
  const news = (state.data.news || []).filter((n) => n.code === company.code).slice(0, 3);
  const daily = state.chartData || []; const lastBar = daily.at(-1) || {}; const vol20 = daily.slice(-21, -1).map((r) => number(r.v)).filter((v) => v !== null);
  const volAvg = vol20.length ? vol20.reduce((a, b) => a + b, 0) / vol20.length : null; const volRatio = volAvg && number(lastBar.v) !== null ? lastBar.v / volAvg : null;
  const c20 = daily.length > 21 ? daily.at(-1).c / daily.at(-21).c - 1 : null;
  // ---- 参考度: 「高」は出さない(水準は素朴予測に負けている/一致は根拠にしない)
  const reasons = [];
  if (uc) reasons.push("答え合わせ前の期限(未検証)");
  if (!rel) reasons.push("この期限・模型のバックテストが無い");
  else if ((rel.tSkill ?? 0) <= -2) reasons.push(`水準は「今の株価のまま」に負けている(スキル ${percent(rel.skill)})`);
  if (split) reasons.push("3模型で上下の向きが割れている");
  if (rg && rg.judged && number(rg.ic) !== null && rg.ic <= 0) reasons.push(`いまの地合い(${rg.name})では順位の当たりがマイナス`);
  if (rg && !rg.judged) reasons.push(`いまの地合い(${rg.name})の検証日数が不足`);
  if (!lastE) reasons.push("決算データが無い");
  const rankOk = rel && (rel.tIc ?? 0) >= 2 && !uc;
  const level = uc || !rel ? "未検証" : (split || (rg && rg.judged && rg.ic <= 0)) ? "低(追加確認が必要)" : rankOk ? "中(順位の参考として)" : "低";
  return { h, H, p, adopted, vals, ret, split, spread, rel, rg, uc, close, width90, pr, pos, neg, ne, lastE, news, volRatio, c20, reasons, level, rankOk };
}
function renderJudgment() {
  const box = $("#judgmentPanel"); if (!box) return;
  const company = state.data?.predictions?.find((r) => r.code === state.selectedCode); if (!company) { box.innerHTML = ""; return; }
  const J = judgment(company);
  const times = $("#stockTimes");
  if (times) times.innerHTML = `価格基準日 <b>${escapeHtml(company.lastDate || "—")}</b> · 予測の基準日 <b>${escapeHtml(state.data.asOf || "—")}</b>(模型の学習 ${escapeHtml(String(state.data.trainedAt || "—").slice(0, 16).replace("T", " "))} UTC) · 根拠文書 ${escapeHtml(state.evidence?.file || "—")} · サイト生成 ${escapeHtml(String(state.data.generatedAt || "—").slice(0, 16).replace("T", " "))}`;
  if (!J) { box.innerHTML = '<div class="empty-state"><p>この期限の予測はありません。</p></div>'; return; }
  const dir = J.ret === null ? "—" : J.ret > 0.002 ? "上向き" : J.ret < -0.002 ? "下向き" : "ほぼ横ばい";
  const fl = (arr) => arr.map((r) => escapeHtml(r.label || r.name)).join("・");
  const sentence = `この銘柄には${J.h}営業日で<b>${dir}</b>の予測が出ている(期間VWAP ${percent(J.ret)}・${escapeHtml(J.adopted)})。`
    + (J.pos.length ? `上向きの材料は${fl(J.pos)}。` : "") + (J.neg.length ? `下向きの材料は${fl(J.neg)}。` : "")
    + (J.split ? "ただし3模型の向きは割れている。" : "")
    + (J.rel && (J.rel.tSkill ?? 0) <= -2 ? "水準は過去の検証で「今の株価のまま」に負けているので、目標株価ではなく<b>相対的な強さ</b>として読む。" : "")
    + (J.rg ? `いまの地合い(${escapeHtml(J.rg.name)})での検証結果と、` : "") + (J.ne ? `次の決算(${escapeHtml(J.ne.next)}ごろ・推定)` : "今後の決算") + "と出来高の変化を確認して判断する。";
  const tone = J.level.startsWith("中") ? "warning" : J.level === "未検証" ? "experimental" : "negative";
  const eItem = J.lastE ? `${escapeHtml(J.lastE.announceDate)} 発表(${escapeHtml(J.lastE.period || "")}): 売上 前年同期比 ${percent(J.lastE.yoy?.sales)}・営業利益 ${percent(J.lastE.yoy?.operatingProfit)}${J.lastE.yoyBase ? `<small>比較: ${escapeHtml(J.lastE.yoyBase.period || "")}</small>` : "<small>前年同期の行なし</small>"}` : "決算データなし";
  const models = J.vals.map(([m, v]) => `<span class="${v >= 0 ? "positive-text" : "negative-text"}">${m} ${percent(v)}</span>`).join(" / ");
  const cov = state.reliability?.live?.[J.H]?.coverage; const cqr = state.reliability?.cqr?.horizons?.[J.H]?.coverage;
  const covText = cqr?.["90"]?.measured != null ? `較正期間の後半で90%区間の実測 ${metricPercent(cqr["90"].measured)}` : cov?.["90"]?.n >= 100 ? `本番の90%区間の実測 ${metricPercent(cov["90"].measured)}(${intJa(cov["90"].n)}件)` : "区間の実測包含率はまだ測れていない";
  const checks = [];
  if (J.ne) checks.push(`${kindTag("est")}次の決算は ${escapeHtml(J.ne.next)} ごろ(前回 ${escapeHtml(J.ne.last.announceDate)} から約3か月の推定)。売上・営業利益の前年同期比が前回(${percent(J.lastE?.yoy?.sales)} / ${percent(J.lastE?.yoy?.operatingProfit)})から変わるか`);
  if (J.volRatio !== null && J.volRatio >= 2) checks.push(`${kindTag("fact")}直近の出来高が20日平均の${J.volRatio.toFixed(1)}倍。開示・ニュースを先に確認`);
  if (J.split) checks.push(`${kindTag("est")}3模型の向きが割れている。どの材料で差が出ているかを「予測の中身」で確認`);
  checks.push(`${kindTag("est")}価格が90%区間(${yen(J.p.low90)}〜${yen(J.p.high90)})の外に出たら、予測の前提(過去の値動きの幅)が崩れた可能性。<b>損切りの基準ではない</b>`);
  if (J.uc) checks.push(`${kindTag("unver")}この期限は答え合わせ前。最初の確定まで判断材料にしない`);
  const bullets = (rows, sign) => rows.length ? rows.map((r) => `<li>${kindTag("est")}${escapeHtml(r.label || r.name)}<small>値 ${escapeHtml(String(r.raw ?? "—"))} · 寄与 ${signed(r.contribution, 3)}</small></li>`).join("") : `<li class="muted">${sign}の材料は見つからない</li>`;
  const against = [];
  if (J.split) against.push(`${kindTag("est")}模型の不一致: ${models}`);
  if (J.pr) against.push(`${kindTag("check")}途中安値のリスク: 過去約3年、${J.h}日保有中の最安値までの下落は中央値 ${percent(J.pr.median)}、悪い方から10%で ${percent(J.pr.q10)}`);
  if (J.width90 !== null) against.push(`${kindTag("est")}90%区間の幅は現在値の ${metricPercent(J.width90)}`);
  box.innerHTML = `<div class="judg-head"><div><p class="eyebrow">参考メモ · ${J.h}営業日</p><p class="judg-sentence">${sentence}</p></div><div class="judg-level"><span>参考度</span><span class="pill ${tone}">${escapeHtml(J.level)}</span></div></div>
  ${J.reasons.length ? `<ul class="judg-reasons">${J.reasons.map((r) => `<li>⚠ ${escapeHtml(r)}</li>`).join("")}</ul>` : ""}
  <div class="judg-grid">
    <article><h3>何が変わったか</h3><ul>
      <li>${kindTag("fact")}20日騰落 ${percent(J.c20)} · 前日比 ${percent(company.change1d)}</li>
      <li>${kindTag("fact")}${eItem}</li>
      ${J.news.map((n) => `<li>${kindTag("fact")}${escapeHtml((n.publishedAt || "").slice(0, 10))} ${escapeHtml(n.title)}<small>${kindTag("hypo")}株価への影響は未検証</small></li>`).join("")}
    </ul></article>
    <article><h3>予測と不確実性</h3><ul>
      <li>${kindTag("est")}模型・主役(${escapeHtml(J.adopted)}): 期間VWAP ${percent(J.ret)}(${yen(J.p.price)})${J.p.range ? `<small>⚠ ${escapeHtml(rangeNote(J.p))}</small>` : ""}</li>
      <li>${J.p.claude ? `${kindTag("hypo")}Claude の独自予測${J.p.claude.legacy ? "(旧方式: 模型+補正)" : ""}: 期間VWAP ${percent(J.p.claude.return)}(${yen(J.p.claude.price)})<small>${escapeHtml(J.p.claude.reason || "")}(未検証・答え合わせ中)</small>` : `${kindTag("unver")}Claude の独自予測はこの期限は未記入`}</li>
      <li>${kindTag("est")}68%区間 ${yen(J.p.low68)}〜${yen(J.p.high68)} / 90%区間 ${yen(J.p.low90)}〜${yen(J.p.high90)}</li>
      <li>${kindTag("est")}3模型: ${models || "—"}<small>一致していても同じデータで学習しているため、信頼度の根拠にはしない</small></li>
      <li>${kindTag("check")}${covText}</li>
    </ul></article>
    <article><h3>強気の材料</h3><ul>${bullets(J.pos, "上向き")}</ul><p class="judg-foot">${(() => { const m = state.evidence?.stocks?.[company.code]?.method?.[J.H]; return m ? `${escapeHtml(m.model)}(${escapeHtml(m.method)})による寄与` : "寄与は根拠ファイル(注目銘柄のみ)にある銘柄だけ"; })()}</p></article>
    <article><h3>弱気の材料・反対材料</h3><ul>${bullets(J.neg, "下向き")}${against.map((a) => `<li>${a}</li>`).join("")}</ul></article>
    <article><h3>過去の似た局面での成績</h3><ul>
      ${J.rel ? `<li>${kindTag("check")}全期間(${intJa(J.rel.days)}日): 順位IC ${signed(J.rel.ic, 3)}(t ${signed(J.rel.tIc, 1)}) · 水準スキル ${percent(J.rel.skill)} → ${escapeHtml(J.rel.verdict)}</li>` : `<li>${kindTag("unver")}この期限・模型のバックテストなし</li>`}
      ${J.rg ? (J.rg.judged ? `<li>${kindTag("check")}いまの地合い「${escapeHtml(J.rg.name)}」(${intJa(J.rg.days)}日): 順位IC ${signed(J.rg.ic, 3)} · 水準スキル ${percent(J.rg.skill)}</li>` : `<li>${kindTag("unver")}いまの地合い「${escapeHtml(J.rg.name)}」は検証日数が不足(判定しない)</li>`) : ""}
    </ul><p class="judg-foot">検証は今の選定銘柄で行っているため、過去の成績は良く見える方向に偏る</p></article>
    <article><h3>次に確認すること</h3><ul>${checks.map((c) => `<li>${c}</li>`).join("")}</ul></article>
  </div>
  <p class="judg-legend">${Object.keys(KIND).map((k) => kindTag(k)).join(" ")} 事実=原本の数値 / 推定=モデルの出力 / 検証=過去データでの成績 / 仮説=解釈 / 未検証=まだ確かめていない</p>`;
}
function renderReliability() {
  const R = state.reliability; if (!R || !$("#relRows")) return;
  const bt = R.backtest || {};
  const rows = [];
  Object.entries(bt.horizons || {}).sort((a, b) => a[0] - b[0]).forEach(([h, H]) => ["CURRENT", "GBM", "DNN"].forEach((m) => { const v = H.models?.[m]; if (!v) return;
    const tone = /勝つ/.test(v.verdict) ? "positive" : /負ける/.test(v.verdict) ? "negative" : "muted";
    rows.push(`<tr><th>${h}日</th><td>${m}</td><td>${intJa(v.days)}</td><td>${metricPercent(v.mae, 2)}</td><td>${metricPercent(v.maeNaive, 2)}</td><td class="${v.skill > 0 ? "positive-text" : "negative-text"}">${percent(v.skill)}</td><td>${signed(v.tSkill, 1)}</td><td><span class="pill ${tone}">${escapeHtml(v.verdict)}</span></td><td>${signed(v.ic, 3)}</td><td>${signed(v.tIc, 1)}</td></tr>`); }));
  $("#relRows").innerHTML = rows.join("") || `<tr><td colspan="10">${escapeHtml(bt.error || "バックテストの予測ファイルがありません")}</td></tr>`;
  $("#relFoot").textContent = `出所: output/${bt.file || "—"}(${bt.from || "—"}〜${bt.to || "—"})。126日以上はバックテストが無く未検証。${(R.notes || []).join(" ")}`;
  const regs = ["上昇", "下落", "高変動"];
  $("#relRegimeNote").textContent = `予測日のTOPIXで3区分(直近20日の実現ボラが上位3分の1=高変動、それ以外は20日騰落の符号)。いまの地合い: ${bt.currentRegime || "—"}。予測日が${R.minRegimeDays || 60}日未満の区分は判定しない`;
  $("#relRegimeHead").innerHTML = `<tr><th>期限</th><th>模型</th>${regs.map((r) => `<th>${r}<small>順位IC / 水準スキル</small></th>`).join("")}</tr>`;
  const rr = [];
  Object.entries(bt.horizons || {}).sort((a, b) => a[0] - b[0]).forEach(([h, H]) => ["CURRENT", "GBM", "DNN"].forEach((m) => {
    rr.push(`<tr><th>${h}日</th><td>${m}</td>${regs.map((r) => { const g = H.regimes?.[r]; if (!g) return "<td>—</td>"; if (!g.judged) return `<td class="muted">判定しない(${g.days}日)</td>`; const v = g.models?.[m] || {}; return `<td><span class="${v.ic > 0 ? "positive-text" : "negative-text"}">${signed(v.ic, 3)}</span> / ${percent(v.skill)}<small>${g.days}日</small></td>`; }).join("")}</tr>`); }));
  $("#relRegime").innerHTML = rr.join("");
  const cov = [];
  const hs = new Set([...Object.keys(R.cqr?.horizons || {}), ...Object.keys(R.live || {})]);
  [...hs].sort((a, b) => a - b).forEach((h) => {
    const c = R.cqr?.horizons?.[h]?.coverage; if (c && (c["68"] || c["90"])) cov.push(`<tr><th>${h}日</th><td>学習時(較正期間の後半)</td><td>${metricPercent(c["68"]?.measured)}<small>補正前 ${metricPercent(c["68"]?.raw)}</small></td><td>${metricPercent(c["90"]?.measured)}<small>補正前 ${metricPercent(c["90"]?.raw)}</small></td><td>${intJa(c["90"]?.n)}</td></tr>`);
    else if (R.cqr?.horizons?.[h]) cov.push(`<tr><th>${h}日</th><td>学習時</td><td colspan="3" class="muted">期限が較正期間に比べて長く、測れない</td></tr>`);
    const l = R.live?.[h]?.coverage; if (l) cov.push(`<tr><th>${h}日</th><td>本番の確定分</td><td>${metricPercent(l["68"]?.measured)}</td><td>${metricPercent(l["90"]?.measured)}</td><td>${intJa(l["90"]?.n)}${(l["90"]?.n || 0) < 100 ? '<small class="negative-text">件数が少ない</small>' : ""}</td></tr>`);
  });
  $("#relCov").innerHTML = cov.join("") || '<tr><td colspan="5" class="muted">まだ測れていません(次回の再学習で学習時の実測が入ります)</td></tr>';
  const u = R.universeBias;
  $("#relUniverse").innerHTML = u ? `<div class="model-kpis"><article><span>選定銘柄の平均リターン</span><strong>${percent(u.meanReturn)}</strong><small>${u.from}〜${u.to}・${intJa(u.n)}銘柄</small></article><article><span>中央値</span><strong>${percent(u.medianReturn)}</strong></article><article><span>TOPIX</span><strong>${percent(u.topixReturn)}</strong></article><article><span>TOPIXを上回った割合</span><strong>${metricPercent(u.beatTopixShare)}</strong></article></div><p class="lab-foot">平均がTOPIXを大きく上回るのは、今の時点で売買が多い(=上がって注目された)銘柄を後から選んでいるため。過去の成績、とくに「急落で買う」ような判定は、この偏りの分だけ良く見える。</p>` : '<p class="muted">計算できませんでした。</p>';
}
function bindDetailTabs() {
  $$("#detailTabs [data-detail-tab]").forEach((b) => b.addEventListener("click", () => {
    const tab = b.dataset.detailTab;
    $$("#detailTabs [data-detail-tab]").forEach((x) => x.classList.toggle("active", x === b));
    $$("[data-detail-group]").forEach((g) => { g.hidden = g.dataset.detailGroup !== tab; });
    const company = state.data?.predictions?.find((r) => r.code === state.selectedCode); if (!company) return;
    requestAnimationFrame(() => { for (const fn of [() => renderBroker(company), () => renderEarnings(company), () => renderInsights(company), () => renderStockDetails(), () => (tab === "exp" ? renderStockExp(company) : null)]) { try { fn(); } catch (e) { console.warn(e); } } });
  }));
}
bindDetailTabs();

function renderStockDetails() { renderStockDetailsCore(); try { renderJudgment(); } catch (e) { console.warn(e); } }
function renderModels() { renderModelsCore(); try { renderReliability(); } catch (e) { console.warn(e); } }


// ===================== 2026-09-25 チャートの共通化・チャート専用ページ・個別銘柄の要点カード =====================
// ・TradingView 型チャート(#tvShell)は1つだけ置き、表示中のページ(個別銘柄 / チャート専用 / 指数)へ付け替えて使う。
//   表示中の銘柄は state.sym = {type: "stock"|"index", code}。描画・凡例・ウォッチリスト・描画ツールの保存はこれを見る。
// ・予測の重ね方は株も指数も同じ: 右の「未来」の帯に 68%/90% 区間、選んだ模型の点予測(破線)、他の模型は色の点、Claude は◆。
//   外挿で極端な値(表示範囲を大きく外れる値)はチャートを縮めずに端の矢印で示す。
state.sym = { type: "stock", code: state.selectedCode };
state.watchMode = "stock";
state.stockView = "";
state.tvLoadedKey = null;
state.chartSplits = [];
const TV_PAGES = new Set(["chart", "charts", "index"]);
const STOCK_HORIZONS = [1, 3, 5, 10, 20, 60, 126, 180, 252];
const INDEX_HORIZONS = [5, 20, 60];
const TRADE_COLORS = { buy: "#2962ff", sell: "#f57c00" };
function horizonLabel(h) { return { 126: "半年(126日)", 180: "3Q(180日)", 252: "1年(252日)" }[Number(h)] || `${h}営業日`; }
function isIndexSym() { return state.sym?.type === "index"; }
function symKey() { return isIndexSym() ? `idx-${state.sym.code}` : (state.sym?.code || state.selectedCode); }
function tvHorizon() { const hs = isIndexSym() ? INDEX_HORIZONS : STOCK_HORIZONS; return hs.includes(Number(state.horizon)) ? Number(state.horizon) : 20; }
function mountTv(hostId) { const shell = $("#tvShell"); const host = $(`#${hostId}`); if (shell && host && shell.parentElement !== host) host.appendChild(shell); }
function tvQty(q) { const v = number(q, 0); return Math.abs(v) >= 1e4 ? `${(v / 1e4).toFixed(v >= 1e5 ? 0 : 1)}万` : Math.round(v).toLocaleString("ja-JP"); }
function tvMoneyShort(v) { const a = Math.abs(number(v, 0)); return a >= 1e8 ? `${(a / 1e8).toFixed(1)}億` : a >= 1e4 ? `${(a / 1e4).toFixed(a >= 1e5 ? 0 : 1)}万` : `${Math.round(a).toLocaleString("ja-JP")}円`; }
function tvRoundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); }

function tvSymInfo() {
  if (isIndexSym()) { const p = indexPage(state.sym.code) || INDEX_PAGES.find((x) => x.id === state.sym.code) || {}; return { title: `${p.name || state.sym.code} · ${p.symbol || ""}`, venue: p.kind || "指数" }; }
  const c = state.data?.predictions?.find((r) => r.code === state.sym?.code); return { title: `${state.sym?.code || ""} · ${c?.name || ""}`, venue: "東証" };
}

// 表示中の銘柄・期限・模型の予測(未来の帯に描く値)
function tvForecast() {
  const h = tvHorizon(); let model = state.selectedModel;
  if (isIndexSym()) {
    const page = indexPage(state.sym.code); const H = page?.ai?.horizons?.[String(h)]; if (!H) return null;
    const adopted = H.selectedModel; if (!["CURRENT", "GBM", "DNN"].includes(model)) model = "ADOPTED";
    const key = model === "ADOPTED" ? adopted : model; const f = H.forecasts?.[key]; if (!f) return null;
    const models = {}; ["CURRENT", "GBM", "DNN"].forEach((m) => { const x = H.forecasts?.[m]; if (x && number(x.price) !== null) models[m] = { price: x.price, return: x.return }; });
    return { h, model, key, adopted, asOf: page.ai.asOf, label: model === "ADOPTED" ? `主役 ${adopted}` : key, color: modelColors[key] || modelColors.ADOPTED, price: f.price, return: f.return, low68: f.low68, high68: f.high68, low90: f.low90, high90: f.high90, models, claude: null, uc: false, fallback: ["CLAUDE", "NLG"].includes(state.selectedModel) ? "指数は模型のみ(主役を表示)" : "" };
  }
  const company = state.data?.predictions?.find((r) => r.code === state.sym?.code); const pred = company?.periods?.[String(h)]; if (!pred) return null;
  let fallback = "";
  if (model === "NLG") model = "ADOPTED";
  if (model === "CLAUDE" && !pred.claude) { model = "ADOPTED"; fallback = "Claude はこの期限が未記入(主役を表示)"; }
  let price = pred.price, ret = pred.return, key = pred.adopted, clipped = pred.range;
  if (["CURRENT", "GBM", "DNN"].includes(model)) { const m = pred.models?.[model] || {}; price = m.price; ret = m.return; key = model; clipped = m.range; }
  if (model === "CLAUDE") { price = pred.claude.price; ret = pred.claude.return; key = "CLAUDE"; clipped = null; }
  const models = {}; ["CURRENT", "GBM", "DNN"].forEach((m) => { const x = pred.models?.[m]; if (x && number(x.price) !== null) models[m] = { price: x.price, return: x.return, clipped: !!x.range }; });
  const claude = pred.claude && number(pred.claude.price) !== null ? pred.claude : null;
  const cb = model === "CLAUDE" && number(claude?.low68) !== null && number(claude?.high68) !== null;
  return { h, model, key, adopted: pred.adopted, asOf: String(state.data?.asOf || "").slice(0, 10), label: model === "ADOPTED" ? `主役 ${pred.adopted}` : model === "CLAUDE" ? "Claude" : model, color: model === "CLAUDE" ? modelColors.CLAUDE : (modelColors[key] || modelColors.ADOPTED), price, return: ret, low68: cb ? claude.low68 : pred.low68, high68: cb ? claude.high68 : pred.high68, low90: pred.low90, high90: pred.high90, models, claude, uc: UC_LONG.has(h), clipped, fallback };
}

function drawFutureZone(ctx, o) {
  const { fc, g, y, top, bottom, futureW, rows, last, lo, hi, text } = o;
  const fx0 = g.plotW + 2; const fx1 = g.plotW + futureW - 6;
  const cy = (v) => Math.max(top + 6, Math.min(bottom - 6, y(v)));
  ctx.fillStyle = tvColor("--tv-future", "rgba(120,123,134,.06)"); ctx.fillRect(g.plotW, top, futureW, bottom - top);
  const band = (a, b, token, fb) => { const A = number(a), B = number(b); if (A === null || B === null) return; ctx.fillStyle = tvColor(token, fb); ctx.fillRect(fx0, cy(B), fx1 - fx0, cy(A) - cy(B)); };
  band(fc.low90, fc.high90, "--tv-band90", "rgba(41,98,255,.10)"); band(fc.low68, fc.high68, "--tv-band68", "rgba(41,98,255,.20)");
  const marker = (x, price, color, shape) => {
    const v = number(price); if (v === null) return;
    ctx.fillStyle = color; ctx.strokeStyle = color;
    if (v < lo || v > hi) {       // 表示範囲の外(外挿など)は端に矢印
      const py = v < lo ? bottom - 4 : top + 4; const d = v < lo ? -1 : 1;
      ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x - 5, py + d * 8); ctx.lineTo(x + 5, py + d * 8); ctx.closePath(); ctx.fill(); return;
    }
    const py = y(v); ctx.beginPath();
    if (shape === "diamond") { ctx.moveTo(x, py - 5); ctx.lineTo(x + 5, py); ctx.lineTo(x, py + 5); ctx.lineTo(x - 5, py); ctx.closePath(); ctx.fill(); }
    else { ctx.arc(x, py, 3.2, 0, Math.PI * 2); ctx.fill(); }
  };
  const slots = { CURRENT: .30, GBM: .48, DNN: .66 };
  Object.entries(fc.models || {}).forEach(([m, v]) => { if (m === fc.key && fc.model !== "CLAUDE") return; ctx.globalAlpha = .9; marker(fx0 + (fx1 - fx0) * slots[m], v.price, modelColors[m]); ctx.globalAlpha = 1; });
  if (fc.claude && fc.model !== "CLAUDE") marker(fx0 + (fx1 - fx0) * .84, fc.claude.price, modelColors.CLAUDE, "diamond");
  const px = fx1 - 3;
  // 予測は基準日の終値から出したもの。価格の方が新しい(基準日より後の足がある)ときは、基準日の足から線を引いて印を付ける
  let bi = rows.length - 1;
  if (fc.asOf) { for (let k = rows.length - 1; k >= 0; k--) { if ((rows[k].end || rows[k].d) <= fc.asOf) { bi = k; break; } } }
  const bx = g.x(bi), by = y(bi === rows.length - 1 ? last.c : rows[bi].c);
  ctx.strokeStyle = fc.color; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px, cy(fc.price)); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
  if (bi < rows.length - 1) { ctx.fillStyle = fc.color; ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill(); ctx.font = "10px -apple-system, 'Segoe UI', sans-serif"; ctx.textAlign = "right"; ctx.fillText(`予測の基準 ${fc.asOf.slice(5).replace("-", "/")}`, Math.max(60, bx - 6), by - 8); ctx.textAlign = "left"; }
  marker(px, fc.price, fc.color, fc.model === "CLAUDE" ? "diamond" : null);
  ctx.fillStyle = text; ctx.font = "10px -apple-system, 'Segoe UI', Inter, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`${horizonLabel(fc.h)}先まで`, (fx0 + fx1) / 2, top + 12);
  if (fc.uc) { ctx.fillStyle = tvColor("--warning", "#d49a1f"); ctx.fillText("⚠検証中", (fx0 + fx1) / 2, top + 25); }
  if (fc.clipped?.clipped) { ctx.fillStyle = tvColor("--warning", "#d49a1f"); ctx.fillText("⚠外挿", (fx0 + fx1) / 2, bottom - 8); }
  ctx.textAlign = "left";
  tvAxisLabel(ctx, g.plotW + futureW, cy(fc.price), tvFmt(fc.price), fc.color, "#fff");
}

// 過去の予測: その日に出した h 日先の予測を「期限の日」に置き、実際の h 日平均と並べる(日足のみ)
function tvPastPoints(rows, view, fc) {
  if (!fc) return null;
  const h = fc.h; const key = fc.model === "ADOPTED" ? "ADOPTED" : fc.model === "CLAUDE" ? "CLAUDE" : fc.key;
  const ma = movingAverage(rows, h); const pts = []; const errs = [];
  for (let i = Math.max(0, view.start - h); i <= view.end; i++) {
    const p = rows[i]?.p?.[String(h)]?.[key]; const price = number(p?.price); if (price === null) continue;
    const j = i + h; if (j > rows.length - 1) continue;
    if (Number.isFinite(ma[j]) && ma[j] > 0) errs.push(Math.abs(price / ma[j] - 1));
    if (j < view.start || j > view.end) continue;
    pts.push({ i, j, price });
  }
  return { h, key, label: fc.label, pts, ma, mae: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null };
}
function drawPastPredictions(ctx, past, view, g, y, fc) {
  const color = fc?.color || modelColors.ADOPTED;
  ctx.save(); ctx.globalAlpha = .55; tvLine(ctx, past.ma, view, g.x, y, color, 1.2); ctx.restore();
  if (!past.pts.length) return;
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]); ctx.beginPath();
  past.pts.forEach((p, k) => { const px = g.x(p.j), py = y(p.price); if (!k) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke(); ctx.setLineDash([]);
  if (g.slot >= 3) past.pts.forEach((p) => { ctx.beginPath(); ctx.arc(g.x(p.j), y(p.price), 1.8, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
}

// ---- 売買履歴(取引分析で読み込んだ CSV。端末内のみ) ----
function tradeSplitFactor(date) { let f = 1; (state.chartSplits || []).forEach(([d, r]) => { const x = number(r); if (d > date && x && x > 0) f *= x; }); return f; }
function chartTrades() {
  if (isIndexSym()) return [];
  const code = state.sym?.code || state.selectedCode;
  return (state.trades || []).filter((t) => t.code === code && (t.currency || "JPY") !== "USD").map((t) => {
    const f = tradeSplitFactor(t.date);
    return { ...t, price: t.price / f, qty: t.qty * f, costPrice: Number.isFinite(t.costPrice) && t.costPrice > 0 ? t.costPrice / f : t.costPrice, rawPrice: t.price, rawQty: t.qty, splitFactor: f };
  });
}
function tradeBarIndex(rows) {
  const starts = rows.map((r) => r.start || r.d); const ends = rows.map((r) => r.end || r.d);
  return (date) => { let a = 0, b = rows.length - 1, ans = -1; while (a <= b) { const m = (a + b) >> 1; if (starts[m] <= date) { ans = m; a = m + 1; } else b = m - 1; } return ans >= 0 && date <= ends[ans] ? ans : -1; };
}
function openPosition(trades) {
  const lots = [];
  trades.filter((t) => !t.realizedOnly).sort((a, b) => a.date.localeCompare(b.date) || number(a.sourceOrder, 0) - number(b.sourceOrder, 0)).forEach((t) => {
    if (t.side === "buy") lots.push({ price: t.price, qty: t.qty, date: t.date });
    else { let q = t.qty; while (q > 1e-9 && lots.length) { const lot = lots[0]; const m = Math.min(q, lot.qty); lot.qty -= m; q -= m; if (lot.qty <= 1e-9) lots.shift(); } }
  });
  const qty = lots.reduce((s, l) => s + l.qty, 0); if (qty <= 1e-9) return null;
  return { qty, avg: lots.reduce((s, l) => s + l.price * l.qty, 0) / qty, since: lots[0]?.date };
}

// ---- 期限・模型の切り替え(チャート上部) ----
function syncTvControls() {
  const hs = $("#tvHorizon"), ms = $("#tvModel"); if (!hs || !ms) return;
  const list = isIndexSym() ? INDEX_HORIZONS : STOCK_HORIZONS; const h = tvHorizon();
  hs.innerHTML = list.map((x) => `<option value="${x}" ${x === h ? "selected" : ""}>${horizonLabel(x)}${UC_LONG.has(x) ? " ⚠" : ""}</option>`).join("");
  const models = isIndexSym() ? [["ADOPTED", "主役(採用)"], ["CURRENT", "CURRENT"], ["GBM", "GBM"], ["DNN", "DNN"]] : [["ADOPTED", "模型・主役(採用)"], ["CURRENT", "CURRENT"], ["GBM", "GBM"], ["DNN", "DNN"], ["CLAUDE", "Claude(未検証)"]];
  const cur = models.some(([v]) => v === state.selectedModel) ? state.selectedModel : "ADOPTED";
  ms.innerHTML = models.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("");
  $$("#forecastTabs button").forEach((b) => b.classList.toggle("active", Number(b.dataset.horizon) === Number(state.horizon)));
  const tc = $("#toggleTrades")?.closest(".tv-chip"); if (tc) tc.style.display = isIndexSym() ? "none" : "";
  if ($("#forecastModel") && [...$("#forecastModel").options].some((o) => o.value === state.selectedModel)) $("#forecastModel").value = state.selectedModel;
}
function bindTvExtras() {
  $("#tvHorizon")?.addEventListener("change", (e) => {
    state.horizon = Number(e.target.value); syncTvControls();
    if (state.page === "chart") { renderForecastDetails(); renderStockDetails(); renderStockCards(state.data.predictions.find((r) => r.code === state.selectedCode)); }
    if (state.page === "index") { const p = indexPage(state.indexId); if (p) renderIndexForecast(p); }
    renderSymbolCard(); drawStockChart(); drawIndicatorChart();
  });
  $("#tvModel")?.addEventListener("change", (e) => {
    state.selectedModel = e.target.value; syncTvControls();
    if (state.page === "chart") { renderForecastDetails(); renderStockDetails(); }
    if (state.page === "index") { const p = indexPage(state.indexId); if (p) renderIndexForecast(p); }
    drawStockChart(); drawIndicatorChart();
  });
  $("#togglePast")?.addEventListener("change", drawStockChart);
  $$("[data-watch-mode]").forEach((b) => b.addEventListener("click", () => { state.watchMode = b.dataset.watchMode; renderWatchlist(); }));
  $("#openChartsPage")?.addEventListener("click", () => goChart({ type: "stock", code: state.selectedCode }));
  $("#indexOpenCharts")?.addEventListener("click", () => goChart({ type: "index", code: state.indexId || "N225" }));
}

// ---- 指数の日足を TradingView 型エンジンの行にする(時系列検証の予測を p に付ける) ----
function indexChartRows(page) {
  const rows = indexRows(page); const hist = page?.ai?.history || {};
  const byDate = new Map(rows.map((r) => [r.d, r]));
  Object.entries(hist).forEach(([h, models]) => {
    const sel = page.ai.horizons?.[h]?.selectedModel;
    Object.entries(models || {}).forEach(([m, list]) => (list || []).forEach(([d, pred, actual]) => {
      const r = byDate.get(d); if (!r || number(pred) === null) return;
      r.p = r.p || {}; r.p[h] = r.p[h] || {};
      const v = { return: pred, price: r.c * (1 + pred), actual };
      r.p[h][m] = v; if (m === sel) r.p[h].ADOPTED = { ...v, model: m };
    }));
  });
  return rows;
}

// ---- チャート専用ページ ----
function watchOrder(type) {
  if (type === "index") return (state.indexPages?.pages || []).slice();
  const sort = $("#watchSort")?.value || "rank"; const rows = [...(state.data?.predictions || [])];
  if (sort === "rank") rows.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
  if (sort === "change") rows.sort((a, b) => (number(b.change1d, -9) - number(a.change1d, -9)));
  if (sort === "ai") rows.sort((a, b) => (number(b.periods?.["20"]?.return, -9) - number(a.periods?.["20"]?.return, -9)));
  return rows;
}
async function loadChartsPage() {
  const sym = state.chartsSym || { type: "stock", code: state.selectedCode };
  const key = sym.type === "index" ? `idx-${sym.code}` : sym.code;
  if (state.tv && symKey() !== key) { state.tv.count = null; state.tv.offset = 0; state.tv.hover = null; state.tv.pending = null; }
  state.sym = { ...sym }; state.watchMode = sym.type;
  if (sym.type === "stock") state.selectedCode = sym.code; else state.indexId = sym.code;
  renderChartsHeader();
  if (state.tvLoadedKey !== key) {
    let rows = [];
    if (sym.type === "index") { rows = indexChartRows(indexPage(sym.code)); state.chartWeekly = []; state.chartSplits = []; }
    else { try { rows = await fetchChartPoints(sym.code); } catch { rows = []; } }
    if (state.page !== "charts" || symKey() !== key) return;
    state.chartData = rows; state.tvLoadedKey = key;
  }
  if (state.page !== "charts") return;
  renderChartsHeader(); syncTvControls(); renderWatchlist(); renderSymbolCard(); renderCommentTimeline();
  drawStockChart(); drawIndicatorChart();
}
function renderChartsHeader() {
  const sym = state.sym; const rows = state.tvLoadedKey === symKey() ? (state.chartData || []) : []; const last = rows.at(-1) || {}; const prev = rows.at(-2) || {};
  const chg = last.c != null && prev.c != null ? last.c - prev.c : null; const pct = chg != null ? last.c / prev.c - 1 : null;
  if (sym.type === "index") {
    const p = indexPage(sym.code) || INDEX_PAGES.find((x) => x.id === sym.code) || {};
    $("#chartsKind").textContent = `CHART · ${p.kind || "指数"} · ${p.symbol || ""}`; $("#chartsTitle").textContent = p.name || sym.code;
    $("#chartsSub").textContent = p.ai ? `指数専用モデルの予測(CURRENT / GBM / DNN)を重ねて表示 · 予測の基準日 ${p.ai.asOf || "—"}` : "この指数に専用の予測モデルはありません(市場の特徴量としてのみ使用)";
    $("#chartsOpenPage").textContent = "指数ページ ›";
  } else {
    const c = state.data?.predictions?.find((r) => r.code === sym.code) || {};
    $("#chartsKind").textContent = `CHART · ${c.market || ""} · ${c.industry || ""}`; $("#chartsTitle").textContent = `${c.name || sym.code}`;
    $("#chartsSub").innerHTML = `<span class="code-pill">${escapeHtml(sym.code)}</span> 売買代金 #${c.rank ?? "—"} · 予測の基準日 ${escapeHtml(state.data?.asOf || "—")}`;
    $("#chartsOpenPage").textContent = "銘柄ページ ›";
  }
  $("#chartsPrice").innerHTML = last.c == null ? "" : `<strong>${tvFmt(last.c)}</strong><span class="${chg == null ? "" : chg >= 0 ? "positive-text" : "negative-text"}">${chg == null ? "—" : `${chg >= 0 ? "+" : ""}${tvFmt(chg)} (${percent(pct, 2)})`}</span><small>${escapeHtml(last.d || "")}</small>`;
}
function stepChartsSymbol(dir) {
  const sym = state.sym; const list = watchOrder(sym.type).map((x) => (sym.type === "index" ? x.id : x.code));
  const i = list.indexOf(sym.code); if (!list.length) return;
  const next = list[(Math.max(0, i) + dir + list.length) % list.length]; goChart({ type: sym.type, code: next });
}
function bindChartsPage() {
  $("#chartsPrev")?.addEventListener("click", () => stepChartsSymbol(-1));
  $("#chartsNext")?.addEventListener("click", () => stepChartsSymbol(1));
  $("#chartsOpenPage")?.addEventListener("click", () => { if (isIndexSym()) goIndex(state.sym.code); else goStock(state.sym.code); });
  const input = $("#chartsSearch"), box = $("#chartsResults"); if (!input || !box) return;
  let items = [], active = 0;
  const render = () => {
    items = symbolCandidates(input.value); active = Math.min(active, Math.max(0, items.length - 1));
    box.innerHTML = items.length ? items.map((item, i) => `<button type="button" role="option" class="symbol-option ${i === active ? "active" : ""}" data-cs="${i}"><span class="symbol-type ${item.type}">${item.type === "index" ? "指数" : "株"}</span><b>${escapeHtml(item.code)}</b><span class="symbol-name">${escapeHtml(item.name)}<small>${escapeHtml(item.sub || "")}</small></span>${item.type === "stock" ? `<em class="${number(item.change, 0) >= 0 ? "positive-text" : "negative-text"}">${tvFmt(item.price)} ${percent(item.change, 2)}</em>` : "<em>チャート</em>"}</button>`).join("") : '<div class="symbol-empty">該当する銘柄・指数がありません</div>';
    box.hidden = false;
    box.querySelectorAll("[data-cs]").forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); choose(Number(b.dataset.cs)); }));
  };
  const choose = (i) => { const item = items[i]; if (!item) return; input.value = ""; input.blur(); box.hidden = true; goChart({ type: item.type === "index" ? "index" : "stock", code: item.type === "index" ? item.id : item.code }); };
  input.addEventListener("focus", () => { active = 0; render(); });
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % Math.max(items.length, 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % Math.max(items.length, 1); render(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { box.hidden = true; input.blur(); }
  });
  document.addEventListener("keydown", (e) => {
    if (state.page !== "charts" || e.target.closest?.("input, select, textarea")) return;
    if (e.key === "ArrowRight" && e.altKey) { e.preventDefault(); stepChartsSymbol(1); }
    if (e.key === "ArrowLeft" && e.altKey) { e.preventDefault(); stepChartsSymbol(-1); }
  });
}

// ---- 個別銘柄ページ: 要点カード(概要) と 詳しいページ ----
// 以前は「企業情報・ニュース / 決算検証・関係・リスク / 予測の中身」のタブ切り替えだったが分かりにくかったので、
// ホームと同じく要点をカードで並べ、押すとその項目の詳しいページ(#stock-コード/項目)へ移る形にした。
const STOCK_VIEWS = {
  forecast: ["AI予測", "予測値・区間・模型の比較"], memo: ["参考メモ", "判断材料と確認すること"], company: ["企業情報", "業績・財務・指標・信用残・配当・有報"],
  earnings: ["決算検証", "決算ごとの数値と発表後の値動き"], news: ["ニュース", "関連ニュース"], relations: ["企業関係", "セクター・取引関係"],
  risk: ["リスク・株数", "途中安値の実績と許容損失"], model: ["予測の中身", "寄与の大きい特徴量・有報データ"], exp: ["実験AI ⚠", "不採用の GNN・Transformer"],
};
const STOCK_VIEW_ALIAS = { valuation: ["company", "valuation"], credit: ["company", "credit"], perf: ["company", "perf"], dividend: ["company", "dividend"] };
function applyStockView() {
  const view = STOCK_VIEWS[state.stockView] ? state.stockView : "";
  const overview = $("#stockOverview"), detail = $("#stockDetail"), crumbs = $("#stockCrumbs"); if (!overview || !detail) return;
  overview.hidden = !!view; detail.hidden = !view;
  $$("[data-stock-view]").forEach((el) => { el.hidden = el.dataset.stockView !== view; });
  if (crumbs) {
    crumbs.hidden = !view;
    crumbs.innerHTML = view ? `<button type="button" class="crumb-back" data-stock-go="">‹ 概要とチャート</button><div class="crumb-chips">${Object.entries(STOCK_VIEWS).map(([k, [label]]) => `<button type="button" class="${k === view ? "active" : ""} ${k === "exp" ? "uc" : ""}" data-stock-go="${k}">${escapeHtml(label)}</button>`).join("")}</div>` : "";
  }
  const company = state.data?.predictions?.find((r) => r.code === state.selectedCode);
  if (!view) { requestAnimationFrame(() => { drawStockChart(); drawIndicatorChart(); if (company) renderStockCards(company); }); return; }   // 隠れている間は描けないので、概要に戻ったら描き直す
  if (!company) return;
  requestAnimationFrame(() => {
    const run = (fn) => { try { fn(); } catch (e) { console.warn(e); } };
    if (view === "forecast") run(() => renderForecastDetails());
    if (view === "company") run(() => renderBroker(company));
    if (view === "earnings") run(() => renderEarnings(company));
    if (view === "relations") run(() => { renderRelations(company); renderInsights(company); });
    if (view === "model") run(() => renderInsights(company));
    if (view === "risk") run(() => renderOptimizer(company));
    if (view === "memo") run(() => renderJudgment());
    if (view === "exp") run(() => renderStockExp(company));
  });
}
function bindStockNav() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-stock-go]"); if (!b) return;
    if (b.dataset.brokerTab) state.brokerTab = b.dataset.brokerTab;
    if (b.dataset.stockGo === "charts") { goChart({ type: "stock", code: state.selectedCode }); return; }
    if (b.dataset.stockGo === "trades") { navigate("trades"); return; }
    goStock(state.selectedCode, b.dataset.stockGo);
  });
  document.addEventListener("keydown", (e) => { if (e.key !== "Enter") return; const card = e.target.closest?.(".stock-card-grid [data-stock-go]"); if (card) card.click(); });
}
function svgBars(values, opts = {}) {
  const vals = values.map(number); const ok = vals.filter((v) => v !== null); if (!ok.length) return "";
  const W = 300, H = 90, max = Math.max(...ok, 0), min = Math.min(...ok, 0), span = max - min || 1; const slot = W / vals.length; const bw = Math.min(34, slot * .58);
  const y = (v) => 8 + (max - v) / span * (H - 16);
  const bars = vals.map((v, i) => v === null ? "" : `<rect x="${(slot * i + (slot - bw) / 2).toFixed(1)}" y="${Math.min(y(v), y(0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y(v) - y(0))).toFixed(1)}" rx="3" class="${v < 0 ? "neg" : ""}"/>`).join("");
  let line = "";
  if (opts.line) { const lv = opts.line.map(number); const lok = lv.filter((v) => v !== null); if (lok.length > 1) { const lmax = Math.max(...lok), lmin = Math.min(...lok), ls = lmax - lmin || 1; const ly = (v) => 10 + (lmax - v) / ls * (H - 24); line = `<path d="${lv.map((v, i) => v === null ? "" : `${i && lv[i - 1] !== null ? "L" : "M"}${(slot * i + slot / 2).toFixed(1)} ${ly(v).toFixed(1)}`).join(" ")}"/>`; } }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="card-svg">${bars}${line}</svg>`;
}
function svgSpark(values, cls = "") {
  const v = values.map(number).filter((x) => x !== null); if (v.length < 2) return "";
  const W = 300, H = 60, max = Math.max(...v), min = Math.min(...v), s = max - min || 1;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="card-spark ${cls}"><path d="${v.map((x, i) => `${i ? "L" : "M"}${(i / (v.length - 1) * W).toFixed(1)} ${(6 + (max - x) / s * (H - 12)).toFixed(1)}`).join(" ")}"/></svg>`;
}
function renderStockCards(company) {
  const box = $("#stockCards"); if (!box || !company) return;
  const code = company.code; const H = String(state.horizon); const p = company.periods || {};
  const card = (view, icon, title, sub, body, extra = "") => `<article class="feature-card span-4 clickable stock-card-x ${extra}" data-stock-go="${view}" tabindex="0" role="link"><header><div><span class="card-icon">${icon}</span><h3>${title}</h3><p>${sub}</p></div><button type="button" aria-label="${escapeHtml(title)}の詳しいページへ" tabindex="-1">›</button></header>${body}</article>`;
  // 1) AI予測
  const hs = [5, 20, 60, 126, 252].filter((h) => p[String(h)]);
  const cur = p[H] || p["20"];
  const fcRows = hs.map((h) => { const x = p[String(h)]; const cl = x.claude; return `<div class="kv-row ${String(h) === H ? "on" : ""}"><span>${escapeHtml(horizonLabel(h))}${UC_LONG.has(h) ? " ⚠" : ""}</span><b class="${number(x.return, 0) >= 0 ? "positive-text" : "negative-text"}" title="${escapeHtml(x.range ? rangeNote(x) : outsideBand(x, x.price) ? "点予測が同じ期限の90%区間の外(模型の食い違いが大きい)" : "")}">${percent(x.return)}${x.range || outsideBand(x, x.price) ? " ⚠" : ""}</b><small>${escapeHtml(x.adopted || "")}</small><em class="${cl ? (cl.return >= 0 ? "positive-text" : "negative-text") : "muted"}">${cl ? `Claude ${percent(cl.return)}` : "Claude —"}</em></div>`; }).join("");
  const flag = cur && (cur.range || outsideBand(cur, cur.price)) ? `<p class="card-warn">⚠ ${cur.range ? "模型の出力が範囲外(外挿)" : "点予測が90%区間の外"}。詳しいページで3模型を確認</p>` : "";
  const c1 = card("forecast", "↗", "AI予測", `模型(主役)と Claude を並べて表示 · ${escapeHtml(state.data.asOf || "")}基準`, `<div class="card-big"><strong>${yen(cur?.price)}</strong><span>${escapeHtml(horizonLabel(Number(p[H] ? H : 20)))}の予測VWAP · 68% ${yen(cur?.low68)}〜${yen(cur?.high68)}</span></div><div class="kv-list">${fcRows}</div>${flag}${hs.some((h) => p[String(h)].range || outsideBand(p[String(h)], p[String(h)].price)) ? '<p class="card-foot">⚠ = 模型の出力が範囲外(外挿)か、点予測が90%区間の外</p>' : ""}`);
  // 2) 参考メモ
  let J = null; try { J = judgment(company); } catch { J = null; }
  const tone = J?.level?.startsWith("中") ? "warning" : J?.level === "未検証" ? "experimental" : "negative";
  const c2 = card("memo", "✎", "参考メモ", "判断材料・反対材料・次に確認すること", J ? `<div class="card-level"><span>参考度</span><span class="pill ${tone}">${escapeHtml(J.level)}</span></div><ul class="card-bullets">${J.reasons.slice(0, 3).map((r) => `<li>⚠ ${escapeHtml(r)}</li>`).join("") || "<li>大きな注意点はありません</li>"}</ul>${J.ne ? `<p class="card-foot">次の決算 ${escapeHtml(J.ne.next)}ごろ(推定)</p>` : ""}` : '<p class="muted">この期限の予測がありません</p>');
  // 3) 業績
  const fin = (state.fundamentals?.[code] || []).slice(-6);
  const lastF = fin.at(-1), prevF = fin.at(-2);
  const yoy = (a, b) => { const x = number(a), y = number(b); return x === null || y === null || y === 0 ? null : (x - y) / Math.abs(y); };
  const c3 = card("company", "▤", "業績", "売上高と営業利益率(通期)", fin.length ? `<div class="card-chart">${svgBars(fin.map((r) => r.sales), { line: fin.map((r) => (number(r.sales) ? number(r.operatingProfit, 0) / r.sales : null)) })}</div><div class="card-kpis"><span>売上高<b>${brokerMoney(lastF?.sales)}</b><small class="${number(yoy(lastF?.sales, prevF?.sales), 0) >= 0 ? "positive-text" : "negative-text"}">${percent(yoy(lastF?.sales, prevF?.sales))}</small></span><span>営業利益<b>${brokerMoney(lastF?.operatingProfit)}</b><small class="${number(yoy(lastF?.operatingProfit, prevF?.operatingProfit), 0) >= 0 ? "positive-text" : "negative-text"}">${percent(yoy(lastF?.operatingProfit, prevF?.operatingProfit))}</small></span><span>決算期<b>${escapeHtml(lastF?.period || "—")}</b><small>百万円</small></span></div>` : '<p class="muted">財務履歴はありません</p>');
  // 4) 株価指標(詳細データの読み込み後に埋まる)
  const doc = state.detail?.[code]; const price = number(state.chartData?.at(-1)?.c, number(company.lastClose ?? company.close));
  let val = '<p class="muted">読み込み中…</p>';
  if (doc) {
    const { rows: annual, forecast } = mergedAnnual(doc); const lastA = annual.at(-1);
    const bal = (doc.kabutan?.balance || []).filter((b) => number(b.bps) !== null).at(-1);
    const ratio = (a, b) => { const x = number(a), y = number(b); return x === null || y === null || y <= 0 ? null : x / y; };
    const perF = forecast ? ratio(price, forecast.eps) : null; const perA = ratio(price, lastA?.eps); const pbr = ratio(price, bal?.bps);
    const dps = number(forecast?.dps) ?? number(lastA?.dps); const shares = number(doc.irbank?.security?.issued_shares);
    val = `<div class="card-kpis four"><span>PER(予)<b>${perF === null ? "—" : `${perF.toFixed(1)}倍`}</b></span><span>PER(実)<b>${perA === null ? "—" : `${perA.toFixed(1)}倍`}</b></span><span>PBR<b>${pbr === null ? "—" : `${pbr.toFixed(2)}倍`}</b></span><span>配当利回り<b>${dps !== null && price ? `${(dps / price * 100).toFixed(2)}%` : "—"}</b></span></div><p class="card-foot">時価総額 ${shares && price ? `${Math.round(shares * price / 1e8).toLocaleString("ja-JP")}億円` : "—"} · 株価 ${tvFmt(price)}円</p>`;
  }
  const c4 = card("valuation", "％", "株価指標", "PER・PBR・配当利回り(直近終値)", val).replace('data-stock-go="valuation"', 'data-stock-go="company" data-broker-tab="valuation"');
  // 5) 決算
  const ne = nextEarningsGuess(code); const le = ne?.last || (state.earnings?.[code]?.items || []).filter((x) => x.announceDate).at(-1);
  const c5 = card("earnings", "◐", "決算", "発表ごとの前年比と発表後5日の値動き", le ? `<div class="card-kpis"><span>直近の発表<b>${escapeHtml(le.announceDate || "—")}</b><small>${escapeHtml(le.period || "")}</small></span><span>売上 前年比<b class="${number(le.yoy?.sales, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(le.yoy?.sales)}</b></span><span>営業益 前年比<b class="${number(le.yoy?.operatingProfit, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(le.yoy?.operatingProfit)}</b></span></div><p class="card-foot">発表後5営業日 <b class="${number(le.marketReaction5d, 0) >= 0 ? "positive-text" : "negative-text"}">${percent(le.marketReaction5d)}</b>${ne ? ` · 次回 ${escapeHtml(ne.next)}ごろ(推定)` : ""}</p>` : '<p class="muted">決算データはありません</p>');
  // 6) 信用残
  const credit = state.marketHistory?.[code]?.credit || []; const lc = credit.at(-1), pc = credit.at(-2);
  const c6 = card("credit", "⇅", "信用残・需給", "信用倍率と買残・売残の推移", lc ? `<div class="card-chart small">${svgSpark(credit.slice(-26).map((r) => r.ratio))}</div><div class="card-kpis"><span>信用倍率<b>${number(lc.ratio)?.toFixed(2) ?? "—"}倍</b><small>${escapeHtml(lc.date || "")}</small></span><span>買残<b>${tvQty(lc.buyBalance)}</b><small class="${number(lc.buyBalance, 0) >= number(pc?.buyBalance, 0) ? "positive-text" : "negative-text"}">${pc ? percent(yoy(lc.buyBalance, pc.buyBalance)) : ""}</small></span><span>売残<b>${tvQty(lc.sellBalance)}</b><small>${pc ? percent(yoy(lc.sellBalance, pc.sellBalance)) : ""}</small></span></div>` : '<p class="muted">信用残の履歴はありません</p>').replace('data-stock-go="credit"', 'data-stock-go="company" data-broker-tab="credit"');
  // 7) ニュース
  const news = (state.data.news || []).filter((n) => n.code === code).slice(0, 3);
  const c7 = card("news", "▧", "ニュース", "決算・適時開示・関連情報", news.length ? `<div class="news-preview">${news.map((n) => `<article><time>${escapeHtml(n.publishedAt.slice(0, 16))} · ${escapeHtml(n.source || "")}</time><p>${escapeHtml(n.title)}</p></article>`).join("")}</div>` : '<p class="muted">保存済みの関連ニュースはありません</p>');
  // 8) 予測の中身
  const evs = state.evidence?.stocks?.[code]; const contrib = (evs?.contrib?.[H] || evs?.contrib?.["20"] || []).slice().sort((a, b) => Math.abs(number(b.contribution, 0)) - Math.abs(number(a.contribution, 0))).slice(0, 4);
  const meth = evs?.method?.[H] || evs?.method?.["20"];
  const c8 = card("model", "◈", "予測の中身", meth ? `${escapeHtml(meth.model)}(${escapeHtml(meth.method)})で分解` : "寄与の大きい特徴量", contrib.length ? `<div class="kv-list">${contrib.map((r) => `<div class="kv-row"><span>${escapeHtml(r.label || r.name)}</span><b class="${number(r.contribution, 0) >= 0 ? "positive-text" : "negative-text"}">${signed(r.contribution, 4)}</b></div>`).join("")}</div>` : `<p class="muted">根拠ファイル(注目銘柄のみ)の対象外です</p><p class="card-foot">有報データ・特徴量の一覧は詳しいページで</p>`);
  // 9) リスク
  const pr = cur?.pathRisk; const w90 = cur && price ? (number(cur.high90) - number(cur.low90)) / price : null;
  const c9 = card("risk", "⚖", "リスク・株数", "保有中の途中安値(過去実績)", pr ? `<div class="card-kpis"><span>途中安値 中央値<b class="negative-text">${percent(pr.median)}</b></span><span>悪い方10%<b class="negative-text">${percent(pr.q10)}</b></span><span>悪い方5%<b class="negative-text">${percent(pr.q05)}</b></span></div><p class="card-foot">${escapeHtml(horizonLabel(Number(p[H] ? H : 20)))}保有 · 90%区間の幅 ${metricPercent(w90)} · 予測ではなく過去の値動きの幅</p>` : '<p class="muted">この期限の実績が足りません</p>');
  // 10) 企業関係
  const rel = state.relations?.companies?.[code]; const facts = state.evidence?.relations?.stocks?.[code] || [];
  const peers = (rel?.statPeers || []).slice(0, 3);
  const c10 = card("relations", "⌘", "企業関係", "開示ベースの関係と値動きの近い銘柄", `<div class="card-kpis"><span>登録済みの関係<b>${facts.length || (rel?.edges || []).length || 0}件</b></span><span>値動きの近い銘柄<b>${(rel?.statPeers || []).length}件</b></span></div>${peers.length ? `<div class="kv-list">${peers.map((x) => `<div class="kv-row"><span>${escapeHtml(x.name)}</span><small>${escapeHtml(x.code)}</small><b>相関 ${number(x.corr250)?.toFixed(2) ?? "—"}</b></div>`).join("")}</div>` : ""}`);
  // 11) 売買履歴
  const trades = chartTrades(); const pos = openPosition(trades); const realized = trades.filter((t) => Number.isFinite(t.realizedPnl)).reduce((s, t) => s + t.realizedPnl, 0);
  const c11 = card("charts", "◷", "売買履歴", "取引分析で読み込んだCSV(端末内のみ)をチャートに重ねる", trades.length ? `<div class="card-kpis"><span>約定<b>${trades.length}件</b><small>${escapeHtml(trades.map((t) => t.date).sort()[0] || "")}〜</small></span><span>保有<b>${pos ? `${tvQty(pos.qty)}株` : "なし"}</b><small>${pos ? `平均 ${tvFmt(pos.avg)}` : ""}</small></span><span>実現損益<b class="${realized >= 0 ? "positive-text" : "negative-text"}">${realized ? `${realized >= 0 ? "+" : "−"}${tvMoneyShort(Math.abs(realized))}` : "—"}</b></span></div><p class="card-foot">チャート専用ページで B / S の位置と建玉ラインを確認</p>` : '<p class="muted">この銘柄の取引は読み込まれていません。「取引分析」から楽天・SBIのCSVを読み込むとチャートに B / S が出ます</p>');
  // 12) 実験AI
  const c12 = card("exp", "⚗", "実験AI", "不採用の GNN・Transformer の出力(検証中)", '<p class="card-foot">検証で予測力が確認できず本番予測には使っていないモデルです。対照(ランダム)と並べて表示します。</p><span class="pill warning">UNDER CONSTRUCTION</span>', "uc-card-x");
  box.innerHTML = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12].join("");
}

// ---- 更新時刻のまとめ(2026-09-25 改訂g。run_chain.ps1 → scripts/mark_update.py が data/update-times.json を書く) ----
const UPDATE_TIME_LABELS = [["infer", "予測"], ["train", "再学習(DNN以外)"], ["dnn", "DNN学習"], ["news", "ニュース"], ["shinyo", "信用残"], ["fundamentals", "決算"], ["consensus", "コンセンサス"], ["options", "オプション・VIX"], ["publish", "サイト公開"], ["weekly", "週次の再検証(日曜)"], ["comments", "AIコメント(日曜)"]];
async function renderUpdateTimes() {
  const box = $("#homeTimes"); if (!box) return;
  let d = null;
  try { const r = await fetch("data/update-times.json", { cache: "no-store" }); d = r.ok ? await r.json() : null; } catch { d = null; }
  const items = d?.items || {};
  const fmt = (s) => { const t = s ? new Date(s) : null; return t && !isNaN(t) ? t.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; };
  const cells = UPDATE_TIME_LABELS.filter(([k]) => items[k]).map(([k, label]) => {
    const it = items[k]; const failed = it.failedAt && (!it.at || it.failedAt > it.at);
    return `<span class="ut-item${failed ? " ut-fail" : ""}" title="${failed ? `最後の実行は失敗(${escapeHtml(fmt(it.failedAt))})。表示は前回成功した時刻` : ""}"><b>${escapeHtml(label)}</b>${escapeHtml(fmt(it.at))}${failed ? " ⚠" : ""}</span>`;
  });
  if (!cells.length) { box.hidden = true; return; }
  box.innerHTML = `<div class="section-title"><div><span>更新時刻</span><small>各処理が最後に終わった時刻(日本時間)。⚠ は直近の実行が失敗</small></div></div><div class="ut-list">${cells.join("")}</div>`;
  box.hidden = false;
}

// ---- ホームの実データ化(財務カード・AIコメント・チャートの見本) ----
function renderHomeExtras() {
  const top = [...(state.data?.predictions || [])].sort((a, b) => (a.rank || 9999) - (b.rank || 9999))[0];
  const fin = top ? (state.fundamentals?.[top.code] || []).slice(-5) : [];
  const box = $("#homeFinance");
  if (box) box.innerHTML = fin.length ? svgBars(fin.map((r) => r.sales), { line: fin.map((r) => (number(r.sales) ? number(r.operatingProfit, 0) / r.sales : null)) }) : "";
  if ($("#homeFinanceName")) $("#homeFinanceName").textContent = top && fin.length ? `例: ${top.name}(売買代金1位)` : "";
  const cm = (state.comments || [])[0]; const c = $("#homeComment");
  if (c) c.innerHTML = cm ? `<time>${escapeHtml(cm.from)}〜${escapeHtml(cm.to || "")}</time><span class="stance ${escapeHtml(cm.stance)}">${cm.stance === "positive" ? "堅調予想" : cm.stance === "negative" ? "慎重" : "中立"}</span><p><b>${escapeHtml(cm.code)} ${escapeHtml(state.data.predictions.find((r) => r.code === cm.code)?.name || "")}</b> ${escapeHtml(cm.title)} ― ${escapeHtml(cm.summary)}</p>` : "<p>保存済みのAIコメントはありません。</p>";
  const run = state.data?.run; const el = $("#headerAsOf");
  if (el) {
    const modeLabel = { infer: "予測", train: "答え合わせ・再学習", full: "日次" }[run?.mode] || "";
    const t = run?.finished_at ? new Date(run.finished_at) : null;
    el.textContent = `${state.data.asOf || "—"} 基準${run ? ` · ${modeLabel}${run.complete ? "" : "(途中)"} ${t && !isNaN(t) ? t.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}` : " 更新"}`;
    el.title = run ? `最後の実行: mode=${run.mode} complete=${run.complete} exit=${run.exit_code ?? "—"} 開始 ${run.started_at || "—"} 終了 ${run.finished_at || "—"}` : "";
  }
}


init();
