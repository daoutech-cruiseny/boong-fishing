// game.js — pure game logic for 붕어 낚시터 (no DOM).
// Item catalog, weighted RNG, cast-power & difficulty math, inventory
// (localStorage), and a nickname-based ranking with simulated NPCs.

export const TIERS = {
  junk:   { label: "꽝",   rank: 0, score: 0,   cls: "junk",   dot: "var(--junk-dot)" },
  common: { label: "일반", rank: 1, score: 1,   cls: "common", dot: "var(--common-dot)" },
  rare:   { label: "희귀", rank: 2, score: 5,   cls: "rare",   dot: "var(--rare-dot)" },
  epic:   { label: "에픽", rank: 3, score: 20,  cls: "epic",   dot: "var(--epic-dot)" },
  legend: { label: "전설", rank: 4, score: 100, cls: "legend", dot: "var(--legend-dot)" },
};

// `big: true` → creature that dramatically breaches the water on reel-in.
export const ITEMS = [
  { id: "weed",     name: "물풀",            tier: "junk",   weight: 22,  icon: "🌿" },
  { id: "boot",     name: "낡은 장화",        tier: "junk",   weight: 14,  icon: "👢" },
  { id: "can",      name: "녹슨 깡통",        tier: "junk",   weight: 12,  icon: "🥫" },
  { id: "fish",     name: "물고기",          tier: "common", weight: 18,  icon: "🐟", big: true },
  { id: "coin",     name: "동전",            tier: "common", weight: 12,  icon: "🪙" },
  { id: "marble",   name: "유리 구슬",        tier: "common", weight: 8,   icon: "🔵" },
  { id: "leaf",     name: "물든 단풍잎",      tier: "common", weight: 8,   icon: "🍁" },
  { id: "frog",     name: "놀란 개구리",      tier: "common", weight: 6,   icon: "🐸", big: true },
  { id: "mirror",   name: "은 손거울",        tier: "rare",   weight: 5,   icon: "🪞" },
  { id: "button",   name: "진주 단추",        tier: "rare",   weight: 4,   icon: "⚪" },
  { id: "silver",   name: "은화 한 닢",       tier: "rare",   weight: 3,   icon: "🥈" },
  { id: "watch",    name: "골동 회중시계",    tier: "rare",   weight: 3,   icon: "⏱️" },
  { id: "turtle",   name: "느긋한 거북",      tier: "rare",   weight: 3,   icon: "🐢", big: true },
  { id: "puffer",   name: "성난 복어",        tier: "rare",   weight: 2.5, icon: "🐡", big: true },
  { id: "chest",    name: "황금 보물상자",    tier: "epic",   weight: 2.5, icon: "🎁" },
  { id: "ruby",     name: "루비 원석",        tier: "epic",   weight: 1.5, icon: "💎" },
  { id: "compass",  name: "황동 나침반",      tier: "epic",   weight: 1.5, icon: "🧭" },
  { id: "octopus",  name: "길 잃은 대왕문어",  tier: "epic",   weight: 1.2, icon: "🐙", big: true },
  { id: "shark",    name: "민물 상어?!",       tier: "epic",   weight: 1.0, icon: "🦈", big: true },
  { id: "dolphin",  name: "탈출한 돌고래",     tier: "epic",   weight: 0.8, icon: "🐬", big: true },
  { id: "pika",     name: "물에 빠진 전기쥐?!", tier: "epic",   weight: 0.6, icon: "⚡", big: true },
  { id: "urn",      name: "고대 유물 항아리", tier: "legend", weight: 0.8, icon: "🏺" },
  { id: "carp",     name: "전설의 월척 잉어", tier: "legend", weight: 0.4, icon: "🐠", big: true },
  { id: "whale",    name: "저수지의 고래",     tier: "legend", weight: 0.4, icon: "🐳", big: true },
  { id: "gyara",    name: "갸라도스(사칭)",    tier: "legend", weight: 0.25, icon: "🐉", big: true },
  { id: "kraken",   name: "전설의 대왕오징어", tier: "legend", weight: 0.2, icon: "🦑", big: true },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// ---- cast & difficulty math (tunable) ----
const AMP_MAX = 0.12;   // head-yaw amplitude that maps to full power
const SPEED_MAX = 0.5;  // yaw units / second at center-return for full power

export function castPowerFromYaw(amp, speed) {
  const p = 0.5 * (amp / AMP_MAX) + 0.5 * (speed / SPEED_MAX);
  return clamp(p, 0.1, 1);
}
export function depthLabel(power) {
  if (power > 0.7) return "깊은 물 · 레어↑ · 챔질 빡빡";
  if (power > 0.4) return "보통 수심";
  return "얕은 물 · 챔질 여유";
}
export function hookDifficulty(power, globalMult = 1) {
  const tapsNeeded = Math.max(3, Math.round((4 + power * 4) * globalMult));
  const timeWindow = clamp(4.6 - power * 2.1, 2.4, 4.6);
  // Long, unpredictable wait so a cast builds real anticipation: you can walk
  // away and get pinged when it bites. Deeper casts bite sooner. (ms)
  const baseWait = 28000 - power * 18000;                 // ~28s shallow → ~10s deep
  const biteDelay = clamp(baseWait * (0.6 + Math.random() * 0.8), 5000, 45000);
  return { tapsNeeded, timeWindow, biteDelay };
}

export function pickItem(power = 0) {
  const mult = power > 0.7 ? 1.8 : power > 0.4 ? 1.2 : 1;
  const weighted = ITEMS.map((it) => ({
    it,
    w: TIERS[it.tier].rank >= 2 ? it.weight * mult : it.weight,
  }));
  let total = weighted.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) { r -= x.w; if (r <= 0) return x.it; }
  return ITEMS[0];
}

// ---- NPC roster for the ranking (stable) ----
const NPC_FIXED = [
  { nick: "월척사냥꾼",   trophy: "고대 유물 항아리", tier: "legend", score: 312 },
  { nick: "뻐끔여신",     trophy: "황금 보물상자",    tier: "epic",   score: 196 },
  { nick: "저수지지배자", trophy: "루비 원석",        tier: "epic",   score: 171 },
  { nick: "입질장인",     trophy: "황동 나침반",      tier: "epic",   score: 142 },
  { nick: "찌의민족",     trophy: "은화 한 닢",       tier: "rare",   score: 96 },
  { nick: "새벽붕어",     trophy: "골동 회중시계",    tier: "rare",   score: 78 },
  { nick: "가짜미끼왕",   trophy: "진주 단추",        tier: "rare",   score: 61 },
  { nick: "출근전한판",   trophy: "은 손거울",        tier: "rare",   score: 47 },
];
function buildNpcs() {
  const list = NPC_FIXED.slice();
  const extra = ["점심헌터","탕비실강태공","사축붕어","월요병","칼퇴요정","주말없음","연봉협상중","사내연못","물멍중","리필가능","무한루프","빌드중","배포대기","핫픽스","연차쓰개"];
  let s = 40;
  for (const nick of extra) {
    s = Math.max(2, s - 2 - Math.floor(Math.random() * 3));
    const tier = s > 20 ? "rare" : s > 8 ? "common" : "junk";
    const pool = ITEMS.filter((i) => i.tier === tier);
    list.push({ nick, trophy: pool[Math.floor(Math.random() * pool.length)].name, tier, score: s });
  }
  return list;
}

const SIZE_MIN = 12, SIZE_MAX = 48;
const BEST_QUOTE = "놓친 붕어가 더 크다지만, 이건 안 놓쳤지!";

export class Store {
  constructor(nickname) {
    this.nickname = nickname || "붕어왕초보";
    this.inventory = {};          // id -> count
    this.best = null;             // { id, name, tier, size, ts }
    this.npcs = buildNpcs();
    this._load();
  }

  _key() { return "boong.save." + this.nickname; }
  _load() {
    try {
      const raw = localStorage.getItem(this._key());
      if (raw) {
        const d = JSON.parse(raw);
        this.inventory = d.inventory || {};
        this.best = d.best || null;
      }
    } catch (e) { /* ignore */ }
  }
  _save() {
    try {
      localStorage.setItem(this._key(), JSON.stringify({ inventory: this.inventory, best: this.best }));
    } catch (e) { /* ignore (private mode etc.) */ }
  }

  totalCaught() { return Object.values(this.inventory).reduce((a, b) => a + b, 0); }
  countByTier() {
    const c = { junk: 0, common: 0, rare: 0, epic: 0, legend: 0 };
    for (const [id, n] of Object.entries(this.inventory)) {
      const it = ITEM_BY_ID[id]; if (it) c[it.tier] += n;
    }
    return c;
  }
  score() {
    let s = 0;
    for (const [id, n] of Object.entries(this.inventory)) {
      const it = ITEM_BY_ID[id]; if (it) s += TIERS[it.tier].score * n;
    }
    return s;
  }

  // record a catch; returns { isNewBest }
  addCatch(item) {
    this.inventory[item.id] = (this.inventory[item.id] || 0) + 1;
    let isNewBest = false;
    if (!this.best || TIERS[item.tier].rank > TIERS[this.best.tier].rank) {
      this.best = {
        id: item.id, name: item.name, tier: item.tier,
        size: Math.floor(SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)),
        ts: Date.now(),
      };
      isNewBest = true;
    }
    this._save();
    return { isNewBest };
  }

  bestTrophy() {
    if (this.best) {
      const it = ITEM_BY_ID[this.best.id];
      return { name: this.best.name, tier: this.best.tier, icon: it ? it.icon : "🐟", size: this.best.size };
    }
    return null;
  }

  // full ranking (player inserted by score), returns sorted rows + my index
  ranking() {
    const myBest = this.bestTrophy();
    const rows = this.npcs.map((n) => ({
      nick: n.nick, score: n.score, trophy: n.trophy, tier: n.tier, me: false,
    }));
    rows.push({
      nick: this.nickname + " (나)", score: this.score(),
      trophy: myBest ? myBest.name : "아직 없음", tier: myBest ? myBest.tier : "junk", me: true,
    });
    rows.sort((a, b) => b.score - a.score || (a.me ? 1 : -1));
    const myIndex = rows.findIndex((r) => r.me);
    return { rows, myRank: myIndex + 1 };
  }
}

export const QUOTE = BEST_QUOTE;
export function tierOf(id) { const it = ITEM_BY_ID[id]; return it ? it.tier : "junk"; }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
