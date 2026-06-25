// main.js — wiring for 붕어 낚시터
import { FaceTracker } from "./face.js";
import {
  Store, ITEMS, TIERS, pickItem, hookDifficulty, castPowerFromYaw,
  depthLabel, QUOTE, clamp,
} from "./game.js";

const $ = (id) => document.getElementById(id);

// ---------- global state ----------
let store = null;
let face = null;
let faceMode = false;            // true once camera + model are live
const settings = { sensitivity: "normal", difficultyMult: 1, sfx: true, bgm: false };

// lobby game state machine
const L = {
  state: "idle", power: 0.5,
  tapsNeeded: 6, tapsDone: 0, timeLeft: 0, timer: null, biteTimer: null,
  // face cast tracking
  oHold: 0, peakAmp: 0, peakSpeed: 0, lastYaw: 0, lastT: 0, winding: false,
  // hook cycle tracking
  cycleArmed: false,
};

// ---------- tiny sound ----------
let audioCtx = null;
function blip(freq = 440, dur = 0.08, type = "sine", vol = 0.05) {
  if (!settings.sfx) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

// ---------- screen nav ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.id === id));
}

// ---------- ENTRY ----------
function npcNames() { return new Set((store ? store.npcs : []).map((n) => n.nick)); }
function takenNames() {
  // base set from a fresh roster (store not yet created at first keystroke)
  return new Set(["월척사냥꾼","뻐끔여신","저수지지배자","입질장인","찌의민족","새벽붕어","가짜미끼왕","출근전한판"]);
}
function uniqueNick(name) {
  const taken = takenNames();
  if (!taken.has(name)) return name;
  let i = 2; while (taken.has(name + i)) i++; return name + i;
}

function initEntry() {
  const input = $("nickname"), status = $("nick-status");
  input.addEventListener("input", () => {
    const v = input.value.trim();
    if (!v) { status.textContent = ""; status.className = "nick-status"; return; }
    if (takenNames().has(v)) {
      status.textContent = `이미 있어요 → ${uniqueNick(v)} 추천`;
      status.className = "nick-status warn";
    } else {
      status.textContent = "사용할 수 있는 닉네임이에요";
      status.className = "nick-status ok";
    }
  });
  $("btn-start").addEventListener("click", onStart);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") onStart(); });
}

async function onStart() {
  const v = $("nickname").value.trim();
  const err = $("entry-error");
  if (!v) { err.textContent = "닉네임을 입력해 주세요."; err.hidden = false; return; }
  err.hidden = true;
  const nick = uniqueNick(v);
  store = new Store(nick);
  showScreen("screen-cal");
  await startFace();
}

// ---------- FACE / CAMERA ----------
function ensureDetVideo() {
  let v = $("det-video");
  if (!v) {
    v = document.createElement("video");
    v.id = "det-video"; v.muted = true; v.playsInline = true; v.autoplay = true;
    v.style.cssText = "position:fixed;left:-12px;top:-12px;width:2px;height:2px;opacity:0;pointer-events:none;";
    document.body.appendChild(v);
  }
  return v;
}

async function startFace() {
  const badge = $("cal-badge");
  face = new FaceTracker();
  face.setSensitivity(settings.sensitivity);
  face.onframe = onFaceFrame;
  try {
    const det = ensureDetVideo();
    const ok = await face.init(det);
    // mirror stream onto the visible calibration + game videos
    if (face._stream) { $("cal-video").srcObject = face._stream; $("game-video").srcObject = face._stream;
      $("cal-video").play().catch(()=>{}); $("game-video").play().catch(()=>{}); }
    faceMode = ok;
    if (ok) { badge.textContent = "얼굴 인식 준비됐어요"; }
    else { badge.textContent = "인식 모델을 못 불러왔어요 — 버튼으로 플레이"; setupCalButtonsNoFace(); }
  } catch (e) {
    console.warn("camera/init failed:", e);
    faceMode = false;
    badge.textContent = "카메라를 쓸 수 없어요 — 버튼으로 플레이할게요";
    setupCalButtonsNoFace();
  }
  setupCalibration();
}

function setupCalButtonsNoFace() {
  $("cal-instr").textContent = "카메라 없이 버튼·키보드로 플레이합니다";
  $("btn-cal-neutral").textContent = "버튼으로 시작";
  $("btn-cal-skip").hidden = true;
}

function setupCalibration() {
  $("btn-cal-neutral").addEventListener("click", onCalNeutral, { once: false });
  $("btn-cal-skip").addEventListener("click", enterLobby);
}

let calStage = 0;
async function onCalNeutral() {
  if (!faceMode) { enterLobby(); return; }
  if (calStage === 0) {
    $("cal-instr").textContent = "정면을 본 채로… 보정 중";
    $("btn-cal-neutral").disabled = true;
    await face.captureNeutral(900);
    $("btn-cal-neutral").disabled = false;
    $("cal-step-1").classList.add("done");
    calStage = 1;
    $("cal-instr").textContent = "입을 크게 'O'로 벌린 채 아래 버튼을 누르세요";
    $("btn-cal-neutral").textContent = "입 'O' 인식";
  } else if (calStage === 1) {
    // measure the user's real 'O' peak → thresholds adapt to their distance
    $("cal-instr").textContent = "그대로 'O' 유지… 인식 중";
    $("btn-cal-neutral").disabled = true;
    const got = await face.captureO(1500);
    $("btn-cal-neutral").disabled = false;
    $("cal-step-2").classList.add("done");
    calStage = 2;
    $("cal-instr").textContent = got ? "좋아요! 이 거리에 맞게 맞췄어요 — 멀어도 OK" : "괜찮아요 — 바로 시작해도 돼요";
    $("btn-cal-neutral").textContent = "낚시 시작";
  } else {
    enterLobby();
  }
}

// ---------- LOBBY ----------
function enterLobby() {
  showScreen("screen-lobby");
  if (face && face._stream) { $("game-video").srcObject = face._stream; $("game-video").play().catch(()=>{}); }
  if (!faceMode) { const sv = $("selfview-status"); sv.classList.add("off"); sv.innerHTML = '<span class="sv-dot"></span>버튼 모드'; }
  renderNpcs();
  refreshChips();
  renderMiniRank();
  bindLobbyControls();
  toReady();
  startNpcLoop();
}

function refreshChips() {
  $("eh-count").textContent = store.totalCaught();
  $("my-rank").textContent = store.ranking().myRank + "위";
}

// ----- state transitions -----
function svStatus(text, on = true) {
  const el = $("selfview-status");
  el.classList.toggle("off", !on);
  el.innerHTML = '<span class="sv-dot"></span>' + text;
}
function clearTimers() {
  if (L.timer) { clearInterval(L.timer); L.timer = null; }
  if (L.biteTimer) { clearTimeout(L.biteTimer); L.biteTimer = null; }
}
function setBob(show) {
  const b = $("mybob"); b.hidden = !show; if (!show) b.classList.remove("is-bite");
}

// creature/trophy breaches the water at the bob, with a splash and droplets
function showCatchReveal(item) {
  const stage = $("catch-stage"); if (!stage) return;
  const bobTop = parseFloat($("mybob").style.top) || 60;   // % down the scene
  const big = !!item.big;
  let drops = "";
  for (let i = 0; i < 7; i++) {
    const dx = Math.round(Math.random() * 120 - 60);
    const dy = Math.round(-30 - Math.random() * 55);
    const delay = (Math.random() * 0.15).toFixed(2);
    drops += `<span class="drop" style="--dx:${dx}px;--dy:${dy}px;animation-delay:${delay}s"></span>`;
  }
  stage.innerHTML =
    `<div class="splash" style="top:${bobTop}%"></div>
     <div style="position:absolute;left:50%;top:${bobTop}%">${drops}</div>
     <div class="catch-creature ${big ? "big" : ""}" style="top:${bobTop}%">${item.icon}</div>`;
  stage.hidden = false;
  clearTimeout(stage._t);
  stage._t = setTimeout(() => { stage.hidden = true; stage.innerHTML = ""; }, big ? 2400 : 2000);
}

function toReady() {
  clearTimers(); L.state = "ready"; L.oHold = 0; L.peakAmp = 0; L.peakSpeed = 0; L.winding = false;
  setBob(false); $("mybob").style.transition = "none"; $("mybob").style.top = "70%";
  $("castpad").hidden = true;
  const cs = $("catch-stage"); if (cs) { cs.hidden = true; cs.innerHTML = ""; }
  svStatus("대기 중", faceMode);
  $("ab-phase").textContent = "① 준비";
  $("ab-hint").textContent = faceMode ? "입을 'O'로 벌리면 붕어 모드!" : "버튼/스페이스로 진행";
  $("ab-ctrl").innerHTML = `<button class="btn btn-primary" id="b-arm">붕어 모드 ON</button>`;
  $("b-arm").onclick = arm;
}

function arm() {
  if (L.state !== "ready") return;
  L.state = "armed"; L.peakAmp = 0; L.peakSpeed = 0; L.winding = false; L.lastYaw = 0; L.lastT = performance.now();
  svStatus("붕어 모드 ON", true);
  $("ab-phase").textContent = "② 캐스팅";
  $("ab-hint").textContent = faceMode ? "고개를 빠르고 크게 돌렸다 정면으로!" : "스와이프하거나 버튼으로";
  $("castpad-hint").textContent = faceMode
    ? "고개를 휙 돌렸다가 → 정면으로 돌아오면 던져져요!"
    : "화면을 휙 스와이프하세요";
  $("castpad-sub").textContent = faceMode
    ? "멀리(크게) 돌릴수록 더 멀리 날아가요"
    : "세게 스와이프 = 멀리 · 또는 아래 버튼";
  $("castpad").hidden = false;
  $("ab-ctrl").innerHTML = `<button class="btn btn-ghost" id="b-soft">살짝 던지기</button>`;
  $("b-soft").onclick = () => doCast(0.18);
}

function doCast(power) {
  if (L.state !== "armed") return;
  L.state = "waiting"; L.power = power;
  $("castpad").hidden = true;
  const landing = 70 - power * 22;
  const b = $("mybob");
  b.style.transition = "none"; b.style.top = "70%"; setBob(true);
  b.classList.add("casting"); setTimeout(() => b.classList.remove("casting"), 520);
  requestAnimationFrame(() => { b.style.transition = "top .55s ease"; b.style.top = landing + "%"; });
  const diff = hookDifficulty(power, settings.difficultyMult);
  L.tapsNeeded = diff.tapsNeeded; L._window = diff.timeWindow;
  $("ab-phase").textContent = "③ 대기";
  $("ab-hint").textContent = `비거리 ${Math.round(power * 100)} · ${depthLabel(power)}`;
  $("ab-ctrl").innerHTML = `<span class="ab-hint">찌를 보며 입질을 기다리는 중…</span>`;
  svStatus("대기 중", true);
  blip(330, 0.12, "triangle");
  L.biteTimer = setTimeout(bite, diff.biteDelay);
}

function bite() {
  if (L.state !== "waiting") return;
  L.state = "bite"; L.tapsDone = 0; L.cycleArmed = false; L.timeLeft = L._window;
  $("mybob").classList.add("is-bite");
  svStatus("입질!", true);
  $("ab-phase").textContent = "④ 챔질!";
  $("ab-hint").textContent = `뻐끔뻐끔! ${L.tapsNeeded}회 빠르게!`;
  $("ab-ctrl").innerHTML =
    `<div class="ab-row"><button class="btn btn-tap" id="b-tap">뻐끔!</button><span class="timer" id="tm">${L.timeLeft.toFixed(1)}초</span></div>
     <div class="ab-row"><div class="gauge" style="flex:1"><div class="gauge-fill" id="gf"></div></div><span class="tapn" id="tapn">0/${L.tapsNeeded}회</span></div>`;
  $("b-tap").onclick = hookTap;
  blip(520, 0.1, "square");
  L.timer = setInterval(() => {
    L.timeLeft -= 0.1;
    const t = $("tm"); if (t) t.textContent = Math.max(0, L.timeLeft).toFixed(1) + "초";
    if (L.timeLeft <= 0) missed();
  }, 100);
}

function hookTap() {
  if (L.state !== "bite") return;
  L.tapsDone++;
  const pct = Math.min(100, (L.tapsDone / L.tapsNeeded) * 100);
  const gf = $("gf"); if (gf) gf.style.width = pct + "%";
  const tn = $("tapn"); if (tn) tn.textContent = `${L.tapsDone}/${L.tapsNeeded}회`;
  blip(600 + L.tapsDone * 40, 0.05, "sine", 0.04);
  if (L.tapsDone >= L.tapsNeeded) caught();
}

function caught() {
  clearTimers(); L.state = "caught";
  $("mybob").classList.remove("is-bite");
  const item = pickItem(L.power);
  const { isNewBest } = store.addCatch(item);
  showCatchReveal(item);
  refreshChips(); renderMiniRank();
  svStatus("획득!", true);
  $("ab-phase").textContent = "✦ 획득!";
  $("ab-hint").textContent = isNewBest ? "내 최고 전리품 갱신!" : "어항에 들어갔어요";
  const t = TIERS[item.tier];
  $("ab-ctrl").innerHTML =
    `<div class="ab-row"><div class="result"><div class="result-icc">${item.icon}</div>
       <div><div class="result-name">${item.name}</div><span class="rar rar-${t.cls}">${t.label}</span></div></div>
     <button class="btn btn-blue" id="b-again">다시 낚기</button></div>`;
  $("b-again").onclick = toReady;
  // celebratory sound
  blip(523, 0.09); setTimeout(() => blip(659, 0.09), 90); setTimeout(() => blip(784, 0.12), 180);
  if (t.rank >= 3) showToast(`${store.nickname}님이 ${t.label} ${item.name}을(를) 낚았어요!`);
}

function missed() {
  clearTimers(); L.state = "missed";
  $("mybob").classList.remove("is-bite"); setBob(false);
  svStatus("놓침", false);
  $("ab-phase").textContent = "놓침";
  $("ab-hint").textContent = "놓친 붕어가 더 크다…";
  $("ab-ctrl").innerHTML = `<button class="btn btn-blue" id="b-again2">다시 낚기</button>`;
  $("b-again2").onclick = toReady;
  blip(200, 0.18, "sawtooth", 0.04);
}

// ----- face-driven loop -----
function onFaceFrame(m) {
  // calibration badge live hint
  if ($("screen-cal").classList.contains("is-active") && faceMode) {
    $("cal-badge").textContent = face.faceFound ? "얼굴 인식 중 ✓" : "얼굴이 안 보여요";
  }
  if (!$("screen-lobby").classList.contains("is-active") || !faceMode) return;

  const now = performance.now();
  const dt = Math.min(0.1, (now - (L.lastT || now)) / 1000) || 0.016;
  L.lastT = now;

  if (L.state === "ready") {
    if (face.isO()) { L.oHold += dt; if (L.oHold > 0.4) arm(); }
    else L.oHold = Math.max(0, L.oHold - dt);
  } else if (L.state === "armed") {
    const yaw = m.yaw;
    const speed = Math.abs(yaw - L.lastYaw) / dt;
    L.lastYaw = yaw;
    if (Math.abs(yaw) > 0.045) { L.winding = true; L.peakAmp = Math.max(L.peakAmp, Math.abs(yaw)); L.peakSpeed = Math.max(L.peakSpeed, speed); }
    if (L.winding && Math.abs(yaw) < 0.02) { doCast(castPowerFromYaw(L.peakAmp, L.peakSpeed)); }
  } else if (L.state === "bite") {
    if (face.isPucker()) L.cycleArmed = true;
    else if (face.isOpen() && L.cycleArmed) { L.cycleArmed = false; hookTap(); }
  }
}

// ----- castpad swipe (alternative cast) + keyboard -----
function bindLobbyControls() {
  const cp = $("castpad");
  let sx = 0, sy = 0, st = 0, dragging = false;
  cp.onpointerdown = (e) => { dragging = true; sx = e.clientX; sy = e.clientY; st = performance.now(); try { cp.setPointerCapture(e.pointerId); } catch (_) {} };
  cp.onpointerup = (e) => {
    if (!dragging) return; dragging = false;
    const dx = e.clientX - sx, dy = e.clientY - sy, dist = Math.hypot(dx, dy);
    const dtm = Math.max(performance.now() - st, 1), speed = dist / dtm;
    doCast(clamp(speed * 0.22 + dist * 0.0018, 0.1, 1));
  };
  cp.onpointercancel = () => { dragging = false; };

  // header buttons (onclick assignment is idempotent)
  $("btn-eohang").onclick = openEohang;
  $("btn-ranking").onclick = openRanking;
  $("btn-settings").onclick = openSettings;
  document.querySelectorAll(".modal-close").forEach((b) => b.onclick = () => closeModal(b.dataset.close));

  // document-level listeners: bind only once
  if (L._bound) return;
  L._bound = true;
  document.addEventListener("keydown", (e) => {
    if (!$("screen-lobby").classList.contains("is-active")) return;
    if (e.repeat && L.state !== "bite") return;
    if (e.code === "Space" || (e.key && e.key.toLowerCase() === "o")) {
      e.preventDefault();
      if (L.state === "ready") arm();
      else if (L.state === "armed") doCast(0.5);
      else if (L.state === "bite") hookTap();
      else if (L.state === "caught" || L.state === "missed") toReady();
    }
  });
  document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
}

// ---------- NPC presence ----------
const FISH_COLORS = ["#F2D75C", "#CAC8C1", "#C8A06C", "#9DC3E0", "#E6A6C6", "#A9D58C"];
function fishSvg(color) {
  return `<svg width="40" height="30" viewBox="0 0 40 30" aria-hidden="true">
    <ellipse cx="18" cy="15" rx="13" ry="10" fill="${color}"/>
    <polygon points="29,15 39,8 39,22" fill="${color}"/>
    <circle cx="12" cy="13" r="2" fill="#2C2C2A"/></svg>`;
}
let npcShown = [];
function renderNpcs() {
  const wrap = $("players"); wrap.innerHTML = "";
  npcShown = store.npcs.slice(0, 3);
  const xs = [18, 46, 74], y = 17;
  npcShown.forEach((n, i) => {
    const el = document.createElement("div");
    el.className = "player";
    el.style.left = xs[i] + "%"; el.style.top = y + "%";
    el.innerHTML = `${fishSvg(FISH_COLORS[i % FISH_COLORS.length])}
      <span class="player-tag">${n.nick}</span>
      <span class="player-stat st-wait" id="npc-${i}">대기</span>`;
    wrap.appendChild(el);
  });
}
let npcTimer = null;
function startNpcLoop() {
  if (npcTimer) clearInterval(npcTimer);
  const states = [["대기", "st-wait"], ["입질!", "st-bite"], ["낚는 중", "st-bite"], ["획득!", "st-catch"]];
  npcTimer = setInterval(() => {
    if (!$("screen-lobby").classList.contains("is-active")) return;
    const i = Math.floor(Math.random() * npcShown.length);
    const s = states[Math.floor(Math.random() * states.length)];
    const el = $("npc-" + i); if (el) { el.textContent = s[0]; el.className = "player-stat " + s[1]; }
    if (s[0] === "획득!") {
      const it = pickItem(0);
      showToast(`${npcShown[i].nick}님이 ${TIERS[it.tier].label} ${it.name}!`);
    }
  }, 2800);
}

let toastT = null;
function showToast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  if (toastT) clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}

function renderMiniRank() {
  const { rows } = store.ranking();
  $("mini-rank").innerHTML = `<h4>오늘의 붕어왕</h4>` + rows.slice(0, 3).map((r, i) =>
    `<div class="mr-row"><span class="mr-no">${i + 1}</span><span class="mr-nick">${r.nick}</span>
     <span class="mr-dot" style="background:${TIERS[r.tier].dot}"></span></div>`).join("");
}

// ---------- MODALS ----------
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

let ehFilter = "all";
function openEohang() {
  ehFilter = "all";
  renderEohang();
  openModal("panel-eohang");
}
function renderEohang() {
  const body = $("eohang-body");
  const best = store.bestTrophy();
  const c = store.countByTier();
  const total = store.totalCaught();
  const kinds = Object.keys(store.inventory).length;
  let html = `<p class="eh-summary">지금까지 낚은 붕어 <b>${total}마리</b> · ${kinds}종</p>`;
  if (best) {
    const t = TIERS[best.tier];
    html += `<div class="feat"><div class="feat-icc">${best.icon}</div><div>
      <div class="feat-label">내 최고 전리품</div>
      <div class="feat-name">${best.name} <span class="rar rar-${t.cls}">${t.label}</span></div>
      <div class="eh-summary" style="margin:0">크기 ${best.size}cm · 사내 손꼽히는 월척</div>
      <div class="feat-quote">"${QUOTE}"</div></div></div>`;
  }
  const filters = [["all", `전체 ${total}`], ["legend", `전설 ${c.legend}`], ["epic", `에픽 ${c.epic}`], ["rare", `희귀 ${c.rare}`], ["common", `일반 ${c.common}`], ["junk", `꽝 ${c.junk}`]];
  html += `<div class="eh-filters">` + filters.map(([k, lab]) =>
    `<button class="fchip ${k === ehFilter ? "on" : ""}" data-f="${k}">${lab}</button>`).join("") + `</div>`;
  const owned = ITEMS.filter((it) => store.inventory[it.id]);
  const shown = owned.filter((it) => ehFilter === "all" || it.tier === ehFilter);
  if (total === 0) html += `<p class="empty">아직 아무것도 못 낚았어요. 저수지로 가서 한 마리!</p>`;
  else html += `<div class="eh-grid">` + shown.map((it) => {
    const t = TIERS[it.tier];
    return `<div class="eh-item"><div class="eh-icc">${it.icon}</div><div>
      <div class="eh-name">${it.name}</div>
      <div class="eh-meta"><span class="rar rar-${t.cls}">${t.label}</span><span class="eh-cnt">×${store.inventory[it.id]}</span></div>
    </div></div>`;
  }).join("") + `</div>`;
  body.innerHTML = html;
  body.querySelectorAll(".fchip").forEach((b) => b.onclick = () => { ehFilter = b.dataset.f; renderEohang(); });
}

function openRanking() {
  const { rows, myRank } = store.ranking();
  const top3 = rows.slice(0, 3);
  const order = [1, 0, 2]; // 2nd, 1st, 3rd visual order
  const medals = ["m1", "m2", "m3"];
  const podium = order.map((idx) => {
    const r = top3[idx]; if (!r) return "";
    const t = TIERS[r.tier];
    const crown = idx === 0 ? `<div class="pod-crown">👑</div>` : "";
    return `<div class="pod ${idx === 0 ? "first" : ""}">${crown}
      <div class="pod-medal ${medals[idx]}">${idx + 1}</div>
      <div class="pod-ava">🐟</div>
      <div class="pod-nick">${r.nick}</div>
      <span class="rar rar-${t.cls}">${t.label}</span>
      <div class="pod-tname">${r.trophy}</div></div>`;
  }).join("");
  const list = rows.slice(3, 8).map((r, i) => {
    const t = TIERS[r.tier];
    return `<div class="rk-row ${r.me ? "me" : ""}"><span class="rk-no">${i + 4}</span>
      <span class="rk-nick">${r.nick}</span>
      <span class="rk-troph"><span class="mr-dot" style="background:${t.dot}"></span>${r.trophy}</span></div>`;
  }).join("");
  let meRow = "";
  if (myRank > 8) {
    const r = rows[myRank - 1], t = TIERS[r.tier];
    meRow = `<div class="rk-row me" style="margin-top:8px"><span class="rk-no">${myRank}</span>
      <span class="rk-nick">${r.nick}</span>
      <span class="rk-troph"><span class="mr-dot" style="background:${t.dot}"></span>${r.trophy}</span></div>`;
  }
  $("ranking-body").innerHTML = `<div class="podium">${podium}</div><div class="rk-list">${list}${meRow}</div>`;
  openModal("panel-ranking");
}

function openSettings() {
  const seg = (name, cur, opts) => `<span class="seg">` + opts.map(([v, lab]) =>
    `<button data-set="${name}" data-val="${v}" class="${v === cur ? "on" : ""}">${lab}</button>`).join("") + `</span>`;
  const sw = (name, on) => `<button class="switch ${on ? "on" : "off"}" data-toggle="${name}"><span class="knob"></span></button>`;
  $("settings-body").innerHTML = `
    <div class="sg"><p class="sg-title">카메라</p>
      <div class="srow"><div><div class="lbl">얼굴 인식</div><div class="sub">${faceMode ? "카메라 사용 중" : "버튼 모드 (카메라 없음)"}</div></div>
        <button class="set-link" id="set-recal">캘리브레이션 다시</button></div>
      <div class="srow"><div><div class="lbl">인식 감도</div><div class="sub">입·고개 동작 민감도</div></div>
        ${seg("sensitivity", settings.sensitivity, [["low", "낮음"], ["normal", "보통"], ["high", "높음"]])}</div>
    </div>
    <div class="sg"><p class="sg-title">게임</p>
      <div class="srow"><div><div class="lbl">챔질 난이도</div><div class="sub">비거리 보정에 더해 적용</div></div>
        ${seg("difficulty", String(settings.difficultyMult), [["0.7", "느슨"], ["1", "보통"], ["1.3", "빡빡"]])}</div>
      <div class="srow"><div class="lbl">효과음</div>${sw("sfx", settings.sfx)}</div>
      <div class="srow"><div class="lbl">배경음</div>${sw("bgm", settings.bgm)}</div>
    </div>
    <div class="sg"><p class="sg-title">계정</p>
      <div class="srow"><div class="lbl">닉네임</div><span class="eh-cnt">${store.nickname}</span></div>
      <div class="srow danger"><div class="lbl">어항 비우기</div><button class="set-link" id="set-clear" style="color:var(--coral-strong)">비우기</button></div>
    </div>`;
  const body = $("settings-body");
  body.querySelectorAll("[data-set]").forEach((b) => b.onclick = () => {
    const name = b.dataset.set, val = b.dataset.val;
    if (name === "sensitivity") { settings.sensitivity = val; if (face) face.setSensitivity(val); }
    if (name === "difficulty") settings.difficultyMult = parseFloat(val);
    openSettings();
  });
  body.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => {
    const name = b.dataset.toggle; settings[name] = !settings[name]; if (name === "sfx" && settings.sfx) blip(660, 0.07); openSettings();
  });
  $("set-recal").onclick = () => { closeModal("panel-settings"); calStage = 0; $("cal-step-1").classList.remove("done"); $("cal-step-2").classList.remove("done"); $("btn-cal-neutral").textContent = "정면 보정 시작"; showScreen("screen-cal"); };
  $("set-clear").onclick = () => {
    if (confirm("어항을 비울까요? 되돌릴 수 없어요.")) { store.inventory = {}; store.best = null; store._save(); refreshChips(); renderMiniRank(); openSettings(); }
  };
  openModal("panel-settings");
}

// ---------- boot ----------
initEntry();
