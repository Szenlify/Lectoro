// quiz-runner.js - Sandboxed execution of AI-generated interactive quizzes
(function () {
    function handleMessage(event) {
        // Strict sender validation: accept quiz payloads only from embedding parent window
        if (event.source !== window.parent) return;
        if (event.data && event.data.action === "LOAD_QUIZ" && typeof event.data.html === "string") {
            document.open();
            document.write(event.data.html);
            document.close();
            try {
                window.parent.postMessage({ action: "QUIZ_LOADED" }, "*");
            } catch (e) {}
        }
    }

    window.addEventListener("message", handleMessage);

    try {
        window.parent.postMessage({ action: "QUIZ_SANDBOX_READY" }, "*");
    } catch (e) {}
})();
