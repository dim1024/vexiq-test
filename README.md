# 🎮 VEX IQ Game Controller — Setup Guide

Add VEX IQ 2nd Generation Controller support to your HTML/JavaScript game without changing your existing game code.

### 1. Add the Controller Script

Open your game's `index.html` file and paste the following code **right before `</body>`**:

```html
<script>
(function () {
  const script = document.createElement("script");
  script.src =
    "https://dim1024.github.io/vex-game-adapter/vex-controller.js?v=" +
    Date.now();
  document.body.appendChild(script);
})();
</script>
```

### 2. Connect Your Controller

1. Connect your **VEX IQ 2nd Generation Controller** to your computer using USB-C.
2. Click **+ Add Controller**.
3. Select **Connect VEX IQ**.
4. Choose **VEX Robotics IQ Controller – VEX Robotics Communications Port** from the device list and click **Connect**.

### 3. Customize Controls

- Click any controller button assignment and press the desired keyboard key.
- Assign mouse clicks when needed.
- Adjust **Mouse speed** for the right joystick.
- Settings are automatically saved for each game.
- Close the settings window and start playing!

### Automatic Updates

The adapter loads its latest published version whenever the game opens. You do not need to copy or update `vex-controller.js` in individual game repositories.

**Note:** Games must support compatible keyboard or mouse events. Some games may require additional integration.
