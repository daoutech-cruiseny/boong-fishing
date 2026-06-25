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
  SUPABASE_URL: "",       // 예: https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: "",  // 예: eyJhbGciOiJIUzI1NiIs...

  ROOM: "저수지 1호",      // 같은 방에 있는 사람끼리 보입니다

  // 사내망에서 esm.sh가 막히면 자체 호스팅 ESM 경로로 바꾸세요.
  SUPABASE_ESM_URL: "https://esm.sh/@supabase/supabase-js@2",
};

export const realtimeConfigured = () =>
  !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
