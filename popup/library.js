// ── Library tab: curated titles well-suited for learning English ──
// Static, hand-picked list (title / difficulty / short note / link / image),
// stored in shared/library-items.json and loaded once when the popup opens.
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

/** Opens the item's own direct "link" (from library-items.json);
 * falls back to YouTube search if link is empty. */
function libraryOpenItem(title, link) {
    const trimmed = (link || "").trim();
    if (trimmed) {
        window.open(trimmed, "_blank");
        return;
    }
    const q = encodeURIComponent(title);
    window.open(`https://www.youtube.com/results?search_query=${q}`, "_blank");
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
            (item.title && item.title.toLowerCase().includes(q)) ||
            (item.note && item.note.toLowerCase().includes(q))
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
                    ? `Nie znaleziono „${escapeHtml(queryLabel)}” wśród polecanych pozycji.`
                    : "Żadna z pozycji nie pasuje do wybranych filtrów."
            }</div>
        </div>`;
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
                <span class="library-poster-fallback">${levelIcon[item.level] || "🎬"}</span>
            </div>
            <span class="library-level-badge lvl-${item.level || "beginner"}">${levelIcon[item.level] || "🟢"} ${levelLabel[item.level] || "A1/A2"}</span>
            <div class="library-card-info">
                <div class="library-card-title">${escapeHtml(item.title)}</div>
                <div class="library-card-note">${escapeHtml(item.note || "")}</div>
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
