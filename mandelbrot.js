function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}

function nanColesce(value, defaultValue) {
    return isNaN(value) ? defaultValue : value;
}

function toFloatStr(value) {
    const str = String(value);
    if (!str.includes('.') && !str.includes('e')) {
        return str + '.0';
    }
    return str;
}

function sRgb8ToLinear(x) {
    const f = x / 255.0;
    return (
        f < 0.04045 ? f / 12.92 :
        Math.pow((f + 0.055) / 1.055, 2.4)
    );
}

function glslColorSRgb8(r, g, b, a) {
    const x = sRgb8ToLinear(r);
    const y = sRgb8ToLinear(g);
    const z = sRgb8ToLinear(b);

    if (a == undefined) {
        return `vec3(${toFloatStr(x)}, ${toFloatStr(y)}, ${toFloatStr(z)})`;
    } else {
        return `vec4(${toFloatStr(x)}, ${toFloatStr(y)}, ${toFloatStr(z)}, ${toFloatStr(a)})`;
    }
}

function glslColorLinear8(r, g, b, a) {
    const x = r / 255;
    const y = g / 255;
    const z = b / 255;

    if (a == undefined) {
        return `vec3(${toFloatStr(x)}, ${toFloatStr(y)}, ${toFloatStr(z)})`;
    } else {
        return `vec4(${toFloatStr(x)}, ${toFloatStr(y)}, ${toFloatStr(z)}, ${toFloatStr(a)})`;
    }
}

function throttle(func, delay) {
    let args = null;
    let self = null;
    let timer = null;

    return function () {
        if (timer === null) {
            timer = setTimeout(function () {
                timer = null;
                try {
                    if (args !== null) {
                        func.apply(self, args);
                    }
                } finally {
                    args = null;
                    self = null;
                }
            }, delay);
            args = null;
            self = null;
            func.apply(this, arguments);
        } else {
            args = arguments;
            self = this;
        }
    };
}

function debounce(func, delay) {
    let args = null;
    let self = null;
    let timer = null;

    return function () {
        if (timer !== null) {
            clearTimeout(timer);
        }

        args = arguments;
        self = this;
        timer = setTimeout(function () {
            timer = null;
            try {
                func.apply(self, args);
            } finally {
                args = null;
                self = null;
            }
        }, delay);
    };
}

const params = new URLSearchParams(location.search);

const INPUT_THROTTLE_MS = 250;

const DEFAULT_ITERATIONS = 500;
const DEFAULT_THRESHOLD = 4.0;
const DEFAULT_FPS = 12;
const DEFAULT_COLORS = 'BGR';

const MAX_ITERATIONS = 10000;
const MAX_THRESHOLD = 10000;
const MAX_FPS = 120;

const iterationsParam = params.get('iterations');
const thresholdParam = params.get('threshold');
const animationParam = params.get('animation');
const colorsParam = (params.get('colors') || '').trim() || DEFAULT_COLORS;

let fractal = (params.get('fractal') || '').trim().toLowerCase() || 'mandelbrot';
let animationFPS = +params.get('fps', DEFAULT_FPS);

if (!isFinite(animationFPS) || animationFPS <= 0) {
    animationFPS = DEFAULT_FPS;
} else if (animationFPS > MAX_FPS) {
    animationFPS = MAX_FPS;
}

document.getElementById('fps-input').value = animationFPS;

let iterations = iterationsParam ? nanColesce(clamp(parseInt(iterationsParam, 10), 0, MAX_ITERATIONS), DEFAULT_ITERATIONS) : DEFAULT_ITERATIONS;
let threshold = thresholdParam ? nanColesce(clamp(parseFloat(thresholdParam), 0, MAX_THRESHOLD), DEFAULT_THRESHOLD) : DEFAULT_THRESHOLD;
let animation = animationParam ? animationParam.split(/\s+/).map(
    item => {
        const step = item ? item.split(',').map(Number) : [];
        let [x, y, z, d, cr, ci] = step;
        if (!isFinite(x)) {
            x = -0.5;
        }
        if (!isFinite(y)) {
            y = 0;
        }
        if (!isFinite(z) || z <= 0) {
            z = 2.5;
        }
        if (!isFinite(d) || d < 0) {
            d = 1000;
        }
        if (!isFinite(cr) || cr <= 0) {
            cr = -0.744;
        }
        if (!isFinite(ci) || ci <= 0) {
            ci = 0.148;
        }
        return { x, y, z, cr, ci, d };
    }
) : null;

const ZOOM_FACTOR = 1.25;

const VERTEX_CODE = `\
#version 300 es

in vec4 vertexPosition;

void main() {
    gl_Position = vertexPosition;
}
`;

const COLOR_CODES = {
    RBG: `\
v *= 0.005;
fragColor.xyz = hsv2rgb(vec3(1.0 - mod(v, 1.0), 1.0, 1.0));
fragColor.w = 1.0;`,

    GRB: `\
v *= 0.005;
fragColor.xyz = hsv2rgb(vec3(1.0 - mod(v + 2.0/3.0, 1.0), 1.0, 1.0));
fragColor.w = 1.0;`,

    BGR: `\
v *= 0.005;
fragColor.xyz = hsv2rgb(vec3(1.0 - mod(v + 1.0/3.0, 1.0), 1.0, 1.0));
fragColor.w = 1.0;`,

    RGB: `\
v *= 0.005;
fragColor.xyz = hsv2rgb(vec3(mod(v, 1.0), 1.0, 1.0));
fragColor.w = 1.0;`,

    BRG: `\
v *= 0.005;
fragColor.xyz = hsv2rgb(vec3(mod(v + 2.0/3.0, 1.0), 1.0, 1.0));
fragColor.w = 1.0;`,

    GBR: `\
v *= 0.005;
fragColor.xyz = hsv2rgb(vec3(mod(v + 1.0/3.0, 1.0), 1.0, 1.0));
fragColor.w = 1.0;`,

    grayscaleBB: `\
v *= 0.01;
v = mod(v, 2.0);
v = 1.0 - abs(v - 1.0);
fragColor = vec4(v, v, v, 1.0);`,

    grayscaleWB: `\
v *= 0.01;
v = mod(v, 2.0);
v = abs(v - 1.0);
fragColor = vec4(v, v, v, 1.0);`,

    horizonS: `\
v *= 0.005;
v = mod(v, 1.0);
float t;
if (v < 0.16) {
    t = v / 0.16;
    fragColor.xyz = mix(${glslColorLinear8(0, 7, 100)}, ${glslColorLinear8(32, 107, 203)}, t);
} else if (v < 0.42) {
    t = (v - 0.16) / (0.42 - 0.16);
    fragColor.xyz = mix(${glslColorLinear8(32, 107, 203)}, ${glslColorLinear8(237, 255, 255)}, t);
} else if (v < 0.6425) {
    t = (v - 0.42) / (0.6425 - 0.42);
    fragColor.xyz = mix(${glslColorLinear8(237, 255, 255)}, ${glslColorLinear8(255, 170, 0)}, t);
} else if (v < 0.8575) {
    t = (v - 0.6425) / (0.8575 - 0.6425);
    fragColor.xyz = mix(${glslColorLinear8(255, 170, 0)}, ${glslColorLinear8(0, 2, 0)}, t);
} else {
    t = (v - 0.8575) / (1.0 - 0.8575);
    fragColor.xyz = mix(${glslColorLinear8(0, 2, 0)}, ${glslColorLinear8(0, 7, 100)}, t);
}
fragColor.w = 1.0;`,

    horizonL: `\
v *= 0.005;
v = mod(v, 1.0);
float t;
if (v < 0.16) {
    t = v / 0.16;
    fragColor.xyz = mix(${glslColorSRgb8(0, 7, 100)}, ${glslColorSRgb8(32, 107, 203)}, t);
} else if (v < 0.42) {
    t = (v - 0.16) / (0.42 - 0.16);
    fragColor.xyz = mix(${glslColorSRgb8(32, 107, 203)}, ${glslColorSRgb8(237, 255, 255)}, t);
} else if (v < 0.6425) {
    t = (v - 0.42) / (0.6425 - 0.42);
    fragColor.xyz = mix(${glslColorSRgb8(237, 255, 255)}, ${glslColorSRgb8(255, 170, 0)}, t);
} else if (v < 0.8575) {
    t = (v - 0.6425) / (0.8575 - 0.6425);
    fragColor.xyz = mix(${glslColorSRgb8(255, 170, 0)}, ${glslColorSRgb8(0, 2, 0)}, t);
} else {
    t = (v - 0.8575) / (1.0 - 0.8575);
    fragColor.xyz = mix(${glslColorSRgb8(0, 2, 0)}, ${glslColorSRgb8(0, 7, 100)}, t);
}
fragColor.w = 1.0;`,

    sepia: `\
v *= 0.0005;
v = mod(v, 2.0);
v = abs(v - 1.0);
fragColor.rgb = mix(
    vec3(0.16202937563911096, 0.05448027644244237, 0.006995410187265387),
    vec3(0.8879231178819663, 0.7758222183174236, 0.6104955708078648),
    pow(v, 16.0)
);
fragColor.a = 1.0;`,
}

function getMandelbrotCode(iterations, threshold, colorCode) {
    return `\
#version 300 es
precision highp float;

uniform vec2 canvasSize;
uniform vec3 viewPort;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 z = vec2(0.0, 0.0);
    float x = gl_FragCoord.x / canvasSize.y * viewPort.z + viewPort.x;
    float y = gl_FragCoord.y / canvasSize.y * viewPort.z + viewPort.y;

    for (int i = 0; i < ${iterations}; ++ i) {
        float a = z.x*z.x + z.y*z.y;
        if (a >= ${toFloatStr(threshold * threshold)}) {
            float v = (float(i + 1) - log(log(a)) * ${toFloatStr(1 / Math.log(2))});

            ${colorCode}
            return;
        }
        float zx = z.x*z.x - z.y*z.y + x;
        z.y = 2.0 * z.x*z.y + y;
        z.x = zx;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

function getJuliaCode(iterations, threshold, colorCode) {
    return `\
#version 300 es
precision highp float;

uniform vec2 canvasSize;
uniform vec3 viewPort;
uniform vec2 c;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    float x = gl_FragCoord.x / canvasSize.y * viewPort.z + viewPort.x;
    float y = gl_FragCoord.y / canvasSize.y * viewPort.z + viewPort.y;
    vec2 z = vec2(x, y);

    for (int i = 0; i < ${iterations}; ++ i) {
        float a = z.x*z.x + z.y*z.y;
        if (a >= ${toFloatStr(threshold * threshold)}) {
            float v = (float(i + 1) - log(log(a)) * ${toFloatStr(1 / Math.log(2))});

            ${colorCode}
            return;
        }
        float zx = z.x*z.x - z.y*z.y + c.x;
        z.y = 2.0 * z.x*z.y + c.y;
        z.x = zx;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

let colors = colorsParam === 'horizon' ? 'horizonS' : colorsParam;
let colorCode = COLOR_CODES[colors] || COLOR_CODES[DEFAULT_COLORS];
document.getElementById('color-code-preset').value = colors || DEFAULT_COLORS;
document.getElementById('color-code').value = COLOR_CODES[DEFAULT_COLORS];

function cycleColors(offset) {
    const presets = document.getElementById('color-code-preset');
    let index = (presets.options.selectedIndex + offset) % presets.options.length;
    if (index < 0) {
        index += presets.options.length;
    }
    let value = presets.options[index].value;
    if (value === 'custom') {
        index = (index + offset) % presets.options.length;
        if (index < 0) {
            index += presets.options.length;
        }
        value = presets.options[index].value;
    }
    presets.value = value;
    setColorCode(COLOR_CODES[value]);
    colors = value;
    setUrlParams();
    showMessage(`set colors to ${presets.options[index].label}`, MSG_LEVEL_INFO);
}

const canvas = document.getElementById("canvas");
const fpsEl = document.getElementById("fps");
const messagesEl = document.getElementById("messages");
const helpEl = document.getElementById("help");

const MSG_LEVEL_INFO = 'info';
const MSG_LEVEL_WARNING = 'warning';
const MSG_LEVEL_ERROR = 'error';

function showMessage(message, level) {
    level ||= 'info';
    console[level](message);
    const lineEl = document.createElement('li');
    lineEl.className = level;
    lineEl.appendChild(document.createTextNode(message));
    messagesEl.appendChild(lineEl);
    setTimeout(function () {
        messagesEl.removeChild(lineEl);
    }, 5000);
}

let redraw;
let updateShader;
let sampleRatio = 1;
let pixelRatio = window.devicePixelRatio * sampleRatio;

function resizeCanvas() {
    canvas.style.width  = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    canvas.width  = pixelRatio * window.innerWidth;
    canvas.height = pixelRatio * window.innerHeight;
}

function setColorCode(newColorCode) {
    const oldColorCode = colorCode;
    try {
        colorCode = newColorCode;
        updateShader();
        redraw();
    } catch (error) {
        console.error(error);
        showMessage(String(error), MSG_LEVEL_ERROR);

        colorCode = oldColorCode;
        updateShader();
    }
}

const debouncedSetColorCode = debounce(setColorCode, INPUT_THROTTLE_MS);

function setIterations(newIterations) {
    if (!isFinite(newIterations) || newIterations <= 0 || (newIterations|0) !== newIterations) {
        throw new Error(`illegal iterations: ${newIterations}`);
    }
    if (newIterations > MAX_ITERATIONS) {
        newIterations = MAX_ITERATIONS;
    }
    iterations = newIterations;
    updateShader();
    redraw();
    setUrlParams();
}

function setThreshold(newThreshold) {
    if (!isFinite(newThreshold) || newThreshold <= 0) {
        throw new Error(`illegal threshold: ${newThreshold}`);
    }
    if (newThreshold > MAX_THRESHOLD) {
        newThreshold = MAX_THRESHOLD;
    }
    threshold = newThreshold;
    updateShader();
    redraw();
    setUrlParams();
}

const debouncedSetIterations = debounce(setIterations, INPUT_THROTTLE_MS);
const debouncedSetThreshold = debounce(setThreshold, INPUT_THROTTLE_MS);

function saveScreenshotBlob() {
    return new Promise((resolve, reject) => {
        try {
            const filename = `${fractal}.png`;
            canvas.toBlob(blob => {
                try {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    link.style.position = 'absolute';
                    link.style.opacity = '0';
                    document.body.appendChild(link);
                    link.click();
                    setTimeout(() => {
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                    }, 0);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }, 'image/png');
        } catch (error) {
            reject(error);
        }
    });
}

function saveScreenshot() {
    const filename = `${fractal}.png`;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.position = 'absolute';
    link.style.opacity = '0';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        document.body.removeChild(link);
    }, 0);
}

window.onresize = function () {
    resizeCanvas();
    redraw();
};

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.body.requestFullscreen();
    }
}

window.ondblclick = toggleFullscreen;

resizeCanvas();

let grabbing = false;
let touching = false;
let animating = false;
let animationTimer = null;

const mousePos = {
    x: 0,
    y: 0,
};

const viewPort = {
    x: -0.5,
    y: 0,
    z: 2.5,
    cr: -0.744,
    ci: 0.148,
};

if (fractal === 'julia') {
    viewPort.x = 0;
    viewPort.z = 2;
}

function getUrlHash() {
    if (location.hash.startsWith('#!')) {
        const [x, y, z, cr, ci] = location.hash.slice(2).split(',');
        viewPort.x = nanColesce(+x, viewPort.x);
        viewPort.y = nanColesce(+y, viewPort.y);
        viewPort.z = nanColesce(+z, viewPort.z);
        viewPort.cr = nanColesce(+cr, viewPort.cr);
        viewPort.ci = nanColesce(+ci, viewPort.ci);
    }
}

function setUrlParams() {
    const params = [];
    if (fractal !== 'mandelbrot') {
        params.push(`fractal=${fractal}`);
    }
    if (iterations !== DEFAULT_ITERATIONS) {
        params.push(`iterations=${iterations}`);
    }
    if (threshold !== DEFAULT_THRESHOLD) {
        params.push(`threshold=${threshold}`);
    }
    if (animation && animation.length > 0) {
        const animStr = animation.map(item => `${item.x},${item.y},${item.z},${item.d},${item.cr},${item.ci}`).join('%20');
        params.push(`animation=${animStr}`);
    }
    if (animationFPS !== DEFAULT_FPS) {
        params.push(`fps=${animationFPS}`);
    }
    if (colors !== DEFAULT_COLORS) {
        params.push(`colors=${colors}`);
    }
    const query = params.join('&');
    const hash = `#!${viewPort.x},${viewPort.y},${viewPort.z},${viewPort.cr},${viewPort.ci}`;

    history.pushState(null, null, `?${query}${hash}`);
}

const throttledSetUrlParams = throttle(setUrlParams, INPUT_THROTTLE_MS);
const debouncedSetUrlParams = debounce(setUrlParams, INPUT_THROTTLE_MS);

getUrlHash();

window.onhashchange = function (event) {
    const { x: x1, y: y1, z: z1, cr: cr1, ci: ci1 } = viewPort;
    getUrlHash();
    const { x: x2, y: y2, z: z2, cr: cr2, ci: ci2 } = viewPort;
    if (x1 !== x2 || y1 !== y2 || z1 !== z2 || cr1 !== cr2 || ci1 !== ci2) {
        redraw();
    }
};

/*
window.onclick = function (event) {
    viewPort.x += -0.5 * (canvas.width / canvas.height) * viewPort.z + event.clientX * pixelRatio / canvas.height * viewPort.z;
    viewPort.y -= -0.5 * viewPort.z + event.clientY * pixelRatio / canvas.height * viewPort.z;
    setUrlParams();
    redraw();
};
*/

let hideCursorTimer = null;

function hideCursor() {
    if (hideCursorTimer !== null) {
        clearTimeout(hideCursorTimer);
        hideCursorTimer = null;
    }
    canvas.classList.add('cursorHidden');
}

function showCursor() {
    canvas.classList.remove('cursorHidden');
    if (hideCursorTimer !== null) {
        clearTimeout(hideCursorTimer);
    }
    hideCursorTimer = setTimeout(function () {
        hideCursorTimer = null;
        canvas.classList.add('cursorHidden');
    }, 1000);
}

/**
 * @param {MouseEvent} event 
 */
window.onmousedown = function (event) {
    if (touching || animating || !(event.buttons & 1)) return;
    canvas.classList.add('grabbing');
    canvas.classList.remove('cursorHidden');
    fpsEl.classList.remove('hidden');
    if (hideCursorTimer !== null) {
        clearTimeout(hideCursorTimer);
    }
    grabbing = true;
    mousePos.x = event.clientX * pixelRatio;
    mousePos.y = event.clientY * pixelRatio;
};

/**
 * @param {MouseEvent} event 
 */
window.onmouseup = function (event) {
    if (!grabbing || (event.buttons & 1)) return;
    debouncedSetUrlParams();
    if (!touching) {
        fpsEl.classList.add('hidden');
    }
    if (!animating) {
        showCursor();
    }
    grabbing = false;
    canvas.classList.remove('grabbing');
    helpEl.classList.add('hidden');
}

/**
 * @param {MouseEvent} event 
 */
window.onmousemove = function (event) {
    if (!animating) {
        showCursor();
    }
    const x = event.clientX * pixelRatio;
    const y = event.clientY * pixelRatio;
    if (grabbing) {
        let dx = x - mousePos.x;
        let dy = y - mousePos.y;
        if (event.shiftKey) {
            dx *= 0.1;
            dy *= 0.1;
        }
        if (event.ctrlKey && fractal === 'julia') {
            viewPort.cr += dx / canvas.height;
            viewPort.ci += dy / canvas.height;
        } else {
            viewPort.x -= dx / canvas.height * viewPort.z;
            viewPort.y += dy / canvas.height * viewPort.z;
        }
        redraw();
    }
    mousePos.x = x;
    mousePos.y = y;
};

/**
 * @type {Map<number, { x: number, y: number }>}
 */
const activeTouches = new Map();
const activeCenter = { x: 0, y: 0, size: 0 };

function refreshActviveCenter() {
    const touches = Array.from(activeTouches.values());
    let xsum = 0;
    let ysum = 0;
    let maxSize = 0;
    for (let index = 0; index < touches.length; ++ index) {
        const { x, y } = touches[index];
        xsum += x;
        ysum += y;

        for (let otherIndex = index + 1; otherIndex < touches.length; ++ otherIndex) {
            const { x: xo, y: yo } = touches[otherIndex];
            const dx = xo - x;
            const dy = yo - y;
            const size = Math.sqrt(dx*dx + dy*dy);
            if (size > maxSize) {
                maxSize = size;
            }
        }
    }

    activeCenter.x = xsum / activeTouches.size;
    activeCenter.y = ysum / activeTouches.size;
    activeCenter.size = maxSize;
}

let singleTouchTimestamp = 0;

/**
 * @param {TouchEvent} event 
 */
window.addEventListener('touchstart', function (event) {
    event.preventDefault();
    if (grabbing || animating) return;

    if (event.touches.length === 1) {
        const now = Date.now();
        const dt = now - singleTouchTimestamp;
        if (dt <= 250) {
            toggleFullscreen();
        }
        singleTouchTimestamp = now;
    }

    touching = true;
    fpsEl.classList.remove('hidden');

    for (const touch of event.changedTouches) {
        const x = touch.clientX * pixelRatio;
        const y = touch.clientY * pixelRatio;
        activeTouches.set(touch.identifier, { x, y });
    }

    refreshActviveCenter();
}, { passive: false });

/**
 * @param {TouchEvent} event 
 */
window.addEventListener('touchmove', function (event) {
    event.preventDefault();
    if (!touching) return;

    const touchCount1 = activeTouches.size;
    const { x: x1, y: y1, size: size1 } = activeCenter;

    for (const touch of event.changedTouches) {
        const x = touch.clientX * pixelRatio;
        const y = touch.clientY * pixelRatio;
        activeTouches.set(touch.identifier, { x, y });
    }

    refreshActviveCenter();

    const touchCount2 = activeTouches.size;
    const { x: x2, y: y2, size: size2 } = activeCenter;

    const dx = x2 - x1;
    const dy = y2 - y1;

    if (touchCount2 > 2 && fractal === 'julia') {
        viewPort.cr += dx * 0.1 / canvas.height;
        viewPort.ci += dy * 0.1 / canvas.height;
    } else {
        viewPort.x -= dx / canvas.height * viewPort.z;
        viewPort.y += dy / canvas.height * viewPort.z;
    }

    if (touchCount1 > 1 && touchCount2 > 1 && size1 !== 0 && size2 !== 0) {
        const scale = size1 / size2;
        const dx = (x2 - canvas.width  * 0.5) / canvas.height;
        const dy = (y2 - canvas.height * 0.5) / canvas.height;
        const z1 = viewPort.z;
        const z2 = z1 * scale;
        viewPort.x += dx * z1 - dx * z2;
        viewPort.y -= dy * z1 - dy * z2;
        viewPort.z = z2;
    }

    redraw();
}, { passive: false });

/**
 * @param {TouchEvent} event 
 */
function handleTouchEnd (event) {
    event.preventDefault();
    debouncedSetUrlParams();

    for (const touch of event.changedTouches) {
        activeTouches.delete(touch.identifier);
    }

    if (activeTouches.size === 0) {
        touching = false;
        if (!grabbing) {
            fpsEl.classList.add('hidden');
        }
    } else {
        refreshActviveCenter();
    }
}

window.addEventListener('touchend', handleTouchEnd, { passive: false });
window.addEventListener('touchcancel', handleTouchEnd, { passive: false });

/**
 * 
 * @param {KeyboardEvent} event 
 */
window.onkeydown = function (event) {
    try {
        switch (event.key) {
            case '+':
                viewPort.z /= ZOOM_FACTOR;
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case '-':
                viewPort.z *= ZOOM_FACTOR;
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'f':
                toggleFullscreen();
                event.preventDefault();
                break;

            case 'h':
                if (helpEl.classList.contains('hidden')) {
                    document.getElementById('fractal-input').value = fractal;
                    document.getElementById('iterations-input').value = iterations;
                    document.getElementById('threshold-input').value = threshold;
                    helpEl.classList.remove('hidden');
                } else {
                    helpEl.classList.add('hidden');
                }
                event.preventDefault();
                break;

            case 'i':
                if (iterations < MAX_ITERATIONS) {
                    if (iterations >= 1000) {
                        iterations += 1000;
                    } else if (iterations >= 100) {
                        iterations += 100;
                    } else if (iterations >= 10) {
                        iterations += 10;
                    } else {
                        iterations += 1;
                    }
                    showMessage(`increased iterations to ${iterations}`);
                    updateShader();
                    redraw();
                    debouncedSetUrlParams();
                }
                event.preventDefault();
                break;

            case 'I':
                if (iterations > 1) {
                    if (iterations > 1000) {
                        iterations -= 1000;
                    } else if (iterations > 100) {
                        iterations -= 100;
                    } else if (iterations > 10) {
                        iterations -= 10;
                    } else {
                        iterations -= 1;
                    }
                    showMessage(`decreased iterations to ${iterations}`);
                    updateShader();
                    redraw();
                    debouncedSetUrlParams();
                }
                event.preventDefault();
                break;

            case 't':
                if (threshold < MAX_THRESHOLD) {
                    if (threshold >= 1000) {
                        threshold += 1000;
                    } else if (threshold >= 100) {
                        threshold += 100;
                    } else if (threshold >= 10) {
                        threshold += 10;
                    } else {
                        threshold += 1;
                    }
                    showMessage(`increased threshold to ${threshold}`);
                    updateShader();
                    redraw();
                    debouncedSetUrlParams();
                }
                event.preventDefault();
                break;

            case 'T':
                if (threshold > 1) {
                    if (threshold > 1000) {
                        threshold -= 1000;
                    } else if (threshold > 100) {
                        threshold -= 100;
                    } else if (threshold > 10) {
                        threshold -= 10;
                    } else {
                        threshold -= 1;
                    }
                    showMessage(`decreased threshold to ${threshold}`);
                    updateShader();
                    redraw();
                    debouncedSetUrlParams();
                }
                event.preventDefault();
                break;

            case 'p':
                playAnimation(animation);
                event.preventDefault();
                break;

            case 'P':
                if (animation) {
                    const revAnimation = animation.slice().reverse();
                    for (let index = revAnimation.length - 2; index >= 0; -- index) {
                        revAnimation[index + 1].d = revAnimation[index].d;
                    }
                    playAnimation(revAnimation);
                }
                event.preventDefault();
                break;

            case 'a':
                if (!animation) {
                    animation = [];
                }
                const item = { ...viewPort, d: 1000 };
                animation.push(item);
                setUrlParams();
                showMessage(`added key-frame #${animation.length}: ${item.x}, ${item.y}, ${item.z}, ${item.d}, ${item.cr}, ${item.ci}`);
                event.preventDefault();
                break;

            case 'A':
                if (animation && animation.length > 0) {
                    const item = animation.pop();
                    if (animation.length === 0) {
                        animation = null;
                    }
                    setUrlParams();
                    showMessage(`removed key-frame #${animation.length + 1}: ${item.x}, ${item.y}, ${item.z}, ${item.d}, ${item.cr}, ${item.ci}`);
                } else {
                    showMessage('no more key-frames to remove');
                }
                event.preventDefault();
                break;

            case 'u':
                if (animation && animation.length > 0) {
                    const item = animation[animation.length - 1];
                    item.x  = viewPort.x;
                    item.y  = viewPort.y;
                    item.z  = viewPort.z;
                    item.cr = viewPort.cr;
                    item.ci = viewPort.ci;
                    showMessage(`updated key-frame #${animation.length} to: ${item.x}, ${item.y}, ${item.z}, ${item.d}, ${item.cr}, ${item.ci}`);
                } else {
                    showMessage(`no animation`);
                }
                event.preventDefault();
                break;

            case 'd':
                if (animation && animation.length > 0) {
                    const item = animation[animation.length - 1];
                    item.d += event.altKey ? 100 : 1000;
                    setUrlParams();
                    showMessage(`increased duration of key-frame #${animation.length} to ${item.d}`);
                } else {
                    showMessage(`no animation`);
                }
                event.preventDefault();
                break;

            case 'D':
                if (animation && animation.length > 0) {
                    const item = animation[animation.length - 1];
                    item.d = Math.max(0, item.d - event.altKey ? 100 : 1000);
                    setUrlParams();
                    showMessage(`decreased duration of key-frame #${animation.length} to ${item.d}`);
                } else {
                    showMessage(`no animation`);
                }
                event.preventDefault();
                break;

            case 'ArrowRight':
                if (event.ctrlKey) {
                    viewPort.cr += event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.x += 0.1 * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowLeft':
                if (event.ctrlKey) {
                    viewPort.cr -= event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.x -= 0.1 * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowUp':
                if (event.ctrlKey) {
                    viewPort.ci += event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.y += 0.1 * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowDown':
                if (event.ctrlKey) {
                    viewPort.ci -= event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.y -= 0.1 * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'Escape':
                if (!helpEl.classList.contains('hidden')) {
                    helpEl.classList.add('hidden');
                } else {
                    stopAnimation();
                }
                event.preventDefault();
                break;

            case 'm':
                fractal = 'mandelbrot';
                updateShader();
                redraw();
                setUrlParams();
                event.preventDefault();
                break;

            case 'j':
                fractal = 'julia';
                updateShader();
                redraw();
                setUrlParams();
                event.preventDefault();
                break;

            case 'o':
                sampleRatio = 1 + sampleRatio % 2;
                pixelRatio = window.devicePixelRatio * sampleRatio;
                resizeCanvas();
                redraw();
                showMessage(`set sampling ratio to ${sampleRatio}x${sampleRatio}`);
                event.preventDefault();
                break;

            case 's':
                if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
                    if (sampleRatio === 1) {
                        sampleRatio = 2;
                        pixelRatio = window.devicePixelRatio * sampleRatio;
                        resizeCanvas();
                        redraw();
                        saveScreenshotBlob().finally(() => {
                            showMessage('saved screenshot');
                            setTimeout(() => {
                                sampleRatio = 1;
                                pixelRatio = window.devicePixelRatio * sampleRatio;
                                resizeCanvas();
                                redraw();
                            }, 0);
                        });
                    } else {
                        redraw();
                        saveScreenshotBlob().finally(() => {
                            showMessage('saved screenshot');
                        });
                    }
                    event.preventDefault();
                }
                break;

            case 'c':
                cycleColors(1);
                event.preventDefault();
                break;

            case 'C':
                cycleColors(-1);
                event.preventDefault();
                break;

            default:
                // console.log(event);
                break;
        }
    } catch (error) {
        console.error(error);
        showMessage(String(error), MSG_LEVEL_ERROR);
    }
};

const CI_FACTOR = 1.01;
const CR_FACTOR = 1.001;

const CI_FACTOR_FINE = 1.001;
const CR_FACTOR_FINE = 1.0001;

/**
 * @param {WheelEvent} event 
 */
window.addEventListener('wheel', function (event) {
    event.preventDefault();

    if (event.deltaY === 0 || event.metaKey) {
        return;
    }

    if (event.ctrlKey || event.altKey) {
        if (event.altKey) {
            viewPort.ci = event.deltaY < 0 ? viewPort.ci / CI_FACTOR : viewPort.ci * CI_FACTOR;
        } else {
            viewPort.cr = event.deltaY < 0 ? viewPort.cr / CR_FACTOR : viewPort.cr * CR_FACTOR;
        }
        debouncedSetUrlParams();
        redraw();
        return;
    }

    const z1 = viewPort.z;
    const z2 = event.deltaY < 0 ? z1 / ZOOM_FACTOR : z1 * ZOOM_FACTOR;

    const x = event.clientX * pixelRatio;
    const y = event.clientY * pixelRatio;

    const dx = (x - canvas.width  * 0.5) / canvas.height;
    const dy = (y - canvas.height * 0.5) / canvas.height;

    viewPort.x += dx * z1 - dx * z2;
    viewPort.y -= dy * z1 - dy * z2;
    viewPort.z = z2;

    debouncedSetUrlParams();
    redraw();
}, { passive: false });

function createShader(gl, shaderType, sourceCode) {
    const shader = gl.createShader(shaderType);
    gl.shaderSource(shader, sourceCode.trim());
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function setup() {
    const gl = canvas.getContext("webgl2");
    if (!gl) {
        throw new TypeError("WebGL2 not supported!");
    }

    const program = gl.createProgram();
    let fragmentCode = fractal === 'julia' ?
        getJuliaCode(iterations, threshold, colorCode) :
        getMandelbrotCode(iterations, threshold, colorCode);

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_CODE);
    let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    updateShader = function updateShader () {
        gl.detachShader(program, fragmentShader);
        gl.deleteShader(fragmentShader);

        fragmentCode = fractal === 'julia' ?
            getJuliaCode(iterations, threshold, colorCode) :
            getMandelbrotCode(iterations, threshold, colorCode);

        fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
        gl.attachShader(program, fragmentShader);
        linkProgram();
    };

    function linkProgram () {
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program));
        }

        vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
        gl.enableVertexAttribArray(vertexPosition);
        gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);

        canvasSizeUniform = gl.getUniformLocation(program, 'canvasSize');
        viewPortUniform = gl.getUniformLocation(program, 'viewPort');
        cUniform = gl.getUniformLocation(program, 'c');
    }

    const vertices = [
      [-1, -1],
      [ 1, -1],
      [-1,  1],
      [ 1,  1],
    ];
    const vertexData = new Float32Array(vertices.flat());
    let buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

    linkProgram();
    gl.useProgram(program);

    let w = canvas.width;
    let h = canvas.height;
    let timestamp = Date.now();

    redraw = function redraw() {
        const cw = canvas.width;
        const ch = canvas.height;

        if (cw !== w || ch !== h) {
            w = cw;
            h = ch;
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        }

        gl.uniform2f(canvasSizeUniform, w, h);
        gl.uniform3f(viewPortUniform,
            viewPort.x - 0.5 * canvas.width / canvas.height * viewPort.z,
            viewPort.y - 0.5 * viewPort.z,
            viewPort.z
        );
        if (cUniform) {
            gl.uniform2f(cUniform, viewPort.cr, viewPort.ci);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length);
        gl.flush();

        const now = Date.now();
        const duration = (now - timestamp) / 1000;
        const fpsVal = 1 / duration;
        fpsEl.innerHTML = `${fpsVal > 1.0 ? Math.round(fpsVal) : fpsVal.toFixed(1)} fps`;
        timestamp = now;
    }
}

function stopAnimation() {
    console.log("stopping animation");
    if (animationTimer !== null) {
        clearInterval(animationTimer);
        animationTimer = null;
    }
    animating = false;
}

function playAnimation(animation) {
    console.log("starting animation...");
    if (animationTimer !== null) {
        clearInterval(animationTimer);
        animationTimer = null;
    }

    if (animation && animation.length > 0) {
        const item = animation[0];
        viewPort.x = item.x;
        viewPort.y = item.y;
        viewPort.z = item.z;
        viewPort.cr = item.cr;
        viewPort.ci = item.ci;
        redraw();
    }

    if (!animation || animation.length < 2) {
        animating = false;
        return;
    }

    animating = true;
    hideCursor();
    let animationIndex = 0;
    let timestamp = Date.now();
    animationTimer = setInterval(function () {
        const now = Date.now();
        const { x: x1, y: y1, z: z1, cr: cr1, ci: ci1, _ } = animation[animationIndex];
        const { x: x2, y: y2, z: z2, cr: cr2, ci: ci2, d } = animation[animationIndex + 1];
        let interp = (now - timestamp) / d;
        if (interp > 1) {
            viewPort.x = x2;
            viewPort.y = y2;
            viewPort.z = z2;
            viewPort.cr = cr2;
            viewPort.ci = ci2;
            timestamp = now;
            ++ animationIndex;
            if (animationIndex + 1 >= animation.length) {
                clearInterval(animationTimer);
                animating = false;
                animationTimer = null;
            }
        } else if (x1 === x2 && y1 === y2 && z1 === z2 && cr1 === cr2 && ci1 === ci2) {
            return;
        } else {
            interp = (
                z1 > z2 ? 1.0 - Math.pow(1.0 - interp, 16) :
                z1 < z2 ? Math.pow(interp, 16) :
                interp
            );
            const inv = 1.0 - interp;
            viewPort.x = x1 * inv + x2 * interp;
            viewPort.y = y1 * inv + y2 * interp;
            viewPort.z = z1 * inv + z2 * interp;
            viewPort.cr = cr1 * inv + cr2 * interp;
            viewPort.ci = ci1 * inv + ci2 * interp;
        }
        redraw();
    }, 1000/animationFPS);
}

try {
    setup();
    if (animation) {
        playAnimation(animation);
    } else {
        redraw();
        showCursor();
    }
} catch (error) {
    console.error(error);
    showMessage(`Error initializing: ${error}`, MSG_LEVEL_ERROR);
}
