const { chromium } = require('playwright');
(async()=>{
 const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const ctx=await b.newContext({viewport:{width:430,height:870},hasTouch:true,isMobile:true});
 const p=await ctx.newPage();const logs=[];
 p.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push(m.text().slice(0,200))});
 p.on('pageerror',e=>logs.push('PE '+e.message.slice(0,200)));
 await p.goto('http://localhost:4173/');
 await p.waitForFunction(()=>window.__game&&!document.getElementById('loading'),null,{timeout:90000}).catch(()=>{});
 await p.waitForTimeout(1500);
 const vals=JSON.parse(process.env.VALS);
 await p.evaluate((vals)=>{const g=window.__game;g.blocks.reset?.();
   const bm=g.blocks;const pl=g.player;
   // lay blocks out in a row in front of the camera
   let i=0;for(const v of vals){const x=(i%3-1)*2.3, z=17-Math.floor(i/3)*2.6; bm.create(BigInt(v),{x,y:1.2,z},{appear:false}); i++;}
   pl.yawT=pl.yaw=0;pl.pitchT=pl.pitch=-0.5;
 },vals);
 await p.waitForTimeout(3500);
 await p.evaluate(()=>{document.querySelector('.tutorial')?.remove();document.querySelector('.inspect')?.remove()});
 await p.screenshot({path:process.env.S+'/shots/'+process.env.PFX+'.png'});
 console.log(JSON.stringify(logs.slice(0,5)));
 await b.close();
})();
