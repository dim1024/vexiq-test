
/* VEX IQ Game Mapper — Build 2026-11-17.5
   USB-C · No Robot Brain · Universal key mapping
*/
(function () {
  'use strict';

  if (window.VEXMapper) return;

  const VERSION = '2026-11-17.5';

  const POLL = new Uint8Array([
    0xc9, 0x36, 0xb8, 0x47,
    0x58, 0x60, 0x00, 0x10, 0x53
  ]);

  const BUTTONS = {
    'E ↑': [13, 8],
    'E ↓': [13, 2],
    'F ↑': [13, 4],
    'F ↓': [13, 1],
    'L ↑': [13, 32],
    'L ↓': [13, 16],
    'R ↑': [13, 128],
    'R ↓': [13, 64],
    'L3': [14, 1],
    'R3': [14, 2]
  };

  const defaults = {
    'Left ↑': 'w',
    'Left ↓': 's',
    'Left ←': 'a',
    'Left →': 'd',
    'E ↑': 'j',
    'E ↓': 'q',
    'F ↑': 'r',
    'F ↓': 'f',
    'L ↑': 'e',
    'L ↓': 'c',
    'R ↑': 'v',
    'R ↓': '1',
    'L3': 'p',
    'R3': 'k',
    'Right ↑': 'none',
    'Right ↓': 'none',
    'Right ←': 'none',
    'Right →': 'none',
    'Right aim': 'mouse-move'
  };

  const storageKey =
    'vex-mapper:' + location.origin + location.pathname;

  let mapping = Object.assign({}, defaults);

  try {
    Object.assign(
      mapping,
      JSON.parse(localStorage.getItem(storageKey) || '{}')
    );
  } catch (e) {}

  let port = null;
  let reader = null;
  let writer = null;
  let readTask = null;
  let pollTask = null;

  let active = false;
  let closing = false;
  let connecting = false;

  let buffer = [];
  let packets = 0;
  let polls = 0;
  let lastPacketAt = 0;

  let physical = {};
  let held = {};
  let pressedTargets = {};

  let aimX = innerWidth / 2;
  let aimY = innerHeight / 2;

  let panelOpen = false;
  let captureName = null;
  let lastError = '';

  let host, shadow, pill, pillText, pillDot;
  let dialog, statusEl, rowsEl;
  let cursorEl, captureBanner;

  const selectors = {};

  function save() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(mapping)
      );
    } catch (e) {}
  }

  function node(tag, className, text, parent) {
    const el = document.createElement(tag);

    if (className) el.className = className;

    if (text !== undefined && text !== null) {
      el.textContent = text;
    }

    if (parent) parent.appendChild(el);

    return el;
  }

  function status(text, kind) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.dataset.kind = kind || '';
    }

    pillDot.dataset.kind = kind || '';

    pillText.textContent = active
      ? 'Controller Connected'
      : '+ Add Controller';
  }

  function switchPanel(open) {
    panelOpen = open;
    dialog.hidden = !open;

    pill.setAttribute(
      'aria-expanded',
      String(open)
    );

    if (!open) stopCapture();
  }

  function stopCapture() {
    captureName = null;
    captureBanner.hidden = true;

    Object.keys(selectors).forEach(name => {
      selectors[name].classList.remove('listening');
    });
  }

  function displayOutput(out) {
    if (out === 'none') return 'Not assigned';
    if (out === 'mouse-left') return 'Left mouse click';
    if (out === 'mouse-right') return 'Right mouse click';
    if (out === 'Space') return 'Space';

    if (out.toUpperCase().startsWith('ARROW')) {
      return out.replace('Arrow', 'Arrow ');
    }

    return out;
  }

  function updateRows() {
    Object.keys(selectors).forEach(name => {
      selectors[name].textContent =
        displayOutput(mapping[name]);
    });

    const aimBtn = shadow.getElementById('vex-aim');

    if (aimBtn) {
      aimBtn.textContent =
        mapping['Right aim'] === 'mouse-move'
          ? 'Enabled'
          : 'Disabled';
    }
  }

  function showCapture(name) {
    stopCapture();
    releaseAll();

    captureName = name;

    selectors[name].classList.add('listening');

    captureBanner.textContent =
      'Press a keyboard key for ' +
      name + ' (Esc to cancel).';

    captureBanner.hidden = false;
  }

  function setMapping(name, value) {
    releaseAll();

    mapping[name] = value;

    save();
    stopCapture();
    updateRows();
  }

  function captureKey(e) {
    if (!captureName) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if (e.key === 'Escape') {
      stopCapture();
      return;
    }

    if (['Control', 'Alt', 'Meta'].includes(e.key)) {
      return;
    }

    const k = e.key === ' ' ? 'Space' : e.key;

    setMapping(
      captureName,
      k.length === 1 ? k.toLowerCase() : k
    );
  }

  window.addEventListener(
    'keydown',
    captureKey,
    true
  );

  function keyCode(key) {
    if (key === 'Space' || key === ' ') {
      return 'Space';
    }

    if (/^Arrow(Up|Down|Left|Right)$/.test(key)) {
      return key;
    }

    if (/^[a-z]$/i.test(key)) {
      return 'Key' + key.toUpperCase();
    }

    if (/^[0-9]$/.test(key)) {
      return 'Digit' + key;
    }

    if (key === 'Shift') return 'ShiftLeft';
    if (key === 'Control') return 'ControlLeft';

    return key;
  }

  function emitKey(key, down) {
    const name = key === 'Space' ? ' ' : key;

    const evt = new KeyboardEvent(
      down ? 'keydown' : 'keyup',
      {
        key: name,
        code: keyCode(key),
        bubbles: true,
        cancelable: true,
        shiftKey: key === 'Shift',
        ctrlKey: key === 'Control'
      }
    );

    window.dispatchEvent(evt);
  }

  function mouseTarget() {
    const hit = document.elementFromPoint(
      aimX,
      aimY
    );

    return hit && hit !== host
      ? hit
      : document.body;
  }

  function emitMouse(button, down) {
    const target = down
      ? mouseTarget()
      : (pressedTargets[button] || mouseTarget());

    if (down) {
      pressedTargets[button] = target;
    }

    const props = {
      bubbles: true,
      cancelable: true,
      clientX: aimX,
      clientY: aimY,
      button: button,
      buttons: down
        ? (button === 0 ? 1 : 2)
        : 0
    };

    target.dispatchEvent(
      new MouseEvent(
        down ? 'mousedown' : 'mouseup',
        props
      )
    );

    if (!down) {
      if (button === 0) {
        target.dispatchEvent(
          new MouseEvent('click', props)
        );
      }

      delete pressedTargets[button];
    }
  }

  function output(out, down) {
    if (
      !out ||
      out === 'none' ||
      out === 'mouse-move'
    ) return;

    let count = held[out] || 0;

    if (down) {
      held[out] = count + 1;

      if (count) return;
    } else {
      if (!count) return;

      held[out] = count - 1;

      if (count !== 1) return;
    }

    if (
      out === 'mouse-left' ||
      out === 'mouse-right'
    ) {
      emitMouse(
        out === 'mouse-left' ? 0 : 2,
        down
      );
    } else {
      emitKey(out, down);
    }
  }

  function setPhysical(name, pressed) {
    pressed = Boolean(pressed);

    if (
      Boolean(physical[name]) === pressed
    ) return;

    physical[name] = pressed;

    output(mapping[name], pressed);
  }

  function releaseAll() {
    Object.keys(physical).forEach(name => {
      setPhysical(name, false);
    });

    Object.keys(held).forEach(out => {
      if (held[out]) {
        held[out] = 1;
        output(out, false);
      }
    });

    physical = {};
    held = {};
    pressedTargets = {};
  }

  function axis(v) {
    const d = v - 127;

    return Math.abs(d) < 24 ? 0 : d;
  }

  function moveAim(x, y) {
    if (
      mapping['Right aim'] !== 'mouse-move' ||
      (!x && !y) ||
      panelOpen
    ) return;

    aimX = Math.max(
      0,
      Math.min(innerWidth - 1, aimX + x * .10)
    );

    aimY = Math.max(
      0,
      Math.min(innerHeight - 1, aimY - y * .10)
    );

    cursorEl.style.left = aimX + 'px';
    cursorEl.style.top = aimY + 'px';
    cursorEl.hidden = false;

    const target = mouseTarget();

    target.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: aimX,
        clientY: aimY
      })
    );
  }

  function packet(p) {
    packets++;
    lastPacketAt = Date.now();

    const rx = axis(p[5]);
    const ry = axis(p[6]);
    const lx = axis(p[7]);
    const ly = axis(p[8]);

    setPhysical('Left ←', lx < 0);
    setPhysical('Left →', lx > 0);
    setPhysical('Left ↑', ly > 0);
    setPhysical('Left ↓', ly < 0);

    setPhysical('Right ←', rx < 0);
    setPhysical('Right →', rx > 0);
    setPhysical('Right ↑', ry > 0);
    setPhysical('Right ↓', ry < 0);

    Object.keys(BUTTONS).forEach(name => {
      const [index, mask] = BUTTONS[name];

      setPhysical(
        name,
        Boolean(p[index] & mask)
      );
    });

    moveAim(rx, ry);
  }

  function incoming(data) {
    for (const b of data) {
      buffer.push(b);
    }

    if (buffer.length > 4096) {
      buffer = buffer.slice(-256);
    }

    while (buffer.length >= 4) {
      if (
        buffer[0] !== 170 ||
        buffer[1] !== 85 ||
        buffer[2] !== 88 ||
        buffer[3] !== 19
      ) {
        buffer.shift();
        continue;
      }

      if (buffer.length < 23) break;

      packet(buffer.splice(0, 23));
    }
  }

  function sleep(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  async function readLoop() {
    try {
      reader = port.readable.getReader();

      while (active) {
        const result = await reader.read();

        if (result.done) break;

        if (result.value) {
          incoming(result.value);
        }
      }
    } catch (e) {
      if (active) {
        fail('Read error: ' + e.message);
      }
    } finally {
      if (reader) {
        try {
          reader.releaseLock();
        } catch (e) {}

        reader = null;
      }
    }
  }

  async function pollLoop() {
    try {
      while (active) {
        await writer.write(POLL);

        polls++;

        await sleep(100);
      }
    } catch (e) {
      if (active) {
        fail('Write error: ' + e.message);
      }
    }
  }

  function fail(message) {
    lastError = message;
    active = false;

    releaseAll();

    status(message, 'error');

    setTimeout(disconnect, 0);
  }

  async function connect() {
    if (
      active ||
      closing ||
      connecting
    ) return;

    if (!navigator.serial) {
      status(
        'Chrome/Edge and HTTPS are required.',
        'error'
      );
      return;
    }

    connecting = true;

    const btn = shadow.getElementById(
      'vex-connect'
    );

    btn.disabled = true;

    try {
      port = await navigator.serial.requestPort();

      const info = port.getInfo();

      if (
        info.usbVendorId !== 10376 ||
        info.usbProductId !== 528
      ) {
        status(
          'Select VEX IQ Communications Port.',
          'error'
        );

        port = null;
        return;
      }

      await port.open({
        baudRate: 115200
      });

      writer = port.writable.getWriter();

      buffer = [];
      lastPacketAt = 0;
      active = true;
      lastError = '';

      status(
        'VEX IQ connected',
        'connected'
      );

      shadow.getElementById(
        'vex-disconnect'
      ).disabled = false;

      readTask = readLoop();
      pollTask = pollLoop();

      switchPanel(false);

    } catch (e) {
      status(
        'Connection failed: ' + e.message,
        'error'
      );

      if (port && port.readable) {
        await disconnect();
      } else {
        port = null;
      }
    } finally {
      connecting = false;
      btn.disabled = active;
    }
  }

  async function disconnect() {
    if (closing) return;

    closing = true;
    active = false;

    releaseAll();

    try {
      if (reader) {
        await reader.cancel();
      }
    } catch (e) {}

    try {
      if (readTask) {
        await readTask;
      }
    } catch (e) {}

    readTask = null;

    try {
      if (pollTask) {
        await pollTask;
      }
    } catch (e) {}

    pollTask = null;

    try {
      if (writer) {
        writer.releaseLock();
      }
    } catch (e) {}

    writer = null;

    try {
      if (port) {
        await port.close();
      }
    } catch (e) {}

    port = null;
    closing = false;

    shadow.getElementById(
      'vex-connect'
    ).disabled = false;

    shadow.getElementById(
      'vex-disconnect'
    ).disabled = true;

    if (cursorEl) {
      cursorEl.hidden = true;
    }

    status(
      lastError || 'Not connected',
      lastError ? 'error' : ''
    );
  }

  function buildUI() {
    host = node(
      'div',
      '',
      null,
      document.body
    );

    host.id = 'vex-mapper-host';

    shadow = host.attachShadow({
      mode: 'open'
    });

    const style = node(
      'style',
      '',
      null,
      shadow
    );

    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        font-family:
          Inter, system-ui, Arial, sans-serif;
        color: #edf4ff;
      }

      * {
        box-sizing: border-box;
      }

      button {
        font: inherit;
        cursor: pointer;
      }

      .pill {
        display: flex;
        align-items: center;
        gap: 9px;
        background: #f6f9ff;
        color: #18273c;
        border: 1px solid #d7e2f2;
        border-radius: 999px;
        padding: 11px 16px;
        box-shadow: 0 9px 30px #0006;
        font-weight: 700;
        font-size: 13px;
      }

      .pill:hover {
        background: white;
        transform: translateY(-1px);
      }

      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #95a3b8;
      }

      .dot[data-kind="connected"] {
        background: #1fbf79;
        box-shadow: 0 0 0 3px #1fbf792a;
      }

      .dot[data-kind="error"] {
        background: #ef7979;
      }

      .dialog {
        position: absolute;
        bottom: 59px;
        right: 0;
        width: min(380px, calc(100vw - 24px));
        max-height: min(76vh, 700px);
        overflow: auto;
        background: #132238;
        border: 1px solid #3a526f;
        border-radius: 18px;
        box-shadow: 0 18px 55px #000a;
        padding: 19px;
      }

      [hidden] {
        display: none !important;
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .title {
        font-size: 19px;
        font-weight: 800;
        letter-spacing: -.3px;
      }

      .sub {
        font-size: 12px;
        color: #a6bad6;
        margin-top: 5px;
      }

      .close {
        background: transparent;
        color: #9eb4d0;
        border: 0;
        font-size: 23px;
        padding: 0 4px;
      }

      .state {
        margin: 17px 0;
        padding: 11px 12px;
        background: #1c304c;
        border-radius: 11px;
        font-size: 13px;
        color: #c9ddf8;
      }

      .state[data-kind="connected"] {
        color: #79ecc0;
      }

      .state[data-kind="error"] {
        color: #ffabac;
      }

      .buttons {
        display: flex;
        gap: 8px;
        margin-bottom: 14px;
      }

      .primary,
      .secondary {
        border: 0;
        border-radius: 9px;
        padding: 10px 14px;
        font-weight: 700;
        font-size: 13px;
      }

      .primary {
        background: #6d9aff;
        color: #07162b;
        flex: 1;
      }

      .secondary {
        background: #30435f;
        color: #e1ecff;
      }

      button:disabled {
        opacity: .4;
        cursor: default;
      }

      .section {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid #2d425d;
        padding-top: 14px;
        margin-top: 14px;
      }

      .section b {
        font-size: 13px;
      }

      .tiny {
        color: #95aac7;
        font-size: 11px;
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid #20344d;
      }

      .row span {
        font-size: 12px;
        color: #dce8f8;
      }

      .map {
        min-width: 118px;
        max-width: 145px;
        border: 1px solid #4d6483;
        border-radius: 8px;
        color: #eaf3ff;
        background: #253a56;
        padding: 7px;
        font-size: 12px;
      }

      .map:hover,
      .map.listening {
        border-color: #86c5ff;
        background: #365579;
      }

      .tools {
        display: flex;
        gap: 6px;
        margin: 11px 0;
      }

      .tool {
        flex: 1;
        border: 1px solid #3c5875;
        background: #20354e;
        color: #cadbf2;
        border-radius: 8px;
        padding: 8px 3px;
        font-size: 11px;
      }

      .help {
        font-size: 11px;
        color: #9ab1ce;
        line-height: 1.55;
        margin: 10px 0;
      }

      .banner {
        background: #334e70;
        border: 1px solid #78b1ff;
        padding: 11px;
        border-radius: 9px;
        font-size: 12px;
        line-height: 1.5;
      }

      @media (max-width: 460px) {
        :host {
          right: 12px;
          bottom: 12px;
        }

        .dialog {
          max-height: 75vh;
        }
      }
    `;

    // Small controller button

    pill = node(
      'button',
      'pill',
      null,
      shadow
    );

    pill.type = 'button';

    pill.setAttribute(
      'aria-expanded',
      'false'
    );

    pillDot = node(
      'span',
      'dot',
      null,
      pill
    );

    node('span', '', '🎮', pill);

    pillText = node(
      'span',
      '',
      '+ Add Controller',
      pill
    );

    pill.addEventListener('click', () => {
      switchPanel(!panelOpen);
    });

    // Settings window

    dialog = node(
      'section',
      'dialog',
      null,
      shadow
    );

    dialog.hidden = true;

    const head = node(
      'div',
      'head',
      null,
      dialog
    );

    const header = node(
      'div',
      '',
      null,
      head
    );

    node(
      'div',
      'title',
      'Controller settings',
      header
    );

    node(
      'div',
      'sub',
      'VEX IQ 2nd Gen · Build ' + VERSION,
      header
    );

    const close = node(
      'button',
      'close',
      '×',
      head
    );

    close.type = 'button';

    close.setAttribute(
      'aria-label',
      'Close settings'
    );

    close.addEventListener('click', () => {
      switchPanel(false);
    });

    statusEl = node(
      'div',
      'state',
      'Not connected',
      dialog
    );

    const connectRow = node(
      'div',
      'buttons',
      null,
      dialog
    );

    const connectBtn = node(
      'button',
      'primary',
      'Connect VEX IQ',
      connectRow
    );

    connectBtn.id = 'vex-connect';
    connectBtn.onclick = connect;

    const disconnectBtn = node(
      'button',
      'secondary',
      'Disconnect',
      connectRow
    );

    disconnectBtn.id = 'vex-disconnect';
    disconnectBtn.disabled = true;
    disconnectBtn.onclick = disconnect;

    node(
      'div',
      'help',
      'Choose Communications Port. ' +
      'Settings save automatically for this game.',
      dialog
    );

    const section = node(
      'div',
      'section',
      null,
      dialog
    );

    node(
      'b',
      '',
      'Button mapping',
      section
    );

    node(
      'span',
      'tiny',
      'Click to reassign',
      section
    );

    captureBanner = node(
      'div',
      'banner',
      'Press a key',
      dialog
    );

    captureBanner.hidden = true;

    rowsEl = node(
      'div',
      '',
      null,
      dialog
    );

    Object.keys(defaults)
      .filter(name => name !== 'Right aim')
      .forEach(name => {

        const row = node(
          'div',
          'row',
          null,
          rowsEl
        );

        node(
          'span',
          '',
          name,
          row
        );

        const btn = node(
          'button',
          'map',
          displayOutput(mapping[name]),
          row
        );

        selectors[name] = btn;

        btn.onclick = () => showCapture(name);
      });

    const aimRow = node(
      'div',
      'row',
      null,
      dialog
    );

    node(
      'span',
      '',
      'Right stick → mouse aim',
      aimRow
    );

    const aimBtn = node(
      'button',
      'map',
      null,
      aimRow
    );

    aimBtn.id = 'vex-aim';

    aimBtn.onclick = () => {
      releaseAll();

      mapping['Right aim'] =
        mapping['Right aim'] === 'mouse-move'
          ? 'none'
          : 'mouse-move';

      save();
      updateRows();
    };

    // Mouse mapping tools

    const tools = node(
      'div',
      'tools',
      null,
      dialog
    );

    const mouseL = node(
      'button',
      'tool',
      'Left click',
      tools
    );

    const mouseR = node(
      'button',
      'tool',
      'Right click',
      tools
    );

    const clear = node(
      'button',
      'tool',
      'Unassign',
      tools
    );

    mouseL.onclick = () => {
      if (captureName) {
        setMapping(captureName, 'mouse-left');
      }
    };

    mouseR.onclick = () => {
      if (captureName) {
        setMapping(captureName, 'mouse-right');
      }
    };

    clear.onclick = () => {
      if (captureName) {
        setMapping(captureName, 'none');
      }
    };

    node(
      'div',
      'help',
      'To set mouse clicks: choose a button above, ' +
      'then Left click or Right click. ' +
      'Esc cancels keyboard capture.',
      dialog
    );

    // Reset mappings

    const reset = node(
      'button',
      'secondary',
      'Reset to defaults',
      dialog
    );

    reset.onclick = () => {
      releaseAll();

      mapping = Object.assign({}, defaults);

      save();
      stopCapture();
      updateRows();
    };

    // Copy diagnostic

    const copy = node(
      'button',
      'secondary',
      'Copy diagnostic',
      dialog
    );

    copy.style.marginLeft = '8px';

    copy.onclick = async () => {
      const report = [
        'VEX IQ Game Mapper',
        'Build Version: ' + VERSION,
        'Status: ' + (
          active ? 'Connected' : 'Disconnected'
        ),
        'Packets: ' + packets,
        'Polls sent: ' + polls,
        'Last packet age: ' + (
          lastPacketAt
            ? Date.now() - lastPacketAt + ' ms'
            : 'none'
        ),
        'Last error: ' + (lastError || 'none'),
        'Mappings: ' + JSON.stringify(mapping)
      ].join('\n');

      try {
        await navigator.clipboard.writeText(report);
        copy.textContent = 'Copied!';
      } catch (e) {
        copy.textContent = 'Copy failed';
      }

      setTimeout(() => {
        copy.textContent = 'Copy diagnostic';
      }, 1200);
    };

    // Virtual cursor

    cursorEl = node(
      'div',
      '',
      null,
      document.body
    );

    cursorEl.hidden = true;

    cursorEl.style.cssText =
      'position:fixed;' +
      'width:17px;height:17px;' +
      'pointer-events:none;' +
      'border:2px solid #61ffc2;' +
      'border-radius:50%;' +
      'transform:translate(-50%,-50%);' +
      'z-index:2147483645;' +
      'box-shadow:0 0 0 2px #091522';

    updateRows();
    status('Not connected', '');

    setInterval(() => {
      if (
        active &&
        lastPacketAt &&
        Date.now() - lastPacketAt > 1800
      ) {
        status(
          'Connected, but no recent data',
          'error'
        );

        releaseAll();

      } else if (active) {
        status(
          'VEX IQ connected',
          'connected'
        );
      }
    }, 400);
  }

  window.addEventListener(
    'blur',
    () => releaseAll()
  );

  window.addEventListener(
    'beforeunload',
    () => {
      active = false;
      releaseAll();
    }
  );

  window.VEXMapper = {
    version: VERSION,
    connect,
    disconnect
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      buildUI,
      {once:true}
    );
  } else {
    buildUI();
  }

})();
