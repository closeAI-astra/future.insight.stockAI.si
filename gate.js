// Future Sight — パスワード入口(publish_pages.py が生成。編集しない)
(() => {
  const META_URL = "enc-meta.json";
  const KEY_STORE = "fs-pages-key:" + new URL(".", location.href).pathname;
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  let key = null, meta = null;

  async function derive(password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(meta.salt), iterations: meta.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function decryptBytes(buf) {
    const u = new Uint8Array(buf);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  async function check() {
    try { const t = new TextDecoder().decode(await decryptBytes(b64(meta.check))); return t === "future-sight-ok"; } catch { return false; }
  }
  function installFetch() {
    const orig = window.fetch.bind(window);
    const dataPath = new URL("data/", document.baseURI).pathname;
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.startsWith(dataPath) && u.pathname.endsWith(".json")) {
        const request = new Request(u, input instanceof Request ? input : init);
        if (request.method !== "GET") return orig(input, init);
        const encryptedUrl = new URL(u); encryptedUrl.pathname += ".enc";
        const r = await orig(new Request(encryptedUrl, request), init);
        if (!r.ok) return new Response("", { status: r.status, statusText: r.statusText });
        const body = await decryptBytes(await r.arrayBuffer());
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
      }
      return orig(input, init);
    };
  }
  function start() {
    installFetch();
    document.getElementById("fs-gate")?.remove();
    const s = document.createElement("script"); s.src = "app.js"; document.body.appendChild(s);
  }
  function showGate(message) {
    const wrap = document.createElement("div"); wrap.id = "fs-gate";
    wrap.innerHTML = `<form><h1>Future Sight</h1><p>閲覧にはパスワードが必要です。</p>
      <input type="password" autocomplete="current-password" placeholder="パスワード" required>
      <label><input type="checkbox"> この端末で覚える</label>
      <button type="submit">開く</button><p class="fs-gate-msg">${message || ""}</p></form>`;
    const st = document.createElement("style");
    st.textContent = `#fs-gate{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#0f1a2e;font-family:"Noto Sans JP",system-ui,sans-serif}
      #fs-gate form{width:min(360px,92vw);display:grid;gap:12px;padding:28px;border-radius:18px;background:#fff;color:#10203e;box-shadow:0 20px 60px rgba(0,0,0,.35)}
      #fs-gate h1{margin:0;font-size:22px}#fs-gate p{margin:0;font-size:13px;color:#56627a}
      #fs-gate input[type=password]{padding:11px 12px;border-radius:10px;border:1px solid #c9d3e3;font-size:15px}
      #fs-gate label{font-size:12px;color:#56627a;display:flex;gap:6px;align-items:center}
      #fs-gate button{padding:11px;border:0;border-radius:10px;background:#1768ef;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
      #fs-gate .fs-gate-msg{color:#df4b57;min-height:1em}`;
    document.head.appendChild(st); document.body.appendChild(wrap);
    const form = wrap.querySelector("form"), pw = form.querySelector("input[type=password]"), rem = form.querySelector("input[type=checkbox]"), msg = form.querySelector(".fs-gate-msg"), btn = form.querySelector("button");
    pw.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); btn.disabled = true; msg.textContent = "確認中…";
      try {
        key = await derive(pw.value);
        if (!(await check())) { msg.textContent = "パスワードが違います。"; btn.disabled = false; return; }
        const raw = toB64(await crypto.subtle.exportKey("raw", key));
        try { (rem.checked ? localStorage : sessionStorage).setItem(KEY_STORE, JSON.stringify({ salt: meta.salt, raw })); } catch { /* 保存できない環境では毎回入力 */ }
        start();
      } catch (err) { msg.textContent = "開けませんでした: " + err; btn.disabled = false; }
    });
  }
  async function boot() {
    if (!window.crypto?.subtle || typeof DecompressionStream === "undefined") { document.body.innerHTML = "<p style='padding:24px'>このブラウザは対応していません(最新の Chrome / Edge / Safari / Firefox を使ってください)。</p>"; return; }
    meta = await (await fetch(META_URL, { cache: "no-store" })).json();
    for (const storeName of ["sessionStorage", "localStorage"]) {
      try {
        const store = window[storeName];
        const saved = JSON.parse(store.getItem(KEY_STORE) || "null");
        if (saved && saved.salt === meta.salt) {
          key = await crypto.subtle.importKey("raw", b64(saved.raw), { name: "AES-GCM" }, false, ["decrypt"]);
          if (await check()) { start(); return; }
        }
      } catch { /* 読めなければ入力してもらう */ }
    }
    showGate("");
  }
  const launch = () => boot().catch(() => {
    showGate("入口のデータを取得できませんでした。ページを再読み込みしてください。");
    document.querySelector("#fs-gate button").disabled = true;
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launch); else launch();
})();
