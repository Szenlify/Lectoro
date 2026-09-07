"use strict";

function generationConfig(temperature, maxOutputTokens) {
    const temp = Number(temperature), tokens = Number(maxOutputTokens);
    return {
        temperature: Number.isFinite(temp) ? Math.min(Math.max(temp, 0), 2) : 0.2,
        maxOutputTokens: Number.isFinite(tokens) ? Math.min(Math.max(Math.floor(tokens), 1), 8192) : 500,
        responseMimeType: "application/json",
    };
}

function readJsonResponse(response) {
    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason !== "STOP") {
        throw new Error("AI response was blocked or incomplete. Please try again.");
    }
    const text = (candidate.content?.parts || [])
        .filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text).join("").trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) {
        throw new Error("AI returned invalid JSON. Please try again.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("AI returned an invalid response object.");
    }
    return text;
}

module.exports = { generationConfig, readJsonResponse };
