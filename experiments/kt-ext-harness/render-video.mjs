// Render demo-lines.txt (real run, real IP masked) into a clean terminal video.
// Playwright records a styled HTML terminal; ffmpeg finishes it as mp4.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = fileURLToPath(new URL(".", import.meta.url));
const OUT = "/Users/amangupta/Desktop/Personal_Projects/unlink/veil-demo-ip.mp4";
const lines = readFileSync(here + "demo-lines.txt", "utf8").replace(/\n$/, "").split("\n");

const cls = (l) =>
  /this is YOU|real IP/.test(l) ? "you" :
  /Tor exit/.test(l) ? "exit" :
  /different exits:\s*YES/.test(l) ? "yes" :
  /strangers/.test(l) ? "win" :
  /^\$ /.test(l) ? "prompt" :
  /^Veil|^---/.test(l) ? "head" : "dim";

const html = `<!doctype html><meta charset=utf8><style>
  html,body{margin:0;background:#0b0d11;height:100%}
  .wrap{padding:54px 60px;font:15.5px/1.72 Menlo,monospace;color:#c7ccd3}
  .bar{display:flex;gap:8px;margin:0 0 26px 0}
  .bar i{width:12px;height:12px;border-radius:50%;background:#2a2e35;display:block}
  .l{white-space:pre;opacity:0;transition:opacity .18s}
  .l.on{opacity:1}
  .dim{color:#9a9ea4}.head{color:#ededee;font-weight:700}.prompt{color:#5f636a}
  .you{color:#D9674E;font-weight:700}.exit{color:#ededee;font-weight:700}
  .yes{color:#ededee;font-weight:700}.win{color:#c7ccd3;font-style:italic}
  #cur{display:inline-block;width:9px;height:17px;background:#D9674E;vertical-align:-3px;animation:b 1s steps(1) infinite}
  @keyframes b{50%{opacity:0}}
</style><div class=wrap><div class=bar><i></i><i></i><i></i></div><div id=t></div></div>
<script>
  const lines=${JSON.stringify(lines)}, cls=${JSON.stringify(lines.map(cls))};
  const t=document.getElementById('t'); let i=0;
  const cur=document.createElement('span'); cur.id='cur';
  function step(){
    if(i<lines.length){
      const d=document.createElement('div'); d.className='l '+cls[i];
      d.textContent=lines[i]||' '; t.appendChild(d);
      requestAnimationFrame(()=>d.classList.add('on'));
      d.appendChild(cur);
      i++; setTimeout(step, lines[i-1]==='' ? 90 : 460);
    } else { setTimeout(()=>{ cur.remove(); window.__done=true; }, 3200); }
  }
  setTimeout(step, 600);
</script>`;
writeFileSync(here + "demo-terminal.html", html);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 720 }, recordVideo: { dir: here + "vid", size: { width: 1200, height: 720 } } });
const page = await ctx.newPage();
await page.goto("file://" + here + "demo-terminal.html");
await page.waitForFunction(() => window.__done === true, { timeout: 60000 });
const webm = await page.video().path();
await ctx.close();
await browser.close();

execSync(`ffmpeg -y -i "${webm}" -vf "scale=1200:720,fps=30" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${OUT}"`, { stdio: "inherit" });
rmSync(here + "vid", { recursive: true, force: true });
console.log("\nwrote " + OUT);
