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
  const b = flatten(caption);
  if (a.length < 4 || !b) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const grams = (value) => {
    const set = new Set();
    for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size < 3) return false;
  let hit = 0;
  for (const gram of ga) if (gb.has(gram)) hit += 1;
  return hit / ga.size >= 0.72 && hit >= 4;
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
    if (avg > 22) {
      quietMs = 0;
      if (!speaking) {
        speaking = true;
        onChange(true);
      }
    } else if (speaking) {
      quietMs += 80;
      if (quietMs >= 900) {
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
    for (let i = 0; i < ev.results.length; i += 1) {
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
