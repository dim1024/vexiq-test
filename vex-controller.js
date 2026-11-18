
/* VEX_BUILD: 2026-11-18.11 */
/* VEX IQ 2nd Gen browser adapter — no Robot Brain */
(() => {
  'use strict';
  if (window.VEXMapper) return;

  const VERSION = '2026-11-18.11';
  const POLL = new Uint8Array([0xc9,0x36,0xb8,0x47,0x58,0x60,0x00,0x10,0x53]);
  const BUTTONS = {
    'E ↑':[13,8], 'E ↓':[13,2], 'F ↑':[13,4], 'F ↓':[13,1],
    'L ↑':[13,32], 'L ↓':[13,16], 'R ↑':[13,128], 'R ↓':[13,64],
    'L3':[14,1], 'R3':[14,2]
  };
  const INPUTS = [
    'Left ↑','Left ↓','Left ←','Left →',
    'Right ↑','Right ↓','Right ←','Right →',
    ...Object.keys(BUTTONS)
  ];
  const DEFAULTS = {
    w:'Left ↑', s:'Left ↓', a:'Left ←', d:'Left →',
    ArrowUp:'Left ↑', ArrowDown:'Left ↓',
    ArrowLeft:'Left ←', ArrowRight:'Left →',
    Space:'E ↑', Enter:'R3', j:'F ↑', q:'E ↓',
    r:'F ↑', f:'F ↓', e:'L ↑', c:'L ↓',
    v:'R ↑', '1':'R ↓', p:'L3', k:'none', m:'none'
  };
  const STORE = 'vex-auto-map:' + location.origin + location.pathname;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (_) {}
  let mapping = {}, keys = [], speed = 1.0, aimEnabled = true;
  if (Number.isFinite(saved.speed)) speed = Math.max(.5,Math.min(3.5,saved.speed));
  if (typeof saved.aimEnabled === 'boolean') aimEnabled = saved.aimEnabled;

  let port = null, reader = null, writer = null, readJob = null, pollJob = null;
  let active = false, busy = false, closing = false, packets = 0, polls = 0;
  let lastData = 0, lastError = '', buffer = [];
  let previousInputs = {}, pressedInputs = {}, heldKeys = {}, realKeys = new Set();
  let mouseHeldTargets = {}, aimX = innerWidth/2, aimY = innerHeight/2;
  let panelOpen = false, learning = null, conflict = null;
  let host, shadow, pill, pillText, light, panel, statusText, rows, help;
  let messageBox, messageText, connectButton, disconnectButton, speedSlider, speedValue, cursor;
  const fields = new Map();

  let showCursor = saved.showCursor === true;
  
  function save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          assigned: mapping,
          speed,
          aimEnabled,
          showCursor
        })
      );
    } catch (_) {}
  }
  
  function make(tag,parent,cls,text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }
  function codeOf(key) {
    if (key === 'Space' || key === ' ') return 'Space';
    if (/^[a-z]$/i.test(key)) return 'Key'+key.toUpperCase();
    if (/^[0-9]$/.test(key)) return 'Digit'+key;
    if (key === 'Shift') return 'ShiftLeft';
    if (key === 'Control') return 'ControlLeft';
    return key;
  }
  function keyEvent(key,down) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key:key==='Space' ? ' ' : key, code:codeOf(key),
      bubbles:true, cancelable:true,
      shiftKey:key==='Shift', ctrlKey:key==='Control'
    }));
  }
  window.addEventListener('keydown',e=>{ if(e.isTrusted)realKeys.add(e.code); },true);
  window.addEventListener('keyup',e=>{
    if(!e.isTrusted)return;
    realKeys.delete(e.code);
    for(const k of Object.keys(heldKeys)) {
      if(heldKeys[k] && codeOf(k)===e.code) {
        queueMicrotask(()=>{ if(heldKeys[k]) keyEvent(k,true); });
      }
    }
  },true);
  function mouseTarget() {
    const t=document.elementFromPoint(aimX,aimY);
    return t && t!==host ? t : document.body;
  }
  function mouseEvent(name,down) {
    const button=name==='mouse-left'?0:2;
    const target=down?mouseTarget():(mouseHeldTargets[button]||mouseTarget());
    if(down)mouseHeldTargets[button]=target;
    const opts={bubbles:true,cancelable:true,clientX:aimX,clientY:aimY,
      button,buttons:down?(button===0?1:2):0};
    target.dispatchEvent(new MouseEvent(down?'mousedown':'mouseup',opts));
    if(!down) {
      if(button===0)target.dispatchEvent(new MouseEvent('click',opts));
      delete mouseHeldTargets[button];
    }
  }
  function emit(name,down) {
    if(name==='mouse-left'||name==='mouse-right')mouseEvent(name,down);
    else if(down || !realKeys.has(codeOf(name)))keyEvent(name,down);
  }
  function releaseAll() {
    for(const name of Object.keys(heldKeys)) if(heldKeys[name])emit(name,false);
    heldKeys={}; mouseHeldTargets={};
  }
  function applyInputs(next) {
    const prior=pressedInputs;
    pressedInputs=next;
    if(learning) {
      const pressed=INPUTS.find(name=>next[name]&&!prior[name]);
      if(pressed)requestAssignment(learning,pressed);
    }
    if(panelOpen) { releaseAll();return; }
    const counts={};
    for(const key of keys) {
      const button=mapping[key];
      if(button&&button!=='none'&&next[button])counts[key]=(counts[key]||0)+1;
    }
    for(const key of new Set([...Object.keys(heldKeys),...Object.keys(counts)])) {
      const before=heldKeys[key]||0, after=counts[key]||0;
      if(!before&&after)emit(key,true);
      else if(before&&!after)emit(key,false);
    }
    heldKeys=counts;
  }
  function axis(value) { const d=value-127; return Math.abs(d)<24?0:d; }
  
  


function aim(rx, ry) {
  if (panelOpen || !aimEnabled || (!rx && !ry)) {
    return;
  }

  aimX = Math.max(
    0,
    Math.min(innerWidth - 1, aimX + rx * speed)
  );

  aimY = Math.max(
    0,
    Math.min(innerHeight - 1, aimY - ry * speed)
  );

  cursor.style.left = aimX + 'px';
  cursor.style.top = aimY + 'px';
  cursor.hidden = !showCursor;

  mouseTarget().dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: aimX,
      clientY: aimY
    })
  );
}



  
  
  function packet(p) {
    packets++;lastData=Date.now();
    const rx=axis(p[5]),ry=axis(p[6]),lx=axis(p[7]),ly=axis(p[8]);
    const next={
      'Left ↑':ly>0,'Left ↓':ly<0,'Left ←':lx<0,'Left →':lx>0,
      'Right ↑':ry>0,'Right ↓':ry<0,'Right ←':rx<0,'Right →':rx>0
    };
    for(const [name,[offset,mask]] of Object.entries(BUTTONS))next[name]=!!(p[offset]&mask);
    applyInputs(next);aim(rx,ry);
  }
  function receive(chunk) {
    for(const b of chunk)buffer.push(b);
    if(buffer.length>4096)buffer=buffer.slice(-512);
    while(buffer.length>=4) {
      if(buffer[0]!==170||buffer[1]!==85||buffer[2]!==88||buffer[3]!==19){buffer.shift();continue;}
      if(buffer.length<23)break;
      packet(buffer.splice(0,23));
    }
  }
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function readLoop() {
    try {
      reader=port.readable.getReader();
      while(active) {
        const result=await reader.read();
        if(result.done)break;
        if(result.value)receive(result.value);
      }
    } catch(e) { if(active)fail('Read error: '+e.message); }
    finally {if(reader){try{reader.releaseLock();}catch(_){}reader=null;}}
  }
  async function pollLoop() {
    try {
      while(active) {await writer.write(POLL);polls++;await sleep(100);}
    } catch(e) {if(active)fail('Write error: '+e.message);}
  }
  function setStatus(msg,kind='') {
    if(statusText){statusText.textContent=msg;statusText.dataset.kind=kind;}
    if(light)light.dataset.kind=kind;
    if(pillText)pillText.textContent=active?'Controller Connected':'+ Add Controller';
  }
  function fail(message) {
    lastError=message;active=false;releaseAll();setStatus(message,'error');
    setTimeout(()=>disconnect(),0);
  }
  async function connect() {
    if(active||busy||closing)return;
    if(!navigator.serial){setStatus('Use Chrome/Edge on HTTPS.','error');return;}
    busy=true;connectButton.disabled=true;
    try {
      port=await navigator.serial.requestPort();
      const info=port.getInfo();
      if(info.usbVendorId!==10376||info.usbProductId!==528)
        throw new Error('Choose VEX Robotics IQ Controller — Communications Port');
      await port.open({baudRate:115200});
      writer=port.writable.getWriter();buffer=[];lastData=0;lastError='';
      pressedInputs={};active=true;
      readJob=readLoop();pollJob=pollLoop();
      disconnectButton.disabled=false;
      setStatus('VEX IQ connected','connected');
      // Keep settings open so the next click can assign a physical button.
    } catch(e) {
      lastError=e.message;setStatus('Connection failed: '+e.message,'error');
      if(writer){try{writer.releaseLock();}catch(_){}writer=null;}
      if(port){try{await port.close();}catch(_){}port=null;}
    } finally {busy=false;connectButton.disabled=active;}
  }
  async function disconnect() {
    if(closing||busy)return;
    closing=true;active=false;releaseAll();learning=null;
    try{if(reader)await reader.cancel();}catch(_){}
    try{if(readJob)await readJob;}catch(_){}
    try{if(pollJob)await pollJob;}catch(_){}
    readJob=pollJob=null;
    try{if(writer)writer.releaseLock();}catch(_){}
    writer=null;
    try{if(port)await port.close();}catch(_){}
    port=null;closing=false;pressedInputs={};
    if(cursor)cursor.hidden=true;
    if(connectButton)connectButton.disabled=false;
    if(disconnectButton)disconnectButton.disabled=true;
    setStatus(lastError?'Disconnected — '+lastError:'Not connected',lastError?'error':'');
    updateFields();
  }

  function showPanel(open) {
    panelOpen = open;
    panel.hidden = !open;
  
    pill.classList.toggle('compact', !open);
  
    pill.setAttribute('aria-expanded', String(open));
  
    learning = null;
    conflict = null;
    messageBox.hidden = true;
  
    releaseAll();
    updateFields();
  }

  function updateFields() {
    for(const key of keys) {
      const field=fields.get(key);
      if(!field)continue;
      const waiting=learning===key;
      field.textContent=waiting?'Press VEX…':(mapping[key]&&mapping[key]!=='none'?mapping[key]:'Not assigned');
      field.classList.toggle('listening',waiting);
    }
    if(help)help.textContent='Click a field, then press a button on your VEX controller.';
  }
  function beginAssignment(key) {
    if(!active){setStatus('Connect VEX IQ first.','error');return;}
    releaseAll();conflict=null;messageBox.hidden=true;
    learning=key;updateFields();
  }
  function finishAssignment(key,input) {
    releaseAll();mapping[key]=input;learning=null;conflict=null;
    messageBox.hidden=true;save();updateFields();
  }
  
  function requestAssignment(key, input) {
    if (input === 'none') {finishAssignment(key, input);    return;}
    const duplicates = keys.filter(  k => k !== key && mapping[k] === input);
    if (!duplicates.length) {  finishAssignment(key, input); return;  }
    conflict = { key, input, duplicates };
    learning = null;
    messageText.textContent = input + ' is already assigned to '+duplicates.join(', ') + '.';
    updateFields();
    // Move warning directly above the selected field.
    const field = fields.get(key);
    if (field) {field.closest('.row').before(messageBox); }
    messageBox.hidden = false;
  }

  function resolveConflict(choice) {
    if(!conflict)return;
    const {key,input,duplicates}=conflict;
    if(choice==='cancel'){conflict=null;messageBox.hidden=true;updateFields();return;}
    if(choice==='replace')for(const k of duplicates)mapping[k]='none';
    finishAssignment(key,input);
  }
  function canonical(raw) {
    if(raw===' '||raw==='Spacebar')return 'Space';
    if(/^Key[A-Z]$/.test(raw))return raw[3].toLowerCase();
    if(/^Digit\d$/.test(raw))return raw.slice(5);
    if(/^[A-Z]$/.test(raw))return raw.toLowerCase();
    return raw;
  }
  function validKey(k) {
    return /^[a-z0-9]$/.test(k)||
      /^(Space|Enter|Shift|Control|Escape|Tab|Backspace)$/.test(k)||
      /^Arrow(Up|Down|Left|Right)$/.test(k)||/^F(?:[1-9]|1[0-2])$/.test(k);
  }
  // Best-effort discovery; JS APIs do not expose a semantic list of game actions.
  async function discoverKeys() {
    const found=new Set(['Enter']);
    const sources=[];
    for(const script of [...document.scripts]) {
      if(!script.src){sources.push(script.textContent||'');continue;}
      const url=new URL(script.src,location.href);
      if(url.origin!==location.origin||/vex-controller|VexIQ-Adapter/i.test(url.pathname))continue;
      try {const r=await fetch(url.href,{cache:'no-store'});if(r.ok)sources.push(await r.text());}catch(_){}
    }
    for(const src of sources) {
      const patterns=[
        /\b(?:e|event|ev|evt)\s*\.\s*(?:code|key)\s*(?:===|==|!==|!=)\s*['"]([^'"]+)['"]/g,
        /['"]([^'"]+)['"]\s*(?:===|==|!==|!=)\s*\b(?:e|event|ev|evt)\s*\.\s*(?:code|key)/g,
        /\bkeys\s*\[\s*['"]([^'"]+)['"]\s*\]/g,
        /\bkeys\s*\.\s*([a-zA-Z])\b/g,
        /\b(?:k|key)\s*(?:===|==|!==|!=)\s*['"]([^'"]+)['"]/g,
        /['"]([^'"]+)['"]\s*(?:===|==|!==|!=)\s*\b(?:k|key)\b/g
      ];
      // Only treat k comparisons as game keys when derived from e.key.
      if(!/\b(?:let|const|var)\s+(?:k|key)\s*=\s*(?:e|event|ev|evt)\s*\.\s*key/.test(src))patterns.splice(4,2);
      for(const re of patterns)for(const match of src.matchAll(re)){
        const key=canonical(match[1]);if(validKey(key))found.add(key);
      }
      const arr=/\[([^\]\n]{1,350})\]\s*\.\s*includes\s*\(\s*(?:e|event|ev|evt)\s*\.\s*(?:code|key)\s*\)/g;
      for(const match of src.matchAll(arr))for(const item of match[1].matchAll(/['"]([^'"]+)['"]/g)){
        const key=canonical(item[1]);if(validKey(key))found.add(key);
      }
    }
    const order=['w','a','s','d','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space','Enter'];
    keys=[...found].sort((a,b)=>{
      const ai=order.indexOf(a),bi=order.indexOf(b);
      return (ai>=0||bi>=0)?(ai<0?999:ai)-(bi<0?999:bi):a.localeCompare(b);
    });
    mapping={};
    for(const key of keys){
      const prior=saved.assigned?.[key];
      mapping[key]=INPUTS.includes(prior)?prior:(DEFAULTS[key]||'none');
    }
    // R3 -> Enter, unless the user previously customized it.
    if(!Object.prototype.hasOwnProperty.call(saved.assigned||{},'Enter'))mapping.Enter='R3';
    drawRows();updateFields();
  }
  function drawRows() {
    rows.textContent='';fields.clear();
    for(const key of keys){
      const row=make('div',rows,'row');
      make('span',row,'key',key);
      const field=make('button',row,'field');
      field.type='button';field.onclick=()=>beginAssignment(key);
      fields.set(key,field);
    }
  }
  function buildUI() {
    host=make('div',document.body);host.id='vex-adapter';
    shadow=host.attachShadow({mode:'open'});
    make('style',shadow).textContent=`
:host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;font-family:system-ui,Arial,sans-serif;color:#eff6ff}
*{box-sizing:border-box}[hidden]{display:none!important}button,input{font:inherit}button{cursor:pointer}
.pill{display:flex;align-items:center;gap:8px;padding:11px 15px;border:1px solid #d7e2ee;border-radius:99px;color:#18283d;background:#f8fbff;box-shadow:0 9px 30px #0007;font-size:13px;font-weight:700}
.light{width:9px;height:9px;border-radius:50%;background:#9faaba}.light[data-kind=connected]{background:#25c381}.light[data-kind=error]{background:#ee7878}
.panel{position:absolute;bottom:58px;right:0;width:min(394px,calc(100vw - 24px));max-height:78vh;overflow-y:auto;padding:18px;background:#14253e;border:1px solid #4a6280;border-radius:17px;box-shadow:0 15px 50px #000a}
.head,.bar,.foot{display:flex;align-items:center;justify-content:space-between;gap:8px}.title{font-size:19px;font-weight:750}.sub,.hint{font-size:11px;color:#bad0eb;line-height:1.55}
.close{border:0;background:none;color:#dceafa;font-size:24px}.status{margin:14px 0;background:#213c59;padding:10px;border-radius:9px;font-size:12px}.status[data-kind=error]{color:#ffa5a5}.status[data-kind=connected]{color:#85f4c3}
.primary,.secondary,.small{border:0;border-radius:9px;padding:10px;font-size:12px;font-weight:650}.primary{flex:1;background:#90baff;color:#0d233b}.secondary,.small{color:#eff6ff;background:#344e6d}
.section{margin-top:15px;padding-top:13px;border-top:1px solid #3d5370;font-size:13px;font-weight:750}.hint{margin:9px 0}.row{display:grid;grid-template-columns:92px 1fr;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid #2b405a}
.key{font-size:13px;text-align:center;padding:8px;border-radius:8px;background:#203751;font-weight:750}.field{background:#273f60;color:#f4f8ff;border:1px solid #527295;border-radius:9px;padding:9px;font-size:12px;text-align:center;min-height:36px}.field.listening{background:#3e6594;border-color:#a5d1ff;box-shadow:0 0 0 2px #86baff45}
.warning{background:#493724;border:1px solid #f6b66b;border-radius:10px;padding:12px;margin:11px 0;font-size:12px;line-height:1.45}.warningButtons{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.small{background:#6c593b}
.speed{width:100%;accent-color:#8abaff;margin:11px 0}.foot{margin-top:14px;flex-wrap:wrap}button:disabled{opacity:.45;cursor:default}
.pill {
    transition: opacity .2s, padding .2s;
  }
  
  .pill.compact {
    padding: 10px;
    opacity: .4;
  }
  
  .pill.compact .pill-label {
    display: none;
  }
  
  .pill.compact:hover,
  .pill.compact:focus-visible {
    padding: 11px 15px;
    opacity: 1;
  }
  
  .pill.compact:hover .pill-label,
  .pill.compact:focus-visible .pill-label {
    display: inline;
  }

`;
    pill=make('button',shadow,'pill');pill.type='button';
    light=make('span',pill,'light');make('span',pill,'','🎮');
    pillText=make('span',pill,'pill-label','+ Add Controller');
    pill.classList.add('compact');
    pill.onclick=()=>showPanel(!panelOpen);
    panel=make('section',shadow,'panel');panel.hidden=true;
    const head=make('div',panel,'head');const heading=make('div',head);
    make('div',heading,'title','Controller settings');
    make('div',heading,'sub','VEX IQ 2nd Gen · '+VERSION);
    const close=make('button',head,'close','×');close.onclick=()=>showPanel(false);
    statusText=make('div',panel,'status','Not connected');
    const buttons=make('div',panel,'bar');
    connectButton=make('button',buttons,'primary','Connect VEX IQ');connectButton.onclick=connect;
    disconnectButton=make('button',buttons,'secondary','Disconnect');
    disconnectButton.disabled=true;disconnectButton.onclick=disconnect;
    make('div',panel,'hint','Choose VEX Robotics IQ Controller — Communications Port.');
    make('div',panel,'section','Game keys → VEX controls');
    help=make('div',panel,'hint','Click a field, then press a button on your VEX controller.');
    rows=make('div',panel);
    messageBox=make('div',panel,'warning');messageBox.hidden=true;
    messageText=make('div',messageBox);
    const choices=make('div',messageBox,'warningButtons');
    for(const [label,choice] of [['Replace old','replace'],['Keep both','both'],['Cancel','cancel']]){
      const b=make('button',choices,'small',label);b.onclick=()=>resolveConflict(choice);
    }
    const clear=make('button',panel,'secondary','Clear selected field');
    clear.style.marginTop='10px';
    clear.onclick=()=>{if(learning)finishAssignment(learning,'none');};
    make('div',panel,'section','Right joystick mouse sensitivity');
    const speedRow=make('div',panel,'bar');make('span',speedRow,'hint','Mouse speed');
    speedValue=make('b',speedRow,'',speed.toFixed(2)+'×');
    speedSlider=make('input',panel,'speed');speedSlider.type='range';
    speedSlider.min='0.5';speedSlider.max='3.5';speedSlider.step='0.1';speedSlider.value=String(speed);
    speedSlider.oninput=()=>{speed=+speedSlider.value;speedValue.textContent=speed.toFixed(2)+'×';save();};
    const aimButton=make('button',panel,'secondary','Mouse aiming: '+(aimEnabled?'ON':'OFF'));
    aimButton.onclick=()=>{aimEnabled=!aimEnabled;aimButton.textContent='Mouse aiming: '+(aimEnabled?'ON':'OFF');if(!aimEnabled)cursor.hidden=true;save();};
    
    const cursorButton = make(
      'button',
      panel,
      'secondary',
      'Show mouse cursor: ' + (showCursor ? 'ON' : 'OFF')
    );
    
    cursorButton.style.marginTop = '10px';
    
    cursorButton.onclick = () => {
      showCursor = !showCursor;
    
      cursorButton.textContent =
        'Show mouse cursor: ' + (showCursor ? 'ON' : 'OFF');
    
      cursor.hidden = !showCursor || !active || panelOpen;
    
      if (showCursor) {
        cursor.style.left = aimX + 'px';
        cursor.style.top = aimY + 'px';
      }
    
      save();
    };

    const foot=make('div',panel,'foot');
    const reset=make('button',foot,'secondary','Reset defaults');
    reset.onclick=()=>{releaseAll();for(const key of keys)mapping[key]=DEFAULTS[key]||'none';mapping.Enter='R3';save();updateFields();};
    const copy=make('button',foot,'secondary','Copy diagnostic');
    copy.onclick=async()=>{
      const report=[
        'VEX IQ Game Adapter','Build Version: '+VERSION,
        'Status: '+(active?'Connected':'Disconnected'),
        'Packets: '+packets,'Polls: '+polls,
        'Last age: '+(lastData?Date.now()-lastData+' ms':'none'),
        'Detected keys: '+keys.join(', '),
        'Mappings: '+JSON.stringify(mapping),
        'Mouse speed: '+speed,
        'Last error: '+(lastError||'none')
      ].join('\n');
      try{await navigator.clipboard.writeText(report);copy.textContent='Copied!';}
      catch(_){copy.textContent='Copy failed';}
      setTimeout(()=>copy.textContent='Copy diagnostic',1400);
    };
    cursor=make('div',document.body);cursor.hidden=true;
    cursor.style.cssText='position:fixed;width:16px;height:16px;pointer-events:none;'+
      'border:2px solid #70ffca;border-radius:50%;transform:translate(-50%,-50%);'+
      'z-index:2147483645;box-shadow:0 0 0 2px #11253b';
    setStatus('Not connected');
    discoverKeys().catch(e=>{
      help.textContent='Automatic scan unavailable: '+e.message;
      keys=['Enter'];mapping.Enter='R3';drawRows();updateFields();
    });
    setInterval(()=>{
      if(!active)return;
      if(lastData&&Date.now()-lastData>1800){releaseAll();setStatus('No recent controller data','error');}
      else setStatus('VEX IQ connected','connected');
    },400);
  }
  window.addEventListener('blur',()=>{releaseAll();realKeys.clear();});
  window.addEventListener('beforeunload',()=>{active=false;releaseAll();});
  window.VEXMapper={version:VERSION,connect,disconnect};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',buildUI,{once:true});
  else buildUI();
})();
