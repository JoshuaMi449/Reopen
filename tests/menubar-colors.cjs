const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const exportsObject={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/shared/menubarTheme.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject});
const {colorHex,colorParts,colorLimits,adaptedColor,menubarColor,allowsTransparentColor}=exportsObject;
function visibleContrast(hex,dark) {
 const background=dark?[0x2d,0x2e,0x31]:[0xf1,0xf2,0xf4],alpha=colorParts(hex).a;
 const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
 const brightness=rgb=>rgb.reduce((sum,v,i)=>sum+linear(v/255)*[.2126,.7152,.0722][i],0);
 const blended=[1,3,5].map((offset,i)=>parseInt(hex.slice(offset,offset+2),16)*alpha+background[i]*(1-alpha));
 const first=brightness(blended),second=brightness(background);
 return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);
}
assert.equal(menubarColor({'cpu-user':'invalid'},'cpu-user','#007aff'),'#007aff');
assert.equal(menubarColor({'cpu-user':'#007affbb'},'cpu-user','#007aff'),'#007affbb');
for(const key of ['cpu-idle','memory-available','storage-free']) assert.equal(allowsTransparentColor(key),true,`${key} can be transparent`);
for(const key of ['cpu-user','cpu-system','memory-app','memory-wired','memory-compressed','storage-used','battery-adapter','battery-battery','net-upload','net-download']) assert.equal(allowsTransparentColor(key),false,`${key} must remain visible`);
for(const dark of [true,false]) for(let h=0;h<360;h+=15) for(const s of [0,.5,1]) {
 const limits=colorLimits(h,s,dark);assert(limits.minL<=limits.maxL);assert(limits.minA>=.7);
 for(const l of [0,.2,.5,.8,1]) for(const a of [0,.2,.7,1]) {
  const result=adaptedColor(colorHex(h,s,l,a),dark),p=colorParts(result),bounds=colorLimits(p.h,p.s,dark);
  assert(p.a>=.69&&p.a<=1);assert(p.l>=bounds.minL-.021&&p.l<=bounds.maxL+.021);
  assert(visibleContrast(result,dark)>=2.95,`graph color ${result} must contrast with the ${dark?'dark':'light'} surface`);
 }
}
for (const dark of [false,true]) {
 const transparent=colorParts(adaptedColor('#33669900',dark,0));
 assert.equal(transparent.a,0,'semantic background colors may be fully transparent');
 const translucent=colorParts(adaptedColor('#33669933',dark,0));
 assert(translucent.a>0&&translucent.a<.25,'partial transparency is retained');
}
console.log('PASS: legacy/alpha colors, all hue families and both appearance limits');
const {menubarDark}=exportsObject;
assert.equal(menubarDark({darkMode:'light'},true),false);
assert.equal(menubarDark({darkMode:'dark'},false),true);
assert.equal(menubarDark({darkMode:'system'},true),true);
assert.equal(menubarDark({darkMode:'system'},false),false);
assert.equal(menubarDark({darkMode:'special',specialStyle:'special-forestdark'},false),true);
assert.equal(menubarDark({darkMode:'special',specialStyle:'special-clouddancer'},true),false);
console.log('PASS: explicit, system and special appearance selection');
