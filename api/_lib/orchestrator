// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — api/_lib/orchestrator.js  ("MEGA IA")
// Couche centrale d'orchestration multi-modèles. Fichier SANS export default
// → pas un endpoint public, uniquement une librairie importée.
//
// PHILOSOPHIE (à ne jamais casser) :
//   - Le CODE ne décide jamais du contenu (quel produit, quelle question,
//     quel hôtel). Il décide seulement QUEL MODÈLE appeler et QUAND s'arrêter.
//   - Les modèles gratuits (Groq, Gemini, Mistral, DeepSeek) sont TOUJOURS
//     essayés en premier, dans cet ordre, pour router/décider ET pour générer.
//   - Claude est réservé à la SYNTHÈSE FINALE DE QUALITÉ, appelé seulement
//     quand l'appelant juge que rien d'exploitable n'est sorti des IA
//     gratuites. Ses tokens sont systématiquement plafonnés.
//
// TROIS NIVEAUX EXPOSÉS :
//   route()     → décision rapide et pas chère (Groq 70b en tête). Utilisé
//                 pour "dois-je poser une question ?", "quelle intention ?"
//   generate()  → génération de contenu avec recherche web quand possible
//                 (Groq compound-beta) puis cascade Gemini/Mistral/DeepSeek.
//   finalize()  → dernier recours Claude + web_search, tokens plafonnés.
//                 L'appelant DOIT fournir un test d'utilisabilité (usable)
//                 pour ne déclencher Claude que si vraiment nécessaire.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchT, parseJSON } from './shared.js';

const CLAUDE_MODEL = "claude-haiku-4-5";
const CLAUDE_HARD_CAP = 900; // aucun appel Claude ne dépasse ce plafond de tokens, quoi qu'on demande

// ── MODÈLES GRATUITS ────────────────────────────────────────────────────────
async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] })
    }, 7000);
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}

// Groq compound-beta = seul modèle gratuit avec une vraie recherche web intégrée.
// C'est le pilier de generate() : il évite d'inventer noms/prix/hôtels.
async function groqSearch(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "compound-beta", max_tokens: maxTok || 1500, messages: [{ role: "user", content: prompt }] })
    }, 12000);
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}

async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + key, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTok || 800 } })
    }, 9000);
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates && d.candidates[0] && d.candidates[0].content ? d.candidates[0].content.parts[0].text : null;
  } catch (e) { return null; }
}

async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "mistral-small-latest", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] })
    }, 7000);
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}

async function deepseek(sys, user, maxTok) {
  const key = process.env.DEEPSEEK_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "deepseek-chat", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] })
    }, 7000);
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}

// ── CLAUDE — DERNIER RECOURS ───────────────────────────────────────────────
async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const payload = { model: CLAUDE_MODEL, max_tokens: Math.min(maxTok || 600, CLAUDE_HARD_CAP), system: sys, messages: [{ role: "user", content: user }] };
    if (tools && tools.length) payload.tools = tools;
    const r = await fetchT("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload)
    }, 16000);
    if (!r.ok) return null;
    const d = await r.json();
    let t = ""; for (const b of (d.content || [])) if (b.type === "text") t += b.text;
    return t || null;
  } catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// NIVEAU 1 — route() : décision rapide et gratuite (routing, questions, intent)
// Cascade : Groq 70b → Gemini → Mistral → DeepSeek. Jamais Claude ici : une
// décision de routage ne justifie pas un modèle payant.
// ─────────────────────────────────────────────────────────────────────────────
export async function route(sys, user, maxTok) {
  const raw = await groq(sys, user, maxTok || 400)
    || await gemini(sys + "\n\n" + user, maxTok || 400)
    || await mistral(sys, user, maxTok || 400)
    || await deepseek(sys, user, maxTok || 400);
  return { raw, parsed: parseJSON(raw || "") };
}

// ─────────────────────────────────────────────────────────────────────────────
// NIVEAU 2 — generate() : génération de contenu, recherche web si possible.
// Cascade : Groq compound-beta (avec recherche web réelle, GRATUIT) → Gemini
// → Mistral. Utilisé pour la recherche produit et la génération d'itinéraire.
// ─────────────────────────────────────────────────────────────────────────────
export async function generate(prompt, maxTok) {
  const raw = await groqSearch(prompt, maxTok || 1500)
    || await gemini(prompt, maxTok || 1500)
    || await mistral("Reponds en JSON strict.", prompt, maxTok || 1200);
  return { raw, parsed: parseJSON(raw || "") };
}

// ─────────────────────────────────────────────────────────────────────────────
// NIVEAU 3 — finalize() : Claude, dernier recours uniquement.
// L'appelant DOIT avoir déjà essayé route()/generate() et constaté un résultat
// inexploitable avant d'appeler finalize() — ce n'est pas vérifié ici par
// design (l'orchestrateur reste un outil, pas un policier), mais chat.js et
// travel.js respectent systématiquement cette règle avant de l'invoquer.
// ─────────────────────────────────────────────────────────────────────────────
export async function finalize(sys, user, maxTok, useWebSearch) {
  const tools = useWebSearch ? [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }] : null;
  const raw = await claude(sys, user, maxTok || 700, tools);
  return { raw, parsed: parseJSON(raw || "") };
}

// Exposé pour cas où l'appelant veut appeler un modèle gratuit précis
// (ex: extraction rapide de mots-clés sans passer par toute la cascade route()).
export const models = { groq, groqSearch, gemini, mistral, deepseek, claude };
