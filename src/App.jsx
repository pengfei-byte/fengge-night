import { useEffect, useState } from "react";
import Call from "./components/Call.jsx";
import { fetchHealth } from "./lib/api.js";

export default function App() {
  const [health, setHealth] = useState(null);
  const [calling, setCalling] = useState(false);

  useEffect(() => {
    document.title = "亡命夜谈 · 峰哥";
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth({ realtime: false, portrait: "/fengge.jpg", briefing: { chips: [] } }));
  }, []);

  if (calling) {
    return <Call health={health} onLeave={() => setCalling(false)} />;
  }

  const ready = Boolean(health?.realtime);
  const portrait = health?.portrait || "/fengge.jpg";

  return (
    <main className="cover">
      <img className="cover-photo" src={portrait} alt="峰哥，戴着帽子，夜里靠着砖墙" />
      <div className="cover-shade" />
      <p className="live-pill">
        <i />
        直播中
      </p>
      <section className="cover-copy">
        <p className="eyebrow">非官方 AI 分身</p>
        <h1>
          亡命夜谈
          <em>峰哥</em>
        </h1>
        <button type="button" className="call-btn" disabled={!ready} onClick={() => setCalling(true)}>
          {ready ? "进入直播间" : "线路还没准备好"}
        </button>
        <p className="fine">模仿公开场合的口气和神态，不是周丽峰本人。接通后大约五分钟，退出就停。</p>
      </section>
    </main>
  );
}
