
/* VEX IQ 2nd Gen Universal Mapper — 2026-11-17.4
   Standalone browser adapter; no Robot Brain.
   HTTPS Chrome/Edge required.
   Mouse support is experimental.
*/
(function () {
'use strict';

if (window.VEXMapper) return;

var BUILD = '2026-11-17.4';

var POLL = new Uint8Array([
  0xc9,0x36,0xb8,0x47,0x58,0x60,0x00,0x10,0x53
]);

var BUTTONS = {
  'E ↑':[13,8],
  'E ↓':[13,2],
  'F ↑':[13,4],
  'F ↓':[13,1],
  'L ↑':[13,32],
  'L ↓':[13,16],
  'R ↑':[13,128],
  'R ↓':[13,64],
  'L3':[14,1],
  'R3':[14,2]
};

var defaults = {
  'Left ↑':'w',
  'Left ↓':'s',
  'Left ←':'a',
  'Left →':'d',
  'E ↑':'j',
  'E ↓':'q',
  'F ↑':'r',
  'F ↓':'f',
  'L ↑':'e',
  'L ↓':'c',
  'R ↑':'v',
  'R ↓':'1',
  'L3':'p',
  'R3':'k',
  'Right ↑':'none',
  'Right ↓':'none',
  'Right ←':'none',
  'Right →':'none',
  'Right aim':'mouse-move'
};

var options = [
  'none','w','a','s','d',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
  'j','q','r','f','e','c','v','p','k',
  '1','2','3','Space','Enter','Shift',
  'mouse-left','mouse-right'
];

var storageKey =
  'vex-mapper:'+location.origin+location.pathname;

var mapping = Object.assign({},defaults);

try {
  Object.assign(
    mapping,
    JSON.parse(localStorage.getItem(storageKey)||'{}')
  );
} catch(e) {}

var port=null;
var reader=null;
var writer=null;
var readingTask=null;
var pollTask=null;

var alive=false;
var closing=false;

var buffer=[];
var lastPacketTime=0;
var packets=0;
var polls=0;

var held={};
var lastPhysical={};
var lastButtons={};

var aimX=innerWidth/2;
var aimY=innerHeight/2;

var root;
var statusEl;
var controlsEl;
var countsEl;
var cursorEl;
var btnConnect;
var btnDisconnect;

function element(tag,props,parent) {
  var e=document.createElement(tag);

  Object.assign(e,props||{});

  if(parent) parent.appendChild(e);

  return e;
}

function save() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(mapping)
    );
  } catch(e) {}
}

function label(key) {
  return key==='Space'?' ':
    key==='Shift'?'Shift':key;
}

function code(key) {
  if(key===' ') return 'Space';
  if(key==='Shift') return 'ShiftLeft';
  if(key==='Enter') return 'Enter';

  if(key.indexOf('Arrow')===0) return key;

  if(key.length===1 && /[a-z]/i.test(key)) {
    return 'Key'+key.toUpperCase();
  }

  if(key.length===1 && /[0-9]/.test(key)) {
    return 'Digit'+key;
  }

  return key;
}

function fireKey(key,down) {
  var k=label(key);
  var c=code(key);

  var event=new KeyboardEvent(
    down?'keydown':'keyup',
    {
      key:k,
      code:c,
      bubbles:true,
      cancelable:true
    }
  );

  window.dispatchEvent(event);
}

function fireMouse(button,down) {
  var target=
    document.elementFromPoint(aimX,aimY)||
    document.body;

  var ev=new MouseEvent(
    down?'mousedown':'mouseup',
    {
      bubbles:true,
      cancelable:true,
      clientX:aimX,
      clientY:aimY,
      button:button,
      buttons:down?(button===0?1:2):0
    }
  );

  target.dispatchEvent(ev);

  if(!down) {
    target.dispatchEvent(
      new MouseEvent('click',{
        bubbles:true,
        clientX:aimX,
        clientY:aimY,
        button:button
      })
    );
  }
}

function outputFor(action) {
  return mapping[action]||'none';
}

function activateOutput(out,down) {
  if(!out||out==='none'||out==='mouse-move') {
    return;
  }

  var n=held[out]||0;

  if(down) {
    held[out]=n+1;

    if(!n) {
      if(out==='mouse-left'||out==='mouse-right') {
        fireMouse(
          out==='mouse-left'?0:2,
          true
        );
      } else {
        fireKey(out,true);
      }
    }
  } else if(n) {
    held[out]=n-1;

    if(n===1) {
      if(out==='mouse-left'||out==='mouse-right') {
        fireMouse(
          out==='mouse-left'?0:2,
          false
        );
      } else {
        fireKey(out,false);
      }
    }
  }
}

function setPhysical(action,on) {
  if(!!lastPhysical[action]===!!on) return;

  lastPhysical[action]=!!on;

  activateOutput(outputFor(action),!!on);
}

function releaseAll() {
  Object.keys(lastPhysical).forEach(function(k){
    setPhysical(k,false);
  });

  Object.keys(held).forEach(function(o){
    if(held[o]) {
      held[o]=1;
      activateOutput(o,false);
    }
  });

  lastPhysical={};
  lastButtons={};
}

function axis(v) {
  var n=v-127;
  return Math.abs(n)<24?0:n;
}

function setAim(dx,dy) {
  if(mapping['Right aim']!=='mouse-move') return;

  if(!dx&&!dy) return;

  aimX=Math.max(
    0,
    Math.min(innerWidth-1,aimX+dx*.10)
  );

  aimY=Math.max(
    0,
    Math.min(innerHeight-1,aimY-dy*.10)
  );

  cursorEl.style.left=aimX+'px';
  cursorEl.style.top=aimY+'px';
  cursorEl.style.display='block';

  var target=
    document.elementFromPoint(aimX,aimY)||
    document.body;

  target.dispatchEvent(
    new MouseEvent('mousemove',{
      bubbles:true,
      cancelable:true,
      clientX:aimX,
      clientY:aimY
    })
  );
}

function packet(p) {
  packets++;
  lastPacketTime=Date.now();

  var x=axis(p[7]);
  var y=axis(p[8]);
  var rx=axis(p[5]);
  var ry=axis(p[6]);

  setPhysical('Left ←',x<0);
  setPhysical('Left →',x>0);
  setPhysical('Left ↑',y>0);
  setPhysical('Left ↓',y<0);

  setPhysical('Right ←',rx<0);
  setPhysical('Right →',rx>0);
  setPhysical('Right ↑',ry>0);
  setPhysical('Right ↓',ry<0);

  Object.keys(BUTTONS).forEach(function(name){
    var b=BUTTONS[name];

    setPhysical(
      name,
      !!(p[b[0]]&b[1])
    );
  });

  setAim(rx,ry);

  countsEl.textContent=
    'Packets: '+packets+
    ' · Polls: '+polls+
    ' · RX age: 0 ms';
}

function incoming(data) {
  for(var i=0;i<data.length;i++) {
    buffer.push(data[i]);
  }

  if(buffer.length>4096) {
    buffer=buffer.slice(-512);
  }

  while(buffer.length>=4) {
    if(
      buffer[0]!==170||
      buffer[1]!==85||
      buffer[2]!==88||
      buffer[3]!==19
    ) {
      buffer.shift();
      continue;
    }

    if(buffer.length<23) break;

    packet(buffer.splice(0,23));
  }
}

function sleep(ms) {
  return new Promise(function(resolve){
    setTimeout(resolve,ms);
  });
}

async function readLoop() {
  try {
    reader=port.readable.getReader();

    while(alive) {
      var v=await reader.read();

      if(v.done) break;

      if(v.value) incoming(v.value);
    }
  } catch(e) {
    if(alive) fail('Read error: '+e.message);
  } finally {
    if(reader) {
      try {reader.releaseLock();} catch(e) {}
      reader=null;
    }
  }
}

async function pollLoop() {
  try {
    while(alive) {
      await writer.write(POLL);
      polls++;
      await sleep(100);
    }
  } catch(e) {
    if(alive) fail('Write error: '+e.message);
  }
}

function status(s) {
  statusEl.textContent=s;
}

function fail(s) {
  status(s);
  alive=false;
  releaseAll();

  setTimeout(disconnect,0);
}

async function connect() {
  if(alive||closing) return;

  if(!navigator.serial) {
    status(
      'Web Serial unavailable — use Chrome/Edge over HTTPS'
    );
    return;
  }

  try {
    port=await navigator.serial.requestPort();

    var info=port.getInfo();

    if(
      info.usbVendorId!==10376||
      info.usbProductId!==528
    ) {
      status(
        'Wrong device: choose VEX IQ Communications Port'
      );
      port=null;
      return;
    }

    await port.open({baudRate:115200});

    writer=port.writable.getWriter();
    buffer=[];
    alive=true;

    status('Connected — VEX IQ');

    btnConnect.disabled=true;
    btnDisconnect.disabled=false;

    readingTask=readLoop();
    pollTask=pollLoop();

  } catch(e) {
    status('Connection failed: '+e.message);
    await disconnect();
  }
}

async function disconnect() {
  if(closing) return;

  closing=true;
  alive=false;
  releaseAll();

  try {
    if(reader) await reader.cancel();
  } catch(e) {}

  try {
    if(readingTask) await readingTask;
  } catch(e) {}

  readingTask=null;

  try {
    if(pollTask) await pollTask;
  } catch(e) {}

  pollTask=null;

  try {
    if(writer) writer.releaseLock();
  } catch(e) {}

  writer=null;

  try {
    if(port) await port.close();
  } catch(e) {}

  port=null;
  closing=false;

  btnConnect.disabled=false;
  btnDisconnect.disabled=true;

  status('Disconnected');
  cursorEl.style.display='none';
}

function buildUI() {
  root=element('div',{},document.body);
  root.id='vexmapper';

  root.style.cssText=
    'position:fixed;right:12px;bottom:12px;'+
    'width:min(360px,calc(100vw - 24px));'+
    'max-height:80vh;overflow:auto;'+
    'z-index:2147483645;'+
    'background:#142239;color:#eef5ff;'+
    'border:2px solid #67c8ab;'+
    'border-radius:12px;padding:12px;'+
    'font:13px Arial;'+
    'box-shadow:0 8px 25px #0009';

  var header=element(
    'div',
    {textContent:'🎮 VEX Mapper · '+BUILD},
    root
  );

  header.style.cssText=
    'font-weight:bold;'+
    'font-size:15px;'+
    'margin-bottom:8px';

  var hide=element(
    'button',
    {textContent:'Hide settings'},
    root
  );

  hide.style.marginBottom='6px';

  statusEl=element(
    'div',
    {textContent:'Not connected'},
    root
  );

  statusEl.style.margin='7px 0';

  btnConnect=element(
    'button',
    {textContent:'Connect VEX IQ'},
    root
  );

  btnConnect.onclick=connect;

  btnDisconnect=element(
    'button',
    {textContent:'Disconnect'},
    root
  );

  btnDisconnect.onclick=disconnect;
  btnDisconnect.disabled=true;

  countsEl=element(
    'div',
    {textContent:'Packets: 0'},
    root
  );

  countsEl.style.margin='8px 0';

  controlsEl=element('div',{},root);

  var help=element(
    'div',
    {
      textContent:
        'Left stick → keys; right stick → virtual '+
        'mouse aim. Choose mappings below. '+
        'Mouse compatibility varies by game.'
    },
    root
  );

  help.style.cssText=
    'color:#a8c2dd;margin:8px 0';

  Object.keys(defaults).forEach(function(name){
    if(name==='Right aim') return;

    var line=element('div',{},controlsEl);

    line.style.cssText=
      'display:flex;align-items:center;'+
      'gap:8px;margin:5px 0';

    var labelEl=element(
      'span',
      {textContent:name},
      line
    );

    labelEl.style.width='95px';

    var sel=element('select',{},line);

    sel.style.cssText=
      'flex:1;'+
      'background:#293b57;'+
      'color:white;'+
      'border:1px solid #7996b7;'+
      'padding:5px';

    options.forEach(function(o){
      element(
        'option',
        {value:o,textContent:o},
        sel
      );
    });

    sel.value=mapping[name];

    sel.onchange=function(){
      releaseAll();
      mapping[name]=sel.value;
      save();
    };
  });

  var reset=element(
    'button',
    {textContent:'Reset mappings'},
    root
  );

  reset.onclick=function(){
    releaseAll();

    mapping=Object.assign({},defaults);
    save();

    Array.from(
      controlsEl.querySelectorAll('select')
    ).forEach(function(s,i){
      s.value=mapping[
        Object.keys(defaults)[i]
      ];
    });
  };

  var collapsed=false;

  hide.onclick=function(){
    collapsed=!collapsed;

    controlsEl.style.display=
      collapsed?'none':'';

    help.style.display=
      collapsed?'none':'';

    reset.style.display=
      collapsed?'none':'';

    hide.textContent=collapsed?
      'Show settings':
      'Hide settings';
  };

  [
    btnConnect,
    btnDisconnect,
    hide,
    reset
  ].forEach(function(b){
    b.style.cssText=
      'background:#3375c9;'+
      'color:white;'+
      'border:0;border-radius:6px;'+
      'padding:7px;margin:3px;cursor:pointer';
  });

  cursorEl=element('div',{},document.body);

  cursorEl.style.cssText=
    'position:fixed;'+
    'width:16px;height:16px;'+
    'border:2px solid #00ffbb;'+
    'border-radius:50%;'+
    'transform:translate(-50%,-50%);'+
    'pointer-events:none;display:none;'+
    'z-index:2147483644;'+
    'box-shadow:0 0 0 2px #000';

  setInterval(function(){
    if(
      alive&&
      lastPacketTime&&
      Date.now()-lastPacketTime>1800
    ) {
      status('No recent controller data');
      releaseAll();
    }

    if(lastPacketTime) {
      countsEl.textContent=
        'Packets: '+packets+
        ' · Polls: '+polls+
        ' · RX age: '+
        (Date.now()-lastPacketTime)+' ms';
    }
  },350);
}

window.addEventListener('blur',function(){
  releaseAll();
});

window.addEventListener('beforeunload',function(){
  alive=false;
  releaseAll();
});

window.VEXMapper={
  version:BUILD,
  connect:connect,
  disconnect:disconnect
};

if(document.readyState==='loading') {
  document.addEventListener(
    'DOMContentLoaded',
    buildUI
  );
} else {
  buildUI();
}

})();
