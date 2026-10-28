'use strict';
/* =====================================================================
   Fluency 365 — app de inglês (PWA, sem build, sem servidor)
   Progresso: localStorage (+ sincronização opcional via GitHub Gist secreto)
   Conteúdo:  content.js (pode ser atualizado sem tocar no progresso)
   ===================================================================== */
const LS = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem() {} };
const WEEKS = window.WEEKS, PHASES = window.PHASES, NW = WEEKS.length;
const TTS = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const DEF = { gemini: 'gemini-2.5-flash', claude: 'claude-haiku-5-5' };

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return todayStr(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function toast(msg, ms = 2600, onclick) {
  const t = document.getElementById('toast'); t.textContent = msg; t.onclick = onclick || null; t.style.pointerEvents = onclick ? 'auto' : 'none';
  t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms);
}

/* ---------- estado (progresso) ----------
   IDs estáveis: sessão "w3d2", etapa "w3d2.drill", cartão "w3p4" (semana 3, frase 4).
   Para mudar o formato no futuro, acrescente um passo em migrate() — nunca apague dados. */
const SK = 'fluency.state', CK = 'fluency.cfg', SCHEMA = 2;
const blank = () => ({ v: SCHEMA, start: todayStr(), done: {}, steps: {}, srs: {}, custom: [], scores: [], minutes: {}, days: {}, upd: 0 });
function migrate(s) {
  s = Object.assign(blank(), s || {});
  // if (s.v < 3) { ...transformar dados antigos aqui... }
  s.v = SCHEMA; return s;
}
let S = (() => { try { return migrate(JSON.parse(LS.getItem(SK))); } catch (e) { return blank(); } })();
let CFG = Object.assign({ provider: 'gemini', apiKey: '', model: '', rate: 0.95, gistToken: '', gistId: '', intro: false, autoSpeak: true },
  (() => { try { return JSON.parse(LS.getItem(CK)) || {}; } catch (e) { return {}; } })());
const persist = () => LS.setItem(SK, JSON.stringify(S));
const saveCfg = () => LS.setItem(CK, JSON.stringify(CFG));
function save() { S.upd = Date.now(); persist(); scheduleSync(); }
function active() { S.days[todayStr()] = 1; }
function streak() { let n = 0, d = todayStr(); if (!S.days[d]) d = addDays(d, -1); while (S.days[d]) { n++; d = addDays(d, -1); } return n; }

function merge(a, b) {
  const o = JSON.parse(JSON.stringify(a)); b = migrate(JSON.parse(JSON.stringify(b)));
  if (b.start < o.start) o.start = b.start;
  for (const k of ['done', 'steps']) for (const x in b[k]) o[k][x] = Math.max(o[k][x] || 0, b[k][x]);
  for (const x in b.srs) if (!o.srs[x] || (b.srs[x].u || 0) > (o.srs[x].u || 0)) o.srs[x] = b.srs[x];
  const cm = new Map(o.custom.map(c => [c.id, c]));
  b.custom.forEach(c => { const p = cm.get(c.id); if (!p || (c.u || 0) > (p.u || 0)) cm.set(c.id, c); });
  o.custom = [...cm.values()];
  const sc = new Map(o.scores.map(c => [c.id, c])); b.scores.forEach(c => sc.set(c.id, c));
  o.scores = [...sc.values()].sort((x, y) => x.t - y.t).slice(-600);
  for (const x in b.minutes) o.minutes[x] = Math.max(o.minutes[x] || 0, b.minutes[x]);
  Object.assign(o.days, b.days); o.upd = Math.max(o.upd || 0, b.upd || 0);
  return o;
}

/* ---------- currículo ---------- */
const phaseOf = w => PHASES.find(p => w >= p.weeks[0] && w <= p.weeks[1]) || PHASES[PHASES.length - 1];
const sid = (w, d) => `w${w}d${d}`;
const DAYS = ['', 'Aula', 'Rápido', 'Aula', 'Rápido', 'Aula de conversa', 'Imersão', 'Revisão semanal'];
function nextSession() { for (let w = 1; w <= NW; w++) for (let d = 1; d <= 7; d++) if (!S.done[sid(w, d)]) return { w, d }; return null; }
function weekDone(w) { let n = 0; for (let d = 1; d <= 7; d++) if (S.done[sid(w, d)]) n++; return n; }

function buildSession(w, d) {
  const id = sid(w, d), A = [0, 1, 2], B = [3, 4, 5], ALL = [0, 1, 2, 3, 4, 5];
  const st = (type, o = {}) => ({ key: `${id}.${type}${o.n || ''}`, type, ...o });
  const imm = i => PHASES.length && phaseOf(w).immersion[(w + i) % phaseOf(w).immersion.length];
  switch (d) {
    case 1: return { title: 'Aula 1 · frases novas e gramática', min: 35, steps: [
      st('srs', { title: 'Revisar cartões de hoje' }), st('phrases', { idx: A, title: 'Frases novas (1–3)' }),
      st('grammar', { title: 'Gramática da semana' }), st('drill', { idx: A, title: 'Pronúncia: fale cada frase' })] };
    case 2: return { title: 'Rápido · shadowing', min: 15, steps: [
      st('srs', { title: 'Revisar cartões de hoje' }), st('drill', { idx: ALL, shadow: true, title: 'Shadowing: ouça e repita junto' })] };
    case 3: return { title: 'Aula 2 · mais frases + suas frases', min: 35, steps: [
      st('srs', { title: 'Revisar cartões de hoje' }), st('phrases', { idx: B, title: 'Frases novas (4–6)' }),
      st('write', { title: 'Crie 3 frases suas com a gramática' }), st('drill', { idx: B, title: 'Pronúncia: fale cada frase' })] };
    case 4: return { title: 'Rápido · revisão + escuta', min: 15, steps: [
      st('srs', { title: 'Revisar cartões de hoje' }), st('drill', { idx: B, shadow: true, title: 'Shadowing das frases 4–6' }),
      st('immersion', { short: true, sug: imm(1), title: 'Escuta rápida (10 min)' })] };
    case 5: return { title: 'Aula 3 · conversa guiada', min: 40, steps: [
      st('srs', { title: 'Revisar cartões de hoje' }), st('drill', { idx: ALL, title: 'Pronúncia das 6 frases' }),
      st('chat', { title: 'Conversa com o tutor' })] };
    case 6: return { title: 'Imersão · série, podcast ou vídeo', min: 45, steps: [
      st('immersion', { sug: imm(2), title: 'Imersão (30–45 min)' }), st('note', { title: 'Anote frases novas que você ouviu' })] };
    default: return { title: 'Revisão semanal + teste', min: 30, steps: [
      st('srs', { title: 'Revisar cartões de hoje' }),
      st('drill', { idx: ALL, test: true, title: 'Teste: diga em inglês de memória' }),
      st('mono', { title: 'Fale 1–2 minutos sobre o tema' })] };
  }
}

/* ---------- cartões / repetição espaçada ---------- */
function cardOf(id) {
  const m = /^w(\d+)p(\d)$/.exec(id);
  if (m) { const p = WEEKS[m[1] - 1] && WEEKS[m[1] - 1].p[m[2]]; return p && { id, en: p[0], pt: p[1] }; }
  return S.custom.find(c => c.id === id && !c.del);
}
function addCard(id) { if (!S.srs[id]) S.srs[id] = { e: 2.5, i: 0, r: 0, d: todayStr(), u: Date.now() }; }
const dueIds = () => Object.keys(S.srs).filter(id => S.srs[id].d <= todayStr() && cardOf(id)).sort((a, b) => S.srs[a].d.localeCompare(S.srs[b].d));
function grade(id, g) {
  const c = S.srs[id], t = todayStr();
  if (g === 0) { c.r = 0; c.i = 0; c.e = Math.max(1.3, c.e - .2); c.d = t; }
  else {
    if (g === 1) { c.i = Math.max(1, Math.round((c.i || 1) * 1.2)); c.e = Math.max(1.3, c.e - .15); }
    else if (g === 2) c.i = c.r === 0 ? 1 : c.r === 1 ? 3 : Math.round(c.i * c.e);
    else { c.i = c.r === 0 ? 3 : Math.round(Math.max(c.i, 1) * c.e * 1.3); c.e += .1; }
    c.r++; c.d = addDays(t, c.i);
  }
  c.u = Date.now(); active(); save();
}
function addCustom(en, pt, extra = {}) {
  en = en.trim(); if (!en) return null;
  if (S.custom.some(c => !c.del && c.en.toLowerCase() === en.toLowerCase())) return null;
  const c = { id: 'c' + uid(), kind: 'note', en, pt: (pt || '').trim() || '(sua anotação)', u: Date.now(), ...extra };
  S.custom.push(c); addCard(c.id); save(); return c;
}

/* ---------- voz: síntese (ouvir) ---------- */
function pickVoice() {
  if (!TTS) return null;
  const all = TTS.getVoices(), us = all.filter(v => /^en[-_]US/i.test(v.lang));
  return us.find(v => /Google US English|Samantha|Aria|Jenny|Ava|Allison|Zira/i.test(v.name)) || us[0] || all.find(v => /^en/i.test(v.lang)) || null;
}
function say(text, slow) {
  if (!TTS) return toast('Seu navegador não tem voz para ouvir o inglês.');
  TTS.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US';
  const v = pickVoice(); if (v) u.voice = v; u.rate = slow ? 0.62 : CFG.rate; TTS.speak(u);
}
function sayAll(list, i = 0) {
  if (!TTS || i >= list.length) return;
  TTS.cancel(); const u = new SpeechSynthesisUtterance(list[i]); u.lang = 'en-US'; const v = pickVoice(); if (v) u.voice = v; u.rate = CFG.rate;
  u.onend = () => setTimeout(() => sayAll(list, i + 1), 1500); TTS.speak(u);
}

/* ---------- voz: reconhecimento (falar) ---------- */
let rec = null;
function stopRec() { if (rec) { try { rec.stop(); } catch (e) { } } }
function listen(o) {
  if (!SR) { o.onError && o.onError('Este navegador não reconhece voz. Use o Chrome (Android/PC) ou o Safari (iPhone), direto no navegador.'); o.onEnd && o.onEnd({ text: '', alts: [], fatal: true }); return null; }
  stopRec();
  const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.continuous = !!o.continuous; r.maxAlternatives = 3;
  const finals = []; let alts = [], fatal = false;
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) { finals.push(res[0].transcript.trim()); alts = [...res].map(a => a.transcript.trim()); } else interim += res[0].transcript;
    }
    o.onInterim && o.onInterim((finals.join(' ') + ' ' + interim).trim());
  };
  r.onerror = e => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) fatal = true;
    const M = { 'not-allowed': 'Permita o microfone nas configurações do navegador.', 'service-not-allowed': 'Permita o microfone nas configurações do navegador.', 'audio-capture': 'Microfone não encontrado.', 'network': 'Sem internet para o reconhecimento de voz.', 'no-speech': 'Não ouvi nada. Fale mais perto do microfone.' };
    if (e.error !== 'aborted') o.onError && o.onError(M[e.error] || 'Erro de voz: ' + e.error);
  };
  r.onend = () => { if (rec === r) rec = null; o.onEnd && o.onEnd({ text: finals.join(' ').trim(), alts, fatal }); };
  rec = r;
  try { r.start(); } catch (e) { rec = null; o.onError && o.onError('Não consegui iniciar o microfone.'); o.onEnd && o.onEnd({ text: '', alts: [], fatal: true }); }
  return r;
}

/* ---------- comparação de pronúncia ---------- */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function n2w(n) {
  if (n < 20) return ONES[n]; if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + n2w(n % 100) : '');
  if (n < 10000) { const y = Math.floor(n / 1000); return ONES[y] + ' thousand' + (n % 1000 ? ' ' + n2w(n % 1000) : ''); }
  return String(n).split('').map(x => ONES[+x]).join(' ');
}
function norm(s) {
  s = String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\$/g, ' dollars ').replace(/%/g, ' percent ');
  s = s.replace(/\b\d+\b/g, m => n2w(+m))
    .replace(/\bgonna\b/g, 'going to').replace(/\bwanna\b/g, 'want to').replace(/\bgotta\b/g, 'got to').replace(/\bkinda\b/g, 'kind of').replace(/\bdunno\b/g, 'do not know')
    .replace(/\bcannot\b/g, 'can not').replace(/\bcan't\b/g, 'can not').replace(/\bwon't\b/g, 'will not').replace(/\blet's\b/g, 'let us')
    .replace(/n't\b/g, ' not').replace(/'m\b/g, ' am').replace(/'re\b/g, ' are').replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will').replace(/'d\b/g, ' would').replace(/'s\b/g, ' is');
  return s.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[n];
}
const similar = (a, b) => a.length >= 3 && b.length >= 3 && lev(a, b) <= 1;
function align(t, h) {
  const n = t.length, m = h.length, D = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) D[i][0] = i; for (let j = 0; j <= m; j++) D[0][j] = j;
  const cost = (a, b) => a === b ? 0 : similar(a, b) ? .5 : 1;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + cost(t[i - 1], h[j - 1]), D[i - 1][j] + 1, D[i][j - 1] + 1);
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + cost(t[i - 1], h[j - 1])) {
      const same = t[i - 1] === h[j - 1];
      ops.push({ t: t[i - 1], h: h[j - 1], st: same ? 'ok' : similar(t[i - 1], h[j - 1]) ? 'near' : 'bad' }); i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push({ t: t[i - 1], h: null, st: 'miss' }); i--; }
    else { ops.push({ t: null, h: h[j - 1], st: 'extra' }); j--; }
  }
  return ops.reverse();
}
function evaluate(target, cands) {
  const t = norm(target); let best = null;
  for (const c of cands.filter(Boolean)) {
    const ops = align(t, norm(c));
    const sc = ops.reduce((s, o) => s + (o.st === 'ok' ? 1 : o.st === 'near' ? .5 : 0), 0);
    const acc = t.length ? Math.round(sc / t.length * 100) : 0;
    if (!best || acc > best.acc) best = { acc, ops, heard: c };
  }
  return best || { acc: 0, ops: [], heard: '' };
}
const TIPS = [
  [/th/, 'TH: ponha a ponta da língua entre os dentes e sopre (think) ou faça vibrar (this, the). Não troque por F, T ou D.'],
  [/^h/, 'H inicial: é só um sopro de ar (house, have). Não pronuncie como o “R” do português nem deixe mudo.'],
  [/^r/, 'R inglês: arredonde os lábios e recue a língua sem encostar no céu da boca. Não é o “rr” de “rato”.'],
  [/ed$/, 'Final -ed: soa /t/ (worked), /d/ (played) ou /ɪd/ (wanted). Não diga “éd”.'],
  [/^s[ptk]/, 'S + consoante no início (speak, street): não coloque um “i” antes (“ispeak”).'],
  [/(tion|sion)$/, 'Final -tion: soa “shn” (/ʃən/), não “tion” com T.'],
  [/ee|ea/, 'Vogal longa /iː/ (see, eat) x curta /ɪ/ (sit, it): alongue bem a longa.'],
  [/^w/, 'W: arredonde os lábios como num “u” rápido (water). Não troque por V.'],
  [/ll$|l$/, 'L final (all, will, feel): encoste a ponta da língua atrás dos dentes de cima. No português vira “u”; em inglês não.'],
  [/[bcdfgkpt]$/, 'Consoante final (want, stop, bad): pare o som seco. Não acrescente um “i” no fim (“wanti”).']
];
function tipsFor(words) {
  const out = [];
  for (const w of words) for (const [re, tip] of TIPS) if (re.test(w)) { if (!out.includes(tip)) out.push(tip); break; }
  return out.slice(0, 3);
}
function evalHTML(ev) {
  const w = ev.ops.map(o => {
    if (o.st === 'ok') return `<span class="w ok">${esc(o.t)}</span>`;
    if (o.st === 'near') return `<span class="w near" title="Ouvi: ${esc(o.h)}">${esc(o.t)}</span>`;
    if (o.st === 'bad') return `<span class="w bad">${esc(o.t)}<small>ouvi “${esc(o.h)}”</small></span>`;
    if (o.st === 'miss') return `<span class="w bad">${esc(o.t)}<small>não ouvi</small></span>`;
    return `<span class="w extra">+${esc(o.h)}</span>`;
  }).join(' ');
  const trouble = ev.ops.filter(o => ['bad', 'miss', 'near'].includes(o.st)).map(o => o.t);
  const tips = tipsFor(trouble).map(t => `<div class="tip">💡 ${esc(t)}</div>`).join('');
  const cls = ev.acc >= 85 ? 's-a' : ev.acc >= 60 ? 's-b' : 's-c';
  const msg = ev.acc >= 90 ? 'Excelente!' : ev.acc >= 75 ? 'Muito bom' : ev.acc >= 50 ? 'Quase lá' : 'Tente de novo, devagar';
  return `<div class="score ${cls}">${ev.acc}% · ${msg}</div><div class="words">${w}</div>${tips}` +
    (ev.ops.some(o => o.st === 'near') ? '<div class="muted">Laranja: entendi quase certo, mas o som pode estar diferente. Ouça o modelo e repita.</div>' : '');
}
function logScore(acc) {
  S.scores.push({ id: uid(), t: Date.now(), acc }); if (S.scores.length > 600) S.scores = S.scores.slice(-600);
  active(); save();
}
/* Um "ouvir e avaliar" completo para um botão + área de resultado */
function attempt(btn, resEl, target, cb) {
  if (btn.dataset.on) { stopRec(); return; }
  let err = false; btn.dataset.on = 1; btn.classList.add('on'); const old = btn.innerHTML; btn.innerHTML = '⏹ Ouvindo…';
  listen({
    onInterim: t => resEl.innerHTML = `<div class="interim">🎙 ${esc(t)}</div>`,
    onError: m => { err = true; resEl.innerHTML = `<div class="err">${esc(m)}</div>`; },
    onEnd: ({ text, alts }) => {
      delete btn.dataset.on; btn.classList.remove('on'); btn.innerHTML = old;
      if (!text) { if (!err) resEl.innerHTML = '<div class="err">Não ouvi nada. Tente de novo.</div>'; return; }
      const ev = evaluate(target, [text, ...alts]); logScore(ev.acc); resEl.innerHTML = evalHTML(ev); cb && cb(ev);
    }
  });
}

/* ---------- IA (tutor) ---------- */
async function askAI(system, msgs) {
  if (!CFG.apiKey) throw new Error('NOKEY');
  let r, j;
  if (CFG.provider === 'claude') {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': CFG.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: CFG.model || DEF.claude, max_tokens: 1024, system, messages: msgs }) });
    j = await r.json(); if (!r.ok) { const e = new Error(j.error && j.error.message || 'HTTP ' + r.status); e.status = r.status; throw e; }
    return j.content.map(c => c.text || '').join('');
  }
  r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CFG.model || DEF.gemini)}:generateContent`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': CFG.apiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
      contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } }) });
  j = await r.json(); if (!r.ok) { const e = new Error(j.error && j.error.message || 'HTTP ' + r.status); e.status = r.status; throw e; }
  return ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');
}
function parseJSON(t) {
  t = String(t).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) { } }
  return { reply: t, corrections: [] };
}
function aiErr(e) {
  if (e.message === 'NOKEY') return 'Ative a IA em ⚙️ Configurações (é grátis com o Gemini).';
  if (e.status === 429 || /quota|rate/i.test(e.message)) return 'Limite gratuito atingido por agora. Espere 1–2 minutos e tente de novo.';
  if (/API key|API_KEY|permission|401|403/i.test(e.message) || e.status === 400 || e.status === 401 || e.status === 403) return 'A chave de API parece inválida ou sem permissão. Confira em ⚙️ Configurações. (' + e.message + ')';
  if (/Failed to fetch|NetworkError/i.test(e.message)) return 'Sem conexão com a IA. Verifique sua internet.';
  return 'Erro da IA: ' + e.message;
}
const levelOf = w => phaseOf(w).level;
function tutorSystem(mode, ctx) {
  const base = `You are a warm, patient English tutor for a Brazilian Portuguese speaker. Learner level (CEFR): ${ctx.level}. Current study theme: ${ctx.theme}. Grammar focus: ${ctx.grammar}.`;
  const schema = `Respond ONLY with JSON in this exact shape: {"reply":"...","corrections":[{"original":"the learner's wrong words","better":"natural correct version","why":"explicação curta em português do Brasil"}],"praise":"uma frase curta em português destacando algo que o aluno fez bem","tip":"uma dica curta em português (pode ser string vazia)"}. Maximum 3 corrections, the most important ones. If there are no mistakes, use an empty corrections array. Learner text may come from speech recognition: ignore missing punctuation/capitalization, but DO flag wrong grammar, wrong word choice, unnatural phrasing and words that look like pronunciation errors (a similar-sounding wrong word).`;
  if (mode === 'check') return `${base} The learner sends practice sentences. Do not roleplay. In "reply" write all sentences corrected and natural, in English. ${schema}`;
  if (mode === 'mono') return `${base} The learner spoke freely for 1-2 minutes; you get the speech-recognition transcript. In "reply" write a more natural version of what they said (keep their meaning, same level, max 5 sentences). ${schema}`;
  return `${base} Hold a natural conversation. Use simple English matching the level: short sentences, 1-3 sentences per turn, always end with ONE short question that keeps the learner talking. ${ctx.scenario ? 'Scenario: ' + ctx.scenario : ''} In "reply" put your next message in English (no Portuguese there). ${schema}`;
}
const corrHTML = list => (list || []).filter(c => c && c.better).map(c => `<div class="corr"><div class="bad">✗ ${esc(c.original)}</div><div class="good">✓ ${esc(c.better)} <button class="mini" data-say="${esc(c.better)}">🔊</button></div><div class="why">${esc(c.why)}</div></div>`).join('');
function saveErrors(list) {
  let n = 0;
  (list || []).forEach(c => { if (c && c.better && addCustom(c.better, 'Corrija: “' + (c.original || '') + '”', { kind: 'err', why: c.why || '' })) n++; });
  return n;
}

/* ---------- componentes ---------- */
function mountReview(el, limit, onFinish) {
  const q = dueIds().slice(0, limit), total = q.length; let n = 0, cur = null, ev = null; const again = new Set();
  if (!q.length) { el.innerHTML = '<div class="empty">🎉 Nenhum cartão para revisar agora.</div>'; onFinish && onFinish(true); return; }
  const next = () => { cur = q.shift(); ev = null; if (!cur) { el.innerHTML = `<div class="empty">✅ Revisão concluída (${n} cartões).</div>`; onFinish && onFinish(); return; } front(); };
  function front() {
    const c = cardOf(cur);
    el.innerHTML = `<div class="muted">${n}/${total}</div><div class="card flash"><div class="pt big">${esc(c.pt)}</div><div class="muted">Diga em inglês (ou mostre a resposta).</div>
      <div class="row" style="justify-content:center"><button class="btn" data-c="rec">🎤 Falar</button><button class="btn" data-c="show">👁 Mostrar</button></div><div class="res"></div></div>`;
  }
  function back() {
    const c = cardOf(cur), sug = ev ? (ev.acc >= 85 ? 2 : ev.acc >= 60 ? 1 : 0) : -1;
    el.innerHTML = `<div class="muted">${n}/${total}</div><div class="card flash"><div class="pt">${esc(c.pt)}</div>
      <div class="en big">${esc(c.en)} <button class="mini" data-say="${esc(c.en)}">🔊</button></div>${c.why ? `<div class="muted">${esc(c.why)}</div>` : ''}
      ${ev ? evalHTML(ev) : ''}<div class="grades">${['Errei', 'Difícil', 'Bom', 'Fácil'].map((t, i) => `<button class="btn g${i}${sug === i ? ' sug' : ''}" data-g="${i}">${t}</button>`).join('')}</div></div>`;
  }
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c === 'show') { say(cardOf(cur).en); back(); }
    else if (b.dataset.c === 'rec') {
      const res = $('.res', el);
      attempt(b, res, cardOf(cur).en, e2 => { ev = e2; setTimeout(back, 900); });
    } else if (b.dataset.g !== undefined) {
      const g = +b.dataset.g; grade(cur, g); if (g === 0 && !again.has(cur)) { again.add(cur); q.push(cur); } n++; next();
    }
  };
  next();
}

function mountChat(el, o) {
  const hist = []; let turns = 0, busy = false;
  const ctx = { level: o.level, theme: o.theme, grammar: o.grammar, scenario: o.scenario };
  el.innerHTML = `<div class="msgs"></div><div class="composer"><button class="btn" data-c="mic" title="Falar">🎤</button><input type="text" placeholder="Fale ou escreva em inglês…" autocomplete="off"><button class="btn pri" data-c="send">Enviar</button></div>
    <div class="row"><label class="chk" style="margin:0"><input type="checkbox" data-c="auto" ${CFG.autoSpeak ? 'checked' : ''}> Ler as respostas em voz alta</label></div>`;
  const box = $('.msgs', el), inp = $('input[type=text]', el);
  const add = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; box.appendChild(d); box.scrollTop = box.scrollHeight; return d; };
  async function turn(text, userDiv) {
    busy = true; const typing = add('msg ai', '…');
    try {
      hist.push({ role: 'user', content: text });
      const raw = await askAI(tutorSystem('chat', ctx), hist);
      const j = parseJSON(raw); hist.push({ role: 'assistant', content: raw }); typing.remove();
      const aiDiv = add('msg ai', esc(j.reply || '') + ` <button class="mini" data-say="${esc(j.reply || '')}">🔊</button>`);
      if (userDiv && (j.corrections || []).length) { const f = document.createElement('div'); f.className = 'fb'; f.innerHTML = corrHTML(j.corrections) + (j.praise ? `<div class="praise">👏 ${esc(j.praise)}</div>` : ''); box.insertBefore(f, aiDiv); saveErrors(j.corrections); }
      else if (userDiv && j.praise) { const f = document.createElement('div'); f.className = 'fb'; f.innerHTML = `<div class="praise">✅ Sem erros! ${esc(j.praise)}</div>`; box.insertBefore(f, aiDiv); }
      if (userDiv && j.tip) { const f = document.createElement('div'); f.className = 'fb'; f.innerHTML = `<div class="tip">💡 ${esc(j.tip)}</div>`; box.insertBefore(f, aiDiv); }
      box.scrollTop = box.scrollHeight;
      if (CFG.autoSpeak && j.reply) say(j.reply);
      if (userDiv) { turns++; active(); save(); o.onTurn && o.onTurn(turns); }
    } catch (e) { typing.remove(); hist.pop(); add('msg ai', '⚠️ ' + esc(aiErr(e))); }
    busy = false;
  }
  function send(text) { text = (text || '').trim(); if (!text || busy) return; inp.value = ''; const d = add('msg me', esc(text)); turn(text, d); }
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c === 'send') send(inp.value);
    if (b.dataset.c === 'mic') {
      if (busy) return;
      if (b.dataset.on) { stopRec(); return; }
      b.dataset.on = 1; b.classList.add('on'); b.textContent = '⏹';
      listen({ onInterim: t => inp.value = t, onError: m => toast(m, 4000),
        onEnd: ({ text }) => { delete b.dataset.on; b.classList.remove('on'); b.textContent = '🎤'; if (text) send(text); } });
    }
  };
  $('[data-c=auto]', el).onchange = e => { CFG.autoSpeak = e.target.checked; saveCfg(); };
  inp.onkeydown = e => { if (e.key === 'Enter') send(inp.value); };
  turn('Hi! Please start the conversation.', null);
}

function usedPhrases(w, text) {
  const T = new Set(norm(text));
  return WEEKS[w - 1].p.map(([en]) => { const ws = norm(en).filter(x => x.length > 3); const hit = ws.filter(x => T.has(x)).length; return { en, ok: ws.length > 0 && hit / ws.length >= .7 }; });
}
function mountMono(el, o) {
  el.innerHTML = `<p>🗣 <b>${esc(o.prompt)}</b></p><div class="muted">Fale em inglês. Não pare para pensar em tudo: se esquecer uma palavra, contorne com outras palavras.</div>
    <div class="row"><button class="btn pri" data-c="go">🎤 Começar a falar</button></div><div class="live interim"></div><div class="mres"></div>`;
  const btn = $('[data-c=go]', el), live = $('.live', el), out = $('.mres', el);
  let acc = '', on = false, t0 = 0, fatal = false;
  function loop() {
    listen({ continuous: true, onInterim: t => live.textContent = '🎙 ' + (acc + ' ' + t).trim(), onError: m => { if (!/Não ouvi/.test(m)) toast(m, 4000); },
      onEnd: ({ text, fatal: f }) => { acc = (acc + ' ' + text).trim(); if (f) fatal = true; if (on && !fatal) setTimeout(loop, 150); else finish(); } });
  }
  async function finish() {
    on = false; btn.classList.remove('on'); btn.textContent = '🎤 Falar de novo'; live.textContent = '';
    const text = acc.trim(), secs = Math.max(1, Math.round((Date.now() - t0) / 1000)); acc = ''; t0 = 0; fatal = false;
    if (!text) { out.innerHTML = '<div class="err">Não captei sua fala. Tente de novo.</div>'; return; }
    const words = text.split(/\s+/).length, wpm = Math.round(words / secs * 60);
    const used = o.week ? usedPhrases(o.week, text) : [];
    out.innerHTML = `<div class="card"><b>O que entendi:</b><p>${esc(text)}</p><div class="muted">${words} palavras em ${secs}s (~${wpm} palavras/min; falantes nativos ficam em ~120–150).</div>
      ${used.length ? `<p>Frases da semana usadas: ${used.map(u => `<span class="chip ${u.ok ? 'ok' : ''}">${u.ok ? '✓' : '○'} ${esc(u.en.slice(0, 28))}${u.en.length > 28 ? '…' : ''}</span>`).join('')}</p>` : ''}</div><div class="ai"></div>`;
    const aiBox = $('.ai', out);
    if (!CFG.apiKey) { aiBox.innerHTML = '<div class="tip">Para receber correções da sua fala, ative a IA grátis em ⚙️ Configurações. Sem ela, compare com os exemplos da semana e regrave até ficar natural.</div>'; o.onDone && o.onDone(); return; }
    aiBox.innerHTML = '<div class="muted">Analisando sua fala…</div>';
    try {
      const raw = await askAI(tutorSystem('mono', { level: o.level, theme: o.theme, grammar: o.grammar }), [{ role: 'user', content: text }]);
      const j = parseJSON(raw); const n = saveErrors(j.corrections);
      aiBox.innerHTML = (corrHTML(j.corrections) || '<div class="praise">✅ Não encontrei erros importantes!</div>') + (j.praise ? `<div class="praise">👏 ${esc(j.praise)}</div>` : '') + (j.tip ? `<div class="tip">💡 ${esc(j.tip)}</div>` : '') +
        (j.reply ? `<div class="card"><b>Versão mais natural:</b><p>${esc(j.reply)} <button class="mini" data-say="${esc(j.reply)}">🔊</button></p></div>` : '') + (n ? `<div class="muted">${n} correção(ões) foram para suas revisões.</div>` : '');
      o.onDone && o.onDone();
    } catch (e) { aiBox.innerHTML = `<div class="err">${esc(aiErr(e))}</div>`; }
  }
  btn.onclick = () => {
    if (on) { on = false; stopRec(); return; }
    on = true; t0 = Date.now(); acc = ''; out.innerHTML = ''; btn.classList.add('on'); btn.textContent = '⏹ Terminar'; loop();
  };
}

/* ---------- etapas da sessão ---------- */
function phraseRows(w, idx, o = {}) {
  return idx.map(i => {
    const [en, pt] = WEEKS[w - 1].p[i];
    const hidden = o.test;
    return `<div class="ph" data-i="${i}"><div class="en">${hidden ? '<span class="muted">🔒 diga em inglês…</span>' : esc(en)}</div><div class="pt">${esc(pt)}</div>
      <div class="row">${hidden ? `<button class="mini" data-c="reveal">💡 dica</button>` : `<button class="mini" data-say="${esc(en)}">🔊 Ouvir</button><button class="mini" data-say="${esc(en)}" data-slow="1">🐢 Devagar</button>`}${o.rec ? '<button class="btn" data-c="rec">🎤 Falar</button>' : ''}</div><div class="res"></div></div>`;
  }).join('');
}
function mountStep(step, w, d, body, finish, isDone) {
  const W = WEEKS[w - 1], ph = phaseOf(w), ctx = { level: ph.level, theme: W.t, grammar: W.g };
  const doneBtn = (txt = 'Concluir etapa') => `<div class="row"><button class="btn pri" data-c="done" ${isDone ? 'disabled' : ''}>${isDone ? '✔ Concluída' : txt}</button></div>`;
  const bindDone = (fn) => { const b = $('[data-c=done]', body); if (b) b.onclick = () => { fn && fn(); finish(); b.textContent = '✔ Concluída'; b.disabled = true; }; };
  switch (step.type) {
    case 'srs':
      mountReview(body, 12, none => { if (!isDone) finish(); });
      break;
    case 'phrases':
      body.innerHTML = `<p class="muted">Ouça cada frase 2–3 vezes, depois leia em voz alta imitando o ritmo.</p>${phraseRows(w, step.idx)}${doneBtn('Entendi, adicionar às revisões')}`;
      bindDone(() => { step.idx.forEach(i => addCard(`w${w}p${i}`)); save(); });
      break;
    case 'grammar':
      body.innerHTML = `<div class="card" style="margin-top:0"><h3>${esc(W.t)}</h3><p>${esc(W.g)}</p></div><p class="muted">Leia os exemplos em voz alta e note o padrão:</p>${phraseRows(w, [0, 1, 2, 3, 4, 5])}${doneBtn('Entendi')}`;
      bindDone();
      break;
    case 'write':
      body.innerHTML = `<p>${esc(W.g)}</p><label>Escreva 3 frases suas usando esse ponto (sobre a sua vida):</label><textarea placeholder="1. …&#10;2. …&#10;3. …"></textarea>
        <div class="row"><button class="btn pri" data-c="check">✨ Corrigir com a IA</button></div><div class="ai"></div>${doneBtn()}`;
      $('[data-c=check]', body).onclick = async () => {
        const text = $('textarea', body).value.trim(), box = $('.ai', body); if (!text) return toast('Escreva suas frases primeiro.');
        if (!CFG.apiKey) { box.innerHTML = '<div class="tip">A correção automática precisa da IA grátis (⚙️ Configurações). Por enquanto compare com os exemplos acima.</div>'; return; }
        box.innerHTML = '<div class="muted">Corrigindo…</div>';
        try {
          const j = parseJSON(await askAI(tutorSystem('check', ctx), [{ role: 'user', content: text }])); const n = saveErrors(j.corrections);
          box.innerHTML = (corrHTML(j.corrections) || '<div class="praise">✅ Tudo certo!</div>') + (j.praise ? `<div class="praise">👏 ${esc(j.praise)}</div>` : '') + (j.reply ? `<div class="card"><b>Versão natural:</b><p>${esc(j.reply)}</p></div>` : '') + (n ? `<div class="muted">${n} correção(ões) foram para suas revisões.</div>` : '');
        } catch (e) { box.innerHTML = `<div class="err">${esc(aiErr(e))}</div>`; }
      };
      bindDone();
      break;
    case 'drill': {
      const best = {};
      body.innerHTML = `<p class="muted">${step.test ? 'Veja só a tradução e diga a frase em inglês de memória. Use “dica” se travar.' : step.shadow ? 'Shadowing: toque em 🔊 e fale junto com o áudio, copiando ritmo e entonação. Depois grave com 🎤.' : 'Ouça, depois toque em 🎤 e fale a frase. Tente chegar a 75% ou mais.'}</p>
        ${step.shadow ? '<div class="row"><button class="btn" data-c="all">▶ Tocar todas em sequência</button></div>' : ''}${phraseRows(w, step.idx, { rec: true, test: step.test })}<div class="sum muted"></div>${doneBtn()}`;
      const sum = $('.sum', body);
      body.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const row = b.closest('.ph');
        if (b.dataset.c === 'all') sayAll(step.idx.map(i => WEEKS[w - 1].p[i][0]));
        if (b.dataset.c === 'reveal') { $('.en', row).innerHTML = esc(WEEKS[w - 1].p[+row.dataset.i][0]); b.remove(); }
        if (b.dataset.c === 'rec') {
          const i = +row.dataset.i, en = WEEKS[w - 1].p[i][0];
          attempt(b, $('.res', row), en, ev => {
            if (step.test) $('.en', row).innerHTML = esc(en);
            best[i] = Math.max(best[i] || 0, ev.acc);
            const vals = step.idx.map(k => best[k]), got = vals.filter(v => v != null);
            sum.textContent = `Melhor nota: ${got.length}/${step.idx.length} frases tentadas · média ${Math.round(got.reduce((a, v) => a + v, 0) / got.length)}%`;
            if (!isDone && vals.every(v => v != null && v >= (step.test ? 60 : 75))) { finish(); const bb = $('[data-c=done]', body); bb.textContent = '✔ Concluída'; bb.disabled = true; toast('Etapa concluída! 🎉'); }
          });
        }
      });
      bindDone();
      break;
    }
    case 'chat':
      if (!CFG.apiKey) {
        body.innerHTML = `<div class="tip">💬 Sem a IA ativada, vamos de <b>modo solo</b>: fale sozinho sobre o tema (abaixo). Para ter conversa de verdade com correções, ative a IA grátis em <a href="#/settings">⚙️ Configurações</a>.</div><div class="mono"></div>`;
        mountMono($('.mono', body), { prompt: W.s, week: w, level: ph.level, theme: W.t, grammar: W.g, onDone: () => { if (!isDone) finish(); } });
      } else {
        body.innerHTML = `<p>🗣 <b>${esc(W.s)}</b></p><div class="chatbox"></div>${doneBtn('Concluir conversa')}`;
        mountChat($('.chatbox', body), { level: ph.level, theme: W.t, grammar: W.g, scenario: 'Conversation about: ' + W.s + ' Encourage the learner to use these phrases when natural: ' + W.p.map(x => x[0]).join(' | '),
          onTurn: n => { if (n >= 5 && !isDone) { finish(); toast('Conversa concluída! 🎉'); const bb = $('[data-c=done]', body); if (bb) { bb.textContent = '✔ Concluída'; bb.disabled = true; } } } });
        bindDone();
      }
      break;
    case 'mono':
      body.innerHTML = '<div class="mono"></div>';
      mountMono($('.mono', body), { prompt: W.s, week: w, level: ph.level, theme: W.t, grammar: W.g, onDone: () => { if (!isDone) finish(); } });
      break;
    case 'immersion':
      body.innerHTML = `<div class="card" style="margin-top:0"><b>Sugestão:</b><p>${esc(step.sug)}</p><div class="muted"><b>Como (Fase ${ph.n} · ${esc(ph.name)}):</b> ${esc(ph.how)}</div></div>
        <ol class="clean"><li>Assista/ouça ${step.short ? '10 min' : '30–45 min'}.</li><li>Escolha um trecho de 1–2 min e repita as falas em voz alta (shadowing).</li><li>${step.short ? 'Anote 1–2 frases.' : 'Anote 3–5 frases novas (próxima etapa).'}</li></ol>
        <label>Quantos minutos você fez?</label><input type="number" min="0" max="240" value="${step.short ? 10 : 30}" data-c="min">${doneBtn('Fiz! Registrar')}`;
      bindDone(() => { const m = +$('[data-c=min]', body).value || 0; S.minutes[todayStr()] = (S.minutes[todayStr()] || 0) + m; save(); });
      break;
    case 'note':
      body.innerHTML = `<p class="muted">Frases que você ouviu e quer aprender. Elas viram cartões de revisão.</p>
        <label>Em inglês</label><input type="text" data-c="en" placeholder="ex.: I'm running late"><label>Significado em português</label><input type="text" data-c="pt" placeholder="ex.: Estou atrasado">
        <div class="row"><button class="btn" data-c="add">➕ Adicionar cartão</button></div><div class="added"></div>${doneBtn()}`;
      $('[data-c=add]', body).onclick = () => {
        const en = $('[data-c=en]', body).value, pt = $('[data-c=pt]', body).value;
        if (addCustom(en, pt)) { $('.added', body).insertAdjacentHTML('beforeend', `<div class="chip ok">✓ ${esc(en)}</div>`); $('[data-c=en]', body).value = ''; $('[data-c=pt]', body).value = ''; }
        else toast('Escreva a frase (ou ela já existe).');
      };
      bindDone();
      break;
  }
}

/* ---------- telas ---------- */
const app = () => document.getElementById('app');
const header = (title, back) => `<header class="top">${back ? `<a class="back" href="${back}">‹</a>` : ''}<h1>${title}</h1><a class="gear" href="#/settings" aria-label="Configurações">⚙️</a></header>`;
const bar = (n, t) => `<div class="bar"><i style="width:${Math.round(n / t * 100)}%"></i></div>`;

function viewToday() {
  const n = nextSession(), due = dueIds().length, done = Object.keys(S.done).length, total = NW * 7;
  const exp = Math.min(total, daysBetween(S.start, todayStr()) + 1), behind = exp - done;
  let h = header('Fluency 365');
  if (!CFG.intro) h += `<div class="card hl"><h3>👋 Como funciona</h3><p>Um ano, 7 sessões por semana: 3 <b>aulas</b>, 2 sessões <b>rápidas</b>, 1 de <b>imersão</b> e 1 de <b>revisão</b>. O plano é por sessão, não por data: se faltar um dia, você continua de onde parou.</p><p>Fale em voz alta sempre. O app ouve e mostra o que errou.</p><div class="row"><a class="btn" href="#/method">Ver o método</a><button class="btn pri" data-act="intro">Entendi</button></div></div>`;
  h += `<div class="stats"><div class="stat"><b>🔥 ${streak()}</b><span>dias seguidos</span></div><div class="stat"><b>${done}/${total}</b><span>sessões</span></div><div class="stat"><b>${due}</b><span>cartões p/ revisar</span></div></div>`;
  if (!n) { h += `<div class="card"><h3>🏆 Você concluiu todas as sessões!</h3><p>Veja o plano pós-ano na última semana e continue revisando os cartões.</p></div>`; app().innerHTML = h; return; }
  const ses = buildSession(n.w, n.d), W = WEEKS[n.w - 1], ph = phaseOf(n.w);
  h += `<div class="card hl"><span class="pill">Semana ${n.w} · ${esc(ph.name)} (${ph.level})</span><h2 style="margin:8px 0 2px">${esc(ses.title)}</h2><div class="muted">≈ ${ses.min} min · Tema: ${esc(W.t)}</div>
    <ul class="steps">${ses.steps.map(s => `<li class="${S.steps[s.key] ? 'done' : ''}"><span class="ck">${S.steps[s.key] ? '✓' : ''}</span>${esc(s.title)}</li>`).join('')}</ul>
    <a class="btn pri big" href="#/session/${n.w}/${n.d}">${ses.steps.some(s => S.steps[s.key]) ? 'Continuar sessão' : 'Começar sessão'}</a></div>`;
  h += `<div class="card"><b>${behind > 3 ? `Você está ${behind} sessões atrás do ritmo de 1 por dia.` : 'Você está no ritmo. 👏'}</b><div class="muted">Sem pressão: 1 sessão por dia leva ~1 ano. Mesmo 15 minutos já contam.</div>${bar(done, total)}</div>`;
  if (due) h += `<a class="btn big" href="#/review">🔁 Revisar ${due} cartões agora</a>`;
  h += `<div class="card"><h3>Frase para pensar hoje</h3>${(() => { const p = W.p[(new Date().getDate()) % 6]; return `<div class="en">${esc(p[0])}</div><div class="pt">${esc(p[1])}</div><div class="row"><button class="mini" data-say="${esc(p[0])}">🔊 Ouvir</button></div>`; })()}</div>`;
  app().innerHTML = h;
}

function viewPlan() {
  const n = nextSession(), cur = n ? n.w : NW; let h = header('Plano de 52 semanas');
  PHASES.forEach(ph => {
    h += `<h2>Fase ${ph.n} · ${esc(ph.name)} <span class="pill">${ph.level}</span></h2><div class="muted">${esc(ph.goal)}</div>`;
    for (let w = ph.weeks[0]; w <= ph.weeks[1]; w++) if (WEEKS[w - 1]) h += `<a class="week ${w === cur ? 'cur' : ''}" href="#/week/${w}"><span class="n">S${w}</span><span class="tt">${esc(WEEKS[w - 1].t)}</span><div class="bar"><i style="width:${weekDone(w) / 7 * 100}%"></i></div><span class="muted">${weekDone(w)}/7</span></a>`;
  });
  app().innerHTML = h;
}

function viewWeek(w) {
  const W = WEEKS[w - 1]; if (!W) return viewPlan(); const ph = phaseOf(w);
  let h = header(`Semana ${w}`, '#/plan') + `<div class="card"><span class="pill">${esc(ph.name)} · ${ph.level}</span><h2 style="margin:8px 0">${esc(W.t)}</h2><p>${esc(W.g)}</p><div class="muted">Fale: ${esc(W.s)}</div></div><h2>Sessões</h2>`;
  for (let d = 1; d <= 7; d++) { const s = buildSession(w, d); h += `<a class="week" href="#/session/${w}/${d}"><span class="n">D${d}</span><span class="tt">${esc(s.title)}<div class="muted">≈ ${s.min} min</div></span><span>${S.done[sid(w, d)] ? '✅' : '›'}</span></a>`; }
  h += `<h2>Frases da semana</h2><div class="card">${phraseRows(w, [0, 1, 2, 3, 4, 5])}</div>`;
  app().innerHTML = h;
}

function viewSession(w, d) {
  const W = WEEKS[w - 1]; if (!W || d < 1 || d > 7) return viewToday();
  const ses = buildSession(w, d), id = sid(w, d);
  let h = header(`S${w} · D${d}`, '#/today') + `<div class="muted">${esc(ses.title)} · ≈ ${ses.min} min · ${esc(W.t)}</div><div id="fin"></div>`;
  ses.steps.forEach((s, i) => { h += `<details class="step ${S.steps[s.key] ? 'done' : ''}" ${S.steps[s.key] ? '' : 'open'} data-i="${i}"><summary><span class="ck">${S.steps[s.key] ? '✓' : i + 1}</span>${esc(s.title)}</summary><div class="sb"></div></details>`; });
  h += `<div id="fin2"></div>`;
  app().innerHTML = h;
  const showFin = () => {
    if (!S.done[id]) return; const nx = nextSession();
    $('#fin2').innerHTML = `<div class="card hl"><h3>✅ Sessão concluída!</h3><p>Boa! Volte amanhã.</p>${nx ? `<a class="btn pri" href="#/session/${nx.w}/${nx.d}">Próxima sessão</a>` : ''} <a class="btn" href="#/today">Início</a></div>`;
  };
  ses.steps.forEach((s, i) => {
    const det = $(`details[data-i="${i}"]`), body = $('.sb', det), wasDone = !!S.steps[s.key];
    const finish = () => {
      if (!S.steps[s.key]) { S.steps[s.key] = Date.now(); active(); }
      det.classList.add('done'); $('.ck', det).textContent = '✓';
      if (ses.steps.every(x => S.steps[x.key]) && !S.done[id]) { S.done[id] = Date.now(); toast('Sessão concluída! 🎉'); }
      save(); showFin();
    };
    mountStep(s, w, d, body, finish, wasDone);
  });
  showFin();
}

function viewReview() {
  app().innerHTML = header('Revisar') + `<p class="muted">Repetição espaçada: o que você erra volta logo, o que acerta demora mais para voltar.</p><div id="rv"></div>`;
  mountReview($('#rv'), 30);
}

const SCEN = [
  ['Conversa livre', 'Free conversation about everyday life: ask simple questions about the learner’s day, interests and plans.'],
  ['Restaurante', 'Roleplay: you are a waiter in a restaurant; the learner is the customer.'],
  ['Hotel (check-in)', 'Roleplay: you are a hotel receptionist; the learner is checking in.'],
  ['Entrevista de emprego', 'Roleplay: you are an interviewer; ask typical job interview questions.'],
  ['Consulta médica', 'Roleplay: you are a doctor; the learner is a patient with a minor problem.'],
  ['Aeroporto', 'Roleplay: you are an airline check-in agent; the learner is a traveler.'],
  ['Small talk numa festa', 'Roleplay: you are a friendly stranger at a party making small talk.'],
  ['Loja de roupas', 'Roleplay: you are a shop assistant in a clothing store.'],
  ['Pedir direções', 'Roleplay: you are a local; the learner is a tourist asking for directions.'],
  ['Debate: opinião', 'Debate a light everyday topic (e.g. remote work vs office). Take the opposite side politely and ask for reasons.']
];
function viewTutor() {
  const n = nextSession(), w = n ? n.w : NW;
  let h = header('Tutor de conversação');
  if (!CFG.apiKey) { h += `<div class="card hl"><h3>Ative a IA grátis (2 minutos)</h3><p>A conversa com correção precisa de uma chave de IA. Com o Gemini é grátis e você faz uma vez só.</p><a class="btn pri" href="#/settings">Ir para Configurações</a></div>`; }
  h += `<div class="card"><label style="margin-top:0">Cenário</label><select id="scen">${SCEN.map((s, i) => `<option value="${i}">${s[0]}</option>`).join('')}</select><div class="row"><button class="btn pri" id="go" ${CFG.apiKey ? '' : 'disabled'}>Começar</button></div></div><div id="chat"></div>`;
  app().innerHTML = h;
  $('#go').onclick = () => {
    const sc = SCEN[+$('#scen').value], W = WEEKS[w - 1];
    $('#chat').innerHTML = `<div class="card" id="cbox"></div>`;
    mountChat($('#cbox'), { level: levelOf(w), theme: W.t, grammar: W.g, scenario: sc[1] });
  };
}

function viewProgress() {
  const done = Object.keys(S.done).length, cards = Object.keys(S.srs).filter(id => cardOf(id)), mature = cards.filter(id => S.srs[id].i >= 21).length;
  const mins = Object.values(S.minutes).reduce((a, b) => a + b, 0), errs = S.custom.filter(c => c.kind === 'err' && !c.del);
  const byDay = {}; S.scores.forEach(s => { const d = todayStr(new Date(s.t)); (byDay[d] = byDay[d] || []).push(s.acc); });
  const pts = Object.keys(byDay).sort().slice(-30).map(d => Math.round(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length));
  let spark = '<div class="muted">Faça exercícios de pronúncia para ver sua evolução aqui.</div>';
  if (pts.length > 1) { const W = 300, Hh = 70, step = W / (pts.length - 1); spark = `<svg class="spark" viewBox="0 0 ${W} ${Hh + 10}" preserveAspectRatio="none"><polyline fill="none" stroke="var(--pri)" stroke-width="2.5" points="${pts.map((p, i) => `${(i * step).toFixed(1)},${(Hh - p / 100 * Hh + 5).toFixed(1)}`).join(' ')}"/></svg><div class="muted">Média diária de acerto na pronúncia (últimos ${pts.length} dias com prática): ${pts[0]}% → ${pts[pts.length - 1]}%</div>`; }
  const ph = n => phaseOf(n);
  app().innerHTML = header('Progresso') + `<div class="stats"><div class="stat"><b>${done}</b><span>sessões</span></div><div class="stat"><b>${Math.round(done / (NW * 7) * 100)}%</b><span>do plano</span></div><div class="stat"><b>🔥 ${streak()}</b><span>sequência</span></div>
    <div class="stat"><b>${cards.length}</b><span>cartões</span></div><div class="stat"><b>${mature}</b><span>dominados</span></div><div class="stat"><b>${mins}</b><span>min de imersão</span></div></div>
    <h2>Pronúncia</h2><div class="card">${spark}</div>
    <h2>Caderno de erros (${errs.length})</h2>${errs.length ? errs.slice(-15).reverse().map(c => `<div class="corr"><div class="good">✓ ${esc(c.en)} <button class="mini" data-say="${esc(c.en)}">🔊</button></div><div class="why">${esc(c.pt)} · ${esc(c.why || '')}</div></div>`).join('') : '<div class="muted">Seus erros corrigidos pelo tutor aparecem aqui e viram cartões de revisão automaticamente.</div>'}
    <h2>Mais</h2><div class="row"><a class="btn" href="#/method">📚 Método</a><a class="btn" href="#/settings">⚙️ Configurações e backup</a></div>`;
}

function viewMethod() {
  app().innerHTML = header('Método', '#/progress') + `
  <div class="card"><h3>O que a pesquisa sobre aquisição de idiomas apoia</h3><ul class="clean">
  <li><b>Input compreensível:</b> você aprende muito ouvindo/lendo inglês um pouco acima do seu nível. Por isso há imersão guiada todo sábado (séries, podcasts).</li>
  <li><b>Frases prontas (chunks):</b> aprendemos blocos inteiros (“Could you repeat that?”), não palavras soltas. É o que dá fluência rápida.</li>
  <li><b>Repetição espaçada:</b> revisar no momento certo fixa na memória de longo prazo com muito menos tempo.</li>
  <li><b>Shadowing:</b> repetir junto com o áudio treina ritmo, entonação e pronúncia.</li>
  <li><b>Falar desde o dia 1, com feedback:</b> só ler e ouvir não destrava a fala. Aqui você fala em toda sessão e vê o que errou.</li>
  <li><b>Constância:</b> 30–45 min por dia vence maratonas de fim de semana.</li></ul></div>
  <div class="card"><h3>Ritmo da semana</h3><ul class="clean"><li>Dias 1, 3, 5: aulas mais profundas (35–40 min)</li><li>Dias 2, 4: sessões rápidas (15 min)</li><li>Dia 6: imersão (série, podcast, vídeo)</li><li>Dia 7: revisão e teste de memória</li></ul></div>
  <div class="card"><h3>Como ler a nota de pronúncia</h3><p>O app usa o reconhecimento de voz do seu celular. Se ele entendeu a frase, é bom sinal de que uma pessoa também entenderia; se trocou palavras, treine esses sons. Ele <b>não</b> mede sotaque fino nem substitui conversar com pessoas de verdade. A partir da Fase 3, vale marcar 1–2 conversas por semana com um falante (italki, Tandem, grupos de conversa).</p></div>
  <div class="card"><h3>Meta realista</h3><p>Com ~45 min por dia durante um ano, são cerca de 270 horas. Isso costuma levar a um inglês de conversação confortável (B1–B2) se você for constante e falar bastante. Fluência “nativa” leva mais tempo.</p></div>`;
}

function viewSettings() {
  const dm = CFG.provider === 'claude' ? DEF.claude : DEF.gemini;
  app().innerHTML = header('Configurações', '#/progress') + `
  <h2>🤖 IA do tutor</h2><div class="card">
   <p class="muted">Corrige suas frases e conversa com você. A chave fica só neste aparelho. Grátis: Gemini (aistudio.google.com/apikey).</p>
   <label>Provedor</label><select id="prov"><option value="gemini" ${CFG.provider === 'gemini' ? 'selected' : ''}>Google Gemini (tem plano grátis)</option><option value="claude" ${CFG.provider === 'claude' ? 'selected' : ''}>Claude (Anthropic, pago por uso)</option></select>
   <label>Chave de API</label><input type="password" id="key" value="${esc(CFG.apiKey)}" placeholder="cole a chave aqui" autocomplete="off">
   <label>Modelo (deixe em branco para o padrão: ${esc(dm)})</label><input type="text" id="model" value="${esc(CFG.model)}" placeholder="${esc(dm)}">
   <div class="row"><button class="btn pri" id="saveai">Salvar</button><button class="btn" id="testai">Testar</button></div><div id="aiout" class="muted"></div></div>
  <h2>🔊 Voz</h2><div class="card"><label>Velocidade do áudio em inglês: <b id="rv">${CFG.rate}</b></label><input type="range" id="rate" min="0.6" max="1.2" step="0.05" value="${CFG.rate}"><div class="row"><button class="mini" data-say="Hello! This is how I sound.">🔊 Testar</button></div></div>
  <h2>☁️ Sincronizar entre aparelhos</h2><div class="card">
   <p class="muted">Guarda seu progresso num Gist secreto do seu GitHub (grátis). Use o mesmo token nos outros aparelhos e o progresso aparece lá.</p>
   <label>Token do GitHub (permissão “gist”)</label><input type="password" id="tok" value="${esc(CFG.gistToken)}" placeholder="ghp_…" autocomplete="off">
   <div class="row"><button class="btn pri" id="savesync">Salvar e sincronizar</button></div><div id="syncout" class="muted">${esc(CFG.gistId ? 'Gist ligado: ' + CFG.gistId.slice(0, 8) + '…' : 'Ainda não sincronizado.')}</div></div>
  <h2>💾 Backup</h2><div class="card"><div class="row"><button class="btn" id="exp">⬇ Exportar progresso</button><label class="btn" style="margin:0">⬆ Importar<input type="file" id="imp" accept=".json" hidden></label></div></div>
  <h2>📅 Plano</h2><div class="card"><label>Data de início</label><input type="text" id="start" value="${S.start}"><div class="muted">Formato AAAA-MM-DD. Só afeta a mensagem de ritmo.</div><div class="row"><button class="btn" id="savestart">Salvar data</button></div></div>
  <h2>ℹ️ App</h2><div class="card"><div>Versão do app: <b>${esc(window.APP_VERSION)}</b> · dados v${S.v}</div><div class="row"><button class="btn" id="upd">🔄 Buscar atualização</button><button class="btn" id="reset" style="color:var(--bad)">Apagar progresso</button></div></div>`;
  $('#rate').oninput = e => { CFG.rate = +e.target.value; $('#rv').textContent = CFG.rate; saveCfg(); };
  $('#prov').onchange = e => { CFG.provider = e.target.value; saveCfg(); viewSettings(); };
  $('#saveai').onclick = () => { CFG.provider = $('#prov').value; CFG.apiKey = $('#key').value.trim(); CFG.model = $('#model').value.trim(); saveCfg(); toast('Salvo!'); };
  $('#testai').onclick = async () => {
    CFG.provider = $('#prov').value; CFG.apiKey = $('#key').value.trim(); CFG.model = $('#model').value.trim(); saveCfg();
    $('#aiout').textContent = 'Testando…';
    try { const j = parseJSON(await askAI('Reply ONLY with JSON: {"reply":"ok"}', [{ role: 'user', content: 'ping' }])); $('#aiout').textContent = '✅ Funcionou! Resposta: ' + (j.reply || '(vazia)'); } catch (e) { $('#aiout').textContent = '⚠️ ' + aiErr(e); }
  };
  $('#savesync').onclick = async () => { CFG.gistToken = $('#tok').value.trim(); saveCfg(); await sync(true); };
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = `fluency-backup-${todayStr()}.json`; a.click(); };
  $('#imp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { S = merge(S, JSON.parse(t)); save(); toast('Progresso importado!'); } catch (err) { toast('Arquivo inválido.'); } }); };
  $('#savestart').onclick = () => { const v = $('#start').value.trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { S.start = v; save(); toast('Data salva.'); } else toast('Use AAAA-MM-DD.'); };
  $('#upd').onclick = async () => { try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); toast('Verificando… recarregando.'); setTimeout(() => location.reload(), 900); } catch (e) { location.reload(); } };
  $('#reset').onclick = () => { if (confirm('Apagar TODO o progresso deste aparelho? (O backup/Gist não é apagado.)')) { S = blank(); persist(); toast('Progresso apagado.'); } };
}

/* ---------- sincronização via Gist ---------- */
let syncTimer = null, syncing = false;
function scheduleSync() { if (!CFG.gistToken) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(false), 5000); }
async function sync(manual) {
  if (!CFG.gistToken || syncing) return; syncing = true;
  const out = document.getElementById('syncout'); const say2 = m => { if (out) out.textContent = m; };
  const H = { Authorization: 'Bearer ' + CFG.gistToken, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, FN = 'fluency-progress.json';
  try {
    say2('Sincronizando…');
    if (!CFG.gistId) {
      const r = await fetch('https://api.github.com/gists?per_page=100', { headers: H }); if (!r.ok) throw new Error('GitHub respondeu ' + r.status + (r.status === 401 ? ' (token inválido)' : ''));
      const g = (await r.json()).find(x => x.files && x.files[FN]); if (g) { CFG.gistId = g.id; saveCfg(); }
    }
    let changed = false;
    if (CFG.gistId) {
      const r = await fetch('https://api.github.com/gists/' + CFG.gistId, { headers: H }); if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
      const g = await r.json(), f = g.files && g.files[FN];
      if (f) { let c = f.content; if (f.truncated) c = await (await fetch(f.raw_url)).text(); const before = JSON.stringify(S); S = merge(S, JSON.parse(c)); changed = before !== JSON.stringify(S); persist(); }
    }
    const body = JSON.stringify({ description: 'Fluency 365 — progresso', public: false, files: { [FN]: { content: JSON.stringify(S) } } });
    const r2 = CFG.gistId ? await fetch('https://api.github.com/gists/' + CFG.gistId, { method: 'PATCH', headers: H, body })
      : await fetch('https://api.github.com/gists', { method: 'POST', headers: H, body });
    if (!r2.ok) throw new Error('GitHub respondeu ' + r2.status + (r2.status === 404 || r2.status === 403 ? ' (o token precisa da permissão “gist”)' : ''));
    if (!CFG.gistId) { CFG.gistId = (await r2.json()).id; saveCfg(); }
    say2('✅ Sincronizado às ' + new Date().toLocaleTimeString().slice(0, 5)); if (manual) toast('Sincronizado!');
    if (changed && ['', 'today', 'plan', 'progress'].includes(route().r)) render();
  } catch (e) { say2('⚠️ ' + e.message); if (manual) toast('Falha ao sincronizar'); }
  syncing = false;
}

/* ---------- roteador ---------- */
function route() { const [, r, a, b] = (location.hash || '#/today').split('/'); return { r: r || 'today', a, b }; }
const TABS = [['today', '🏠', 'Hoje'], ['plan', '🗓', 'Plano'], ['review', '🔁', 'Revisar'], ['tutor', '💬', 'Tutor'], ['progress', '📈', 'Progresso']];
function render() {
  stopRec(); if (TTS) TTS.cancel();
  const { r, a, b } = route();
  const V = { today: viewToday, plan: viewPlan, week: () => viewWeek(+a), session: () => viewSession(+a, +b), review: viewReview, tutor: viewTutor, progress: viewProgress, settings: viewSettings, method: viewMethod }[r] || viewToday;
  V(); window.scrollTo(0, 0);
  const due = dueIds().length, grp = { week: 'plan', session: 'today', settings: 'progress', method: 'progress' }[r] || r;
  $('#tabs').innerHTML = TABS.map(([k, i, t]) => `<a href="#/${k}" class="${grp === k ? 'on' : ''}"><span>${i}</span>${t}${k === 'review' && due ? `<em>${due > 99 ? '99+' : due}</em>` : ''}</a>`).join('');
}

/* ---------- eventos globais ---------- */
function boot() {
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-say]'); if (s) { say(s.dataset.say, !!s.dataset.slow); return; }
    const a = e.target.closest('[data-act]'); if (a && a.dataset.act === 'intro') { CFG.intro = true; saveCfg(); render(); }
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(false); });
  if (TTS) TTS.onvoiceschanged = () => { };
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => { });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('Nova versão instalada. Toque para recarregar.', 12000, () => location.reload()); });
  }
  render(); sync(false);
}
if (typeof document !== 'undefined' && document.getElementById('app')) boot();
if (typeof module !== 'undefined') module.exports = { norm, align, evaluate, merge, grade, buildSession, migrate, blank, tipsFor, parseJSON, getS: () => S, setS: v => { S = v; }, addCard, dueIds, cardOf, NW };
