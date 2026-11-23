const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = createRequire(path.resolve('packages/scout-for-lol/packages/app/package.json'))('@playwright/test');

(async () => {
  const output = path.resolve(process.argv[2] ?? '.cache/replay-progress/batched-direct-history-chromium.json');
  const root = path.resolve(__dirname, '..'), sourceHashes = new Map();
  const history = await fs.readFile(path.join(root, 'latest-direct-checkpoint-history.mjs'), 'utf8');
  const runtime = await fs.readFile(path.join(root, 'latest-direct-effect-runtime.mjs'), 'utf8');
  const { directHistoryControlSource } = await import(pathToFileURL(path.join(__dirname, 'direct-history-control-source.mjs')).href);
  const legacy = directHistoryControlSource({ historySource: history, runtimeSource: runtime,
    legacyHistoryUrl: () => '/__legacy-history.mjs', dependencyUrl: dependency => '/' + dependency.slice(2) });
  const source = await fs.readFile('packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts', 'utf8');
  const csp = [...source.match(/const scoutCsp = \[([\s\S]*?)\]\.join/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]).join('; ');
  const entry = `
import {checkLargeDirectAdvance} from '/tools/check-large-direct-advance.mjs';
import {LatestDirectEffectRuntime} from '/latest-direct-effect-runtime.mjs';
import {LatestDirectEffectRuntime as LegacyRuntime} from '/__legacy-runtime.mjs';
import {sha256} from '/structural-comparison.mjs';
window.runCheckpointBranchControl=async()=>{
  const inspect=async runtime=>{
    const text=[...runtime.ledger].map(entry=>JSON.stringify(entry)).join('\\n');
    return {ledgerSha256:await sha256(new TextEncoder().encode(text)),cursor:runtime.cursor,
      checkpointSnapshots:runtime.metrics.checkpointSnapshots,checkpointRowsCopied:runtime.metrics.checkpointRowsCopied,
      checkpointGenerationUpdates:runtime.metrics.checkpointGenerationUpdates,checkpointMs:runtime.metrics.checkpointMs};
  };
  const baseline=checkLargeDirectAdvance(LegacyRuntime,inspect);
  baseline.inspection=await baseline.inspection;
  const batched=checkLargeDirectAdvance(LatestDirectEffectRuntime,inspect);
  batched.inspection=await batched.inspection;
  for(const field of ['events','duration','ledgerRows','instances','simulationSteps'])
    if(!Object.is(baseline[field],batched[field]))throw Error('Checkpoint control changed '+field);
  for(const field of ['ledgerSha256','cursor','checkpointSnapshots','checkpointRowsCopied','checkpointGenerationUpdates'])
    if(!Object.is(baseline.inspection[field],batched.inspection[field]))throw Error('Checkpoint control changed '+field);
  return {baseline,batched,mismatches:[],scope:'Actual owned Chromium; original per-row ledger/generation writes versus batched branches with identical clone/math/tick/restore behavior. Every307256ledgerrowhashed after forward/backward replay. All-omitted control only, not active-match/render memory or latency acceptance. Inspectionserialization/digestisexcludedfromadvance/replaytimings.'};
};`;
  const generated = new Map([['/__legacy-history.mjs', legacy.legacyHistory], ['/__legacy-runtime.mjs', legacy.legacyRuntime], ['/control-entry.mjs', entry]]);
  let serveError = null;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': csp });
        response.end('<!doctype html><title>Owned checkpoint branch control</title><link rel="icon" href="data:,"><script type="module" src="/control-entry.mjs"></script>');
        return;
      }
      let body = generated.get(pathname);
      if (body === undefined) {
        const target = path.resolve(root, '.' + decodeURIComponent(pathname));
        if (!target.startsWith(root + path.sep) || path.extname(target) !== '.mjs') {
          response.writeHead(404); response.end(); return;
        }
        body = await fs.readFile(target, 'utf8');
      }
      const digest = createHash('sha256').update(body).digest('hex');
      if (sourceHashes.has(pathname) && sourceHashes.get(pathname) !== digest) throw Error('Control source changed during owned Chromium run: ' + pathname);
      sourceHashes.set(pathname, digest);
      response.writeHead(200, { 'content-type': 'text/javascript', 'content-security-policy': csp });
      response.end(body);
    } catch (error) { serveError = String(error); response.writeHead(500); response.end('Owned control source failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage(), errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failures.push({ url: request.url(), failure: request.failure() }));
  page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
  try {
    if ((await page.goto(`http://127.0.0.1:${server.address().port}/`)).status() !== 200) throw Error('Owned Chromium control did not load');
    await page.waitForFunction(() => typeof window.runCheckpointBranchControl === 'function');
    const result = await page.evaluate(() => window.runCheckpointBranchControl());
    if (serveError || errors.length || failures.length) throw Error(JSON.stringify({ serveError, errors, failures }));
    result.sourceHashes = Object.fromEntries([...sourceHashes].sort(([a], [b]) => a.localeCompare(b)));
    result.controlSourceSha256 = createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, baseline: result.baseline, batched: result.batched, mismatches: 0, errors, failures }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
