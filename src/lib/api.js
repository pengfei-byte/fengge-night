function explain(err, data, status) {
  if (data?.error) {
    const e = data.error;
    const wrapped = new Error(e.message || "请求失败");
    wrapped.code = e.code;
    wrapped.retryAfter = e.retry_after_ms;
    wrapped.payload = data;
    return wrapped;
  }
  if (err?.name === "TypeError" || /failed to fetch/i.test(err?.message || "")) {
    return new Error("本地服务没开。先跑 npm run dev，再刷新。");
  }
  return new Error(err?.message || `请求失败${status ? `（${status}）` : ""}`);
}

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
      ...options,
    });
  } catch (err) {
    throw explain(err);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw explain(null, data, res.status);
  return data;
}

export function fetchHealth() {
  return request("/api/health");
}

export async function startCall() {
  let res;
  try {
    res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (err) {
    throw explain(err);
  }
  const data = await res.json().catch(() => ({}));
  if (data?.credentials && data?.session?.session_id) return data;
  throw explain(null, data, res.status);
}

export function closeSession(sessionId) {
  if (!sessionId) return Promise.resolve();
  return fetch(`/api/sessions/${sessionId}/close`, { method: "POST" }).catch(() => {});
}

export function heartbeat(sessionId) {
  if (!sessionId) return Promise.resolve();
  return fetch(`/api/sessions/${sessionId}/heartbeat`, { method: "POST" }).catch(() => {});
}
