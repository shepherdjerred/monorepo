#!/usr/bin/env bun
import path from "node:path";
import type { Dataset, GroundTruthLabel } from "./types.ts";

const PORT = 3847;
const datasetPath = path.join(import.meta.dirname, "dataset.json");

const datasetFile = Bun.file(datasetPath);
if (!(await datasetFile.exists())) {
  console.error(
    "dataset.json not found. Run sample.ts first.",
  );
  process.exit(1);
}

let dataset: Dataset = (await datasetFile.json()) as Dataset;

async function saveDataset(): Promise<void> {
  await Bun.write(datasetPath, JSON.stringify(dataset, null, 2));
}

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monarch Accuracy Labeler</title>
<style>
  :root {
    --bg: #f8f9fa; --fg: #1a1a2e; --card-bg: #fff; --card-border: #e0e0e0;
    --accent: #4361ee; --accent-hover: #3a56d4; --green: #2d6a4f; --red: #d62828;
    --dim: #6b7280; --selected-bg: #e8f0fe; --label-green: #d4edda;
    --search-bg: #fff; --btn-bg: #f0f0f0; --btn-hover: #e0e0e0;
    --bar-bg: #e0e0e0; --bar-fill: #4361ee; --badge-bg: #e8e8e8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --card-bg: #161b22; --card-border: #30363d;
      --accent: #58a6ff; --accent-hover: #79b8ff; --green: #3fb950; --red: #f85149;
      --dim: #8b949e; --selected-bg: #1c2d4a; --label-green: #1a3a2a;
      --search-bg: #0d1117; --btn-bg: #21262d; --btn-hover: #30363d;
      --bar-bg: #30363d; --bar-fill: #58a6ff; --badge-bg: #30363d;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--fg);
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-bottom: 1px solid var(--card-border);
    background: var(--card-bg);
  }
  header h1 { font-size: 18px; font-weight: 600; }
  .progress-wrap { display: flex; align-items: center; gap: 10px; }
  .progress-text { font-size: 14px; color: var(--dim); white-space: nowrap; }
  .progress-bar {
    width: 200px; height: 8px; background: var(--bar-bg);
    border-radius: 4px; overflow: hidden;
  }
  .progress-fill {
    height: 100%; background: var(--bar-fill);
    transition: width 0.3s ease;
  }
  .main-area {
    flex: 1; display: flex; flex-direction: column;
    padding: 16px 20px; gap: 12px; overflow-y: auto;
  }
  .nav-row {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .nav-row button {
    padding: 6px 14px; border: 1px solid var(--card-border);
    background: var(--btn-bg); color: var(--fg); border-radius: 6px;
    cursor: pointer; font-size: 13px;
  }
  .nav-row button:hover { background: var(--btn-hover); }
  .nav-label { font-size: 14px; font-weight: 500; }
  .filter-row {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  }
  .filter-row button {
    padding: 4px 10px; border: 1px solid var(--card-border);
    background: var(--btn-bg); color: var(--fg); border-radius: 4px;
    cursor: pointer; font-size: 12px;
  }
  .filter-row button.active {
    background: var(--accent); color: #fff; border-color: var(--accent);
  }
  .txn-card {
    background: var(--card-bg); border: 1px solid var(--card-border);
    border-radius: 10px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  .txn-card.labeled { border-left: 4px solid var(--green); }
  .txn-header {
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .txn-date { font-size: 14px; color: var(--dim); }
  .txn-amount { font-size: 20px; font-weight: 700; }
  .txn-amount.expense { color: var(--red); }
  .txn-amount.income { color: var(--green); }
  .txn-merchant { font-size: 18px; font-weight: 600; }
  .txn-details {
    display: grid; grid-template-columns: auto 1fr; gap: 2px 12px;
    font-size: 13px; margin-top: 6px;
  }
  .txn-details dt { color: var(--dim); text-align: right; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600; background: var(--badge-bg);
  }
  .badge-amazon { background: #fff3cd; color: #856404; }
  .badge-venmo { background: #d4edda; color: #155724; }
  .badge-bilt { background: #cce5ff; color: #004085; }
  .badge-usaa { background: #e2e3e5; color: #383d41; }
  .badge-scl { background: #d1ecf1; color: #0c5460; }
  .badge-apple { background: #f8d7da; color: #721c24; }
  .badge-costco { background: #d4edda; color: #155724; }
  .badge-regular { background: var(--badge-bg); color: var(--dim); }
  @media (prefers-color-scheme: dark) {
    .badge-amazon { background: #3d3200; color: #ffc107; }
    .badge-venmo { background: #0d3320; color: #3fb950; }
    .badge-bilt { background: #0a2744; color: #58a6ff; }
    .badge-usaa { background: #2a2d30; color: #8b949e; }
    .badge-scl { background: #0a3038; color: #56d4e8; }
    .badge-apple { background: #3d0f14; color: #f85149; }
    .badge-costco { background: #0d3320; color: #3fb950; }
  }
  .category-section { margin-top: 8px; }
  .category-section > label { font-size: 13px; color: var(--dim); display: block; margin-bottom: 4px; }
  .search-wrap { position: relative; }
  .search-input {
    width: 100%; padding: 8px 12px; border: 1px solid var(--card-border);
    border-radius: 6px; font-size: 14px; background: var(--search-bg);
    color: var(--fg); outline: none;
  }
  .search-input:focus { border-color: var(--accent); }
  .search-results {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
    background: var(--card-bg); border: 1px solid var(--card-border);
    border-radius: 6px; max-height: 250px; overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none;
  }
  .search-results.open { display: block; }
  .search-group-header {
    padding: 4px 10px; font-size: 11px; color: var(--dim);
    font-weight: 600; text-transform: uppercase;
  }
  .search-item {
    padding: 6px 12px; cursor: pointer; font-size: 13px;
  }
  .search-item:hover, .search-item.highlighted { background: var(--selected-bg); }
  .quick-picks {
    display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
  }
  .quick-pick {
    padding: 6px 14px; border: 1px solid var(--card-border);
    background: var(--btn-bg); color: var(--fg); border-radius: 16px;
    cursor: pointer; font-size: 13px; transition: all 0.15s;
  }
  .quick-pick:hover { background: var(--btn-hover); }
  .quick-pick.selected {
    background: var(--accent); color: #fff; border-color: var(--accent);
  }
  .quick-pick .qp-num {
    font-size: 10px; color: var(--dim); margin-right: 2px;
  }
  .quick-pick.selected .qp-num { color: rgba(255,255,255,0.7); }
  .options-row {
    display: flex; gap: 16px; align-items: center; margin-top: 10px;
    flex-wrap: wrap;
  }
  .options-row label {
    display: flex; align-items: center; gap: 6px;
    font-size: 13px; cursor: pointer;
  }
  .notes-input {
    width: 100%; max-width: 400px; padding: 6px 10px;
    border: 1px solid var(--card-border); border-radius: 6px;
    font-size: 13px; background: var(--search-bg); color: var(--fg);
  }
  .confirm-row { margin-top: 12px; }
  .confirm-btn {
    padding: 10px 28px; background: var(--accent); color: #fff;
    border: none; border-radius: 8px; font-size: 15px; font-weight: 600;
    cursor: pointer;
  }
  .confirm-btn:hover { background: var(--accent-hover); }
  .confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  footer {
    padding: 8px 20px; border-top: 1px solid var(--card-border);
    font-size: 12px; color: var(--dim); background: var(--card-bg);
  }
  .minimap {
    display: flex; flex-wrap: wrap; gap: 2px; margin-top: 8px;
    max-height: 40px; overflow: hidden;
  }
  .minimap-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--bar-bg); cursor: pointer;
  }
  .minimap-dot.labeled { background: var(--green); }
  .minimap-dot.current { background: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
  .selected-category {
    margin-top: 6px; font-size: 14px; font-weight: 500;
    color: var(--accent);
  }
</style>
</head>
<body>
<header>
  <h1>Monarch Accuracy Labeler</h1>
  <div class="progress-wrap">
    <span class="progress-text" id="progress-text">0/0</span>
    <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
  </div>
</header>
<div class="main-area">
  <div class="nav-row">
    <button id="btn-prev">&larr; Prev</button>
    <span class="nav-label" id="nav-label">Transaction #1</span>
    <button id="btn-next">Next &rarr;</button>
    <button id="btn-unlabeled">Jump to unlabeled</button>
  </div>
  <div class="filter-row" id="filter-row"></div>
  <div class="txn-card" id="txn-card">
    <div class="txn-header">
      <span class="txn-date" id="txn-date"></span>
      <span class="txn-amount" id="txn-amount"></span>
      <span class="txn-merchant" id="txn-merchant"></span>
    </div>
    <dl class="txn-details">
      <dt>Plaid name</dt><dd id="txn-plaid"></dd>
      <dt>Account</dt><dd id="txn-account"></dd>
      <dt>Current category</dt><dd id="txn-category"></dd>
      <dt>Deep path</dt><dd><span class="badge" id="txn-deeppath"></span></dd>
      <dt>Recurring</dt><dd id="txn-recurring"></dd>
      <dt>Notes</dt><dd id="txn-notes"></dd>
    </dl>
  </div>
  <div class="category-section">
    <label>Category:</label>
    <div class="search-wrap">
      <input type="text" class="search-input" id="cat-search"
        placeholder="Search categories..." autocomplete="off">
      <div class="search-results" id="cat-results"></div>
    </div>
    <div class="selected-category" id="selected-display"></div>
    <div class="quick-picks" id="quick-picks"></div>
  </div>
  <div class="options-row">
    <label><input type="checkbox" id="chk-keep"> Keep current</label>
    <label><input type="checkbox" id="chk-split"> Needs split</label>
    <label>Notes: <input type="text" class="notes-input" id="label-notes"></label>
  </div>
  <div class="confirm-row">
    <button class="confirm-btn" id="btn-confirm">
      Confirm &amp; Next (Enter)
    </button>
  </div>
  <div class="minimap" id="minimap"></div>
</div>
<footer>
  Shortcuts: Enter=confirm &middot; /=search &middot; k=keep &middot; s=split &middot; Tab=skip &middot; arrows=nav &middot; u=unlabeled &middot; 1-9=quick pick
</footer>

<script>
"use strict";

let dataset = null;
let currentIndex = 0;
let selectedCategoryId = null;
let selectedCategoryName = null;
let highlightedSearchIndex = -1;
let filteredResults = [];
let filter = "all";
let filteredIndices = [];
let quickPickCategories = [];

const $ = (id) => document.getElementById(id);

async function init() {
  const res = await fetch("/api/dataset");
  dataset = await res.json();
  computeQuickPicks();
  buildFilterButtons();
  buildFilteredIndices();
  // Jump to first unlabeled
  const labeledIds = new Set(dataset.labels.map(l => l.transactionId));
  const firstUnlabeled = dataset.transactions.findIndex(t => !labeledIds.has(t.id));
  currentIndex = firstUnlabeled >= 0 ? firstUnlabeled : 0;
  render();
  buildMinimap();
}

function computeQuickPicks() {
  const counts = new Map();
  for (const t of dataset.transactions) {
    counts.set(t.currentCategory, (counts.get(t.currentCategory) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  quickPickCategories = sorted.slice(0, 10).map(([name]) => {
    const cat = dataset.categories.find(c => c.name === name);
    return cat ? { id: cat.id, name: cat.name } : { id: "", name };
  });
}

function buildFilterButtons() {
  const row = $("filter-row");
  const filters = [
    { key: "all", text: "All" },
    { key: "unlabeled", text: "Unlabeled" },
    { key: "labeled", text: "Labeled" },
  ];
  for (const f of filters) {
    const btn = document.createElement("button");
    btn.textContent = f.text;
    btn.dataset.filter = f.key;
    if (f.key === filter) btn.classList.add("active");
    btn.addEventListener("click", () => setFilter(f.key));
    row.appendChild(btn);
  }
}

function buildFilteredIndices() {
  const labeledIds = new Set(dataset.labels.map(l => l.transactionId));
  filteredIndices = [];
  for (let i = 0; i < dataset.transactions.length; i++) {
    const t = dataset.transactions[i];
    if (filter === "all") filteredIndices.push(i);
    else if (filter === "unlabeled" && !labeledIds.has(t.id)) filteredIndices.push(i);
    else if (filter === "labeled" && labeledIds.has(t.id)) filteredIndices.push(i);
  }
}

function setFilter(f) {
  filter = f;
  document.querySelectorAll(".filter-row button").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === f);
  });
  buildFilteredIndices();
  if (!filteredIndices.includes(currentIndex)) {
    currentIndex = filteredIndices[0] || 0;
  }
  render();
  buildMinimap();
}

function navigate(delta) {
  const pos = filteredIndices.indexOf(currentIndex);
  if (pos === -1) {
    currentIndex = filteredIndices[0] || 0;
  } else {
    const next = pos + delta;
    if (next >= 0 && next < filteredIndices.length) {
      currentIndex = filteredIndices[next];
    }
  }
  render();
  updateMinimap();
}

function jumpToUnlabeled() {
  const labeledIds = new Set(dataset.labels.map(l => l.transactionId));
  for (let i = currentIndex + 1; i < dataset.transactions.length; i++) {
    if (!labeledIds.has(dataset.transactions[i].id)) {
      currentIndex = i;
      render();
      updateMinimap();
      return;
    }
  }
  for (let i = 0; i <= currentIndex; i++) {
    if (!labeledIds.has(dataset.transactions[i].id)) {
      currentIndex = i;
      render();
      updateMinimap();
      return;
    }
  }
}

function render() {
  if (!dataset) return;
  const t = dataset.transactions[currentIndex];
  if (!t) return;

  const labeledIds = new Set(dataset.labels.map(l => l.transactionId));
  const labelCount = dataset.labels.length;
  const total = dataset.transactions.length;

  $("progress-text").textContent =
    labelCount + "/" + total + " labeled (" + Math.round(labelCount / total * 100) + "%)";
  $("progress-fill").style.width = (labelCount / total * 100) + "%";

  $("nav-label").textContent = "Transaction #" + (currentIndex + 1);

  const card = $("txn-card");
  card.classList.toggle("labeled", labeledIds.has(t.id));

  $("txn-date").textContent = formatDate(t.date);
  const amtEl = $("txn-amount");
  amtEl.textContent = formatAmount(t.amount);
  amtEl.className = "txn-amount " + (t.amount < 0 ? "expense" : "income");
  $("txn-merchant").textContent = t.merchantName;
  $("txn-plaid").textContent = t.plaidName || "\u2014";
  $("txn-account").textContent = t.accountName;
  $("txn-category").textContent = t.currentCategory;

  const dpEl = $("txn-deeppath");
  dpEl.textContent = t.deepPath;
  dpEl.className = "badge badge-" + t.deepPath;

  $("txn-recurring").textContent = t.isRecurring ? "Yes" : "No";
  $("txn-notes").textContent = t.notes || "\u2014";

  // Existing label?
  const existingLabel = dataset.labels.find(l => l.transactionId === t.id);
  if (existingLabel) {
    selectedCategoryId = existingLabel.correctCategoryId;
    selectedCategoryName = existingLabel.correctCategory;
    $("chk-split").checked = existingLabel.shouldSplit;
    $("label-notes").value = existingLabel.labelNotes || "";
    $("chk-keep").checked =
      existingLabel.correctCategoryId === t.currentCategoryId;
  } else {
    selectedCategoryId = null;
    selectedCategoryName = null;
    $("chk-split").checked = false;
    $("label-notes").value = "";
    $("chk-keep").checked = false;
  }

  $("cat-search").value = "";
  $("cat-results").classList.remove("open");

  renderSelectedDisplay();
  renderQuickPicks();
}

function renderSelectedDisplay() {
  const el = $("selected-display");
  el.textContent = selectedCategoryName ? "Selected: " + selectedCategoryName : "";
}

function renderQuickPicks() {
  const container = $("quick-picks");
  // Remove existing children
  while (container.firstChild) container.removeChild(container.firstChild);

  quickPickCategories.forEach((cat, i) => {
    const btn = document.createElement("button");
    btn.className = "quick-pick" + (selectedCategoryId === cat.id ? " selected" : "");
    const numSpan = document.createElement("span");
    numSpan.className = "qp-num";
    numSpan.textContent = String(i + 1);
    btn.appendChild(numSpan);
    btn.appendChild(document.createTextNode(" " + cat.name));
    btn.addEventListener("click", () => selectCategory(cat.id, cat.name));
    container.appendChild(btn);
  });
}

function selectCategory(id, name) {
  selectedCategoryId = id;
  selectedCategoryName = name;
  $("chk-keep").checked = false;
  renderSelectedDisplay();
  renderQuickPicks();
  $("cat-search").value = "";
  $("cat-results").classList.remove("open");
}

function toggleKeep() {
  const checked = $("chk-keep").checked;
  if (checked) {
    const t = dataset.transactions[currentIndex];
    selectedCategoryId = t.currentCategoryId;
    selectedCategoryName = t.currentCategory;
  } else {
    selectedCategoryId = null;
    selectedCategoryName = null;
  }
  renderSelectedDisplay();
  renderQuickPicks();
}

async function confirmLabel() {
  if (!selectedCategoryId || !selectedCategoryName) return;
  const t = dataset.transactions[currentIndex];
  const label = {
    transactionId: t.id,
    correctCategory: selectedCategoryName,
    correctCategoryId: selectedCategoryId,
    shouldSplit: $("chk-split").checked,
    labelNotes: $("label-notes").value || undefined,
    labeledAt: new Date().toISOString(),
  };
  await fetch("/api/label", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(label),
  });
  const idx = dataset.labels.findIndex(l => l.transactionId === t.id);
  if (idx >= 0) dataset.labels[idx] = label;
  else dataset.labels.push(label);

  buildFilteredIndices();
  jumpToUnlabeled();
  buildMinimap();
}

// Search
const searchInput = $("cat-search");
const resultsEl = $("cat-results");

searchInput.addEventListener("input", () => {
  const q = searchInput.value.toLowerCase().trim();
  if (!q) {
    resultsEl.classList.remove("open");
    return;
  }
  filteredResults = dataset.categories.filter(c =>
    c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
  );
  highlightedSearchIndex = 0;
  renderSearchResults();
});

searchInput.addEventListener("keydown", (e) => {
  if (!resultsEl.classList.contains("open")) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlightedSearchIndex = Math.min(highlightedSearchIndex + 1, filteredResults.length - 1);
    renderSearchResults();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightedSearchIndex = Math.max(highlightedSearchIndex - 1, 0);
    renderSearchResults();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (filteredResults[highlightedSearchIndex]) {
      const cat = filteredResults[highlightedSearchIndex];
      selectCategory(cat.id, cat.name);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    resultsEl.classList.remove("open");
    searchInput.blur();
  }
});

function renderSearchResults() {
  if (filteredResults.length === 0) {
    resultsEl.classList.remove("open");
    return;
  }
  resultsEl.classList.add("open");

  // Clear previous results using DOM methods
  while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);

  // Group by category group
  const groups = new Map();
  for (const cat of filteredResults) {
    if (!groups.has(cat.group)) groups.set(cat.group, []);
    groups.get(cat.group).push(cat);
  }

  let globalIdx = 0;
  for (const [group, cats] of groups) {
    const header = document.createElement("div");
    header.className = "search-group-header";
    header.textContent = group;
    resultsEl.appendChild(header);

    for (const cat of cats) {
      const item = document.createElement("div");
      item.className = "search-item" + (globalIdx === highlightedSearchIndex ? " highlighted" : "");
      item.textContent = cat.name;
      const catId = cat.id;
      const catName = cat.name;
      item.addEventListener("click", () => selectCategory(catId, catName));
      resultsEl.appendChild(item);
      globalIdx++;
    }
  }
}

function formatDate(d) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(a) {
  const abs = Math.abs(a);
  const sign = a < 0 ? "-" : "+";
  return sign + "$" + abs.toFixed(2);
}

function buildMinimap() {
  const container = $("minimap");
  while (container.firstChild) container.removeChild(container.firstChild);

  const labeledIds = new Set(dataset.labels.map(l => l.transactionId));
  for (let i = 0; i < dataset.transactions.length; i++) {
    const t = dataset.transactions[i];
    const dot = document.createElement("div");
    dot.className = "minimap-dot";
    if (labeledIds.has(t.id)) dot.classList.add("labeled");
    if (i === currentIndex) dot.classList.add("current");
    dot.title = "#" + (i + 1) + " " + t.merchantName;
    const idx = i;
    dot.addEventListener("click", () => goTo(idx));
    container.appendChild(dot);
  }
}

function updateMinimap() {
  const dots = document.querySelectorAll(".minimap-dot");
  dots.forEach((d, i) => {
    d.classList.toggle("current", i === currentIndex);
  });
}

function goTo(i) {
  currentIndex = i;
  render();
  updateMinimap();
}

// Wire up buttons
$("btn-prev").addEventListener("click", () => navigate(-1));
$("btn-next").addEventListener("click", () => navigate(1));
$("btn-unlabeled").addEventListener("click", jumpToUnlabeled);
$("btn-confirm").addEventListener("click", confirmLabel);
$("chk-keep").addEventListener("change", toggleKeep);

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  const isInput = tag === "INPUT" || tag === "TEXTAREA";

  if (e.key === "Escape") {
    resultsEl.classList.remove("open");
    searchInput.blur();
    $("label-notes").blur();
    return;
  }

  if (isInput) return;

  if (e.key === "Enter") {
    e.preventDefault();
    confirmLabel();
  } else if (e.key === "Tab") {
    e.preventDefault();
    navigate(1);
  } else if (e.key === "/") {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === "k") {
    $("chk-keep").checked = !$("chk-keep").checked;
    toggleKeep();
  } else if (e.key === "s") {
    const el = $("chk-split");
    el.checked = !el.checked;
  } else if (e.key === "ArrowLeft") {
    navigate(-1);
  } else if (e.key === "ArrowRight") {
    navigate(1);
  } else if (e.key === "u") {
    jumpToUnlabeled();
  } else if (e.key >= "1" && e.key <= "9") {
    const idx = parseInt(e.key) - 1;
    if (quickPickCategories[idx]) {
      selectCategory(quickPickCategories[idx].id, quickPickCategories[idx].name);
    }
  }
});

init();
</script>
</body>
</html>`;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/dataset" && req.method === "GET") {
      return Response.json(dataset);
    }

    if (url.pathname === "/api/label" && req.method === "POST") {
      const label = (await req.json()) as GroundTruthLabel;
      const idx = dataset.labels.findIndex(
        (l) => l.transactionId === label.transactionId,
      );
      if (idx >= 0) {
        dataset.labels[idx] = label;
      } else {
        dataset.labels.push(label);
      }
      await saveDataset();
      return Response.json({ ok: true });
    }

    if (
      url.pathname.startsWith("/api/label/") &&
      req.method === "DELETE"
    ) {
      const id = url.pathname.slice("/api/label/".length);
      dataset.labels = dataset.labels.filter(
        (l) => l.transactionId !== id,
      );
      await saveDataset();
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Labeling server running at http://localhost:${String(PORT)}`);
console.log(
  `${String(dataset.transactions.length)} transactions, ${String(dataset.labels.length)} already labeled`,
);
