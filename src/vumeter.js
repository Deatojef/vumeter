/**
 * VUMeter.js
 * Reusable vintage analog VU meter rendered in SVG.
 * GPL v3 — https://github.com/Deatojef/vumeter
 *
 * @version 1.0.0
 *
 * Usage:
 *   const meter = new VUMeter(document.getElementById('my-meter'), options);
 *   meter.setValue(-6);       // feed a dB value
 *   meter.setAmplitude(0.5);  // or a linear 0–1 amplitude
 *   meter.destroy();          // clean up when done
 */

class VUMeter {

    // ─── Constants ──────────────────────────────────────────────────────────

    static VERSION = '1.0.0';

    static DEFAULTS = {
        width:           300,
        height:          200,
        dbMin:           -20,
        dbMax:           3,
        noiseFloor:      -20,   // input dB ≤ noiseFloor → needle rests at left
        ballistics:      true,
        attackTime:      300,   // ms
        releaseTime:     300,   // ms
        label:           'VU',
        brand:           'MODEL 300',
        showLight:       true,
        onClip:          null,
        onClipRelease:   null,
        clipThreshold:   0,     // dB above which clip indicator fires
        autoRange:       false, // dynamically adapt dbMin/dbMax from data
        autoRangeWindow: 30,    // seconds of sample history
        autoRangeMargin: 2,     // dB of padding beyond observed signal edges
        showPeak:        false, // show blue peak-hold secondary needle
        peakColor:       '#5599ff',
        peakAttackTime:  50,    // ms — peak needle rise time
        peakHoldTime:    2000,  // ms — hold before decay
        peakDecayTime:   1500,  // ms — decay duration after hold
        scalePreset:     null,  // null | 'smeter'
    };

    // S-unit definitions (HF, ITU standard, dBm)
    static SMETER_TICKS = [
        { db: -121, label: 'S1' },
        { db: -115, label: 'S2' },
        { db: -109, label: 'S3' },
        { db: -103, label: 'S4' },
        { db:  -97, label: 'S5' },
        { db:  -91, label: 'S6' },
        { db:  -85, label: 'S7' },
        { db:  -79, label: 'S8' },
        { db:  -73, label: 'S9' },
        { db:  -63, label: '+10' },
        { db:  -53, label: '+20' },
        { db:  -33, label: '+40' },
        { db:  -13, label: '+60' },
    ];

    // SVG coordinate constants
    static CX        = 150;   // pivot x
    static CY        = 175;   // pivot y
    static ARC_R     = 140;   // outer arc radius
    static TIP_LEN   = 152;   // needle tip length from pivot
    static TAIL_LEN  = 28;    // counterweight tail length
    static SWEEP     = 100;   // degrees of total arc sweep
    static ANGLE_MIN = 220;   // SVG degrees at dbMin position

    // ─── Construction ───────────────────────────────────────────────────────

    constructor(container, options = {}) {
        this._container = container;
        this._options   = Object.assign({}, VUMeter.DEFAULTS, options);
        this._uid       = 'vu' + Math.random().toString(36).slice(2, 7);

        // Store initial range for resetRange()
        this._initDbMin = this._options.dbMin;
        this._initDbMax = this._options.dbMax;

        this._targetDb  = this._options.dbMin;
        this._currentDb = this._options.dbMin;
        this._clipping  = false;
        this._paused    = false;
        this._rafId     = null;
        this._lastTime  = null;

        // Auto-range state
        this._rangeSamples       = [];
        this._autoRangeTargetMin = this._options.dbMin;
        this._autoRangeTargetMax = this._options.dbMax;
        this._lastRebuiltDbMin   = this._options.dbMin;
        this._lastRebuiltDbMax   = this._options.dbMax;

        // Peak hold state
        this._peakDb        = this._options.dbMin;
        this._peakVisualDb  = this._options.dbMin;
        this._peakHoldUntil = 0;      // 0 = no active hold
        this._peakDecaying  = false;

        // Bound handlers for cleanup
        this._onVisibility = () => {
            if (document.hidden) this.pause();
            else this.resume();
        };

        this._build();
        this._startAnimation();
        document.addEventListener('visibilitychange', this._onVisibility);
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    setValue(db) {
        const opts = this._options;

        // Auto-range: track raw dB samples and expand range if needed
        if (opts.autoRange) {
            const now    = Date.now();
            const cutoff = now - opts.autoRangeWindow * 1000;

            this._rangeSamples.push({ db, t: now });
            this._rangeSamples = this._rangeSamples.filter(s => s.t >= cutoff);

            if (this._rangeSamples.length > 0) {
                const dbs         = this._rangeSamples.map(s => s.db);
                const observedMin = Math.min(...dbs);
                const observedMax = Math.max(...dbs);
                const newMin      = observedMin - opts.autoRangeMargin;
                const newMax      = observedMax + opts.autoRangeMargin;

                // Store contraction targets for rate-limited shrink in _animate()
                this._autoRangeTargetMin = newMin;
                this._autoRangeTargetMax = newMax;

                // Expansion: immediate — only expand, never contract here
                let expandMin   = opts.dbMin;
                let expandMax   = opts.dbMax;
                let needsExpand = false;
                if (newMin < opts.dbMin) { expandMin = newMin; needsExpand = true; }
                if (newMax > opts.dbMax) { expandMax = newMax; needsExpand = true; }
                if (needsExpand) this.setRange(expandMin, expandMax);
            }
        }

        const { dbMin, dbMax, noiseFloor } = opts;

        // Map [noiseFloor, dbMax] → [dbMin, dbMax]
        let mapped;
        if (db <= noiseFloor) {
            mapped = dbMin;
        } else {
            mapped = dbMin + (db - noiseFloor) / (dbMax - noiseFloor) * (dbMax - dbMin);
        }
        this._targetDb = Math.max(dbMin, Math.min(dbMax + 1, mapped));
    }

    setAmplitude(amp) {
        if (amp <= 0) {
            this.setValue(-Infinity);
        } else {
            this.setValue(20 * Math.log10(amp));
        }
    }

    getValue() {
        return this._currentDb;
    }

    setRange(dbMin, dbMax) {
        this._options.dbMin = dbMin;
        this._options.dbMax = dbMax;
        this._targetDb  = Math.max(dbMin, Math.min(dbMax, this._targetDb));
        this._currentDb = Math.max(dbMin, Math.min(dbMax, this._currentDb));
        this._rebuildScale();
        this._lastRebuiltDbMin = dbMin;
        this._lastRebuiltDbMax = dbMax;
    }

    resetRange() {
        this._rangeSamples       = [];
        this._autoRangeTargetMin = this._initDbMin;
        this._autoRangeTargetMax = this._initDbMax;
        this._options.dbMin      = this._initDbMin;
        this._options.dbMax      = this._initDbMax;
        this._rebuildScale();
        this._lastRebuiltDbMin   = this._initDbMin;
        this._lastRebuiltDbMax   = this._initDbMax;
    }

    setOptions(opts) {
        const needsRebuild = 'clipThreshold' in opts || 'scalePreset' in opts
                           || 'label' in opts || 'brand' in opts;
        Object.assign(this._options, opts);
        if (needsRebuild) this._rebuildScale();
    }

    pause() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._paused = true;
    }

    resume() {
        if (this._paused) {
            this._paused = false;
            this._lastTime = null;
            this._rafId = requestAnimationFrame(ts => this._animate(ts));
        }
    }

    destroy() {
        this.pause();
        document.removeEventListener('visibilitychange', this._onVisibility);
        if (this._svg && this._svg.parentNode) {
            this._svg.parentNode.removeChild(this._svg);
        }
        this._svg = null;
    }

    // ─── Build ──────────────────────────────────────────────────────────────

    _build() {
        const { width, height } = this._options;
        const ns  = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 300 200');
        svg.setAttribute('xmlns', ns);
        if (width)  svg.setAttribute('width',  width);
        if (height) svg.setAttribute('height', height);
        svg.setAttribute('aria-label', 'VU Meter');
        svg.setAttribute('role', 'img');

        this._svg = svg;
        this._ns  = ns;

        // Add wrapper div for CSS scoping
        const wrapper = document.createElement('div');
        wrapper.className = 'vu-meter';
        wrapper.appendChild(svg);
        this._wrapper = wrapper;
        this._container.appendChild(wrapper);

        this._buildDefs();
        this._buildHousing();
        this._buildFace();

        // Rebuildable scale group — sits between face and needle layers
        this._scaleGroup = document.createElementNS(ns, 'g');
        this._scaleGroup.setAttribute('id', 'vu-scale-' + this._uid);
        this._svg.appendChild(this._scaleGroup);
        this._buildScale();
        this._buildBranding();

        this._buildNeedle();
        this._buildPivot();
        this._buildBezel();
        this._buildLight();
        this._buildGlass();
    }

    _el(tag, attrs = {}) {
        const el = document.createElementNS(this._ns, tag);
        for (const [k, v] of Object.entries(attrs)) {
            el.setAttribute(k, v);
        }
        this._svg.appendChild(el);
        return el;
    }

    _elIn(parent, tag, attrs = {}) {
        const el = document.createElementNS(this._ns, tag);
        for (const [k, v] of Object.entries(attrs)) {
            el.setAttribute(k, v);
        }
        parent.appendChild(el);
        return el;
    }

    _rebuildScale() {
        // Remove all children from scale group
        while (this._scaleGroup.firstChild) {
            this._scaleGroup.removeChild(this._scaleGroup.firstChild);
        }
        this._buildScale();
        this._buildBranding();
    }

    _buildDefs() {
        const uid  = this._uid;
        const defs = document.createElementNS(this._ns, 'defs');
        this._svg.appendChild(defs);

        // Glass gradient (top → bottom, white highlight fading to subtle dark)
        const glassGrad = this._elIn(defs, 'linearGradient', {
            id: uid + '-glass',
            x1: '0', y1: '0', x2: '0', y2: '1',
            gradientUnits: 'objectBoundingBox',
        });
        this._elIn(glassGrad, 'stop', { offset: '0%',   'stop-color': 'white', 'stop-opacity': '0.18' });
        this._elIn(glassGrad, 'stop', { offset: '45%',  'stop-color': 'white', 'stop-opacity': '0.04' });
        this._elIn(glassGrad, 'stop', { offset: '100%', 'stop-color': 'black', 'stop-opacity': '0.07' });

        // Jewel light — off gradient (dark amber)
        const jewelOff = this._elIn(defs, 'radialGradient', {
            id: uid + '-jewel-off',
            cx: '40%', cy: '35%', r: '60%',
        });
        this._elIn(jewelOff, 'stop', { offset: '0%',   'stop-color': '#7a3800', 'stop-opacity': '1' });
        this._elIn(jewelOff, 'stop', { offset: '100%', 'stop-color': '#2a1000', 'stop-opacity': '1' });

        // Jewel light — on gradient (red glow)
        const jewelOn = this._elIn(defs, 'radialGradient', {
            id: uid + '-jewel-on',
            cx: '40%', cy: '35%', r: '60%',
        });
        this._elIn(jewelOn, 'stop', { offset: '0%',   'stop-color': '#ff8060', 'stop-opacity': '1' });
        this._elIn(jewelOn, 'stop', { offset: '60%',  'stop-color': '#dd2200', 'stop-opacity': '1' });
        this._elIn(jewelOn, 'stop', { offset: '100%', 'stop-color': '#880000', 'stop-opacity': '1' });

        // Housing gradient (top-lit brushed appearance)
        const housingGrad = this._elIn(defs, 'linearGradient', {
            id: uid + '-housing',
            x1: '0', y1: '0', x2: '0', y2: '1',
        });
        this._elIn(housingGrad, 'stop', { offset: '0%',   'stop-color': '#383838' });
        this._elIn(housingGrad, 'stop', { offset: '100%', 'stop-color': '#1a1a1a' });

        // Face subtle gradient (slight warm vignette)
        const faceGrad = this._elIn(defs, 'radialGradient', {
            id: uid + '-face',
            cx: '50%', cy: '40%', r: '65%',
            gradientUnits: 'objectBoundingBox',
        });
        this._elIn(faceGrad, 'stop', { offset: '0%',   'stop-color': '#faf4de' });
        this._elIn(faceGrad, 'stop', { offset: '100%', 'stop-color': '#e8dfc0' });
    }

    _buildHousing() {
        this._el('rect', {
            x: '0', y: '0', width: '300', height: '200',
            rx: '12', ry: '12',
            fill: `url(#${this._uid}-housing)`,
        });
    }

    _buildFace() {
        // Face panel
        this._el('rect', {
            x: '8', y: '8', width: '284', height: '155',
            rx: '5', ry: '5',
            fill: `url(#${this._uid}-face)`,
        });
        // Inset shadow — thin dark border inside face
        this._el('rect', {
            x: '8', y: '8', width: '284', height: '155',
            rx: '5', ry: '5',
            fill: 'none',
            stroke: '#b0a070',
            'stroke-width': '0.8',
            opacity: '0.6',
        });
    }

    // ─── Geometry helpers ────────────────────────────────────────────────────

    _dbToAngleDeg(db) {
        const { dbMin, dbMax } = this._options;
        return VUMeter.ANGLE_MIN + (db - dbMin) / (dbMax - dbMin) * VUMeter.SWEEP;
    }

    _angleToXY(angleDeg, radius) {
        const rad = angleDeg * Math.PI / 180;
        return {
            x: VUMeter.CX + radius * Math.cos(rad),
            y: VUMeter.CY + radius * Math.sin(rad),
        };
    }

    _arcPath(dbStart, dbEnd, r) {
        const a1  = this._dbToAngleDeg(dbStart) * Math.PI / 180;
        const a2  = this._dbToAngleDeg(dbEnd)   * Math.PI / 180;
        const x1  = (VUMeter.CX + r * Math.cos(a1)).toFixed(3);
        const y1  = (VUMeter.CY + r * Math.sin(a1)).toFixed(3);
        const x2  = (VUMeter.CX + r * Math.cos(a2)).toFixed(3);
        const y2  = (VUMeter.CY + r * Math.sin(a2)).toFixed(3);
        return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
    }

    // ─── Scale building ──────────────────────────────────────────────────────

    _buildScale() {
        const { dbMin, dbMax, clipThreshold, scalePreset } = this._options;
        const R = VUMeter.ARC_R;

        // Clamp clip threshold to visible range for arc boundaries
        const arcClip = Math.max(dbMin, Math.min(dbMax, clipThreshold));

        // Black arc: dbMin → clipThreshold
        if (arcClip > dbMin) {
            this._elIn(this._scaleGroup, 'path', {
                d:                this._arcPath(dbMin, arcClip, R),
                fill:             'none',
                stroke:           '#1a1a1a',
                'stroke-width':   '1.5',
                'stroke-linecap': 'round',
            });
        }

        // Red arc: clipThreshold → dbMax
        if (arcClip < dbMax) {
            this._elIn(this._scaleGroup, 'path', {
                d:                this._arcPath(arcClip, dbMax, R),
                fill:             'none',
                stroke:           '#cc2200',
                'stroke-width':   '2',
                'stroke-linecap': 'round',
            });
        }

        if (scalePreset === 'smeter') {
            this._buildSmeterScale();
        } else {
            this._buildDefaultScale();
        }
    }

    _buildDefaultScale() {
        const { dbMin, dbMax, clipThreshold } = this._options;
        const R = VUMeter.ARC_R;

        // Standard VU major tick positions, filtered to visible range
        const allMajorTicks = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
        const majorTicks    = allMajorTicks.filter(d => d >= dbMin && d <= dbMax);
        const majorSet      = new Set(majorTicks);

        // 1 dB minor ticks across the whole range
        const startTick = Math.ceil(dbMin);
        for (let d = startTick; d <= dbMax; d++) {
            const isMajor  = majorSet.has(d);
            const isRed    = d > clipThreshold;
            const angleDeg = this._dbToAngleDeg(d);
            const r_inner  = isMajor ? R - 25 : R - 15;
            const outer    = this._angleToXY(angleDeg, R);
            const inner    = this._angleToXY(angleDeg, r_inner);

            this._elIn(this._scaleGroup, 'line', {
                x1: outer.x.toFixed(3), y1: outer.y.toFixed(3),
                x2: inner.x.toFixed(3), y2: inner.y.toFixed(3),
                stroke:           isRed ? '#cc2200' : '#1a1a1a',
                'stroke-width':   isMajor ? '1.4' : '0.8',
                'stroke-linecap': 'round',
            });
        }

        // Labels for major ticks
        const R_label = R - 35;
        for (const d of majorTicks) {
            const angleDeg = this._dbToAngleDeg(d);
            const pos      = this._angleToXY(angleDeg, R_label);
            const isRed    = d > clipThreshold;
            const label    = d > 0 ? `+${d}` : `${d}`;

            const txt = this._elIn(this._scaleGroup, 'text', {
                x:                   pos.x.toFixed(3),
                y:                   pos.y.toFixed(3),
                'text-anchor':       'middle',
                'dominant-baseline': 'middle',
                'font-size':         d === -20 || d === -10 ? '7.5' : '8.5',
                'font-family':       'Georgia, Times New Roman, serif',
                fill:                isRed ? '#cc2200' : '#1a1a1a',
                'font-weight':       d === 0 ? 'bold' : 'normal',
            });
            txt.textContent = label;
        }
    }

    _buildSmeterScale() {
        const { dbMin, dbMax, clipThreshold } = this._options;
        const R       = VUMeter.ARC_R;
        const R_label = R - 35;

        // Filter S-unit tick definitions to the visible range
        const inRange  = VUMeter.SMETER_TICKS.filter(t => t.db >= dbMin && t.db <= dbMax);
        const majorSet = new Set(inRange.map(t => t.db));

        // 6 dB minor ticks — skip positions that are S-unit major ticks
        for (let d = dbMin; d <= dbMax; d += 6) {
            if (majorSet.has(d)) continue;
            const isRed    = d > clipThreshold;
            const angleDeg = this._dbToAngleDeg(d);
            const outer    = this._angleToXY(angleDeg, R);
            const inner    = this._angleToXY(angleDeg, R - 15);

            this._elIn(this._scaleGroup, 'line', {
                x1: outer.x.toFixed(3), y1: outer.y.toFixed(3),
                x2: inner.x.toFixed(3), y2: inner.y.toFixed(3),
                stroke:           isRed ? '#cc2200' : '#1a1a1a',
                'stroke-width':   '0.8',
                'stroke-linecap': 'round',
            });
        }

        // Major S-unit ticks and labels
        for (const { db, label } of inRange) {
            const isRed    = db > clipThreshold;
            const angleDeg = this._dbToAngleDeg(db);
            const outer    = this._angleToXY(angleDeg, R);
            const inner    = this._angleToXY(angleDeg, R - 25);
            const pos      = this._angleToXY(angleDeg, R_label);

            this._elIn(this._scaleGroup, 'line', {
                x1: outer.x.toFixed(3), y1: outer.y.toFixed(3),
                x2: inner.x.toFixed(3), y2: inner.y.toFixed(3),
                stroke:           isRed ? '#cc2200' : '#1a1a1a',
                'stroke-width':   '1.4',
                'stroke-linecap': 'round',
            });

            const isPlus = label.startsWith('+');
            const txt = this._elIn(this._scaleGroup, 'text', {
                x:                   pos.x.toFixed(3),
                y:                   pos.y.toFixed(3),
                'text-anchor':       'middle',
                'dominant-baseline': 'middle',
                'font-size':         isPlus ? '7' : '8',
                'font-family':       'Georgia, Times New Roman, serif',
                fill:                isRed ? '#cc2200' : '#1a1a1a',
                'font-weight':       label === 'S9' ? 'bold' : 'normal',
            });
            txt.textContent = label;
        }
    }

    _buildBranding() {
        const { label, brand } = this._options;

        if (label) {
            const vu = this._elIn(this._scaleGroup, 'text', {
                x: '150', y: '108',
                'text-anchor':       'middle',
                'dominant-baseline': 'middle',
                'font-size':         '20',
                'font-family':       'Georgia, Times New Roman, serif',
                'font-weight':       'bold',
                fill:                '#1a1a1a',
                'letter-spacing':    '5',
            });
            vu.textContent = label;
        }

        if (brand) {
            const br = this._elIn(this._scaleGroup, 'text', {
                x: '150', y: '120',
                'text-anchor':       'middle',
                'dominant-baseline': 'middle',
                'font-size':         '6.5',
                'font-family':       'Arial, Helvetica, sans-serif',
                fill:                '#666666',
                'letter-spacing':    '2',
            });
            br.textContent = brand.toUpperCase();
        }
    }

    _buildNeedle() {
        const startAngle = this._dbToAngleDeg(this._options.dbMin);
        const tip   = this._angleToXY(startAngle, VUMeter.TIP_LEN);
        const tail  = this._angleToXY(startAngle + 180, VUMeter.TAIL_LEN);

        this._needle = this._el('line', {
            x1: tail.x.toFixed(3), y1: tail.y.toFixed(3),
            x2: tip.x.toFixed(3),  y2: tip.y.toFixed(3),
            stroke:           '#111111',
            'stroke-width':   '1.2',
            'stroke-linecap': 'round',
        });

        // Counterweight ellipse at tail end
        this._counterweight = this._el('ellipse', {
            cx: tail.x.toFixed(3), cy: tail.y.toFixed(3),
            rx: '3.5', ry: '2.2',
            fill: '#333333',
        });
        this._counterweight.setAttribute(
            'transform',
            `rotate(${startAngle}, ${tail.x.toFixed(3)}, ${tail.y.toFixed(3)})`
        );

        // Peak hold needle — rendered after main needle so it draws on top
        if (this._options.showPeak) {
            const pc = this._options.peakColor;

            this._peakNeedle = this._el('line', {
                x1: tail.x.toFixed(3), y1: tail.y.toFixed(3),
                x2: tip.x.toFixed(3),  y2: tip.y.toFixed(3),
                stroke:           pc,
                'stroke-width':   '1.0',
                'stroke-linecap': 'round',
            });

            this._peakCounterweight = this._el('ellipse', {
                cx: tail.x.toFixed(3), cy: tail.y.toFixed(3),
                rx: '3.5', ry: '2.2',
                fill: pc,
            });
            this._peakCounterweight.setAttribute(
                'transform',
                `rotate(${startAngle}, ${tail.x.toFixed(3)}, ${tail.y.toFixed(3)})`
            );
        }
    }

    _buildPivot() {
        // Outer brushed aluminum ring
        this._el('circle', {
            cx: VUMeter.CX, cy: VUMeter.CY, r: '5',
            fill:           '#999999',
            stroke:         '#555555',
            'stroke-width': '0.6',
        });
        // Inner screw head dot
        this._el('circle', {
            cx: VUMeter.CX, cy: VUMeter.CY, r: '1.8',
            fill: '#2a2a2a',
        });
    }

    _buildBezel() {
        this._el('rect', {
            x: '6', y: '6', width: '288', height: '158',
            rx: '7', ry: '7',
            fill:           'none',
            stroke:         '#999999',
            'stroke-width': '1.2',
            opacity:        '0.7',
        });
        // Inner edge highlight (top-lit look)
        this._el('rect', {
            x: '7', y: '7', width: '286', height: '156',
            rx: '6.5', ry: '6.5',
            fill:           'none',
            stroke:         '#cccccc',
            'stroke-width': '0.4',
            opacity:        '0.35',
        });
    }

    _buildLight() {
        if (!this._options.showLight) return;

        // Light housing (dark ellipse ring)
        this._el('ellipse', {
            cx: '262', cy: '28',
            rx: '11', ry: '7',
            fill:           '#1a1a1a',
            stroke:         '#555',
            'stroke-width': '0.8',
        });

        // Jewel element — starts off
        this._light = this._el('ellipse', {
            cx: '262', cy: '28',
            rx: '8.5', ry: '5.5',
            fill: `url(#${this._uid}-jewel-off)`,
        });

        // Light glare dot
        this._el('ellipse', {
            cx: '259', cy: '26',
            rx: '2.5', ry: '1.5',
            fill:    'white',
            opacity: '0.25',
            'pointer-events': 'none',
        });

        // "CLIP" label
        const clipLabel = this._el('text', {
            x: '262', y: '39',
            'text-anchor':       'middle',
            'dominant-baseline': 'middle',
            'font-size':         '5',
            'font-family':       'Arial, Helvetica, sans-serif',
            fill:                '#888888',
            'letter-spacing':    '0.5',
        });
        clipLabel.textContent = 'CLIP';
    }

    _buildGlass() {
        this._el('rect', {
            x: '8', y: '8', width: '284', height: '155',
            rx: '5', ry: '5',
            fill:             `url(#${this._uid}-glass)`,
            'pointer-events': 'none',
        });
    }

    // ─── Animation ──────────────────────────────────────────────────────────

    _startAnimation() {
        this._paused = false;
        this._rafId = requestAnimationFrame(ts => this._animate(ts));
    }

    _animate(timestamp) {
        if (this._lastTime === null) {
            this._lastTime = timestamp;
        }

        const dt = Math.min(timestamp - this._lastTime, 100); // cap dt to 100 ms
        this._lastTime = timestamp;

        // Auto-range contraction: shrink toward observed target at ≤1 dB/s
        if (this._options.autoRange) {
            const maxChange = dt / 1000;
            const prevMin   = this._options.dbMin;
            const prevMax   = this._options.dbMax;

            if (this._options.dbMin < this._autoRangeTargetMin) {
                this._options.dbMin = Math.min(
                    this._options.dbMin + maxChange,
                    this._autoRangeTargetMin
                );
            }
            if (this._options.dbMax > this._autoRangeTargetMax) {
                this._options.dbMax = Math.max(
                    this._options.dbMax - maxChange,
                    this._autoRangeTargetMax
                );
            }

            // Rebuild scale once the range has drifted ≥1 dB from last rebuild
            if (Math.abs(this._options.dbMin - this._lastRebuiltDbMin) >= 1 ||
                Math.abs(this._options.dbMax - this._lastRebuiltDbMax) >= 1) {
                this._rebuildScale();
                this._lastRebuiltDbMin = this._options.dbMin;
                this._lastRebuiltDbMax = this._options.dbMax;
            }
        }

        // Main needle ballistics
        if (this._options.ballistics) {
            const diff = this._targetDb - this._currentDb;

            if (Math.abs(diff) < 0.005) {
                this._currentDb = this._targetDb;
            } else {
                const tau    = diff > 0 ? this._options.attackTime : this._options.releaseTime;
                const factor = 1 - Math.exp(-dt / tau);
                this._currentDb += diff * factor;
            }
        } else {
            this._currentDb = this._targetDb;
        }

        // Pin to scale limits
        const { dbMin, dbMax } = this._options;
        this._currentDb = Math.max(dbMin, Math.min(dbMax + 0.5, this._currentDb));

        this._updateNeedle(this._currentDb);
        this._updateClipState(this._currentDb);

        // Peak hold needle
        if (this._options.showPeak && this._peakNeedle) {
            const now = Date.now();

            // Capture new peak immediately
            if (this._targetDb > this._peakDb) {
                this._peakDb        = this._targetDb;
                this._peakHoldUntil = now + this._options.peakHoldTime;
                this._peakDecaying  = false;
            }

            // Expire hold period
            if (!this._peakDecaying && this._peakHoldUntil > 0 && now >= this._peakHoldUntil) {
                this._peakDecaying = true;
            }

            if (this._peakDecaying) {
                // Exponential decay toward dbMin
                const factor = 1 - Math.exp(-dt / this._options.peakDecayTime);
                this._peakVisualDb += (dbMin - this._peakVisualDb) * factor;

                if (this._peakVisualDb <= dbMin + 0.05) {
                    // Decay complete — reset
                    this._peakDb        = dbMin;
                    this._peakVisualDb  = dbMin;
                    this._peakDecaying  = false;
                    this._peakHoldUntil = 0;
                }
            } else {
                // Fast attack toward _peakDb
                const factor = 1 - Math.exp(-dt / this._options.peakAttackTime);
                this._peakVisualDb += (this._peakDb - this._peakVisualDb) * factor;
            }

            this._updatePeakNeedle(this._peakVisualDb);
        }

        this._rafId = requestAnimationFrame(ts => this._animate(ts));
    }

    _updateNeedle(db) {
        const angleDeg = this._dbToAngleDeg(db);
        const tip      = this._angleToXY(angleDeg, VUMeter.TIP_LEN);
        const tailDeg  = angleDeg + 180;
        const tail     = this._angleToXY(tailDeg, VUMeter.TAIL_LEN);

        this._needle.setAttribute('x1', tail.x.toFixed(2));
        this._needle.setAttribute('y1', tail.y.toFixed(2));
        this._needle.setAttribute('x2', tip.x.toFixed(2));
        this._needle.setAttribute('y2', tip.y.toFixed(2));

        this._counterweight.setAttribute('cx', tail.x.toFixed(2));
        this._counterweight.setAttribute('cy', tail.y.toFixed(2));
        this._counterweight.setAttribute(
            'transform',
            `rotate(${angleDeg.toFixed(2)}, ${tail.x.toFixed(2)}, ${tail.y.toFixed(2)})`
        );
    }

    _updatePeakNeedle(db) {
        const angleDeg = this._dbToAngleDeg(db);
        const tip      = this._angleToXY(angleDeg, VUMeter.TIP_LEN);
        const tailDeg  = angleDeg + 180;
        const tail     = this._angleToXY(tailDeg, VUMeter.TAIL_LEN);

        this._peakNeedle.setAttribute('x1', tail.x.toFixed(2));
        this._peakNeedle.setAttribute('y1', tail.y.toFixed(2));
        this._peakNeedle.setAttribute('x2', tip.x.toFixed(2));
        this._peakNeedle.setAttribute('y2', tip.y.toFixed(2));

        this._peakCounterweight.setAttribute('cx', tail.x.toFixed(2));
        this._peakCounterweight.setAttribute('cy', tail.y.toFixed(2));
        this._peakCounterweight.setAttribute(
            'transform',
            `rotate(${angleDeg.toFixed(2)}, ${tail.x.toFixed(2)}, ${tail.y.toFixed(2)})`
        );
    }

    _updateClipState(db) {
        const clipping = db > this._options.clipThreshold;

        if (clipping === this._clipping) return;
        this._clipping = clipping;

        if (this._light) {
            this._light.setAttribute(
                'fill',
                clipping
                    ? `url(#${this._uid}-jewel-on)`
                    : `url(#${this._uid}-jewel-off)`
            );
        }

        if (this._wrapper) {
            if (clipping) {
                this._wrapper.classList.add('vu-meter--clipping');
            } else {
                this._wrapper.classList.remove('vu-meter--clipping');
            }
        }

        if (clipping  && typeof this._options.onClip       === 'function') this._options.onClip();
        if (!clipping && typeof this._options.onClipRelease === 'function') this._options.onClipRelease();
    }
}
