// quiz.js - Lectoro AI Quiz Viewer Controller

(function () {
  "use strict";

  let cachedHtml = "";
  let cachedTitle = "Lectoro_Quiz";
  let isLoaded = false;
  let retryInterval = null;
  let masteryWriteQueue = Promise.resolve();

  function sendQuizToFrame() {
    if (!cachedHtml) return;
    const frame = document.getElementById("quizFrame");
    if (!frame || !frame.contentWindow) return;

    try {
      frame.contentWindow.postMessage(
        {
          action: "LOAD_QUIZ",
          html: cachedHtml,
          title: cachedTitle,
        },
        "*"
      );
    } catch (err) {
      console.error("Failed to post message to quiz runner frame:", err);
    }
  }

  function startSending() {
    if (isLoaded) return;
    sendQuizToFrame();

    let attempts = 0;
    if (retryInterval) clearInterval(retryInterval);
    retryInterval = setInterval(() => {
      if (isLoaded || attempts++ > 15) {
        clearInterval(retryInterval);
        retryInterval = null;
        return;
      }
      sendQuizToFrame();
    }, 150);
  }

  async function loadQuizData() {
    try {
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(
          ["latestQuizHtml", "latestQuizTitle", "latestQuizMode"],
          resolve
        );
      });

      cachedHtml = data.latestQuizHtml || "";
      cachedTitle = data.latestQuizTitle || "Lectoro_Quiz";

      document.title = cachedTitle + " — Lectoro AI";
      startSending();
    } catch (e) {
      console.error("Failed to load quiz data:", e);
    }
  }


  function queueMasteryUpdate(cardId, mastery) {
    if (!cardId || !mastery || typeof mastery !== "object") return;
    const clean = {
      score: Math.max(0, Math.min(100, Number(mastery.score) || 0)),
      recallWins: Math.max(0, Number(mastery.recallWins) || 0),
      contextWins: Math.max(0, Number(mastery.contextWins) || 0),
      wrongs: Math.max(0, Number(mastery.wrongs) || 0),
      lastReviewed: Math.max(0, Number(mastery.lastReviewed) || 0),
      nextReview: Math.max(0, Number(mastery.nextReview) || 0),
    };
    masteryWriteQueue = masteryWriteQueue
      .then(async () => {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get(["quizMasteryV2"], resolve);
        });
        const store =
          data.quizMasteryV2 && typeof data.quizMasteryV2 === "object"
            ? { ...data.quizMasteryV2 }
            : {};
        store[cardId] = clean;
        await new Promise((resolve) => {
          chrome.storage.local.set({ quizMasteryV2: store }, resolve);
        });
      })
      .catch((err) => {
        console.error("Failed to save quiz mastery:", err);
      });
  }

  function initListeners() {
    const frame = document.getElementById("quizFrame");
    if (frame) {
      frame.addEventListener("load", () => {
        startSending();
      });
    }

    window.addEventListener("message", (event) => {
      const frame = document.getElementById("quizFrame");
      if (!frame || event.source !== frame.contentWindow) return;
      if (!event.data) return;
      if (event.data.action === "QUIZ_SANDBOX_READY") {
        startSending();
      } else if (event.data.action === "QUIZ_LOADED") {
        isLoaded = true;
        if (retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
      } else if (event.data.action === "QUIZ_MASTERY_UPDATE") {
        queueMasteryUpdate(event.data.card_id, event.data.mastery);
      }
    });

    const downloadBtn = document.getElementById("downloadHtmlBtn");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        if (!cachedHtml) return;
        const blob = new Blob([cachedHtml], {
          type: "text/html;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeName = (cachedTitle || "quiz")
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "_");
        a.download = `${safeName}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
    }

    const reloadBtn = document.getElementById("reloadQuizBtn");
    if (reloadBtn) {
      reloadBtn.addEventListener("click", () => {
        const frame = document.getElementById("quizFrame");
        if (frame) {
          isLoaded = false;
          frame.src = "quiz-runner.html";
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initListeners();
    loadQuizData();
  });
})();
