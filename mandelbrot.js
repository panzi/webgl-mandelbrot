
const canvas = document.getElementById("canvas");
const vertexCode = document.getElementById("vertex").textContent;
const fragmentCode = document.getElementById("fragment").textContent;
let redraw;

function resizeCanvas() {
    canvas.style.width  = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    canvas.width  = window.devicePixelRatio * window.innerWidth;
    canvas.height = window.devicePixelRatio * window.innerHeight;
}

function throttle(func, delay) {
    let args;
    let self;
    let timer = null;
    return function () {
        args = arguments;
        self = this;
        if (timer === null) {
            timer = setTimeout(function () {
                timer = null;
                func.apply(this, args);
            }, delay);
        }
    };
}

window.onresize = function () {
    resizeCanvas();
    redraw();
};

window.ondblclick = function () {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        canvas.requestFullscreen();
    }
};

resizeCanvas();

let grabbing = false;
const mousePos = {
    x: 0,
    y: 0,
};
const viewPort = {
    x: -0.25,
    y: 0,
    z: 2,
};
/*
window.onclick = function (event) {
    viewPort.x += -0.5 * (canvas.width / canvas.height) * viewPort.z + event.clientX * window.devicePixelRatio / canvas.height * viewPort.z;
    viewPort.y -= -0.5 * viewPort.z + event.clientY * window.devicePixelRatio / canvas.height * viewPort.z;
    redraw();
};
*/
window.onmousedown = function (event) {
    canvas.className = 'grabbing';
    grabbing = true;
    mousePos.x = event.clientX * window.devicePixelRatio;
    mousePos.y = event.clientY * window.devicePixelRatio;
};

window.onmouseup = function (event) {
    grabbing = false;
    canvas.className = '';
}

window.onmousemove = throttle(function (event) {
    const x = event.clientX * window.devicePixelRatio;
    const y = event.clientY * window.devicePixelRatio;
    if (grabbing) {
        viewPort.x -= (x - mousePos.x) / canvas.height * viewPort.z;
        viewPort.y += (y - mousePos.y) / canvas.height * viewPort.z;
        redraw();
    }
    mousePos.x = x;
    mousePos.y = y;
}, 50);

window.onwheel = function (event) {
    if (event.deltaY === 0) {
        return;
    }

    const z0 = viewPort.z;
    const z = event.deltaY < 0 ? z0 * 0.75 : z0 / 0.75;

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
    }
}

setup();
redraw();
