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
 const S=process.env.S+'/shots/';
 async function setup(val){
  await p.evaluate((val)=>{const g=window.__game;const bm=g.blocks;for(const b of [...bm.blocks]) bm.remove(b);
   const b=bm.create(BigInt(val),{x:0,y:1.62,z:16.6},{appear:false});
   b.body.setBodyType(g.physics.RAPIER.RigidBodyType.Fixed,true);
   window.__b=b;const pl=g.player;pl.yawT=pl.yaw=0;pl.pitchT=pl.pitch=0;
   for(const s of ['.tutorial','.inspect','.top-left','.top-right','.rail-left','.blockcount']) document.querySelector(s)?.remove();
   document.querySelectorAll('.btn,.joy-hint,.crosshair').forEach(e=>e.remove());
  },val);
 }
 async function rot(deg){await p.evaluate((d)=>{const a=d*Math.PI/360;window.__b.body.setRotation({x:0,y:0,z:Math.sin(a),w:Math.cos(a)},true);window.__b.prevQuat.set(0,0,Math.sin(a),Math.cos(a));window.__b.currQuat.copy(window.__b.prevQuat);},deg);await p.waitForTimeout(2500);}
 const out={};
 for(const [name,val] of [['galaxy','1024'],['uvmap','2097154']]){
  await setup(val);
  await rot(0);await p.screenshot({path:S+`lk_${name}_0.png`});
  await rot(90);await p.screenshot({path:S+`lk_${name}_90.png`});
  await p.evaluate(()=>{window.__b.body.setTranslation({x:0.0,y:1.62,z:16.6},true)});
 }
 console.log(JSON.stringify(logs.slice(0,5)));
 await b.close();
})();
