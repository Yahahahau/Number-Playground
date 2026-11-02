const { chromium } = require('playwright');
(async()=>{
 const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const ctx=await b.newContext({viewport:{width:430,height:870},hasTouch:true,isMobile:true});
 const p=await ctx.newPage();const logs=[];
 p.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push(m.text().slice(0,200))});
 p.on('pageerror',e=>logs.push('PE '+e.message.slice(0,200)));
 await p.goto('http://localhost:4173/');
 await p.waitForFunction(()=>window.__game&&!document.getElementById('loading'),null,{timeout:90000}).catch(()=>{});
 await p.waitForTimeout(2500);
 const S=process.env.S+'/shots/';let i=0;
 for(const [y,pi] of (JSON.parse(process.env.VIEWS||'[[-0.28,-0.36],[0.3,-0.1],[3.14,-0.1],[-1.5,0.1]]'))){
  await p.evaluate(([y,pi])=>{const pl=window.__game.player;pl.yawT=pl.yaw=y;pl.pitchT=pl.pitch=pi;},[y,pi]);
  await p.waitForTimeout(2200);await p.screenshot({path:S+(process.env.PFX||'lab')+(i++)+'.png'});
 }
 console.log(JSON.stringify(logs.slice(0,6)));
 await b.close();
})();
