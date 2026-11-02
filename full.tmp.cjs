const { chromium } = require('playwright');
const OUT=process.env.S+'/shots/';
(async()=>{
 const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const ctx=await b.newContext({viewport:{width:430,height:870},deviceScaleFactor:1,hasTouch:true,isMobile:true});
 const p=await ctx.newPage();const logs=[];
 p.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push(m.text().slice(0,300))});
 p.on('pageerror',e=>logs.push('PE '+e.message.slice(0,200)));
 await p.goto('http://localhost:4173/');
 await p.waitForFunction(()=>window.__game&&!document.getElementById('loading'),null,{timeout:90000}).catch(()=>{});
 await p.waitForTimeout(1500);
 // 1. challenge flow via UI button
 await p.click('[aria-label=Free]').catch(()=>{});
 await p.waitForTimeout(800);
 const mode=await p.evaluate(()=>({mode:window.__game.save.data.settings.mode,pad:window.__game.world.pad.visible,goal:document.querySelector('.goalbar .g2').textContent}));
 console.log('mode',JSON.stringify(mode));
 await p.evaluate(()=>{const g=window.__game;g.player.yawT=g.player.yaw=0;g.player.pitchT=g.player.pitch=-0.3;});
 await p.screenshot({path:OUT+'ch_hud.png'});
 // deliver block
 await p.evaluate(()=>{const g=window.__game;for(const b of [...g.blocks.blocks]) g.blocks.remove(b);g.blocks.create(8n,{x:0,y:0.6,z:-16},{appear:false});});
 await p.waitForTimeout(14000);
 const res=await p.evaluate(()=>({stars:window.__game.save.data.stats.stars,solved:window.__game.save.data.challenge.solved,target:window.__game.challenge.target.toString()}));
 console.log('challenge',JSON.stringify(res));
 // back to free
 await p.evaluate(()=>window.__game.challenge.setMode('free'));
 console.log('padHidden',await p.evaluate(()=>!window.__game.world.pad.visible));
 // 2. merge + collection + save
 await p.evaluate(()=>{const g=window.__game;for(const b of [...g.blocks.blocks]) g.blocks.remove(b);
   const a=g.blocks.create(2n,{x:-1.2,y:3,z:10},{appear:false,vel:{x:3,y:0,z:0}});
   const c=g.blocks.create(2n,{x:1.2,y:3,z:10},{appear:false,vel:{x:-3,y:0,z:0}});});
 await p.waitForTimeout(3500);
 console.log('merge',JSON.stringify(await p.evaluate(()=>({vals:window.__game.blocks.blocks.map(b=>b.value.toString()),merges:window.__game.save.data.stats.merges,col:window.__game.collection.size}))));
 // 3. leak check
 for(let k=0;k<2;k++){await p.evaluate(()=>{const g=window.__game;for(const v of [2n,20n,130n,3000n,20000n,2097152n,2097153n,2097154n,2097155n,1024n,5000000000n]) g.blocks.create(v,{x:Math.random()*6-3,y:1,z:8+Math.random()*4},{appear:false});});await p.waitForTimeout(800);await p.evaluate(()=>window.__game.blocks.reset());await p.waitForTimeout(500);}
 const m0=await p.evaluate(()=>{const i=window.__game.renderer.info.memory;return [i.geometries,i.textures]});
 for(let k=0;k<4;k++){await p.evaluate(()=>{const g=window.__game;const vals=[2n,20n,130n,3000n,20000n,2097152n,1024n,5000000000n];for(const v of vals) g.blocks.create(v,{x:Math.random()*6-3,y:1,z:8+Math.random()*4},{appear:false});});await p.waitForTimeout(800);await p.evaluate(()=>window.__game.blocks.reset());await p.waitForTimeout(500);}
 await p.waitForTimeout(1500);
 const m1=await p.evaluate(()=>{const i=window.__game.renderer.info.memory;return [i.geometries,i.textures,i.programs?.length]});
 console.log('mem before/after',JSON.stringify(m0),JSON.stringify(m1));
 console.log('render',JSON.stringify(await p.evaluate(()=>{const g=window.__game;g.renderFrame(1,0.016);const r=g.renderer.info.render;return {calls:r.calls,tris:r.triangles}})));
 // reload persistence
 await p.reload();await p.waitForFunction(()=>window.__game&&!document.getElementById('loading'),null,{timeout:90000}).catch(()=>{});
 console.log('reload',JSON.stringify(await p.evaluate(()=>({max:window.__game.collection.maxValue.toString(),stars:window.__game.save.data.stats.stars,q:window.__game.save.data.settings.quality}))));
 console.log('logs',JSON.stringify(logs.slice(0,6)));
 await b.close();
})();
