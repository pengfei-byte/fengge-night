import { useCallback, useEffect, useRef, useState } from "react";
import { closeSession, heartbeat, startCall } from "../lib/api.js";
import { R2Client } from "../lib/r2.js";
import { createRecognizer, isEchoOf, speechSupported, watchRemoteSpeech } from "../lib/speech.js";
import { turnPayload } from "../../server/persona.js";

const HIDDEN_CLOSE_MS = 25_000;
const CONNECT_TIMEOUT_MS = 22_000;
const CROWD = ["来了来了", "这是个好事儿啊", "夜谈开了", "先听他说完", "还真是", "帽子戴着", "砖墙这期", "说吧"];

function clock(ms) {
  const safe = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function crowdCount(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export default function Call({ health, onLeave }) {
  const videoRef = useRef(null);
  const clientRef = useRef(null);
  const sessionRef = useRef(null);
  const briefingRef = useRef(health?.briefing || null);
  const openedRef = useRef(false);
  const busyRef = useRef(false);
  const leaveRef = useRef(false);
  const genRef = useRef(0);
  const captionRef = useRef("");
  const recentFengRef = useRef([]);
  const echoMuteUntilRef = useRef(0);
  const hiddenTimerRef = useRef(null);
  const connectTimerRef = useRef(null);
  const visibleTimerRef = useRef(null);
  const openTimerRef = useRef(null);
  const recRef = useRef(null);
  const unwatchRef = useRef(null);
  const remoteTalkingRef = useRef(false);
  const inputRef = useRef(null);
  const barrageSeq = useRef(0);
  const heartSeq = useRef(0);
  const crowdCursor = useRef(0);

  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("dialing");
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState("主播正在赶来");
  const [fail, setFail] = useState(null);
  const [caption, setCaption] = useState("");
  const [barrage, setBarrage] = useState([]);
  const [hearts, setHearts] = useState([]);
  const [viewers, setViewers] = useState(1680);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState("");
  const [listening, setListening] = useState(false);
  const [remoteTalking, setRemoteTalking] = useState(false);
  const [ears, setEars] = useState(false);
  const [leftMs, setLeftMs] = useState(health?.hard_close_ms || 300_000);
  const [startedAt, setStartedAt] = useState(0);

  busyRef.current = busy;
  const portrait = health?.portrait || "/fengge.jpg";
  const chips = briefingRef.current?.chips || health?.briefing?.chips || [];

  const shutdown = useCallback((reason = "client_closed") => {
    clearTimeout(connectTimerRef.current);
    clearTimeout(visibleTimerRef.current);
    clearTimeout(openTimerRef.current);
    const id = sessionRef.current;
    clientRef.current?.close(reason);
    clientRef.current = null;
    if (id) closeSession(id);
    sessionRef.current = null;
    setLive(false);
  }, []);

  const free = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
    setStatus("他在听");
    if (!remoteTalkingRef.current) echoMuteUntilRef.current = Date.now() + 1600;
  }, []);

  const hold = useCallback(() => {
    busyRef.current = true;
    echoMuteUntilRef.current = Date.now() + 60_000;
    setBusy(true);
    setStatus("他在说");
  }, []);

  const openFail = useCallback(
    (body) => {
      shutdown("connect_failed");
      setPhase("ended");
      setFail({ title: "直播没开成", body: body || "视频暂时打不通。再试一次。" });
    },
    [shutdown]
  );

  const pushBarrage = useCallback((text, kind) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    const id = ++barrageSeq.current;
    setBarrage((prev) => [...prev, { id, text: clean, kind }].slice(-4));
  }, []);

  const popHeart = useCallback(() => {
    const id = ++heartSeq.current;
    const drift = Math.round(Math.random() * 36 - 18);
    setHearts((prev) => [...prev, { id, drift }].slice(-8));
    window.setTimeout(() => {
      setHearts((prev) => prev.filter((heart) => heart.id !== id));
    }, 980);
  }, []);

  const openIfNeeded = useCallback(() => {
    const client = clientRef.current;
    const opening = briefingRef.current?.opening;
    if (openedRef.current || !client || !opening?.text) return;
    if (!client.say(opening.text, opening)) return;
    openedRef.current = true;
    hold();
  }, [hold]);

  const speak = useCallback(
    (text) => {
      const payload = turnPayload(text);
      const client = clientRef.current;
      if (!payload.text || busyRef.current || !client || phase !== "live") return;
      if (isEchoOf(payload.text, captionRef.current)) return;
      if (!client.say(payload.text, payload)) return;
      setDraft("");
      setHeard("");
      pushBarrage(payload.text, "mine");
      hold();
    },
    [hold, phase, pushBarrage]
  );

  useEffect(() => {
    if (phase !== "live") return undefined;
    const tick = setInterval(() => {
      setViewers((n) => Math.min(9800, Math.max(860, n + Math.round((Math.random() - 0.42) * 18))));
    }, 2200);
    return () => clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    if (phase !== "live") return undefined;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        pushBarrage(CROWD[crowdCursor.current % CROWD.length], "crowd");
        crowdCursor.current += 1;
        arm();
      }, 3200 + Math.random() * 2600);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [phase, pushBarrage]);

  useEffect(() => {
    if (!startedAt || phase !== "live") return undefined;
    const total = health?.hard_close_ms || 300_000;
    const tick = setInterval(() => {
      setLeftMs(Math.max(0, total - (Date.now() - startedAt)));
    }, 500);
    return () => clearInterval(tick);
  }, [health?.hard_close_ms, phase, startedAt]);

  useEffect(() => {
    let cancelled = false;
    const gen = ++genRef.current;
    leaveRef.current = false;
    openedRef.current = false;

    (async () => {
      setPhase("dialing");
      setStatus("主播正在赶来");
      setFail(null);
      setLive(false);
      setRemoteTalking(false);
      setBarrage([]);
      setCaption("");
      captionRef.current = "";
      recentFengRef.current = [];
      echoMuteUntilRef.current = Date.now() + 1600;
      try {
        const data = await startCall();
        if (cancelled || gen !== genRef.current) {
          if (data.session?.session_id) closeSession(data.session.session_id);
          return;
        }
        briefingRef.current = data.briefing || briefingRef.current;
        sessionRef.current = data.session.session_id;
        const client = new R2Client({
          credentials: data.credentials,
          remoteVideo: videoRef.current,
          onRemoteStream: (stream) => {
            unwatchRef.current?.();
            unwatchRef.current = watchRemoteSpeech(stream, (talking) => {
              remoteTalkingRef.current = talking;
              echoMuteUntilRef.current = talking ? Date.now() + 60_000 : Date.now() + 1600;
              setRemoteTalking(talking);
              if (!busyRef.current || talking) return;
              clearTimeout(visibleTimerRef.current);
              visibleTimerRef.current = setTimeout(free, 700);
            });
          },
          onEvent: (msg) => {
            const d = msg.data || {};
            if (msg.type === "session.ready") {
              setStatus("画面要来了");
              openTimerRef.current = setTimeout(openIfNeeded, 700);
            }
            if (msg.type === "turn.text" && d.text) {
              captionRef.current = d.text;
              recentFengRef.current = [...recentFengRef.current, d.text].slice(-6);
              setCaption(d.text);
              hold();
              clearTimeout(visibleTimerRef.current);
              visibleTimerRef.current = setTimeout(free, 16_000);
            }
            if (msg.type === "turn.started") hold();
            if (msg.type === "turn.visible") {
              clearTimeout(visibleTimerRef.current);
              visibleTimerRef.current = setTimeout(() => {
                if (!remoteTalkingRef.current) free();
              }, 1600);
            }
            if (msg.type === "media.clip" && d.kind === "idle") {
              clearTimeout(visibleTimerRef.current);
              visibleTimerRef.current = setTimeout(free, 500);
            }
          },
          onError: (err) => {
            if (gen !== genRef.current || leaveRef.current) return;
            if (!openedRef.current) {
              openFail(err.message || "视频暂时打不通。");
              return;
            }
            free();
            setStatus("这句没接上，你再说一遍");
          },
          onEnded: (info) => {
            if (gen !== genRef.current || leaveRef.current) return;
            if (!openedRef.current) {
              openFail("他那边没接住。再试一次。");
              return;
            }
            setLive(false);
            busyRef.current = false;
            setBusy(false);
            setPhase("ended");
            setStatus(info?.reason === "budget_exhausted" ? "时间到了" : "这场停了");
          },
        });
        clientRef.current = client;
        client.start();
        connectTimerRef.current = setTimeout(() => {
          if (cancelled || gen !== genRef.current || leaveRef.current) return;
          if ((videoRef.current?.videoWidth || 0) < 64) openFail("画面太久没来。再试一次。");
        }, CONNECT_TIMEOUT_MS);
      } catch (err) {
        if (!cancelled) openFail(err.message);
      }
    })();

    return () => {
      cancelled = true;
      unwatchRef.current?.();
      unwatchRef.current = null;
    };
  }, [attempt, free, hold, openFail, openIfNeeded]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const mark = () => {
      if ((video.videoWidth || 0) < 64) return;
      setLive(true);
      setPhase("live");
      setStartedAt((value) => value || Date.now());
      clearTimeout(connectTimerRef.current);
      video.play().catch(() => {});
      openIfNeeded();
    };
    video.addEventListener("playing", mark);
    video.addEventListener("loadeddata", mark);
    video.addEventListener("resize", mark);
    return () => {
      video.removeEventListener("playing", mark);
      video.removeEventListener("loadeddata", mark);
      video.removeEventListener("resize", mark);
    };
  }, [attempt, openIfNeeded]);

  useEffect(() => {
    const beat = setInterval(() => heartbeat(sessionRef.current), 8_000);
    const onHide = () => {
      clearTimeout(hiddenTimerRef.current);
      if (document.hidden && sessionRef.current) {
        hiddenTimerRef.current = setTimeout(() => {
          shutdown("viewer_hidden");
          setPhase("ended");
          setStatus("你离开了，直播停了");
        }, HIDDEN_CLOSE_MS);
      }
    };
    const onLeavePage = () => {
      const id = sessionRef.current;
      if (id) navigator.sendBeacon(`/api/sessions/${id}/close`);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeavePage);
    return () => {
      leaveRef.current = true;
      clearInterval(beat);
      clearTimeout(hiddenTimerRef.current);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeavePage);
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      shutdown("unmount");
    };
  }, [shutdown]);

  useEffect(() => {
    if (phase !== "live" || busy || remoteTalking) {
      setEars(false);
      return undefined;
    }
    const wait = Math.max(1400, echoMuteUntilRef.current - Date.now());
    const timer = setTimeout(() => setEars(true), wait);
    return () => clearTimeout(timer);
  }, [busy, phase, remoteTalking]);

  useEffect(() => {
    if (phase !== "live" || busy || !ears || !speechSupported()) {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      recRef.current = null;
      setListening(false);
      return undefined;
    }
    let stopped = false;
    const begin = () => {
      if (stopped || leaveRef.current || busyRef.current || Date.now() < echoMuteUntilRef.current || recRef.current) return;
      const rec = createRecognizer({
        onResult: ({ all, finalText }) => {
          if (busyRef.current || Date.now() < echoMuteUntilRef.current) return;
          const recent = recentFengRef.current;
          if (isEchoOf(all, recent) || (finalText && isEchoOf(finalText, recent))) return;
          setHeard(all);
          if (finalText) speak(finalText);
        },
        onError: (ev) => {
          if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") {
            stopped = true;
            setListening(false);
            setHeard("麦克风没开，改用打字");
          }
        },
        onEnd: () => {
          if (recRef.current === rec) recRef.current = null;
          setListening(false);
          if (stopped || leaveRef.current || busyRef.current || Date.now() < echoMuteUntilRef.current) return;
          window.setTimeout(begin, 280);
        },
      });
      if (!rec) return;
      recRef.current = rec;
      setListening(true);
      try {
        rec.start();
      } catch {
        recRef.current = null;
        setListening(false);
      }
    };
    begin();
    return () => {
      stopped = true;
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, [busy, ears, phase, speak]);

  const hangup = () => {
    leaveRef.current = true;
    shutdown("client_closed");
    onLeave();
  };

  const retry = () => {
    leaveRef.current = true;
    shutdown("retry");
    setFail(null);
    setAttempt((n) => n + 1);
  };

  const connecting = phase === "dialing" && !fail;

  return (
    <main className="room">
      <section className="room-stage" onClick={() => videoRef.current?.play().catch(() => {})}>
        <video ref={videoRef} className="face" autoPlay playsInline />
        {!live && <img className="still" src={portrait} alt="" />}

        <header className="room-top">
          <div className="host">
            <img src={portrait} alt="" />
            <div>
              <strong>峰哥</strong>
              <span>{live ? `人气 ${crowdCount(viewers)}` : "连接中"}</span>
            </div>
          </div>
          <div className="room-tools">
            {live && <em>{clock(leftMs)}</em>}
            <button type="button" className="close-x" onClick={hangup} aria-label="退出直播间">
              ×
            </button>
          </div>
        </header>

        {connecting && (
          <div className="veil">
            <p>主播正在赶来</p>
            <small>第一句会慢一点</small>
          </div>
        )}

        <div className="barrage" aria-live="polite">
          {barrage.map((item) => (
            <p key={item.id} className={item.kind}>
              {item.text}
            </p>
          ))}
        </div>

        {caption && phase !== "ended" && <p className="caption">{caption}</p>}

        {hearts.map((heart) => (
          <span key={heart.id} className="heart" style={{ "--drift": `${heart.drift}px` }}>
            ♥
          </span>
        ))}

        {phase === "live" && (
          <>
            <button type="button" className="like" onClick={popHeart} aria-label="点赞">
              ♥
            </button>
            <form
              className="dock"
              onSubmit={(event) => {
                event.preventDefault();
                if (event.nativeEvent.isComposing) return;
                speak(draft);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {heard && <p className="heard">听到：{heard}</p>}
              <div className="chips">
                {chips.map((chip) => (
                  <button key={chip} type="button" disabled={busy} onClick={() => speak(chip)}>
                    {chip}
                  </button>
                ))}
              </div>
              <div className="composer">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={busy ? "等他说完" : listening ? "直接说，或发个弹幕" : "发个弹幕"}
                  maxLength={400}
                  aria-label="发弹幕"
                />
                <button type="submit" disabled={busy || !draft.trim()}>
                  发送
                </button>
              </div>
            </form>
          </>
        )}

        {phase === "ended" && !fail && (
          <div className="ended-veil">
            <p className="ended-title">直播已结束</p>
            <p className="fine">{status}</p>
            <button type="button" onClick={retry}>
              再进一次
            </button>
            <button type="button" className="text-btn" onClick={hangup}>
              退出
            </button>
          </div>
        )}
      </section>

      {fail && (
        <div className="modal" role="dialog" aria-modal="true">
          <div>
            <p className="eyebrow">{fail.title}</p>
            <p>{fail.body}</p>
            <div className="modal-actions">
              <button type="button" onClick={retry}>
                再进一次
              </button>
              <button type="button" className="text-btn" onClick={hangup}>
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
