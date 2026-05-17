/* Books page — jcs3.com
   ----------------------
   Fetches a published Google Sheet as CSV, renders book cards with
   Open Library cover fallbacks, status filters, search, sort, and stats.

   ============================================================
   SETUP (one-time, ~5 minutes):
   ============================================================
   1. Create a Google Sheet with these column headers in row 1:
      title | author | isbn | status | rating | started | finished | notes | cover_override
      - status: one of `reading`, `read`, `tbr`, `dnf`
      - rating: 1–5 (or blank for unrated / not-yet-read)
      - started/finished: YYYY-MM-DD (or blank)
      - cover_override: full URL, used only if Open Library has no cover
   2. File → Share → Publish to web → choose the sheet tab,
      format = CSV, click Publish.
   3. Also set the share permission to "Anyone with the link can view"
      (the gviz endpoint below needs link-view, not just publish).
   4. Copy your sheet ID from the URL:
      docs.google.com/spreadsheets/d/[THIS_PART_HERE]/edit
   5. Paste it below as SHEET_ID, and set SHEET_NAME to your tab name.
   ============================================================
*/

const SHEET_ID = "YOUR_SHEET_ID_HERE";
const SHEET_NAME = "Sheet1";

// Use the gviz endpoint — more reliable than publish-to-web CSV link.
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// ---- State ----
let allBooks = [];
let currentFilter = "all";
let currentSort = "date-desc";
let currentSearch = "";

// ---- Boot ----
document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  try {
    allBooks = await loadBooks();
    if (!allBooks.length) {
      showEmpty("No books yet. Add some rows to your Google Sheet.");
      return;
    }
    renderStats(allBooks);
    render();
  } catch (err) {
    console.error(err);
    showError("Couldn't load books. Check that your Google Sheet is shared and SHEET_ID is set in books.js.");
  }
}

function bindEvents() {
  document.getElementById("bt-tabs").addEventListener("click", e => {
    if (e.target.tagName !== "BUTTON") return;
    document.querySelectorAll(".bt-tab").forEach(t => t.classList.remove("active"));
    e.target.classList.add("active");
    currentFilter = e.target.dataset.f;
    render();
  });

  document.getElementById("bt-search").addEventListener("input", e => {
    currentSearch = e.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById("bt-sort").addEventListener("change", e => {
    currentSort = e.target.value;
    render();
  });
}

// ---- Data ----
async function loadBooks() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (!rows.length) return [];

  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (row[i] || "").trim(); });
      return obj;
    })
    .filter(b => b.title) // skip blank rows
    .map(normalize);
}

function normalize(b) {
  const status = (b.status || "tbr").toLowerCase();
  const rating = b.rating ? parseInt(b.rating, 10) : null;
  return {
    title: b.title,
    author: b.author || "Unknown",
    isbn: (b.isbn || "").replace(/[^0-9X]/gi, ""),
    status: ["reading", "read", "tbr", "dnf"].includes(status) ? status : "tbr",
    rating: rating && rating >= 1 && rating <= 5 ? rating : null,
    started: b.started || "",
    finished: b.finished || "",
    notes: b.notes || "",
    coverOverride: b.cover_override || ""
  };
}

/* Minimal CSV parser that handles quoted fields with commas and escaped quotes.
   Adequate for Sheets' standard CSV output. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else { field += c; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c && c.trim() !== ""));
}

// ---- Render ----
function render() {
  let books = allBooks.slice();

  // Filter
  if (currentFilter !== "all") {
    books = books.filter(b => b.status === currentFilter);
  }
  // Search
  if (currentSearch) {
    books = books.filter(b =>
      b.title.toLowerCase().includes(currentSearch) ||
      b.author.toLowerCase().includes(currentSearch)
    );
  }
  // Sort
  books.sort(sorter(currentSort));

  const grid = document.getElementById("bt-grid");
  if (!books.length) {
    grid.innerHTML = `<p class="bt-empty">No books match.</p>`;
    return;
  }
  grid.innerHTML = books.map(cardHTML).join("");

  // Attach image fallback handlers
  grid.querySelectorAll("img.bt-cover-img").forEach(img => {
    img.addEventListener("error", () => handleCoverError(img));
  });
}

function sorter(mode) {
  return (a, b) => {
    switch (mode) {
      case "date-desc": return (b.finished || b.started || "").localeCompare(a.finished || a.started || "");
      case "date-asc":  return (a.finished || a.started || "").localeCompare(b.finished || b.started || "");
      case "rating-desc": return (b.rating || 0) - (a.rating || 0);
      case "title": return a.title.localeCompare(b.title);
      case "author": return a.author.localeCompare(b.author);
      default: return 0;
    }
  };
}

function cardHTML(b) {
  const coverSrc = b.isbn
    ? `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg?default=false`
    : (b.coverOverride || "");

  const statusLabel = {
    reading: "Reading", read: "Read", tbr: "To read", dnf: "DNF"
  }[b.status];

  const stars = b.rating ? "★".repeat(b.rating) + "☆".repeat(5 - b.rating) : "";

  const coverInner = coverSrc
    ? `<img class="bt-cover-img" src="${escapeAttr(coverSrc)}"
            data-override="${escapeAttr(b.coverOverride)}"
            alt="${escapeAttr(b.title)} cover" loading="lazy" />`
    : `<span>${escapeHTML(b.title)}</span>`;

  return `
    <article class="bt-card" data-status="${b.status}">
      <div class="bt-cover">${coverInner}</div>
      <h3 class="bt-bk-title">${escapeHTML(b.title)}</h3>
      <p class="bt-bk-author">${escapeHTML(b.author)}</p>
      <div class="bt-row">
        <span class="bt-pill ${b.status}">${statusLabel}</span>
        <span class="bt-rating" aria-label="${b.rating ? b.rating + ' of 5 stars' : 'unrated'}">${stars}</span>
      </div>
    </article>
  `;
}

/* When the Open Library cover 404s (we set ?default=false to force this),
   fall back to cover_override if provided, otherwise show the title text. */
function handleCoverError(img) {
  const override = img.dataset.override;
  if (override && img.src !== override) {
    img.src = override;
    return;
  }
  const parent = img.parentElement;
  const title = img.alt.replace(/ cover$/, "");
  parent.innerHTML = `<span>${escapeHTML(title)}</span>`;
}

// ---- Stats ----
function renderStats(books) {
  const year = new Date().getFullYear();
  const readThisYear = books.filter(b =>
    b.status === "read" && b.finished && b.finished.startsWith(String(year))
  ).length;
  const reading = books.filter(b => b.status === "reading").length;
  const tbr = books.filter(b => b.status === "tbr").length;
  const rated = books.filter(b => b.status === "read" && b.rating);
  const avg = rated.length
    ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
    : "—";

  document.getElementById("bt-stats").innerHTML = `
    <div class="bt-stat"><div class="bt-stat-label">Read in ${year}</div><div class="bt-stat-val">${readThisYear}</div></div>
    <div class="bt-stat"><div class="bt-stat-label">Currently reading</div><div class="bt-stat-val">${reading}</div></div>
    <div class="bt-stat"><div class="bt-stat-label">To be read</div><div class="bt-stat-val">${tbr}</div></div>
    <div class="bt-stat"><div class="bt-stat-label">Avg rating</div><div class="bt-stat-val">${avg}</div></div>
  `;
}

// ---- UI helpers ----
function showEmpty(msg) {
  document.getElementById("bt-grid").innerHTML = `<p class="bt-empty">${escapeHTML(msg)}</p>`;
}
function showError(msg) {
  document.getElementById("bt-grid").innerHTML = `<p class="bt-error">${escapeHTML(msg)}</p>`;
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]
  ));
}
function escapeAttr(s) { return escapeHTML(s); }
