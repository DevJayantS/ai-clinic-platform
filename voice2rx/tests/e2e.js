// CDP-driven end-to-end check of the Voice2Rx demo flow (no deps). Usage: node e2e.js
const { spawn } = require("child_process");
const fs = require("fs");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333, BASE = "http://localhost:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0, ws; const pending = new Map(), logs = [];

function send(method, params = {}) {
    return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function ev(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("JS error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
}
let failed = 0;
function check(name, ok, extra) { if (!ok) failed++; console.log((ok ? "  ok  " : "FAIL  ") + name + (ok ? "" : "  -> " + extra)); }
async function shot(name) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(__dirname + "/" + name + ".png", Buffer.from(r.data, "base64")); }

(async () => {
    const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=/tmp/v2r-chrome", "--no-first-run", "--window-size=1500,1000", "about:blank"], { stdio: "ignore" });
    let tab; for (let i = 0; i < 40; i++) { try { const l = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json(); tab = l.find((t) => t.type === "page"); if (tab) break; } catch (e) { } await sleep(250); }
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
        else if (d.method === "Runtime.exceptionThrown") logs.push("EXC " + d.params.exceptionDetails.exception?.description);
        else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") logs.push("console.error " + d.params.args.map((a) => a.value || a.description).join(" "));
    };
    await send("Runtime.enable"); await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
    const go = async (u) => { await send("Page.navigate", { url: u }); await sleep(1200); };

    await go(BASE + "/index.html");
    await ev(`localStorage.setItem("loggedInUser", JSON.stringify({role:"doctor",name:"Dr. Demo"}))`);
    await go(BASE + "/doctor-dashboard.html#patients");

    check("Patients view visible, dashboard hidden", await ev(`!document.getElementById('viewPatients').hidden && document.getElementById('viewDashboard').hidden`));
    check("Demo Mode or backend badge present", await ev(`document.querySelector('#v2rMode').textContent.length>3`));
    console.log("   mode:", await ev(`document.querySelector('#v2rMode').textContent`));
    await shot("01-empty");

    // Sample flow
    await ev(`document.querySelector('[data-action=sample]').click()`);
    await sleep(2800);
    check("transcript loaded + labelled demo", await ev(`document.querySelector('#v2rTranscript').value.includes('Demo Patient 001') && document.querySelector('#v2rTxBadge').textContent.includes('Demo')`));
    check("all 5 stages done/skipped", await ev(`[...document.querySelectorAll('.v2r-stage')].every(s=>/done|skipped/.test(s.className))`), await ev(`[...document.querySelectorAll('.v2r-stage')].map(s=>s.className).join()`));
    check("SOAP chief complaint = fever and headache", await ev(`document.querySelector('#f-subjective-chiefComplaint').value==='fever and headache'`));
    check("assessment empty & flagged", await ev(`document.querySelector('#f-assessment-assessment').value==='' && document.querySelector('[data-fld="assessment.assessment"]').classList.contains('verify')`));
    check("validation panel lists warnings", await ev(`document.querySelectorAll('.v2r-issue.warning').length>=3`));
    check("patient auto-selected", await ev(`document.querySelector('#v2rPatient').value==='Demo Patient 001'`));
    await shot("02-soap");

    // edit + tab persistence
    await ev(`(()=>{const t=document.querySelector('#f-assessment-assessment');t.value='Viral illness (doctor entered in test)';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(600);
    check("edit clears assessment warning", await ev(`!document.querySelector('[data-fld="assessment.assessment"]').classList.contains('verify')`));
    await ev(`document.querySelector('#v2rTab-rx').click()`);
    check("Rx tab shows paracetamol with only the name", await ev(`document.querySelector('[data-bind=med][data-key=name]').value==='paracetamol' && document.querySelector('[data-bind=med][data-key=strength]').value===''`));
    check("approve disabled while flagged", await ev(`document.querySelector('[data-action=approve]').disabled`));
    await shot("03-rx");
    await ev(`document.querySelector('#v2rTab-soap').click()`);
    check("SOAP edit preserved after tab switch", await ev(`document.querySelector('#f-assessment-assessment').value.startsWith('Viral')`));

    // add / remove med
    await ev(`document.querySelector('#v2rTab-rx').click(); document.querySelector('[data-action=med-add]').click()`);
    check("add medicine row", await ev(`document.querySelectorAll('.v2r-med').length===2`));
    await ev(`document.querySelectorAll('[data-action=med-remove]')[1].click()`);
    check("remove medicine row", await ev(`document.querySelectorAll('.v2r-med').length===1`));

    // doctor confirms dose etc then approve
    await ev(`(()=>{const set=(k,v)=>{const e=document.querySelector('[data-bind=med][data-key='+k+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};set('strength','500 mg');set('frequency','twice daily');set('duration','3 days');const c=document.querySelector('[data-bind=med-verify]');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));const r=document.querySelector('#v2rReviewed');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await sleep(600);
    check("approve enabled after doctor review", await ev(`!document.querySelector('[data-action=approve]').disabled`), await ev(`document.querySelector('#v2rApprove').textContent`));

    // save
    await ev(`document.querySelector('[data-action=save]').click()`);
    await sleep(800);
    check("save toast + status", await ev(`document.querySelector('#v2rToasts').textContent.includes('Saved')`), await ev(`document.querySelector('#v2rToasts').textContent`));
    await ev(`document.querySelector('[data-action=approve]').click()`);
    await sleep(800);
    check("approved & locked", await ev(`document.querySelector('#v2rStatus').textContent.includes('approved') && document.querySelector('#v2rPanel-rx fieldset').disabled`), await ev(`document.querySelector('#v2rStatus').textContent`));

    // copy + print (stub print)
    await ev(`window.print=()=>{window.__printed=document.getElementById('v2rPrintArea').innerHTML};document.querySelector('#v2rPanel-rx [data-action=print]').click()`);
    check("print area built with approval + notice", await ev(`window.__printed.includes('paracetamol') && window.__printed.includes('Approved by') && window.__printed.includes('AI-generated draft')`));
    await ev(`window.dispatchEvent(new Event('afterprint'))`);
    await ev(`window.print=()=>{window.__printed=document.getElementById('v2rPrintArea').innerHTML};document.querySelector('#v2rTab-soap').click();document.querySelector('#v2rPanel-soap [data-action=print]').click()`);
    check("SOAP print includes DEMO watermark", await ev(`window.__printed.includes('DEMO DATA')`));
    await ev(`window.dispatchEvent(new Event('afterprint'))`);

    // history
    await ev(`document.querySelector('#v2rNav-history').click()`);
    await sleep(700);
    check("history lists saved consultation", await ev(`document.querySelectorAll('#v2rHistList .item').length>=1 && document.querySelector('#v2rHistList').textContent.includes('Approved')`), await ev(`document.querySelector('#v2rHistList').textContent`));
    await ev(`(()=>{const q=document.querySelector('#v2rHistQ');q.value='zzzz';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(500);
    check("search filters to empty", await ev(`document.querySelectorAll('#v2rHistList .item').length===0`));
    await ev(`(()=>{const q=document.querySelector('#v2rHistQ');q.value='paracetamol';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(500);
    await shot("04-history");
    await ev(`document.querySelector('#v2rHistList [data-action=open]').click()`);
    await sleep(900);
    check("open restores note", await ev(`document.querySelector('#f-assessment-assessment').value.startsWith('Viral') && !document.querySelector('#v2rPage-workspace').hidden`));

    // other pages
    for (const p of ["patients", "templates", "settings"]) { await ev(`document.querySelector('#v2rNav-${p}').click()`); await sleep(400); check("page " + p + " renders", await ev(`document.querySelector('#v2rPage-${p}').textContent.length>40`)); }

    // upload error path (unsupported)
    await ev(`document.querySelector('#v2rNav-workspace').click()`);
    await ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['hello'],'notes.pdf',{type:'application/pdf'}));const i=document.querySelector('#v2rFile');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
    check("unsupported upload rejected", await ev(`document.querySelector('#v2rRecError').textContent.includes('Unsupported')`));
    // valid upload + no whisper => clear setup message, no fake transcript
    await ev(`document.querySelector('[data-action=new]').click()`);
    await ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(5000)],'visit.wav',{type:'audio/wav'}));const i=document.querySelector('#v2rFile');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
    await ev(`document.querySelector('[data-action=process]').click()`);
    await sleep(1500);
    console.log("   whisper available:", await ev(`!!(V2RApp.state.backend&&V2RApp.state.backend.whisper.available)`));
    check("audio w/o whisper: setup message, transcript stays empty", await ev(`V2RApp.state.backend&&V2RApp.state.backend.whisper.available ? true : (document.querySelector('#v2rSetup').textContent.includes('not configured') && document.querySelector('#v2rTranscript').value==='')`));
    await shot("05-setup");

    // responsive
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    check("mobile: no horizontal overflow", await ev(`document.documentElement.scrollWidth<=window.innerWidth+2`), await ev(`document.documentElement.scrollWidth+' vs '+window.innerWidth`));
    await shot("06-mobile");

    console.log("console errors:", logs.length ? logs : "none");
    console.log(failed ? failed + " FAILED" : "E2E PASSED");
    chrome.kill(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e); process.exit(2); });
