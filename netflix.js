/**
 * Lectoro – Netflix Legacy Compatibility Layer
 * All Netflix functionality is now centralized in adapters/netflix-adapter.js
 * and shared/subtitle-service.js.
 */
(() => {
    "use strict";

    if (globalThis.LectoroNetflixAdapter) {
        globalThis.LectoroNetflix = globalThis.LectoroNetflixAdapter;
    }
})();
