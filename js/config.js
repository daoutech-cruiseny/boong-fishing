// config.js — realtime backend settings (optional).
//
// Fill these two values to turn on LIVE multiplayer:
//   • 접속 중인 다른 사용자 목록 (Supabase Presence)
//   • 누가 잡으면 전원에게 실시간 알림 (Supabase Broadcast)
//
// Leave them blank to keep running with the built-in NPC simulation.
//
// The anon key is SAFE to expose in a public static site — it is designed for
// client-side use and only carries the nickname + catch info for Realtime.
// (No video, no personal data is ever sent.)
export const CONFIG = {
  SUPABASE_URL: "https://omktdsywidqfrukdjwzm.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_zKWvP5EaQ4-v-aO3upGw1w_SFBLz0bH",  // publishable(클라이언트용) 키 — 공개 안전

  ROOM: "다우 낭낭저수지",  // 같은 방에 있는 사람끼리 보입니다

  // 사내망에서 esm.sh가 막히면 자체 호스팅 ESM 경로로 바꾸세요.
  SUPABASE_ESM_URL: "https://esm.sh/@supabase/supabase-js@2",
};

export const realtimeConfigured = () =>
  !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
