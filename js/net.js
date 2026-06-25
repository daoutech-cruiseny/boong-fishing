// net.js — optional realtime presence + catch broadcast via Supabase Realtime.
// Uses only the anon key (no DB tables / no edge functions): pure ephemeral
// Presence (who's online) + Broadcast (catch events). Falls back silently when
// unconfigured or unreachable, so the game still runs on the NPC simulation.

import { CONFIG, realtimeConfigured } from "./config.js";

export class Pond {
  constructor(room) {
    this.room = room || CONFIG.ROOM || "저수지 1호";
    this.enabled = false;       // true once subscribed to the live channel
    this.onPresence = null;     // (users:[{nick, since}]) => void
    this.onCatch = null;        // (payload) => void  (remote catch)
    this._client = null;
    this._channel = null;
    this._nick = null;
  }

  async connect(nick) {
    this._nick = nick;
    if (!realtimeConfigured()) return false;   // no keys → caller keeps NPC sim
    try {
      const mod = await import(/* @vite-ignore */ CONFIG.SUPABASE_ESM_URL);
      const createClient = mod.createClient || (mod.default && mod.default.createClient);
      if (!createClient) throw new Error("createClient not found in module");

      this._client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 5 } },
      });

      const ch = this._client.channel("pond:" + this.room, {
        config: { presence: { key: nick } },
      });

      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        const users = Object.entries(state).map(([key, metas]) => {
          const m = (metas && metas[0]) || {};
          return { nick: m.nick || key, since: m.since || 0 };
        });
        if (this.onPresence) this.onPresence(users);
      });

      ch.on("broadcast", { event: "catch" }, ({ payload }) => {
        if (this.onCatch && payload) this.onCatch(payload);
      });

      await new Promise((resolve, reject) => {
        let settled = false;
        ch.subscribe((status) => {
          if (settled) return;
          if (status === "SUBSCRIBED") {
            settled = true;
            ch.track({ nick, since: Date.now() });
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            settled = true;
            reject(new Error(status));
          }
        });
        // safety timeout so a hung connection still falls back to NPC sim
        setTimeout(() => { if (!settled) { settled = true; reject(new Error("timeout")); } }, 6000);
      });

      this._channel = ch;
      this.enabled = true;
      return true;
    } catch (err) {
      console.warn("[net] realtime unavailable; using NPC simulation:", err);
      this.enabled = false;
      try { this._client && this._channel && this._client.removeChannel(this._channel); } catch (e) {}
      this._channel = null;
      return false;
    }
  }

  // announce a local catch to everyone in the room
  broadcastCatch(payload) {
    if (!this._channel) return;
    try {
      this._channel.send({ type: "broadcast", event: "catch", payload });
    } catch (e) { /* ignore */ }
  }

  disconnect() {
    try { this._channel && this._client && this._client.removeChannel(this._channel); } catch (e) {}
    this._channel = null;
    this.enabled = false;
  }
}
