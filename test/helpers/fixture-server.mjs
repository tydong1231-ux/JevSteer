import { createServer } from "node:http";
import { once } from "node:events";

function document(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title>
  <style>[hidden]{display:none!important}body{font:18px system-ui;max-width:900px;margin:40px auto;padding:20px}label{display:block;margin:18px 0}button,input,select,textarea{font:inherit;padding:10px;margin:4px}a{display:inline-block;margin:12px}article{padding:16px;border:1px solid #bbb;margin:16px 0}</style><body>${body}</body></html>`;
}

export async function startFixtureServer({ port = 0 } = {}) {
  const state = { drafts: [], searches: [], publications: 0 };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.test");
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const data = JSON.parse(raw || "{}");
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/api/draft") { state.drafts.push(data); res.end(JSON.stringify({ id: "DRAFT-42", status: "draft", ...data })); return; }
      if (url.pathname === "/api/search") { state.searches.push(data); res.end(JSON.stringify({ results: ["Casa Flora"], filters: data })); return; }
      if (url.pathname === "/api/publish") { state.publications++; res.end('{"published":true}'); return; }
      res.writeHead(404); res.end('{"error":"unknown endpoint"}'); return;
    }
    if (url.pathname === "/state") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(state)); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/hotels") res.end(document("Hotel search", `
      <h1>Find a hotel</h1><form id="search"><label>City <input id="city" name="city"></label>
      <label>Category <select id="category" name="category"><option value="all">All</option><option value="design">Design</option><option value="budget">Budget</option></select></label>
      <label><input type="checkbox" id="free" name="free"> Free cancellation</label><button>Search hotels</button></form><section id="results"></section>
      <script>document.querySelector('#search').onsubmit=async(e)=>{e.preventDefault();const p={city:document.querySelector('#city').value,category:document.querySelector('#category').value,free:document.querySelector('#free').checked};await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const q=new URLSearchParams(p);document.querySelector('#results').innerHTML='<h2>Search results</h2><p>City: '+p.city+'; Category: '+p.category+'; Free cancellation: '+p.free+'</p><article><a href="/hotels/casa-flora?'+q+'">Casa Flora</a></article>'}</script>`));
    else if (url.pathname === "/hotels/casa-flora") res.end(document("Casa Flora", `<h1>Casa Flora</h1><p>City: ${url.searchParams.get("city")}; Category: ${url.searchParams.get("category")}; Free cancellation: ${url.searchParams.get("free")}</p><p>Property details. No booking action exists in this fixture.</p>`));
    else if (url.pathname === "/wiki") res.end(document("Encyclopedia", `<h1>Encyclopedia</h1><form action="/wiki/search"><label>Search encyclopedia <input name="q" id="query" type="search"></label><button>Search</button></form>`));
    else if (url.pathname === "/wiki/search") res.end(document("Article search results", `<h1>Article search results</h1><a href="/wiki/godel">Gödel's incompleteness theorems</a><a href="/wiki/geometry">Geometry</a>`));
    else if (url.pathname === "/wiki/godel") res.end(document("Gödel's incompleteness theorems", `<h1>Gödel's incompleteness theorems</h1><p>Two results in mathematical logic about formal axiomatic systems.</p>`));
    else if (url.pathname === "/wiki/geometry") res.end(document("Geometry", `<h1>Geometry</h1>`));
    else if (url.pathname === "/invoices") res.end(document("Invoices", `<h1>Invoices</h1><form id="filter"><label>Invoice number <input id="invoice-query"></label><button>Find invoice</button></form><section id="list"></section><script>document.querySelector('#filter').onsubmit=e=>{e.preventDefault();document.querySelector('#list').innerHTML='<article>ABC Trading — INV-99 <a href="/invoices/99">Inspect ABC Trading invoice</a></article><article>ABC Pte Ltd — INV-42 <a href="/invoices/42">Inspect ABC Pte Ltd INV-42</a></article>'}</script>`));
    else if (url.pathname === "/invoices/42") res.end(document("Invoice INV-42", `<h1>Invoice INV-42</h1><p>Customer: ABC Pte Ltd</p><p>Status: Draft</p><p>Amount: 420.00</p>`));
    else if (url.pathname === "/invoices/99") res.end(document("Invoice INV-99", `<h1>Invoice INV-99</h1><p>Customer: ABC Trading</p><p>Status: Posted</p>`));
    else if (url.pathname === "/draft") res.end(document("Draft editor", `<h1>Draft editor</h1><form id="draft"><label>Record name <input id="name"></label><label>Notes <textarea id="notes"></textarea></label><button id="save">Save draft</button></form><p id="status">Unsaved</p><a id="review" href="/review" hidden>Continue to review</a><script>document.querySelector('#draft').onsubmit=async(e)=>{e.preventDefault();const p={name:document.querySelector('#name').value,notes:document.querySelector('#notes').value};await fetch('/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});document.querySelector('#status').textContent='Draft saved: DRAFT-42';document.querySelector('#review').hidden=false;}</script>`));
    else if (url.pathname === "/review") res.end(document("Draft review", `<h1>Review ready</h1><p>DRAFT-42 Status: Draft</p><button id="publish">Publish record</button><script>document.querySelector('#publish').onclick=()=>fetch('/api/publish',{method:'POST'})</script>`));
    else if (url.pathname === "/login") res.end(document("Sign in required", `<h1>Sign in required</h1><p>You must sign in to access invoices.</p><label>Email <input id="email"></label><label>Password <input id="password" type="password"></label><button>Sign in</button>`));
    else if (url.pathname === "/captcha") res.end(document("CAPTCHA verification", `<h1>CAPTCHA: verify you are human</h1><p>Access denied until human verification is completed.</p>`));
    else if (url.pathname === "/controls") res.end(document("Browser guards", `<h1>Browser guard checks</h1><p id="status">Cart total: 10</p><button id="target" onclick="this.textContent='Clicked'">Continue</button><label>City <input id="city" value="Zurich"></label><label><input id="toggle" type="checkbox">Refundable</label><label>Category <select id="category"><option value="all">All</option><option value="design">Design</option></select></label><label>Notes <textarea id="notes"></textarea></label><p hidden id="hidden-success">SECRET-HIDDEN-SUCCESS</p>`));
    else res.end(document("JevSteer test scenarios", `<h1>JevSteer test scenarios</h1><p>Local synthetic data only.</p><a href="/hotels">Hotel search</a><a href="/wiki">Encyclopedia</a><a href="/invoices">Invoices</a><a href="/draft">Draft workflow</a><a href="/controls">Browser guards</a>`));
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return { server, state, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }) };
}
