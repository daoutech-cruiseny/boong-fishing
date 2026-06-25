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

      // unique per-session key so two people with the same nickname both show
      this._key = nick + "#" + Math.random().toString(36).slice(2, 8);
      // IMPORTANT: keep the topic ASCII/no-colon/no-space — special chars in the
      // channel name silently break broadcast fan-out (presence still works).
      const topic = "pond_" + encodeURIComponent(this.room).replace(/[^a-zA-Z0-9_]/g, "");
      const ch = this._client.channel(topic, {
        config: { presence: { key: this._key }, broadcast: { self: false } },
      });

      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        const users = Object.entries(state).map(([key, metas]) => {
          const m = (metas && metas[0]) || {};
          return { nick: m.nick || key, since: m.since || 0, score: m.score || 0, best: m.best || "" };
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
            this._meta = { nick, since: Date.now(), score: 0, best: "" };
            ch.track(this._meta);
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

  // update my live score/trophy so everyone's leaderboard reflects it
  updateState(partial) {
    if (!this._channel || !this._meta) return;
    Object.assign(this._meta, partial);
    try { this._channel.track(this._meta); } catch (e) { /* ignore */ }
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
