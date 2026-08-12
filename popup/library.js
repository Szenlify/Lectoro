// ── Library tab: curated titles well-suited for learning English ──
// Static, hand-picked list (title / difficulty / short note), stored
// in shared/library-items.json and loaded once when the popup opens.
// No content is scraped or downloaded from any streaming site – the "Szukaj"
// button simply opens a web search so the user can find the title themselves.
let LIBRARY_ITEMS = [];
let libraryItemsLoaded = false;

function loadLibraryItems() {
    if (libraryItemsLoaded) return Promise.resolve(LIBRARY_ITEMS);
    return fetch(chrome.runtime.getURL("shared/library-items.json"))
        .then((res) => res.json())
        .then((items) => {
            LIBRARY_ITEMS = items || [];
            libraryItemsLoaded = true;
            return LIBRARY_ITEMS;
        })
        .catch((err) => {
            console.error("[Lectoro] Failed to load library-items.json:", err);
            LIBRARY_ITEMS = [];
            return LIBRARY_ITEMS;
        });
}

let libraryLevelFilter = "all";
let librarySearchQuery = "";

function libraryOpenSearch(title) {
    // Opens lookmovie2.to's own search results page for the title — no
    // scraping/downloading of any third-party site's catalog or images
    // happens here, this just navigates the user's browser like a normal link.
    const q = encodeURIComponent(title);
    window.open(`https://www.lookmovie2.to/movies/search/?q=${q}`, "_blank");
}

/** Opens the item's own direct "link" (from library-items.json) if one has
 * been filled in for that title; otherwise falls back to the generic
 * lookmovie2.to search-by-title behaviour used before this field existed. */
function libraryOpenItem(title, link) {
    const trimmed = (link || "").trim();
    if (trimmed) {
        window.open(trimmed, "_blank");
        return;
    }
    libraryOpenSearch(title);
}

function renderLibraryGrid() {
    const grid = document.getElementById("libraryGrid");
    if (!grid) return;

    if (!libraryItemsLoaded) {
        grid.innerHTML = `<div class="library-empty"><div class="library-empty-icon">⏳</div><div class="library-empty-title">Wczytywanie…</div></div>`;
        loadLibraryItems().then(() => renderLibraryGrid());
        return;
    }

    const q = librarySearchQuery.trim().toLowerCase();
    const items = LIBRARY_ITEMS.filter((item) => {
        if (libraryLevelFilter !== "all" && item.level !== libraryLevelFilter)
            return false;
        if (!q) return true;
        return (
            item.title.toLowerCase().includes(q) ||
            item.note.toLowerCase().includes(q)
        );
    });

    if (items.length === 0) {
        const queryLabel = librarySearchQuery.trim();
        grid.innerHTML = `
        <div class="library-empty">
            <div class="library-empty-icon">🔍</div>
            <div class="library-empty-title">Brak wyników w bibliotece</div>
            <div class="library-empty-sub">${
                queryLabel
                    ? `Nie znaleziono „${escapeHtml(queryLabel)}” wśród polecanych tytułów.`
                    : "Żaden z polecanych tytułów nie pasuje do wybranych filtrów."
            }</div>
            ${
                queryLabel
                    ? `<button class="library-open-btn library-empty-search-btn" id="libraryEmptySearchBtn" data-title="${escapeAttr(queryLabel)}">🔎 Szukaj „${escapeHtml(queryLabel)}” na lookmovie2.to</button>`
                    : ""
            }
        </div>`;
        document
            .getElementById("libraryEmptySearchBtn")
            ?.addEventListener("click", (e) => {
                libraryOpenSearch(e.currentTarget.dataset.title);
            });
        return;
    }
    const levelLabel = {
        beginner: "A1/A2",
        intermediate: "B1/B2",
        advanced: "C1/C2",
    };
    const levelIcon = { beginner: "🟢", intermediate: "🟡", advanced: "🔴" };

    grid.innerHTML = items
        .map((item) => {
            const hasImage = !!(item.image && item.image.trim());
            const posterImg = hasImage
                ? `<img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.title)}" loading="lazy" onerror="this.remove(); this.parentElement.classList.add('no-image');">`
                : "";
            return `
        <div class="library-card" data-title="${escapeAttr(item.title)}" data-link="${escapeAttr(item.link || "")}">
            <div class="library-poster${hasImage ? "" : " no-image"}">
                ${posterImg}
                <span class="library-poster-fallback">${levelIcon[item.level]}</span>
            </div>
            <span class="library-level-badge lvl-${item.level}">${levelIcon[item.level]} ${levelLabel[item.level]}</span>
            <div class="library-card-info">
                <div class="library-card-title">${escapeHtml(item.title)}</div>
                <div class="library-card-note">${escapeHtml(item.note)}</div>
            </div>
            <div class="library-poster-overlay"><span>▶ Oglądaj</span></div>
        </div>`;
        })
        .join("");

    grid.querySelectorAll(".library-card[data-title]").forEach((card) => {
        card.addEventListener("click", () => {
            libraryOpenItem(card.dataset.title, card.dataset.link);
        });
    });
}

const librarySearchInput = document.getElementById("librarySearch");
librarySearchInput?.addEventListener("input", (e) => {
    librarySearchQuery = e.target.value;
    renderLibraryGrid();
});
librarySearchInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = librarySearchInput.value.trim();
    if (q) libraryOpenSearch(q);
});

document.querySelectorAll(".library-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document
            .querySelectorAll(".library-filter-btn")
            .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        libraryLevelFilter = btn.dataset.level;
        renderLibraryGrid();
    });
});
