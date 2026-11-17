
/* VEX_BUILD: 2026-11-17.6 */
/* VEX IQ Universal Game Mapper: USB-C controller, Chrome Web Serial. */
(function () {
'use strict';
if (window.VEXMapper) return;
const VERSION = '2026-11-17.6';
const POLL = new Uint8Array([0xc9,0x36,0xb8,0x47,0x58,0x60,0x00,0x10,0x53]);
const BUTTONS = {'E ↑':[13,8],'E ↓':[13,2],'F ↑':[13,4],'F ↓':[13,1],'L ↑':[13,32],'L ↓':[13,16],'R ↑':[13,128],'R ↓':[13,64],L3:[14,1],R3:[14,2]};
const defaults = {'Left ↑':'w','Left ↓':'s','Left ←':'a','Left →':'d','E ↑':'j','E ↓':'q','F ↑':'r','F ↓':'f','L ↑':'e','L ↓':'c','R ↑':'v','R ↓':'1',L3:'p',R3:'k','Right ↑':'none','Right ↓':'none','Right ←':'none','Right →':'none','Right aim':'mouse-move','Mouse speed':2.00};
const storageKey = 'vex-mapper:' + location.origin + location.pathname;
let mapping = {...defaults};
try { Object.assign(mapping, JSON.parse(localStorage.getItem(storageKey)||'{}')); } catch(e) {}
let port=null,reader=null,writer=null,readTask=null,pollTask=null,active=false,closing=false,connecting=false;
let buffer=[],packets=0,polls=0,lastPacketAt=0,lastError='';
let physical={},held={},nativeHeld=new Set(),mousePressTarget={};
let aimX=innerWidth/2,aimY=innerHeight/2;
let host,shadow,pill,pillText,dot,dialog,stateEl,cursorEl,rowsEl,captureBanner,slider,sliderText,connectBtn,disconnectBtn;
let panelOpen=false,captureName=null,uiReady=false;
const mapButtons={};

function save(){
  try {
    localStorage.setItem(storageKey,JSON.stringify(mapping));
  } catch(e){}
}

function node(tag,cls,txt,parent){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(txt!==undefined&&txt!==null)el.textContent=txt;
  if(parent)parent.appendChild(el);
  return el;
}

function normalizeKey(k){
  return k==='Space'?' ':k;
}

function keyCode(k){
  if(k==='Space'||k===' ')return 'Space';
  if(/^Arrow(Up|Down|Left|Right)$/.test(k))return k;
  if(/^[a-z]$/i.test(k))return 'Key'+k.toUpperCase();
  if(/^[0-9]$/.test(k))return 'Digit'+k;
  if(k==='Shift')return 'ShiftLeft';
  if(k==='Control')return 'ControlLeft';
  return k;
}

function emitKey(k,down){
  const evt=new KeyboardEvent(
    down?'keydown':'keyup',
    {
      key:normalizeKey(k),
      code:keyCode(k),
      bubbles:true,
      cancelable:true,
      shiftKey:k==='Shift',
      ctrlKey:k==='Control'
    }
  );
  window.dispatchEvent(evt);
}

// Track physical keyboard separately from VEX controller.
window.addEventListener('keydown',e=>{
  if(e.isTrusted)nativeHeld.add(e.code);
},true);

window.addEventListener('keyup',e=>{
  if(!e.isTrusted)return;
  nativeHeld.delete(e.code);
  const activeOutput=Object.keys(held).find(
    k=>held[k]>0&&keyCode(k)===e.code
  );
  if(activeOutput){
    queueMicrotask(()=>{
      if(held[activeOutput]>0)emitKey(activeOutput,true);
    });
  }
},true);

function mouseTarget(){
  let el=document.elementFromPoint(aimX,aimY);
  return (el===host||!el)?document.body:el;
}

function emitMouse(button,down){
  const target=down
    ?mouseTarget()
    :(mousePressTarget[button]||mouseTarget());

  if(down)mousePressTarget[button]=target;

  const opts={
    bubbles:true,
    cancelable:true,
    clientX:aimX,
    clientY:aimY,
    button,
    buttons:down?(button===0?1:2):0
  };

  target.dispatchEvent(
    new MouseEvent(
      down?'mousedown':'mouseup',
      opts
    )
  );

  if(!down){
    if(button===0){
      target.dispatchEvent(new MouseEvent('click',opts));
    }
    delete mousePressTarget[button];
  }
}

function output(o,down){
  if(!o||o==='none'||o==='mouse-move')return;

  let old=held[o]||0;

  if(down){
    held[o]=old+1;
    if(old)return;
  }else{
    if(!old)return;
    held[o]=old-1;
    if(old!==1)return;
  }

  if(o==='mouse-left'||o==='mouse-right'){
    emitMouse(o==='mouse-left'?0:2,down);
  }else if(down||!nativeHeld.has(keyCode(o))){
    emitKey(o,down);
  }
}

function setPhysical(name,pressed){
  pressed=!!pressed;

  if(!!physical[name]===pressed)return;

  physical[name]=pressed;
  output(mapping[name],pressed);
}

function releaseAll(){
  Object.keys(physical).forEach(n=>{
    setPhysical(n,false);
  });

  Object.keys(held).forEach(k=>{
    if(held[k]){
      held[k]=1;
      output(k,false);
    }
  });

  physical={};
  held={};
  mousePressTarget={};
}

function axis(v){
  const d=v-127;
  return Math.abs(d)<24?0:d;
}

function moveAim(dx,dy){
  if(
    mapping['Right aim']!=='mouse-move'||
    (!dx&&!dy)||
    panelOpen
  )return;

  const gain=Number(mapping['Mouse speed'])||0.30;

  aimX=Math.max(
    0,
    Math.min(innerWidth-1,aimX+dx*gain)
  );

  aimY=Math.max(
    0,
    Math.min(innerHeight-1,aimY-dy*gain)
  );

  cursorEl.style.left=aimX+'px';
  cursorEl.style.top=aimY+'px';
  cursorEl.hidden=false;

  mouseTarget().dispatchEvent(
    new MouseEvent('mousemove',{
      bubbles:true,
      cancelable:true,
      clientX:aimX,
      clientY:aimY
    })
  );
}

function packet(p){
  packets++;
  lastPacketAt=Date.now();

  let rx=axis(p[5]);
  let ry=axis(p[6]);
  let lx=axis(p[7]);
  let ly=axis(p[8]);

  setPhysical('Left ←',lx<0);
  setPhysical('Left →',lx>0);
  setPhysical('Left ↑',ly>0);
  setPhysical('Left ↓',ly<0);

  setPhysical('Right ←',rx<0);
  setPhysical('Right →',rx>0);
  setPhysical('Right ↑',ry>0);
  setPhysical('Right ↓',ry<0);

  Object.keys(BUTTONS).forEach(n=>{
    const [i,m]=BUTTONS[n];
    setPhysical(n,!!(p[i]&m));
  });

  moveAim(rx,ry);
}

function incoming(data){
  for(const b of data)buffer.push(b);

  if(buffer.length>4096){
    buffer=buffer.slice(-256);
  }

  while(buffer.length>=4){
    if(
      buffer[0]!==170||
      buffer[1]!==85||
      buffer[2]!==88||
      buffer[3]!==19
    ){
      buffer.shift();
      continue;
    }

    if(buffer.length<23)break;

    packet(buffer.splice(0,23));
  }
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function readLoop(){
  try{
    reader=port.readable.getReader();

    while(active){
      const r=await reader.read();

      if(r.done)break;
      if(r.value)incoming(r.value);
    }
  }catch(e){
    if(active)fail('Read error: '+e.message);
  }finally{
    if(reader){
      try{reader.releaseLock();}catch(e){}
      reader=null;
    }
  }
}

async function pollLoop(){
  try{
    while(active){
      await writer.write(POLL);
      polls++;
      await sleep(100);
    }
  }catch(e){
    if(active)fail('Write error: '+e.message);
  }
}

function status(message,kind=''){
  if(!uiReady)return;

  stateEl.textContent=message;
  stateEl.dataset.kind=kind;
  dot.dataset.kind=kind;

  pillText.textContent=active
    ?'Controller Connected'
    :'+ Add Controller';
}

function fail(msg){
  lastError=msg;
  active=false;
  releaseAll();
  status(msg,'error');
  setTimeout(disconnect,0);
}

async function connect(){
  if(active||connecting||closing)return;

  if(!navigator.serial){
    status(
      'Web Serial requires Chrome/Edge on HTTPS.',
      'error'
    );
    return;
  }

  connecting=true;
  connectBtn.disabled=true;

  try{
    port=await navigator.serial.requestPort();

    const info=port.getInfo();

    if(
      info.usbVendorId!==10376||
      info.usbProductId!==528
    ){
      status(
        'Choose VEX IQ Communications Port.',
        'error'
      );
      port=null;
      return;
    }

    await port.open({baudRate:115200});

    writer=port.writable.getWriter();
    buffer=[];
    lastPacketAt=0;
    active=true;
    lastError='';

    status('VEX IQ connected','connected');

    disconnectBtn.disabled=false;

    readTask=readLoop();
    pollTask=pollLoop();

    switchPanel(false);

  }catch(e){
    status('Connection failed: '+e.message,'error');

    if(port)await disconnect();
  }finally{
    connecting=false;
    connectBtn.disabled=active;
  }
}

async function disconnect(){
  if(closing)return;

  closing=true;
  active=false;
  releaseAll();

  try{
    if(reader)await reader.cancel();
  }catch(e){}

  try{
    if(readTask)await readTask;
  }catch(e){}

  readTask=null;

  try{
    if(pollTask)await pollTask;
  }catch(e){}

  pollTask=null;

  try{
    if(writer)writer.releaseLock();
  }catch(e){}

  writer=null;

  try{
    if(port)await port.close();
  }catch(e){}

  port=null;
  closing=false;

  if(uiReady){
    connectBtn.disabled=false;
    disconnectBtn.disabled=true;
    cursorEl.hidden=true;

    status(
      lastError||'Not connected',
      lastError?'error':''
    );
  }
}

function displayOutput(v){
  return v==='none'?'Not assigned':
    v==='mouse-left'?'Left click':
    v==='mouse-right'?'Right click':
    v==='Space'?'Space':
    String(v).replace('Arrow','Arrow ');
}

function stopCapture(){
  captureName=null;

  if(captureBanner)captureBanner.hidden=true;

  Object.values(mapButtons).forEach(b=>{
    b.classList.remove('listening');
  });
}

function switchPanel(open){
  panelOpen=open;
  dialog.hidden=!open;

  pill.setAttribute('aria-expanded',String(open));

  if(!open){
    stopCapture();
    const focused=shadow.activeElement;

    if(focused&&focused.blur)focused.blur();
  }
}

function updateUI(){
  Object.keys(mapButtons).forEach(n=>{
    mapButtons[n].textContent=displayOutput(mapping[n]);
  });

  slider.value=Number(mapping['Mouse speed'])||.30;
  sliderText.textContent=Number(slider.value).toFixed(2)+'×';

  shadow.getElementById('vex-aim').textContent=
    mapping['Right aim']==='mouse-move'
      ?'Enabled':'Disabled';
}

function changeMap(name,out){
  releaseAll();
  mapping[name]=out;
  save();
  stopCapture();
  updateUI();
}

function startCapture(name){
  releaseAll();
  stopCapture();

  captureName=name;
  mapButtons[name].classList.add('listening');
  captureBanner.hidden=false;

  captureBanner.textContent=
    'Press a key for '+name+
    '. Esc cancels. Or choose a mouse action below.';
}

// Keyboard capture is enabled only during remapping.
window.addEventListener('keydown',function(e){
  if(!captureName)return;
  if(!e.isTrusted)return;

  e.preventDefault();
  e.stopImmediatePropagation();

  if(e.key==='Escape'){
    stopCapture();
    return;
  }

  if(['Control','Alt','Meta'].includes(e.key))return;

  let key=e.key===' '?'Space':e.key;

  changeMap(
    captureName,
    key.length===1?key.toLowerCase():key
  );
},true);

function buildUI(){
  host=node('div','','',document.body);
  host.id='vex-mapper-host';

  shadow=host.attachShadow({mode:'open'});

  const style=node('style','',null,shadow);

  style.textContent=`
:host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646;font-family:system-ui,Arial,sans-serif;color:#eff5ff}
*{box-sizing:border-box}
button{font:inherit;cursor:pointer}
[hidden]{display:none!important}

.pill{display:flex;align-items:center;gap:9px;background:#f7f9fd;color:#13233b;border:1px solid #dce5f2;border-radius:99px;padding:11px 15px;box-shadow:0 8px 30px #0007;font-size:13px;font-weight:700}
.dot{width:9px;height:9px;border-radius:50%;background:#94a3b8}
.dot[data-kind=connected]{background:#1fbb79;box-shadow:0 0 0 3px #1fbb7938}
.dot[data-kind=error]{background:#ee7979}

.dialog{position:absolute;right:0;bottom:58px;width:min(390px,calc(100vw - 24px));max-height:min(78vh,750px);overflow-y:auto;background:#132239;border:1px solid #405979;border-radius:17px;padding:17px;box-shadow:0 16px 48px #000b}

.header,.line,.section{display:flex;align-items:center;justify-content:space-between;gap:10px}
.header{align-items:flex-start}
.title{font-size:19px;font-weight:750}
.sub{font-size:11px;color:#a7bbd7;margin-top:4px}
.close{border:0;background:none;color:#b0c4de;font-size:23px}

.state{margin:14px 0;padding:11px;background:#1c304c;border-radius:9px;font-size:12px;color:#cce0fa}
.state[data-kind=connected]{color:#78ecc0}
.state[data-kind=error]{color:#ffaaaa}

.rowButtons{display:flex;gap:8px}
.primary,.secondary{border:0;border-radius:9px;padding:10px 11px;font-size:12px;font-weight:700}
.primary{background:#77a3ff;color:#0d1b2d;flex:1}
.secondary{background:#304561;color:#eff5ff}
button:disabled{opacity:.45;cursor:default}

.help{font-size:11px;line-height:1.5;color:#9bafca;margin:11px 0}
.section{border-top:1px solid #31445e;padding-top:13px;margin-top:14px;font-size:13px;font-weight:700}

.line{padding:7px 0;border-bottom:1px solid #253952}
.line span{font-size:12px}
.map{min-width:115px;max-width:155px;background:#243a57;border:1px solid #526a8b;border-radius:8px;color:#edf5ff;padding:7px;font-size:12px}
.map.listening{background:#496a98;border-color:#a4d3ff}
.banner{margin:9px 0;padding:9px;border:1px solid #83b7ff;border-radius:8px;background:#28466a;font-size:12px}

.tools{display:flex;gap:7px;margin:12px 0}
.tool{flex:1;border:1px solid #3d5876;background:#20364f;color:#e1eafa;border-radius:8px;padding:8px 3px;font-size:11px}

.speed{width:100%;accent-color:#7daaff}
.speedinfo{font-size:12px;color:#b7cbee}
.footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}

@media(max-width:450px){
  :host{right:10px;bottom:10px}
}`;

  pill=node('button','pill',null,shadow);
  pill.type='button';
  pill.setAttribute('aria-expanded','false');

  dot=node('span','dot',null,pill);
  node('span','','🎮',pill);

  pillText=node(
    'span','',
    '+ Add Controller',
    pill
  );

  pill.onclick=()=>switchPanel(!panelOpen);

  dialog=node('section','dialog',null,shadow);
  dialog.hidden=true;

  const header=node('div','header',null,dialog);
  const titles=node('div','',null,header);

  node('div','title','Controller settings',titles);
  node('div','sub','VEX IQ 2nd Gen · Build '+VERSION,titles);

  const closeBtn=node('button','close','×',header);
  closeBtn.onclick=()=>switchPanel(false);

  stateEl=node('div','state','Not connected',dialog);

  const buttons=node('div','rowButtons',null,dialog);

  connectBtn=node(
    'button','primary',
    'Connect VEX IQ',
    buttons
  );
  connectBtn.onclick=connect;

  disconnectBtn=node(
    'button','secondary',
    'Disconnect',
    buttons
  );
  disconnectBtn.disabled=true;
  disconnectBtn.onclick=disconnect;

  node(
    'div','help',
    'Choose the Communications Port. Mappings save automatically for this game.',
    dialog
  );

  node('div','section','Button mapping',dialog);

  captureBanner=node(
    'div','banner',
    'Press a keyboard key',
    dialog
  );
  captureBanner.hidden=true;

  rowsEl=node('div','',null,dialog);

  Object.keys(defaults)
    .filter(n=>n!=='Right aim'&&n!=='Mouse speed')
    .forEach(name=>{
      const row=node('div','line',null,rowsEl);

      node('span','',name,row);

      const btn=node(
        'button','map',
        displayOutput(mapping[name]),
        row
      );

      mapButtons[name]=btn;
      btn.onclick=()=>startCapture(name);
    });

  const aimRow=node('div','line',null,dialog);

  node('span','','Right stick → mouse aim',aimRow);

  const aimBtn=node('button','map',null,aimRow);
  aimBtn.id='vex-aim';

  aimBtn.onclick=()=>{
    releaseAll();

    mapping['Right aim']=
      mapping['Right aim']==='mouse-move'
        ?'none':'mouse-move';

    save();
    updateUI();
  };

  node(
    'div','section',
    'Right joystick sensitivity',
    dialog
  );

  const sr=node('div','line',null,dialog);

  node('span','speedinfo','Mouse speed',sr);
  sliderText=node('b','speedinfo','',sr);

  slider=node('input','speed',null,dialog);
  slider.type='range';
  slider.min='0.5';
  slider.max='3.50';
  slider.step='0.10';
  slider.value=String(mapping['Mouse speed']);

  slider.oninput=()=>{
    mapping['Mouse speed']=Number(slider.value);
    sliderText.textContent=Number(slider.value).toFixed(2)+'×';
    save();
  };

  node(
    'div','help',
    'Default: 2.00. Adjust while testing aim in the game.',
    dialog
  );

  const tools=node('div','tools',null,dialog);

  const left=node('button','tool','Left click',tools);
  const right=node('button','tool','Right click',tools);
  const clear=node('button','tool','Unassign',tools);

  left.onclick=()=>{
    if(captureName)changeMap(captureName,'mouse-left');
  };

  right.onclick=()=>{
    if(captureName)changeMap(captureName,'mouse-right');
  };

  clear.onclick=()=>{
    if(captureName)changeMap(captureName,'none');
  };

  node(
    'div','help',
    'For mouse clicks: select a button above, then choose Left click or Right click.',
    dialog
  );

  const footer=node('div','footer',null,dialog);

  const reset=node(
    'button','secondary',
    'Reset defaults',
    footer
  );

  reset.onclick=()=>{
    releaseAll();
    mapping={...defaults};
    save();
    stopCapture();
    updateUI();
  };

  const copy=node(
    'button','secondary',
    'Copy diagnostic',
    footer
  );

  copy.onclick=async()=>{
    const info=[
      'VEX IQ Game Mapper',
      'Build Version: '+VERSION,
      'Status: '+(active?'Connected':'Disconnected'),
      'Packets: '+packets,
      'Polls: '+polls,
      'Last age: '+(
        lastPacketAt
          ?Date.now()-lastPacketAt+' ms'
          :'none'
      ),
      'Last error: '+(lastError||'none'),
      'Mappings: '+JSON.stringify(mapping)
    ].join('\n');

    try{
      await navigator.clipboard.writeText(info);
      copy.textContent='Copied!';
    }catch(e){
      copy.textContent='Copy failed';
    }

    setTimeout(()=>{
      copy.textContent='Copy diagnostic';
    },1400);
  };

  cursorEl=node('div','',null,document.body);
  cursorEl.hidden=true;

  cursorEl.style.cssText=
    'position:fixed;'+
    'width:17px;height:17px;'+
    'pointer-events:none;'+
    'border:2px solid #61ffc2;'+
    'border-radius:50%;'+
    'transform:translate(-50%,-50%);'+
    'z-index:2147483645;'+
    'box-shadow:0 0 0 2px #091522';

  uiReady=true;
  updateUI();
  status('Not connected');

  setInterval(()=>{
    if(!active)return;

    if(
      lastPacketAt &&
      Date.now()-lastPacketAt>1800
    ){
      status(
        'Connected, but no recent data',
        'error'
      );
      releaseAll();
    }else{
      status('VEX IQ connected','connected');
    }
  },400);
}

window.addEventListener('blur',()=>{
  releaseAll();
  nativeHeld.clear();
});

window.addEventListener('beforeunload',()=>{
  active=false;
  releaseAll();
});

window.VEXMapper={
  version:VERSION,
  connect,
  disconnect
};

if(document.readyState==='loading'){
  document.addEventListener(
    'DOMContentLoaded',
    buildUI,
    {once:true}
  );
}else{
  buildUI();
}
})();
