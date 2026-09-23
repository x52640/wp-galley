// 用無頭 Chrome（DevTools Protocol）操作發布台畫面：node scripts/ui-drive.mjs <steps.json>
// 不需要安裝任何套件；Chrome 擴充套件連不上時用這個做 UI 驗收。W／H 環境變數設視窗大小。
// steps: [{url}, {eval:"js"}, {wait:ms}, {shot:"file.png"}, {click:"css selector"}]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
const prof = mkdtempSync(join(tmpdir(), 'publisher-cdp-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${prof}`,
  `--window-size=${W},${H}`, '--blink-settings=preferredColorScheme=1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') logs.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXC ' + msg.params.exceptionDetails.exception?.description);
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
};
for (const step of steps) {
  if (step.url) { await send('Page.navigate', { url: step.url }); await sleep(1500); }
  if (step.wait) await sleep(step.wait);
  if (step.eval) console.log('eval>', JSON.stringify(await evaluate(step.eval)));
  if (step.click) console.log('click>', await evaluate(`const el=document.querySelector(${JSON.stringify(step.click)}); if(!el) return 'NOT FOUND'; el.click(); return 'ok'`));
  if (step.shot) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(step.shot, Buffer.from(r.result.data, 'base64')); console.log('shot>', step.shot); }
}
console.log('logs>', JSON.stringify(logs.slice(-20)));
ws.close(); chrome.kill();
