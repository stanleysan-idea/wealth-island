// Latest prices for investments: GET /api/quote?q=tw:2330,us:AAPL,crypto:BTC
// Runs behind the password gate (functions/_middleware.js). Only ticker symbols reach this function;
// how many shares someone holds stays on their phone.
const UA = 'Mozilla/5.0';   // Yahoo answers 429 to full browser user agents from servers
const ITEM = /^(tw|us|crypto):([A-Z0-9.-]{1,12})$/;
const MAX_ITEMS = 30;

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cf: { cacheTtl: 120 } });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}
async function yahoo(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`;
  const j = (await getJSON('https://query1.finance.yahoo.com' + path)) || (await getJSON('https://query2.finance.yahoo.com' + path));
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || !(m.regularMarketPrice > 0)) return null;
  return { price: m.regularMarketPrice, prev: m.chartPreviousClose || m.previousClose || 0, currency: String(m.currency || 'USD').toUpperCase(), time: (m.regularMarketTime || 0) * 1000, name: m.shortName || m.longName || sym };
}
async function twse(code) {   // the Taiwan exchange's own quote, listed (tse) or OTC (otc); has the Chinese name
  const j = await getJSON(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw|otc_${code}.tw`);
  const m = (j?.msgArray || []).find(x => parseFloat(x.z) > 0 || parseFloat(x.y) > 0);
  if (!m) return null;
  const price = parseFloat(m.z) > 0 ? parseFloat(m.z) : parseFloat(m.y);   // z = last trade, y = previous close (no trade yet today)
  const d = String(m.d || ''), t = String(m.t || '00:00:00');
  const time = d.length === 8 ? Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t}+08:00`) : 0;
  return { price, prev: parseFloat(m.y) || 0, currency: 'TWD', time: time || Date.now(), name: m.n || code };
}
async function coingecko(sym) {   // crypto fallback, priced in USD
  const s = sym.toLowerCase(), j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?symbols=${s}&vs_currencies=usd&include_last_updated_at=true&include_24hr_change=true`);
  const r = j?.[s];
  return r && r.usd > 0 ? { price: r.usd, prev: r.usd_24h_change ? r.usd / (1 + r.usd_24h_change / 100) : 0, currency: 'USD', time: (r.last_updated_at || 0) * 1000, name: sym } : null;
}
async function fxRate(c) {   // TWD per one unit of c
  const r = await yahoo(`${c}TWD=X`);
  if (r) return r.price;
  const j = await getJSON(`https://open.er-api.com/v6/latest/${c}`);
  return j?.rates?.TWD > 0 ? j.rates.TWD : null;
}
async function quote(market, sym) {
  if (market === 'tw') return (await twse(sym)) || (await yahoo(sym + '.TW')) || (await yahoo(sym + '.TWO'));
  if (market === 'us') return yahoo(sym);
  return (await yahoo(sym + '-USD')) || (await coingecko(sym));
}

export async function onRequestGet({ request }) {
  const items = [...new Set(String(new URL(request.url).searchParams.get('q') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean))];
  const ok = items.map(s => s.replace(/^(TW|US|CRYPTO):/, p => p.toLowerCase())).filter(s => ITEM.test(s)).slice(0, MAX_ITEMS);
  const quotes = {};
  await Promise.all(ok.map(async key => {
    const [, market, sym] = key.match(ITEM);
    try { const q = await quote(market, sym); if (q) quotes[key] = q; } catch (e) { /* leave it out: the app keeps the last value */ }
  }));
  const fx = { TWD: 1 };   // every other currency the quotes came in, as TWD per unit
  await Promise.all([...new Set(Object.values(quotes).map(q => q.currency))].filter(c => c !== 'TWD' && /^[A-Z]{3}$/.test(c)).map(async c => {
    try { const r = await fxRate(c); if (r) fx[c] = r; } catch (e) {}
  }));
  return new Response(JSON.stringify({ quotes, fx, missing: ok.filter(k => !quotes[k]), at: Date.now() }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
}
