// Password gate for the whole site (Cloudflare Pages Functions run this before every file is served).
// Passwords come from the APP_PASSWORDS secret: one per line or comma-separated, so each person can have their own.
// Removing a password signs out everyone who used it. If the secret is missing, the site stays locked.
const COOKIE = 'wi_session';
const DAYS = 365;
const enc = new TextEncoder();

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = async s => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function sign(pw, payload) {
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('wealth-island:key:' + pw)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}
const tagOf = async pw => (await sha('wealth-island:tag:' + pw)).slice(0, 12);
function same(a, b) {   // constant-time string compare
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const passwordsOf = env => String(env.APP_PASSWORDS || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);

async function makeSession(pw) {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400, tag = await tagOf(pw);
  return `${exp}.${tag}.${await sign(pw, `${exp}.${tag}`)}`;
}
async function validSession(cookie, passwords) {
  const [exp, tag, sig] = String(cookie || '').split('.');
  if (!sig || !(Number(exp) > Date.now() / 1000)) return false;
  for (const pw of passwords) {
    if (!same(await tagOf(pw), tag)) continue;
    return same(await sign(pw, `${exp}.${tag}`), sig);
  }
  return false;
}
function readCookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

function page(msg, next, status) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="robots" content="noindex"><meta name="theme-color" content="#FBF7F0"><title>登入・我的財富島</title>
<style>
:root{--bg:#FBF7F0;--surface:#fff;--ink:#2A2721;--ink-3:#857D70;--line:#ECE4D8;--em:#16905E;--on-em:#fff;--coral:#DB6450;--coral-soft:#FBE8E2;color-scheme:light}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg)}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",system-ui,sans-serif;color:var(--ink);min-height:100vh;display:grid;place-items:center;
  padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
form{width:100%;max-width:360px;background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:24px 20px;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-size:24px;font-weight:800;text-align:center}p{margin:0;font-size:13.5px;color:var(--ink-3);text-align:center;line-height:1.6}
.logo{font-size:40px;text-align:center;line-height:1}
input{width:100%;font:inherit;font-size:17px;color:var(--ink);background:var(--bg);border:1.5px solid transparent;border-radius:14px;padding:13px 14px;outline:0}
input:focus{border-color:var(--em)}
button{font:inherit;font-weight:700;font-size:16px;border:0;border-radius:14px;padding:13px;background:var(--em);color:var(--on-em);cursor:pointer}
.err{color:var(--coral);background:var(--coral-soft);padding:8px 12px;border-radius:12px;font-weight:600}
</style></head><body>
<form method="post" action="/login">
  <div class="logo">🏝️</div><h1>我的財富島</h1>
  <p>這個 App 只開放給有密碼的人使用。</p>
  ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
  <input type="text" name="username" value="財富島" autocomplete="username" hidden>
  <input type="password" name="password" placeholder="密碼" autocomplete="current-password" required autofocus aria-label="密碼">
  <input type="hidden" name="next" value="${esc(next)}">
  <button type="submit">登入</button>
</form></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const passwords = passwordsOf(env);
  if (!passwords.length) return page('網站管理員尚未設定密碼（Cloudflare 的 APP_PASSWORDS），目前暫停開放。', '/', 503);

  if (url.pathname === '/logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await request.formData();
    const pw = String(form.get('password') || ''), next = safeNext(form.get('next'));
    if (passwords.some(p => same(p, pw))) {
      return new Response(null, { status: 303, headers: { Location: next, 'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE}=${await makeSession(pw)}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` } });
    }
    await new Promise(r => setTimeout(r, 1000));   // slow down guessing
    return page('密碼不正確', next, 401);
  }
  if (await validSession(readCookie(request, COOKIE), passwords)) {
    if (url.pathname === '/login') return Response.redirect(new URL('/', url), 303);
    return context.next();
  }
  return page('', url.pathname === '/login' ? '/' : url.pathname + url.search, 401);
}
