export function speechSupported() {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function flatten(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function isEchoOf(userText, caption) {
  const a = flatten(userText);
  const b = flatten(Array.isArray(caption) ? caption.join("") : caption);
  if (a.length < 2 || !b) return false;
  if (a === b || b.includes(a) || (b.length >= 2 && a.includes(b))) return true;
  if (a.length < 4) return false;
  let windows = 0;
  let hit = 0;
  for (let i = 0; i <= a.length - 4; i += 1) {
    windows += 1;
    if (b.includes(a.slice(i, i + 4))) hit += 1;
  }
  return windows > 0 && hit / windows >= 0.55;
}

export function watchRemoteSpeech(stream, onChange) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !stream?.getAudioTracks?.().length) return () => {};
  const ctx = new AudioCtx();
  ctx.resume?.().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let speaking = false;
  let quietMs = 0;
  const tick = setInterval(() => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i];
    const avg = sum / data.length;
    if (avg > 14) {
      quietMs = 0;
      if (!speaking) {
        speaking = true;
        onChange(true);
      }
    } else if (speaking) {
      quietMs += 80;
      if (quietMs >= 1200) {
        speaking = false;
        onChange(false);
      }
    }
  }, 80);
  return () => {
    clearInterval(tick);
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    ctx.close().catch(() => {});
  };
}

export function createRecognizer({ onResult, onError, onEnd } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "zh-CN";
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    let finalText = "";
    let interim = "";
    const start = ev.resultIndex ?? 0;
    for (let i = start; i < ev.results.length; i += 1) {
      const piece = ev.results[i][0]?.transcript || "";
      if (ev.results[i].isFinal) finalText += piece;
      else interim += piece;
    }
    const all = `${finalText}${interim}`.replace(/\s+/g, "").trim();
    onResult?.({ finalText: finalText.trim(), interim: interim.trim(), all });
  };
  rec.onerror = (ev) => onError?.(ev);
  rec.onend = () => onEnd?.();
  return rec;
}
