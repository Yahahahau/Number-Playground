const { chromium } = require('playwright');
(async()=>{
 const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const ctx=await b.newContext({viewport:{width:430,height:870},hasTouch:true,isMobile:true});
 const p=await ctx.newPage();const logs=[];
 p.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push(m.text().slice(0,300))});
 p.on('pageerror',e=>logs.push('PE '+e.message.slice(0,200)));
 await p.goto('http://localhost:4173/');
 await p.waitForFunction(()=>window.__game&&!document.getElementById('loading'),null,{timeout:90000}).catch(()=>{});
 await p.waitForTimeout(1500);
 const sets={A:['2','20','130','131','132','133'],B:['3000','4001','20000','2097152','2097153','2097154'],C:['2097155','1024','1048576','1073741824','5000000000','1125899906842624']};
 for(const k of Object.keys(sets)){
  await p.evaluate((vals)=>{const g=window.__game;const bm=g.blocks;
   for(const b of [...bm.blocks]) bm.remove(b);
   let i=0;for(const v of vals){const x=((i%2)-0.5)*2.1, z=16.6-Math.floor(i/2)*2.6; const q=new (g.camera.quaternion.constructor)().setFromEuler(new (g.camera.rotation.constructor)(0.3*i,0.6*i,0)); bm.create(BigInt(v),{x,y:1.0,z},{appear:false,quat:{x:q.x,y:q.y,z:q.z,w:q.w}}); i++;}
   const pl=g.player;pl.yawT=pl.yaw=0;pl.pitchT=pl.pitch=-0.42;
  },sets[k]);
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{document.querySelector('.tutorial')?.remove();document.querySelector('.inspect')?.remove()});
  await p.screenshot({path:process.env.S+'/shots/mat'+k+'.png'});
 }
 console.log(JSON.stringify(logs.slice(0,5)));
 await b.close();
})();
