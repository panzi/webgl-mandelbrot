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

    for (int i = 0; i < 500; ++ i) {
        float zx = z.x*z.x - z.y*z.y + x;
        z.y = 2.0 * z.x*z.y + y;
        z.x = zx;
        if (abs(zx) > 4.0) {
            float v = float(i) / 200.0;

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

const mousePos = {
    x: 0,
    y: 0,
};

const viewPort = {
    x: -0.25,
    y: 0,
    z: 2.5,
};

/*
window.onclick = function (event) {
    viewPort.x += -0.5 * (canvas.width / canvas.height) * viewPort.z + event.clientX * window.devicePixelRatio / canvas.height * viewPort.z;
    viewPort.y -= -0.5 * viewPort.z + event.clientY * window.devicePixelRatio / canvas.height * viewPort.z;
    redraw();
};
*/

let hideCursorTimer = null;

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
    fps.classList.add('hidden');
    showCursor();
    grabbing = false;
    canvas.classList.remove('grabbing');
}

window.onmousemove = function (event) {
    showCursor();
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

const ZOOM_FACTOR = 1.25;

window.onkeydown = function (event) {
    switch (event.key) {
        case '+':
            viewPort.z /= ZOOM_FACTOR;
            redraw();
            break;

        case '-':
            viewPort.z *= ZOOM_FACTOR;
            redraw();
            break;

        case 'f':
            toggleFullscreen();
            break;

        case 'ArrowRight':
            viewPort.x += 0.1 * viewPort.z;
            redraw();
            break;

        case 'ArrowLeft':
            viewPort.x -= 0.1 * viewPort.z;
            redraw();
            break;

        case 'ArrowUp':
            viewPort.y += 0.1 * viewPort.z;
            redraw();
            break;

        case 'ArrowDown':
            viewPort.y -= 0.1 * viewPort.z;
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

    const z0 = viewPort.z;
    const z = event.deltaY < 0 ? z0 / ZOOM_FACTOR : z0 * ZOOM_FACTOR;

    const x = event.clientX * window.devicePixelRatio;
    const y = event.clientY * window.devicePixelRatio;

    const dx = (x - canvas.width  * 0.5) / canvas.height;
    const dy = (y - canvas.height * 0.5) / canvas.height;

    viewPort.x += dx * z0 - dx * z;
    viewPort.y -= dy * z0 - dy * z;
    viewPort.z = z;

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

setup();
redraw();
showCursor();
