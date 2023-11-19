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

const params = new URLSearchParams(location.search);

const iterationsParam = params.get('iterations');
const thresholdParam = params.get('threshold');
const animationParam = params.get('animation');

let animationFPS = +params.get('fps', '12');

if (isNaN(animationFPS) || animationFPS < 0) {
    animationFPS = 12;
} else if (animationFPS > 120) {
    animationFPS = 120;
}

const DEFAULT_ITERATIONS = 500;
const DEFAULT_THRESHOLD = 4.0;
// file:///home/panzi/src/html/mandelbrot/index.html?animation=-0.8269631235223067,-0.7110330380891499,18.62645149230957%200.3072072708754504,-0.4839597324466828,0.00005575186299632657,5000%200.3072072708754504,-0.4839597324466828,0.00005575186299632657,1000%20-0.8269631235223067,-0.7110330380891499,18.62645149230957,5000
const ITERATIONS = iterationsParam ? nanColesce(clamp(parseInt(iterationsParam, 10), 0, 2000), DEFAULT_ITERATIONS) : DEFAULT_ITERATIONS;
const THRESHOLD = thresholdParam ? nanColesce(clamp(parseFloat(thresholdParam), 0, 1000), DEFAULT_THRESHOLD) : DEFAULT_THRESHOLD;
const ANIMATION = animationParam ? animationParam.split(/\s+/).map(pos => {
    const step = pos ? pos.split(',').map(Number) : [];
    const [x, y, z, d] = step;
    if (isNaN(x)) {
        step[0] = -0.5;
    }
    if (isNaN(y)) {
        step[1] = 0;
    }
    if (isNaN(z) || z <= 0) {
        step[2] = 2.5;
    }
    if (isNaN(d) || d < 0) {
        step[3] = 1000;
    }
    return step;
}) : null;

const ZOOM_FACTOR = 1.25;

const vertexCode = `\
#version 300 es

in vec4 vertexPosition;

void main() {
    gl_Position = vertexPosition;
}
`;

const fragmentCode = `\
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

    for (int i = 0; i < ${ITERATIONS}; ++ i) {
        float zx = z.x*z.x - z.y*z.y + x;
        z.y = 2.0 * z.x*z.y + y;
        z.x = zx;
        float a = z.x*z.x + z.y*z.y;
        if (a > ${toFloatStr(THRESHOLD * THRESHOLD)}) {
            float v = (float(i + 1) - log(log2(sqrt(a)))) * 0.005;

            fragColor.xyz = hsv2rgb(vec3(1.0 - mod(v + 1.0/3.0, 1.0), 1.0, 1.0));
            fragColor.w = 1.0;
            return;
        }
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

const canvas = document.getElementById("canvas");
const fps = document.getElementById("fps");

let redraw;

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
};

function getUrlHash() {
    if (location.hash.startsWith('#!')) {
        const [x, y, z] = location.hash.slice(2).split(',');
        viewPort.x = nanColesce(+x, viewPort.x);
        viewPort.y = nanColesce(+y, viewPort.y);
        viewPort.z = nanColesce(+z, viewPort.z);
    }
}

function setUrlHash() {
    history.replaceState(null, null, `#!${viewPort.x},${viewPort.y},${viewPort.z}`);
}

getUrlHash();

window.onhashchange = function () {
    getUrlHash();
    redraw();
};

/*
window.onclick = function (event) {
    viewPort.x += -0.5 * (canvas.width / canvas.height) * viewPort.z + event.clientX * window.devicePixelRatio / canvas.height * viewPort.z;
    viewPort.y -= -0.5 * viewPort.z + event.clientY * window.devicePixelRatio / canvas.height * viewPort.z;
    setUrlHash();
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

window.onmousedown = function (event) {
    if (touching || animating) return;
    canvas.classList.add('grabbing');
    canvas.classList.remove('cursorHidden');
    fps.classList.remove('hidden');
    if (hideCursorTimer !== null) {
        clearTimeout(hideCursorTimer);
    }
    grabbing = true;
    mousePos.x = event.clientX * window.devicePixelRatio;
    mousePos.y = event.clientY * window.devicePixelRatio;
};

window.onmouseup = function (event) {
    setUrlHash();
    if (!touching) {
        fps.classList.add('hidden');
    }
    if (!animating) {
        showCursor();
    }
    grabbing = false;
    canvas.classList.remove('grabbing');
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
window.ontouchstart = function (event) {
    if (grabbing || animating) return;
    touching = true;
    fps.classList.remove('hidden');

    for (const touch of event.changedTouches) {
        const x = touch.clientX * window.devicePixelRatio;
        const y = touch.clientY * window.devicePixelRatio;
        activeTouches.set(touch.identifier, { x, y });
    }

    refreshActviveCenter();
};

/**
 * @param {TouchEvent} event 
 */
window.ontouchmove = function (event) {
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

    viewPort.x -= dx / canvas.height * viewPort.z;
    viewPort.y += dy / canvas.height * viewPort.z;

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
};

/**
 * @param {TouchEvent} event 
 */
function handleTouchEnd (event) {
    setUrlHash();

    for (const touch of event.changedTouches) {
        activeTouches.delete(touch.identifier);
    }

    if (activeTouches.size === 0) {
        touching = false;
        if (!grabbing) {
            fps.classList.add('hidden');
        }
    }
}

window.ontouchend = handleTouchEnd;
window.ontouchcancel = handleTouchEnd;

window.onkeydown = function (event) {
    switch (event.key) {
        case '+':
            viewPort.z /= ZOOM_FACTOR;
            setUrlHash();
            redraw();
            break;

        case '-':
            viewPort.z *= ZOOM_FACTOR;
            setUrlHash();
            redraw();
            break;

        case 'f':
            toggleFullscreen();
            break;

        case 'ArrowRight':
            viewPort.x += 0.1 * viewPort.z;
            setUrlHash();
            redraw();
            break;

        case 'ArrowLeft':
            viewPort.x -= 0.1 * viewPort.z;
            setUrlHash();
            redraw();
            break;

        case 'ArrowUp':
            viewPort.y += 0.1 * viewPort.z;
            setUrlHash();
            redraw();
            break;

        case 'ArrowDown':
            viewPort.y -= 0.1 * viewPort.z;
            setUrlHash();
            redraw();
            break;

        default:
            // console.log(event);
            break;
    }
};

window.onwheel = function (event) {
    if (event.deltaY === 0) {
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

    setUrlHash();
    redraw();
};

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
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexCode));
    gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragmentCode));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

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

    const vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
    gl.enableVertexAttribArray(vertexPosition);
    gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);

    const canvasSizeUniform = gl.getUniformLocation(program, 'canvasSize');
    const viewPortUniform = gl.getUniformLocation(program, 'viewPort');

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

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length);

        const now = Date.now();
        const duration = (now - timestamp) / 1000;
        const fpsVal = 1 / duration;
        fps.innerHTML = `${fpsVal > 1.0 ? Math.round(fpsVal) : fpsVal.toFixed(1)} fps`;
        timestamp = now;
    }
}

function playAnimation() {
    if (animationTimer !== null) {
        clearInterval(animationTimer);
        animationTimer = null;
    }

    viewPort.x = ANIMATION[0][0];
    viewPort.y = ANIMATION[0][1];
    viewPort.z = ANIMATION[0][2];
    redraw();

    if (ANIMATION.length < 2) {
        return;
    }

    animating = true;
    hideCursor();
    let animationIndex = 0;
    let timestamp = Date.now();
    animationTimer = setInterval(function () {
        const now = Date.now();
        const [x1, y1, z1, _] = ANIMATION[animationIndex];
        const [x2, y2, z2, d] = ANIMATION[animationIndex + 1];
        let interp = (now - timestamp) / d;
        if (interp > 1) {
            viewPort.x = x2;
            viewPort.y = y2;
            viewPort.z = z2;
            timestamp = now;
            ++ animationIndex;
            if (animationIndex + 1 >= ANIMATION.length) {
                clearInterval(animationTimer);
                animating = false;
                animationTimer = null;
            }
        } else if (x1 == x2 && y1 == y2 && z1 == z2) {
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
        }
        redraw();
    }, 1000/animationFPS);
}

try {
    if (ANIMATION) {
        setup();
        playAnimation();
    } else {
        setup();
        redraw();
        showCursor();
    }
} catch (error) {
    console.error(error);
    alert(`Error initializing: ${error}`);
}
