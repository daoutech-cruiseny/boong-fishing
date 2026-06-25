// face.js — MediaPipe Face Landmarker wrapper for 붕어 낚시터
// Exposes per-frame metrics (mouth openness/funnel/pucker, head yaw) and
// calibration. Fails gracefully so the game can fall back to button/keyboard.

const TASKS_VERSION = "0.10.20";
const WASM_URL  = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const ESM_URL   = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// landmark indices (MediaPipe FaceMesh)
const NOSE_TIP = 1, FACE_L = 454, FACE_R = 234;

// sensitivity → threshold deltas above the neutral baseline
const SENS = {
  low:    { open: 0.26, funnel: 0.14, pucker: 0.26 },
  normal: { open: 0.18, funnel: 0.10, pucker: 0.20 },
  high:   { open: 0.12, funnel: 0.07, pucker: 0.15 },
};

export class FaceTracker {
  constructor() {
    this.available = false;       // model + camera ready
    this.faceFound = false;
    this.metrics = { jawOpen: 0, funnel: 0, pucker: 0, yaw: 0 };
    this.baseline = { jawOpen: 0.04, funnel: 0.02, pucker: 0.02, yaw: 0 };
    this.sensitivity = "normal";
    this.th = { open: 0.22, funnel: 0.12, pucker: 0.22 };
    this.openRef = null;          // captured peak of the user's 'O' (set during calibration)
    this.onframe = null;          // (metrics) => void
    this._raw = { jawOpen: 0, funnel: 0, pucker: 0, yaw: 0 };
    this._landmarker = null;
    this._video = null;
    this._stream = null;
    this._running = false;
    this._lastTs = -1;
    this.zoom = 2;                 // digital zoom fed to the detector (bigger face)
    this._canvas = null; this._ctx = null;
    this._recalcTh();
  }

  setSensitivity(level) {
    if (SENS[level]) { this.sensitivity = level; this._recalcTh(); }
  }
  _recalcTh() {
    const d = SENS[this.sensitivity];
    if (this.openRef) {
      // Adaptive: place the threshold a fraction of the way from the neutral
      // baseline to the user's actual 'O' peak. Because both are measured at the
      // user's real distance, detection no longer depends on sitting close.
      const frac = { low: 0.62, normal: 0.46, high: 0.34 }[this.sensitivity] || 0.46;
      const lerp = (base, peak, floor) =>
        Math.max(base + floor, base + Math.max(0, peak - base) * frac);
      this.th = {
        open:   lerp(this.baseline.jawOpen, this.openRef.jawOpen, 0.05),
        funnel: lerp(this.baseline.funnel,  this.openRef.funnel,  0.025),
        pucker: this.baseline.pucker + d.pucker,
      };
    } else {
      this.th = {
        open:   this.baseline.jawOpen + d.open,
        funnel: this.baseline.funnel + d.funnel,
        pucker: this.baseline.pucker + d.pucker,
      };
    }
  }

  async init(videoEl) {
    this._video = videoEl;
    // 1) camera (throws if denied/unavailable)
    // Higher capture resolution gives the landmarker more pixels on a distant
    // face, so blendshapes (jawOpen/funnel/pucker) stay reliable from farther away.
    this._stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = this._stream;
    await videoEl.play();

    // Optional native zoom on cameras that expose it (rare); the software
    // canvas zoom below is the universal path and works on every webcam.
    try {
      const track = this._stream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : null;
      if (caps && caps.zoom) {
        const target = Math.min(caps.zoom.max || 1.5, Math.max(caps.zoom.min || 1, 1.5));
        await track.applyConstraints({ advanced: [{ zoom: target }] });
        this._nativeZoom = target;
        // native zoom already enlarges the face → lighten the software zoom
        this.zoom = Math.max(1, 2 / target);
      }
    } catch (e) { /* unsupported — software zoom handles it */ }

    // 2) model (CDN). If this fails we keep camera but no detection.
    try {
      const mod = await import(ESM_URL);
      const fileset = await mod.FilesetResolver.forVisionTasks(WASM_URL);
      this._landmarker = await mod.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
      this.available = true;
    } catch (err) {
      console.warn("[face] model load failed; gestures disabled:", err);
      this.available = false;
    }
    this._running = true;
    this._loop();
    return this.available;
  }

  _loop = () => {
    if (!this._running) return;
    if (this._landmarker && this._video && this._video.readyState >= 2) {
      let ts = performance.now();
      if (ts <= this._lastTs) ts = this._lastTs + 1;
      this._lastTs = ts;
      try {
        const res = this._landmarker.detectForVideo(this._zoomedInput(), ts);
        this._consume(res);
      } catch (e) { /* transient */ }
    }
    requestAnimationFrame(this._loop);
  };

  // center-crop + upscale the frame so the face fills more of what the
  // detector sees — a software 2x zoom that works on every webcam.
  _zoomedInput() {
    const v = this._video;
    const z = this.zoom || 1;
    if (z <= 1 || !v.videoWidth) return v;
    const sw = Math.round(v.videoWidth / z), sh = Math.round(v.videoHeight / z);
    const sx = Math.round((v.videoWidth - sw) / 2), sy = Math.round((v.videoHeight - sh) / 2);
    if (!this._canvas) { this._canvas = document.createElement("canvas"); this._ctx = this._canvas.getContext("2d"); }
    if (this._canvas.width !== sw || this._canvas.height !== sh) { this._canvas.width = sw; this._canvas.height = sh; }
    this._ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
    return this._canvas;
  }

  _consume(res) {
    const hasFace = res && res.faceLandmarks && res.faceLandmarks.length > 0;
    this.faceFound = hasFace;
    if (hasFace) {
      const bs = res.faceBlendshapes && res.faceBlendshapes[0];
      const get = (name) => {
        if (!bs) return 0;
        const c = bs.categories.find((x) => x.categoryName === name);
        return c ? c.score : 0;
      };
      const lm = res.faceLandmarks[0];
      const nose = lm[NOSE_TIP], l = lm[FACE_L], r = lm[FACE_R];
      const width = Math.abs(l.x - r.x) || 1e-3;
      const yawRaw = (nose.x - (l.x + r.x) / 2) / width; // ~0 centered

      // light smoothing
      const a = 0.5;
      this._raw.jawOpen = a * this._raw.jawOpen + (1 - a) * get("jawOpen");
      this._raw.funnel  = a * this._raw.funnel  + (1 - a) * get("mouthFunnel");
      this._raw.pucker  = a * this._raw.pucker  + (1 - a) * get("mouthPucker");
      this._raw.yaw     = a * this._raw.yaw     + (1 - a) * yawRaw;

      this.metrics = {
        jawOpen: this._raw.jawOpen,
        funnel:  this._raw.funnel,
        pucker:  this._raw.pucker,
        yaw:     this._raw.yaw - this.baseline.yaw,
      };
    }
    if (this.onframe) this.onframe(this.metrics, this.faceFound);
  }

  // average raw metrics over `ms` to set the neutral baseline
  captureNeutral(ms = 900) {
    this.openRef = null;          // re-measure the 'O' after a fresh neutral
    return new Promise((resolve) => {
      const samples = [];
      const t0 = performance.now();
      const grab = () => {
        if (this.faceFound) samples.push({ ...this._raw });
        if (performance.now() - t0 < ms) { requestAnimationFrame(grab); return; }
        if (samples.length) {
          const avg = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
          this.baseline = { jawOpen: avg("jawOpen"), funnel: avg("funnel"), pucker: avg("pucker"), yaw: avg("yaw") };
          this._recalcTh();
        }
        resolve(samples.length > 0);
      };
      grab();
    });
  }

  // record the peak of an 'O' over `ms` and derive distance-adaptive thresholds
  captureO(ms = 1500) {
    return new Promise((resolve) => {
      const peak = { jawOpen: 0, funnel: 0 };
      let sawFace = false;
      const t0 = performance.now();
      const grab = () => {
        if (this.faceFound) {
          sawFace = true;
          peak.jawOpen = Math.max(peak.jawOpen, this._raw.jawOpen);
          peak.funnel  = Math.max(peak.funnel,  this._raw.funnel);
        }
        if (performance.now() - t0 < ms) { requestAnimationFrame(grab); return; }
        // only trust it if the mouth clearly opened past the neutral baseline
        const opened = sawFace && (peak.jawOpen - this.baseline.jawOpen) > 0.05;
        if (opened) { this.openRef = peak; this._recalcTh(); }
        resolve(opened);
      };
      grab();
    });
  }

  // gesture helpers (read by game logic)
  isO()      { return this.metrics.jawOpen > this.th.open && this.metrics.funnel > this.th.funnel; }
  isOpen()   { return this.metrics.jawOpen > this.th.open; }
  isPucker() { return this.metrics.pucker > this.th.pucker && this.metrics.jawOpen < this.th.open * 0.6; }

  stop() {
    this._running = false;
    if (this._stream) this._stream.getTracks().forEach((t) => t.stop());
    if (this._landmarker && this._landmarker.close) { try { this._landmarker.close(); } catch (e) {} }
  }
}
