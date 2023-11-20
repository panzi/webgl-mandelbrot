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

const params = new URLSearchParams(location.search);

const DEFAULT_ITERATIONS = 500;
const DEFAULT_THRESHOLD = 4.0;
const DEFAULT_FPS = 12;

const iterationsParam = params.get('iterations');
const thresholdParam = params.get('threshold');
const animationParam = params.get('animation');
let fractalParam = (params.get('fractal') || '').trim().toLowerCase() || 'mandelbrot';

let animationFPS = +params.get('fps', DEFAULT_FPS);

if (!isFinite(animationFPS) || animationFPS <= 0) {
    animationFPS = DEFAULT_FPS;
} else if (animationFPS > 120) {
    animationFPS = 120;
}

document.getElementById('fps-input').value = animationFPS;

// file:///home/panzi/src/html/mandelbrot/index.html?animation=-0.8269631235223067,-0.7110330380891499,18.62645149230957%200.3072072708754504,-0.4839597324466828,0.00005575186299632657,5000%200.3072072708754504,-0.4839597324466828,0.00005575186299632657,1000%20-0.8269631235223067,-0.7110330380891499,18.62645149230957,5000
let ITERATIONS = iterationsParam ? nanColesce(clamp(parseInt(iterationsParam, 10), 0, 2000), DEFAULT_ITERATIONS) : DEFAULT_ITERATIONS;
let THRESHOLD = thresholdParam ? nanColesce(clamp(parseFloat(thresholdParam), 0, 1000), DEFAULT_THRESHOLD) : DEFAULT_THRESHOLD;
let ANIMATION = animationParam ? animationParam.split(/\s+/).map(
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

const vertexCode = `\
#version 300 es

in vec4 vertexPosition;

void main() {
    gl_Position = vertexPosition;
}
`;

function getMandelbrotCode(iterations, threshold) {
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
            float v = (float(i + 1) - log(log(a)) * ${toFloatStr(1 / Math.log(2))}) * 0.005;

            fragColor.xyz = hsv2rgb(vec3(1.0 - mod(v + 1.0/3.0, 1.0), 1.0, 1.0));
            fragColor.w = 1.0;
            return;
        }
        float zx = z.x*z.x - z.y*z.y + x;
        z.y = 2.0 * z.x*z.y + y;
        z.x = zx;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

function getJuliaCode(iterations, threshold) {
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
            float v = (float(i + 1) - log(log(a)) * ${toFloatStr(1 / Math.log(2))}) * 0.005;

            fragColor.xyz = hsv2rgb(vec3(1.0 - mod(v + 1.0/3.0, 1.0), 1.0, 1.0));
            fragColor.w = 1.0;
            return;
        }
        float zx = z.x*z.x - z.y*z.y + c.x;
        z.y = 2.0 * z.x*z.y + c.y;
        z.x = zx;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

const canvas = document.getElementById("canvas");
const fpsEl = document.getElementById("fps");
const messagesEl = document.getElementById("messages");
const helpEl = document.getElementById("help");

function showMessage(message) {
    console.log(message);
    const lineEl = document.createElement('li');
    lineEl.appendChild(document.createTextNode(message));
    messagesEl.appendChild(lineEl);
    setTimeout(function () {
        messagesEl.removeChild(lineEl);
    }, 5000);
}

let redraw;
let setFractal;

function resizeCanvas() {
    canvas.style.width  = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    canvas.width  = window.devicePixelRatio * window.innerWidth;
    canvas.height = window.devicePixelRatio * window.innerHeight;
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

if (fractalParam === 'julia') {
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
    if (fractalParam !== 'mandelbrot') {
        params.push(`fractal=${fractalParam}`);
    }
    if (ITERATIONS !== DEFAULT_ITERATIONS) {
        params.push(`iterations=${ITERATIONS}`);
    }
    if (THRESHOLD !== DEFAULT_THRESHOLD) {
        params.push(`threshold=${THRESHOLD}`);
    }
    if (ANIMATION && ANIMATION.length > 0) {
        const animStr = ANIMATION.map(item => `${item.x},${item.y},${item.z},${item.d},${item.cr},${item.ci}`).join('%20');
        params.push(`animation=${animStr}`);
    }
    if (animationFPS !== DEFAULT_FPS) {
        params.push(`fps=${animationFPS}`);
    }
    const query = params.join('&');
    const hash = `#!${viewPort.x},${viewPort.y},${viewPort.z},${viewPort.cr},${viewPort.ci}`;

    history.replaceState(null, null, `?${query}${hash}`);
}

const throttledSetUrlParams = throttle(setUrlParams, 500);

getUrlHash();

window.onhashchange = function () {
    getUrlHash();
    redraw();
};

/*
window.onclick = function (event) {
    viewPort.x += -0.5 * (canvas.width / canvas.height) * viewPort.z + event.clientX * window.devicePixelRatio / canvas.height * viewPort.z;
    viewPort.y -= -0.5 * viewPort.z + event.clientY * window.devicePixelRatio / canvas.height * viewPort.z;
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
    mousePos.x = event.clientX * window.devicePixelRatio;
    mousePos.y = event.clientY * window.devicePixelRatio;
};

/**
 * @param {MouseEvent} event 
 */
window.onmouseup = function (event) {
    if (!grabbing || (event.buttons & 1)) return;
    setUrlParams();
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

window.onmousemove = function (event) {
    if (!animating) {
        showCursor();
    }
    const x = event.clientX * window.devicePixelRatio;
    const y = event.clientY * window.devicePixelRatio;
    if (grabbing) {
        viewPort.x -= (x - mousePos.x) / canvas.height * viewPort.z;
        viewPort.y += (y - mousePos.y) / canvas.height * viewPort.z;
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

/**
 * @param {TouchEvent} event 
 */
window.addEventListener('touchstart', function (event) {
    event.preventDefault();
    if (grabbing || animating) return;
    touching = true;
    fpsEl.classList.remove('hidden');

    for (const touch of event.changedTouches) {
        const x = touch.clientX * window.devicePixelRatio;
        const y = touch.clientY * window.devicePixelRatio;
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
        const x = touch.clientX * window.devicePixelRatio;
        const y = touch.clientY * window.devicePixelRatio;
        activeTouches.set(touch.identifier, { x, y });
    }

    refreshActviveCenter();

    const touchCount2 = activeTouches.size;
    const { x: x2, y: y2, size: size2 } = activeCenter;

    const dx = x2 - x1;
    const dy = y2 - y1;

    if (touchCount2 > 2 && fractalParam === 'julia') {
        viewPort.cr /= Math.pow(2, dx / canvas.height);
        viewPort.ci /= Math.pow(2, dy / canvas.height);
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
    setUrlParams();

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
                throttledSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case '-':
                viewPort.z *= ZOOM_FACTOR;
                throttledSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'f':
                toggleFullscreen();
                event.preventDefault();
                break;

            case 'h':
                if (helpEl.classList.contains('hidden')) {
                    helpEl.classList.remove('hidden');
                } else {
                    helpEl.classList.add('hidden');
                }
                event.preventDefault();
                break;

            case 'i':
                if (ITERATIONS < 10000) {
                    if (ITERATIONS >= 1000) {
                        ITERATIONS += 1000;
                    } else if (ITERATIONS >= 100) {
                        ITERATIONS += 100;
                    } else if (ITERATIONS >= 10) {
                        ITERATIONS += 10;
                    } else {
                        ITERATIONS += 1;
                    }
                    showMessage(`increased iterations to ${ITERATIONS}`);
                    setFractal();
                    redraw();
                    throttledSetUrlParams();
                }
                event.preventDefault();
                break;

            case 'I':
                if (ITERATIONS > 1) {
                    if (ITERATIONS > 1000) {
                        ITERATIONS -= 1000;
                    } else if (ITERATIONS > 100) {
                        ITERATIONS -= 100;
                    } else if (ITERATIONS > 10) {
                        ITERATIONS -= 10;
                    } else {
                        ITERATIONS -= 1;
                    }
                    showMessage(`decreased iterations to ${ITERATIONS}`);
                    setFractal();
                    redraw();
                    throttledSetUrlParams();
                }
                event.preventDefault();
                break;

            case 't':
                if (THRESHOLD < 10000) {
                    if (THRESHOLD >= 1000) {
                        THRESHOLD += 1000;
                    } else if (THRESHOLD >= 100) {
                        THRESHOLD += 100;
                    } else if (THRESHOLD >= 10) {
                        THRESHOLD += 10;
                    } else {
                        THRESHOLD += 1;
                    }
                    showMessage(`increased threshold to ${THRESHOLD}`);
                    setFractal();
                    redraw();
                    throttledSetUrlParams();
                }
                event.preventDefault();
                break;

            case 'T':
                if (THRESHOLD > 1) {
                    if (THRESHOLD > 1000) {
                        THRESHOLD -= 1000;
                    } else if (THRESHOLD > 100) {
                        THRESHOLD -= 100;
                    } else if (THRESHOLD > 10) {
                        THRESHOLD -= 10;
                    } else {
                        THRESHOLD -= 1;
                    }
                    showMessage(`decreased threshold to ${THRESHOLD}`);
                    setFractal();
                    redraw();
                    throttledSetUrlParams();
                }
                event.preventDefault();
                break;

            case 'p':
                playAnimation(ANIMATION);
                event.preventDefault();
                break;

            case 'P':
                if (ANIMATION) {
                    const animation = ANIMATION.slice().reverse();
                    for (let index = animation.length - 2; index >= 0; -- index) {
                        animation[index + 1].d = animation[index].d;
                    }
                    playAnimation(animation);
                }
                event.preventDefault();
                break;

            case 'a':
                if (!ANIMATION) {
                    ANIMATION = [];
                }
                const item = { ...viewPort, d: 1000 };
                ANIMATION.push(item);
                setUrlParams();
                showMessage(`added key-frame #${ANIMATION.length}: ${item.x}, ${item.y}, ${item.z}, ${item.d}, ${item.cr}, ${item.ci}`);
                event.preventDefault();
                break;

            case 'A':
                if (ANIMATION && ANIMATION.length > 0) {
                    const item = ANIMATION.pop();
                    if (ANIMATION.length === 0) {
                        ANIMATION = null;
                    }
                    setUrlParams();
                    showMessage(`removed key-frame #${ANIMATION.length + 1}: ${item.x}, ${item.y}, ${item.z}, ${item.d}, ${item.cr}, ${item.ci}`);
                } else {
                    showMessage('no more key-frames to remove');
                }
                event.preventDefault();
                break;

            case 'u':
                if (ANIMATION && ANIMATION.length > 0) {
                    const item = ANIMATION[ANIMATION.length - 1];
                    item.x  = viewPort.x;
                    item.y  = viewPort.y;
                    item.z  = viewPort.z;
                    item.cr = viewPort.cr;
                    item.ci = viewPort.ci;
                    showMessage(`updated key-frame #${ANIMATION.length} to: ${item.x}, ${item.y}, ${item.z}, ${item.d}, ${item.cr}, ${item.ci}`);
                } else {
                    showMessage(`no animation`);
                }
                event.preventDefault();
                break;

            case 'd':
                if (ANIMATION && ANIMATION.length > 0) {
                    const item = ANIMATION[ANIMATION.length - 1];
                    item.d += event.altKey ? 100 : 1000;
                    setUrlParams();
                    showMessage(`increased duration of key-frame #${ANIMATION.length} to ${item.d}`);
                } else {
                    showMessage(`no animation`);
                }
                event.preventDefault();
                break;

            case 'D':
                if (ANIMATION && ANIMATION.length > 0) {
                    const item = ANIMATION[ANIMATION.length - 1];
                    item.d = Math.max(0, item.d - event.altKey ? 100 : 1000);
                    setUrlParams();
                    showMessage(`decreased duration of key-frame #${ANIMATION.length} to ${item.d}`);
                } else {
                    showMessage(`no animation`);
                }
                event.preventDefault();
                break;

            case 'ArrowRight':
                if (event.ctrlKey) {
                    viewPort.cr *= event.shiftKey ? CR_FACTOR_FINE : CR_FACTOR;
                } else {
                    viewPort.x += 0.1 * viewPort.z;
                }
                throttledSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowLeft':
                if (event.ctrlKey) {
                    viewPort.cr /= event.shiftKey ? CR_FACTOR_FINE : CR_FACTOR;
                } else {
                    viewPort.x -= 0.1 * viewPort.z;
                }
                throttledSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowUp':
                if (event.ctrlKey) {
                    viewPort.ci *= event.shiftKey ? CI_FACTOR_FINE : CI_FACTOR;
                } else {
                    viewPort.y += 0.1 * viewPort.z;
                }
                throttledSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowDown':
                if (event.ctrlKey) {
                    viewPort.ci /= event.shiftKey ? CI_FACTOR_FINE : CI_FACTOR;
                } else {
                    viewPort.y -= 0.1 * viewPort.z;
                }
                throttledSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'Escape':
                stopAnimation();
                event.preventDefault();
                break;

            case 'm':
                fractalParam = 'mandelbrot';
                setFractal();
                redraw();
                setUrlParams();
                event.preventDefault();
                break;

            case 'j':
                fractalParam = 'julia';
                setFractal();
                redraw();
                setUrlParams();
                event.preventDefault();
                break;

            default:
                // console.log(event);
                break;
        }
    } catch (error) {
        console.error(error);
        alert(String(error));
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
        setUrlParams();
        redraw();
        return;
    }

    const z1 = viewPort.z;
    const z2 = event.deltaY < 0 ? z1 / ZOOM_FACTOR : z1 * ZOOM_FACTOR;

    const x = event.clientX * window.devicePixelRatio;
    const y = event.clientY * window.devicePixelRatio;

    const dx = (x - canvas.width  * 0.5) / canvas.height;
    const dy = (y - canvas.height * 0.5) / canvas.height;

    viewPort.x += dx * z1 - dx * z2;
    viewPort.y -= dy * z1 - dy * z2;
    viewPort.z = z2;

    setUrlParams();
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
    let fragmentCode = fractalParam === 'julia' ?
        getJuliaCode(ITERATIONS, THRESHOLD) :
        getMandelbrotCode(ITERATIONS, THRESHOLD);

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
    let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    setFractal = function setFractal () {
        try {
            gl.detachShader(program, fragmentShader);
            gl.deleteShader(fragmentShader);

            fragmentCode = fractalParam === 'julia' ?
                getJuliaCode(ITERATIONS, THRESHOLD) :
                getMandelbrotCode(ITERATIONS, THRESHOLD);

            fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
            gl.attachShader(program, fragmentShader);
            linkProgram();
        } catch (error) {
            console.error(error);
            alert(`Error changing fractal: ${error}`);
        }
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

    let w = canvas.width;
    let h = canvas.height;

    linkProgram();
    gl.useProgram(program);

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
    if (ANIMATION) {
        playAnimation(ANIMATION);
    } else {
        redraw();
        showCursor();
    }
} catch (error) {
    console.error(error);
    alert(`Error initializing: ${error}`);
}
