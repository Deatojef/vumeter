# VUMeter

A reusable vanilla JavaScript class that renders a vintage analog VU meter resembling old radio test equipment. Visualizes decibel levels for incoming audio or data with realistic needle ballistics.

**[Live Demo](https://deatojef.github.io/vumeter/)**

---

## Installation

Copy `VUMeter.js` and `VUMeter.css` from `www/` into your project, then include them in your HTML:

```html
<link rel="stylesheet" href="VUMeter.css">
<script src="VUMeter.js"></script>
```

No build step, no dependencies, no frameworks.

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="VUMeter.css">
</head>
<body>
  <div id="my-meter" style="width: 300px;"></div>

  <script src="VUMeter.js"></script>
  <script>
    const meter = new VUMeter(document.getElementById('my-meter'));
    meter.setValue(-12);   // feed a dB value to the meter
  </script>
</body>
</html>
```

---

## Constructor

```js
const meter = new VUMeter(containerElement, options);
```

`containerElement` is any DOM element. The meter appends its SVG inside it automatically.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `width` | number | `300` | SVG `width` attribute in px. Set to `null` to let CSS control width. |
| `height` | number | `200` | SVG `height` attribute in px. |
| `dbMin` | number | `-20` | dB value at the needle's leftmost (rest) position on the visual scale. |
| `dbMax` | number | `3` | dB value at the needle's rightmost (full-scale) position. |
| `noiseFloor` | number | `-20` | Input dB at or below which the needle pins at the left. See [noiseFloor explained](#noisefloor-explained). |
| `ballistics` | boolean | `true` | Enable needle inertia simulation. Set to `false` for instant response. |
| `attackTime` | number | `300` | Milliseconds for the needle to rise toward a higher target value. |
| `releaseTime` | number | `300` | Milliseconds for the needle to fall toward a lower target value. |
| `label` | string | `'VU'` | Large text on the meter face. Set to `''` to hide. |
| `brand` | string | `'MODEL 300'` | Small secondary label beneath `label`. |
| `showLight` | boolean | `true` | Show or hide the CLIP indicator jewel light. |
| `onClip` | function | `null` | Callback fired when the needle crosses the clip threshold. |
| `onClipRelease` | function | `null` | Callback fired when the needle falls back to or below the clip threshold. |
| `clipThreshold` | number | `0` | dB value above which the CLIP jewel lights and `onClip` fires. |
| `autoRange` | boolean | `false` | Dynamically adapt `dbMin`/`dbMax` from incoming data. Expands immediately on new peaks; contracts at ≤1 dB/s when signal quiets. |
| `autoRangeWindow` | number | `30` | Seconds of sample history used to compute the observed signal range. |
| `autoRangeMargin` | number | `2` | dB of padding added beyond the observed min/max edges. |
| `showPeak` | boolean | `false` | Show a blue secondary needle that holds at the peak level, then decays. |
| `peakColor` | string | `'#5599ff'` | Stroke/fill color of the peak hold needle. |
| `peakAttackTime` | number | `50` | Milliseconds for the peak needle to rise to a new high. |
| `peakHoldTime` | number | `2000` | Milliseconds the peak needle holds at its highest value before decaying. |
| `peakDecayTime` | number | `1500` | Milliseconds for the peak needle to fall full-scale after the hold expires. |
| `scalePreset` | string | `null` | `'smeter'` renders S1–S9, +10, +20, +40, +60 dB labels for ham radio use. |

---

## Methods

| Method | Description |
|---|---|
| `setValue(db)` | Feed a dB value. Primary input API. Applies `noiseFloor` remapping then ballistics. |
| `setAmplitude(amp)` | Feed a linear amplitude (0.0–1.0). Converts via `20 * log10(amp)` and calls `setValue()`. |
| `getValue()` | Returns the current displayed dB value after ballistics (not the raw target). |
| `setRange(min, max)` | Recalibrate `dbMin`/`dbMax` at runtime and rebuild the scale immediately. |
| `resetRange()` | Clear auto-range sample history and restore the original constructor `dbMin`/`dbMax`. |
| `setOptions(opts)` | Merge new options into the instance. Rebuilds the scale when `clipThreshold`, `scalePreset`, `label`, or `brand` change. |
| `pause()` | Suspend the animation loop (`requestAnimationFrame`). Use when the meter is off-screen to save CPU. |
| `resume()` | Resume the animation loop after `pause()`. |
| `destroy()` | Stop animation, remove the SVG from the DOM, and detach all event listeners. |

> **Note:** The meter automatically pauses when the browser tab is hidden (`visibilitychange`) and resumes when the tab becomes visible again.

---

## noiseFloor Explained

Real audio signals have a noise floor — a level below which the source is effectively silent. Raw dBFS values from an `AnalyserNode` often sit at −90 dB or lower when quiet, but a VU meter should show the needle at rest (far left) during silence, not bouncing around near the bottom of the scale.

The `noiseFloor` option remaps your raw input onto the visual scale:

- Any input at or below `noiseFloor` → needle pins at the left rest position (`dbMin`).
- Input between `noiseFloor` and `dbMax` is linearly remapped to the full visual range `[dbMin, dbMax]`.

**Example:** With defaults (`noiseFloor: -20`, `dbMin: -20`, `dbMax: 3`):

| Raw input (dBFS) | Needle position |
|---|---|
| −60 or lower | Left rest (−20 VU) |
| −20 | Left rest (−20 VU) |
| −8.5 | Mid-scale (≈ −10 VU) |
| 0 | Near full-scale (≈ 0 VU) |
| +3 | Full scale (+3 VU) |

To disable the remapping so raw dB values map directly to the scale, set `noiseFloor` equal to `dbMin`:

```js
new VUMeter(el, { noiseFloor: -20, dbMin: -20 });
```

---

## Responsive Sizing

Set `width` and `height` options to `null` and size the container with CSS. The SVG uses a fixed `viewBox="0 0 300 200"` and scales to fill whatever space its container provides.

```html
<div id="meter" style="width: 100%; max-width: 500px;"></div>

<script>
  new VUMeter(document.getElementById('meter'), {
    width: null,
    height: null,
  });
</script>
```

---

## Multiple Instances

Each instance generates a unique internal ID (`uid`) for its SVG gradient and filter definitions. Multiple meters on the same page will never have ID collisions.

```js
const meterL = new VUMeter(document.getElementById('ch-left'),  { brand: 'CH. L' });
const meterR = new VUMeter(document.getElementById('ch-right'), { brand: 'CH. R' });

// Feed them independently
meterL.setValue(-9);
meterR.setValue(-14);
```

---

## Web Audio API Example

Use `setAmplitude()` to connect a meter directly to a Web Audio `AnalyserNode`:

```js
const audioCtx = new AudioContext();
const analyser  = audioCtx.createAnalyser();
analyser.fftSize = 256;

// Route your audio source through the analyser
const source = audioCtx.createMediaStreamSource(micStream);
source.connect(analyser);

const meter  = new VUMeter(document.getElementById('meter'));
const buffer = new Float32Array(analyser.fftSize);

function poll() {
  analyser.getFloatTimeDomainData(buffer);

  // Compute RMS amplitude
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);

  meter.setAmplitude(rms);  // converts to dB internally
  requestAnimationFrame(poll);
}

poll();
```

---

## Callbacks

`onClip` fires when the needle crosses above 0 VU. `onClipRelease` fires when it returns to 0 VU or below.

```js
const meter = new VUMeter(document.getElementById('meter'), {
  onClip: function () {
    console.warn('Signal is clipping!');
    document.getElementById('clip-warning').hidden = false;
  },
  onClipRelease: function () {
    document.getElementById('clip-warning').hidden = true;
  },
});
```

The wrapper element also receives the CSS class `vu-meter--clipping` while clipping, so you can style it from a stylesheet:

```css
.vu-meter--clipping {
  outline: 2px solid red;
}
```

---

## S-meter (ham radio signal strength)

The `'smeter'` preset replaces the standard VU scale with ITU S-unit labels (S1–S9, +10, +20, +40, +60 dB) suitable for SDR and amateur radio applications.

```js
const meter = new VUMeter(document.getElementById('sig-meter'), {
    scalePreset:   'smeter',
    dbMin:         -121,   // S1  (noise floor)
    dbMax:         -13,    // S9 +60 dB
    noiseFloor:    -121,   // direct dBm passthrough
    clipThreshold: -53,    // S9 +20 dB — jewel lights above here
    label:         'SIG',
    brand:         '14.205 MHz',
    showPeak:      true,
});

// Feed raw dBm values directly from ka9q-radio or similar:
meter.setValue(-87);  // ≈ S7
```

S-unit reference (HF, 50 Ω, ITU):

| Label | dBm  |
|-------|------|
| S1    | −121 |
| S2    | −115 |
| S3    | −109 |
| S4    | −103 |
| S5    | −97  |
| S6    | −91  |
| S7    | −85  |
| S8    | −79  |
| S9    | −73  |
| S9+10 | −63  |
| S9+20 | −53  |
| S9+40 | −33  |
| S9+60 | −13  |

---

## Peak Hold

Enable a blue secondary needle that freezes at the highest recent value and then decays:

```js
const meter = new VUMeter(el, {
    showPeak:      true,
    peakColor:     '#5599ff',
    peakHoldTime:  3000,   // hold for 3 seconds
    peakDecayTime: 2000,   // then fall over 2 seconds
});
```

---

## Dynamic Range (auto-ranging)

Feed signals of unknown range and let the meter adapt its scale:

```js
const meter = new VUMeter(el, {
    autoRange:       true,
    autoRangeWindow: 30,   // look at last 30 s of data
    autoRangeMargin: 3,    // pad ±3 dB beyond observed edges
});

// Range expands immediately when a new extreme is seen;
// contracts slowly (≤1 dB/s) when the signal quiets.

// Reset to original dbMin/dbMax at any time:
meter.resetRange();
```

You can also recalibrate manually at any time:

```js
meter.setRange(-60, 0);  // rebuilds the scale face immediately
```

---

## License

GPL v3 — see [LICENSE](LICENSE).
