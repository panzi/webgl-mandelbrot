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
    // cheaper, less accurate conversion which is also applied in reverse in the shader
    return Math.pow(f, 2.2);
    // return (
    //     f < 0.04045 ? f / 12.92 :
    //     Math.pow((f + 0.055) / 1.055, 2.4)
    // );
}

function glslColorRGB8AsLinear(r, g, b, a) {
    const x = sRgb8ToLinear(r);
    const y = sRgb8ToLinear(g);
    const z = sRgb8ToLinear(b);

    if (a == undefined) {
        return `vec3(${toFloatStr(x)}, ${toFloatStr(y)}, ${toFloatStr(z)})`;
    } else {
        return `vec4(${toFloatStr(x)}, ${toFloatStr(y)}, ${toFloatStr(z)}, ${toFloatStr(a)})`;
    }
}

function glslColorRGB8(r, g, b, a) {
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

const FRACTAL_NAMES = {
    julia: 'Julia',
    mandelbrot: 'Mandelbrot',
    phoenix: 'Phoenix',
};

const params = new URLSearchParams(location.search);

const INPUT_THROTTLE_MS = 250;

const DEFAULT_ITERATIONS = 500;
const DEFAULT_THRESHOLD = 4.0;
const DEFAULT_FPS = 12;
const DEFAULT_COLORS = 'BGR';
const DEFAULT_COLORSPACE = 'srgb';
const DEFAULT_SMOOTH = true;

const MAX_ITERATIONS = 10000;
const MAX_THRESHOLD = 10000;
const MAX_FPS = 120;

const iterationsParam = params.get('iterations');
const thresholdParam = params.get('threshold');
const animationParam = params.get('animation');
const colorsParam = (params.get('colors') || '').trim() || DEFAULT_COLORS;
const colorSpaceParam = (params.get('colorspace') || '').trim() || DEFAULT_COLORSPACE;

let smooth = (params.get('smooth') || '').trim().toLowerCase() !== 'false';
let fractal = (params.get('fractal') || '').trim().toLowerCase() || 'mandelbrot';
let animationFPS = parseFloat(params.get('fps'));

if (!isFinite(animationFPS) || animationFPS < 0) {
    animationFPS = DEFAULT_FPS;
} else if (animationFPS > MAX_FPS) {
    animationFPS = MAX_FPS;
}

document.getElementById('fps-input').value = animationFPS;
document.getElementById('smooth-input').checked = smooth;

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
const SMALL_ZOOM_FACTOR = 1.025;

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
    fragColor.xyz = mix(${glslColorRGB8(0, 7, 100)}, ${glslColorRGB8(32, 107, 203)}, t);
} else if (v < 0.42) {
    t = (v - 0.16) / (0.42 - 0.16);
    fragColor.xyz = mix(${glslColorRGB8(32, 107, 203)}, ${glslColorRGB8(237, 255, 255)}, t);
} else if (v < 0.6425) {
    t = (v - 0.42) / (0.6425 - 0.42);
    fragColor.xyz = mix(${glslColorRGB8(237, 255, 255)}, ${glslColorRGB8(255, 170, 0)}, t);
} else if (v < 0.8575) {
    t = (v - 0.6425) / (0.8575 - 0.6425);
    fragColor.xyz = mix(${glslColorRGB8(255, 170, 0)}, ${glslColorRGB8(0, 2, 0)}, t);
} else {
    t = (v - 0.8575) / (1.0 - 0.8575);
    fragColor.xyz = mix(${glslColorRGB8(0, 2, 0)}, ${glslColorRGB8(0, 7, 100)}, t);
}
fragColor.w = 1.0;`,

    horizonL: `\
v *= 0.005;
v = mod(v, 1.0);
float t;
if (v < 0.16) {
    t = v / 0.16;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(0, 7, 100)}, ${glslColorRGB8AsLinear(32, 107, 203)}, t);
} else if (v < 0.42) {
    t = (v - 0.16) / (0.42 - 0.16);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(32, 107, 203)}, ${glslColorRGB8AsLinear(237, 255, 255)}, t);
} else if (v < 0.6425) {
    t = (v - 0.42) / (0.6425 - 0.42);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(237, 255, 255)}, ${glslColorRGB8AsLinear(255, 170, 0)}, t);
} else if (v < 0.8575) {
    t = (v - 0.6425) / (0.8575 - 0.6425);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(255, 170, 0)}, ${glslColorRGB8AsLinear(0, 2, 0)}, t);
} else {
    t = (v - 0.8575) / (1.0 - 0.8575);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(0, 2, 0)}, ${glslColorRGB8AsLinear(0, 7, 100)}, t);
}
fragColor.w = 1.0;`,

    horizonC: `\
v *= 0.005;
v = mod(v, 1.0);
float t;
if (v < 0.16) {
    t = v / 0.16;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(0, 7, 100)}, ${glslColorRGB8AsLinear(32, 107, 203)}, t);
} else if (v < 0.42) {
    t = (v - 0.16) / (0.42 - 0.16);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(32, 107, 203)}, ${glslColorRGB8AsLinear(237, 255, 255)}, t);
} else if (v < 0.6425) {
    t = (v - 0.42) / (0.6425 - 0.42);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(237, 255, 255)}, ${glslColorRGB8AsLinear(255, 170, 0)}, t);
} else if (v < 0.8575) {
    t = (v - 0.6425) / (0.8575 - 0.6425);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(255, 170, 0)}, ${glslColorRGB8AsLinear(0, 2, 0)}, t);
} else {
    t = (v - 0.8575) / (1.0 - 0.8575);
    fragColor.xyz = mix(${glslColorRGB8AsLinear(0, 2, 0)}, ${glslColorRGB8AsLinear(0, 7, 100)}, t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    custom: `\
// same as Horizon (sRGB), but with different scaling of v
v *= 0.015;
v = mod(v, 1.0);
float t;
if (v < 0.16) {
    t = v / 0.16;
    fragColor.xyz = mix(${glslColorRGB8(0, 7, 100)}, ${glslColorRGB8(32, 107, 203)}, t);
} else if (v < 0.42) {
    t = (v - 0.16) / (0.42 - 0.16);
    fragColor.xyz = mix(${glslColorRGB8(32, 107, 203)}, ${glslColorRGB8(237, 255, 255)}, t);
} else if (v < 0.6425) {
    t = (v - 0.42) / (0.6425 - 0.42);
    fragColor.xyz = mix(${glslColorRGB8(237, 255, 255)}, ${glslColorRGB8(255, 170, 0)}, t);
} else if (v < 0.8575) {
    t = (v - 0.6425) / (0.8575 - 0.6425);
    fragColor.xyz = mix(${glslColorRGB8(255, 170, 0)}, ${glslColorRGB8(0, 2, 0)}, t);
} else {
    t = (v - 0.8575) / (1.0 - 0.8575);
    fragColor.xyz = mix(${glslColorRGB8(0, 2, 0)}, ${glslColorRGB8(0, 7, 100)}, t);
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

    gay: `\
v *= 0.05;
v = mod(v, 1.0);
if (v < 1.0/6.0) {
    fragColor = ${glslColorRGB8(209, 48, 28, 1.0)};
} else if (v < 2.0/6.0) {
    fragColor = ${glslColorRGB8(228, 142, 45, 1.0)};
} else if (v < 3.0/6.0) {
    fragColor = ${glslColorRGB8(252, 239, 69, 1.0)};
} else if (v < 4.0/6.0) {
    fragColor = ${glslColorRGB8(58, 128, 41, 1.0)};
} else if (v < 5.0/6.0) {
    fragColor = ${glslColorRGB8(30, 72, 248, 1.0)};
} else {
    fragColor = ${glslColorRGB8(108, 18, 134, 1.0)};
}`,

    gayGrad: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 1.0/6.0) {
    t = v * 6.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(209, 48, 28)}, ${glslColorRGB8AsLinear(228, 142, 45)}, t);
} else if (v < 2.0/6.0) {
    t = (v - 1.0/6.0) * 6.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(228, 142, 45)}, ${glslColorRGB8AsLinear(252, 239, 69)}, t);
} else if (v < 3.0/6.0) {
    t = (v - 2.0/6.0) * 6.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(252, 239, 69)}, ${glslColorRGB8AsLinear(58, 128, 41)}, t);
} else if (v < 4.0/6.0) {
    t = (v - 3.0/6.0) * 6.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(58, 128, 41)}, ${glslColorRGB8AsLinear(30, 72, 248)}, t);
} else if (v < 5.0/6.0) {
    t = (v - 4.0/6.0) * 6.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(30, 72, 248)}, ${glslColorRGB8AsLinear(108, 18, 134)}, t);
} else {
    t = (v - 5.0/6.0) * 6.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(108, 18, 134)}, ${glslColorRGB8AsLinear(209, 48, 28)}, t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    trans: `\
v *= 0.05;
v = mod(v, 2.0);
v = 1.0 - abs(v - 1.0);
if (v < 2.0/5.0) {
    fragColor = ${glslColorRGB8(124, 204, 247, 1.0)};
} else if (v < 4.0/5.0) {
    fragColor = ${glslColorRGB8(233, 174, 186, 1.0)};
} else {
    fragColor = vec4(1.0, 1.0, 1.0, 1.0);
}`,

    transGrad: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 1.0/5.0) {
    t = v * 5.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(124, 204, 247)}, ${glslColorRGB8AsLinear(233, 174, 186)}, t);
} else if (v < 2.0/5.0) {
    t = (v - 1.0/5.0) * 5.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(233, 174, 186)}, vec3(1.0, 1.0, 1.0), t);
} else if (v < 3.0/5.0) {
    t = (v - 2.0/5.0) * 5.0;
    fragColor.xyz = mix(vec3(1.0, 1.0, 1.0), ${glslColorRGB8AsLinear(233, 174, 186)}, t);
} else if (v < 4.0/5.0) {
    t = (v - 3.0/5.0) * 5.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(233, 174, 186)}, ${glslColorRGB8AsLinear(124, 204, 247)}, t);
} else {
    fragColor.xyz = ${glslColorRGB8AsLinear(124, 204, 247)};
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    bi: `\
v *= 0.05;
v = mod(v, 1.0);
if (v < 2.0/5.0) {
    fragColor = ${glslColorRGB8(196, 44, 112, 1.0)};
} else if (v < 3.0/5.0) {
    fragColor = ${glslColorRGB8(145, 82, 149, 1.0)};
} else {
    fragColor = ${glslColorRGB8(19, 51, 165, 1.0)};
}`,

    biGrad: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 2.0/5.0) {
    t = v * 2.5;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(196, 44, 112)}, ${glslColorRGB8AsLinear(145, 82, 149)}, t);
} else if (v < 3.0/5.0) {
    t = (v - 2.0/5.0) * 5.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(145, 82, 149)}, ${glslColorRGB8AsLinear(19, 51, 165)}, t);
} else {
    t = (v - 3.0/5.0) * 2.5;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(19, 51, 165)}, ${glslColorRGB8AsLinear(196, 44, 112)}, t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    pan: `\
v *= 0.05;
v = mod(v, 1.0);
if (v < 1.0/3.0) {
    fragColor = ${glslColorRGB8(233, 61, 141, 1.0)};
} else if (v < 2.0/3.0) {
    fragColor = ${glslColorRGB8(248, 219, 64, 1.0)};
} else {
    fragColor = ${glslColorRGB8(87, 175, 250, 1.0)};
}`,

    panGrad: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 1.0/3.0) {
    t = v * 3.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(233, 61, 141)}, ${glslColorRGB8AsLinear(248, 219, 64)}, t);
} else if (v < 2.0/3.0) {
    t = (v - 1.0/3.0) * 3.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(248, 219, 64)}, ${glslColorRGB8AsLinear(87, 175, 250)}, t);
} else {
    t = (v - 2.0/3.0) * 3.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(87, 175, 250)}, ${glslColorRGB8AsLinear(233, 61, 141)}, t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    nb: `\
v *= 0.05;
v = mod(v, 1.0);
if (v < 1.0/4.0) {
    fragColor = ${glslColorRGB8(253, 245, 84, 1.0)};
} else if (v < 2.0/4.0) {
    fragColor = vec4(1.0, 1.0, 1.0, 1.0);
} else if (v < 3.0/4.0) {
    fragColor = ${glslColorRGB8(146, 92, 204, 1.0)};
} else {
    fragColor = ${glslColorRGB8(41, 41, 41, 1.0)};
}`,

    nbGrad: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 1.0/4.0) {
    t = v * 4.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(253, 245, 84)}, vec3(1.0, 1.0, 1.0), t);
} else if (v < 2.0/4.0) {
    t = (v - 1.0/4.0) * 4.0;
    fragColor.xyz = mix(vec3(1.0, 1.0, 1.0), ${glslColorRGB8AsLinear(146, 92, 204)}, t);
} else if (v < 3.0/4.0) {
    t = (v - 2.0/4.0) * 4.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(146, 92, 204)}, ${glslColorRGB8AsLinear(41, 41, 41)}, t);
} else {
    t = (v - 3.0/4.0) * 4.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(41, 41, 41)}, ${glslColorRGB8AsLinear(253, 245, 84)}, t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    ace: `\
v *= 0.05;
v = mod(v, 1.0);
if (v < 1.0/4.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
} else if (v < 2.0/4.0) {
    fragColor = ${glslColorRGB8(146, 146, 146, 1.0)};
} else if (v < 3.0/4.0) {
    fragColor = ${glslColorRGB8(1.0, 1.0, 1.0, 1.0)};
} else {
    fragColor = ${glslColorRGB8(117, 21, 126, 1.0)};
}`,

    aceGrad: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 1.0/4.0) {
    t = v * 4.0;
    fragColor.xyz = mix(vec3(0.0, 0.0, 0.0), ${glslColorRGB8AsLinear(146, 146, 146)}, t);
} else if (v < 2.0/4.0) {
    t = (v - 1.0/4.0) * 4.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(146, 146, 146)}, vec3(1.0, 1.0, 1.0), t);
} else if (v < 3.0/4.0) {
    t = (v - 2.0/4.0) * 4.0;
    fragColor.xyz = mix(vec3(1.0, 1.0, 1.0), ${glslColorRGB8AsLinear(117, 21, 126)}, t);
} else {
    t = (v - 3.0/4.0) * 4.0;
    fragColor.xyz = mix(${glslColorRGB8AsLinear(117, 21, 126)}, vec3(0.0, 0.0, 0.0), t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    gpsFireIncandescent: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 0.382759) {
    t = v * 2.612610023539616;
    fragColor.xyz = mix(vec3(0.466667, 0.011765, 0.003922), vec3(0.5537209556597148, 0.08712517533638242, 0.0026225438196829567), t);
} else if (v < 0.572414) {
    t = (v - 0.382759) * 5.272732066120061;
    fragColor.xyz = mix(vec3(0.5537209556597148, 0.08712517533638242, 0.0026225438196829567), vec3(0.729412, 0.239216, 0.0), t);
} else if (v < 0.852874) {
    t = (v - 0.572414) * 3.5655708478927473;
    fragColor.xyz = mix(vec3(0.729412, 0.239216, 0.0), vec3(0.7675229508909834, 0.29665862326574494, 0.013256044155533817), t);
} else if (v < 0.898851) {
    t = (v - 0.852874) * 21.75000543750139;
    fragColor.xyz = mix(vec3(0.7675229508909834, 0.29665862326574494, 0.013256044155533817), vec3(1.0, 0.647059, 0.094118), t);
} else if (v < 0.95977) {
    t = (v - 0.898851) * 16.41523990873125;
    fragColor.xyz = mix(vec3(1.0, 0.647059, 0.094118), vec3(1.0, 0.7702773701272381, 0.39358528519313074), t);
} else {
    t = (v - 0.95977) * 24.857071836937617;
    fragColor.xyz = mix(vec3(1.0, 0.7702773701272381, 0.39358528519313074), vec3(1.0, 0.956863, 0.847059), t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    gimpHorizon1: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 0.348915) {
    t = v * 2.8660275425246837;
    fragColor.xyz = mix(vec3(0.047059, 0.360784, 0.572549), vec3(0.3756587895030364, 0.5757939814666683, 0.7145366910792146), t);
} else if (v < 0.532554) {
    t = (v - 0.348915) * 5.445466376967856;
    fragColor.xyz = mix(vec3(0.3756587895030364, 0.5757939814666683, 0.7145366910792146), vec3(1.0, 0.984314, 0.984314), t);
} else if (v < 0.542571) {
    t = (v - 0.532554) * 99.83028850953326;
    fragColor.xyz = mix(vec3(1.0, 0.984314, 0.984314), vec3(0.5764708571428592, 0.49131685714285944, 0.4420168571428597), t);
} else if (v < 0.555927) {
    t = (v - 0.542571) * 74.87271638215077;
    fragColor.xyz = mix(vec3(0.5764708571428592, 0.49131685714285944, 0.4420168571428597), vec3(0.258824, 0.121569, 0.035294), t);
} else if (v < 0.582638) {
    t = (v - 0.555927) * 37.43775972445803;
    fragColor.xyz = mix(vec3(0.258824, 0.121569, 0.035294), vec3(0.651212062225824, 0.4869675976286534, 0.3072671206286005), t);
} else if (v < 0.612688) {
    t = (v - 0.582638) * 33.277870216306134;
    fragColor.xyz = mix(vec3(0.651212062225824, 0.4869675976286534, 0.3072671206286005), vec3(1.0, 0.811765, 0.54902), t);
} else if (v < 0.778798) {
    t = (v - 0.612688) * 6.020107157907412;
    fragColor.xyz = mix(vec3(1.0, 0.811765, 0.54902), vec3(0.6712711921897491, 0.483035687214469, 0.3014831376181238), t);
} else if (v < 0.948247) {
    t = (v - 0.778798) * 5.90148068150299;
    fragColor.xyz = mix(vec3(0.6712711921897491, 0.483035687214469, 0.3014831376181238), vec3(0.34902, 0.160784, 0.058824), t);
} else {
    t = (v - 0.948247) * 19.322551349680193;
    fragColor.xyz = mix(vec3(0.34902, 0.160784, 0.058824), vec3(1.0, 0.556863, 0.219608), t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    gimpHorizon2: `\
v *= 0.05;
v = mod(v, 1.0);
float t;
if (v < 0.290484) {
    t = v * 3.4425303975434103;
    fragColor.xyz = mix(vec3(0.047059, 0.360784, 0.572549), vec3(0.10119100969863715, 0.40569505983405696, 0.6086092072997721), t);
} else if (v < 0.348915) {
    t = (v - 0.290484) * 17.114203077133727;
    fragColor.xyz = mix(vec3(0.10119100969863715, 0.40569505983405696, 0.6086092072997721), vec3(0.370303, 0.628966, 0.787879), t);
} else if (v < 0.470785) {
    t = (v - 0.348915) * 8.20546483958316;
    fragColor.xyz = mix(vec3(0.370303, 0.628966, 0.787879), vec3(0.5821085205756946, 0.7484912131192176, 0.8539520755177277), t);
} else if (v < 0.532554) {
    t = (v - 0.470785) * 16.189350645145634;
    fragColor.xyz = mix(vec3(0.5821085205756946, 0.7484912131192176, 0.8539520755177277), vec3(1.0, 0.984314, 0.984314), t);
} else if (v < 0.542571) {
    t = (v - 0.532554) * 99.83028850953326;
    fragColor.xyz = mix(vec3(1.0, 0.984314, 0.984314), vec3(0.450884571428574, 0.4978374285714309, 0.5733642857142877), t);
} else if (v < 0.555927) {
    t = (v - 0.542571) * 74.87271638215077;
    fragColor.xyz = mix(vec3(0.450884571428574, 0.4978374285714309, 0.5733642857142877), vec3(0.039048, 0.13298, 0.265152), t);
} else if (v < 0.582638) {
    t = (v - 0.555927) * 37.43775972445803;
    fragColor.xyz = mix(vec3(0.039048, 0.13298, 0.265152), vec3(0.2949936774898257, 0.49858665685946324, 0.6277192979686755), t);
} else if (v < 0.612688) {
    t = (v - 0.582638) * 33.277870216306134;
    fragColor.xyz = mix(vec3(0.2949936774898257, 0.49858665685946324, 0.6277192979686755), vec3(0.5225, 0.823569, 0.95), t);
} else if (v < 0.754591) {
    t = (v - 0.612688) * 7.0470673629169225;
    fragColor.xyz = mix(vec3(0.5225, 0.823569, 0.95), vec3(0.24687488381459904, 0.3847763495166687, 0.5064653302763663), t);
} else {
    t = (v - 0.754591) * 4.074830181452188;
    fragColor.xyz = mix(vec3(0.24687488381459904, 0.3847763495166687, 0.5064653302763663), vec3(0.0875, 0.131053, 0.25), t);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

    fire: `\
v *= 0.03;
v = mod(v, 1.0);
float t;
if (v < 0.010217113665389528) {
    t = v * 97.875;
    fragColor.xyz = mix(vec3(0.0, 0.0, 0.0), vec3(0.4793278857142856, 0.0, 0.0), t);
} else if (v < 0.02979991485738612) {
    t = (v - 0.010217113665389528) * 51.06521739130435;
    fragColor.xyz = mix(vec3(0.4793278857142856, 0.0, 0.0), vec3(0.729412, 0.0, 0.0), t);
} else if (v < 0.31417624521072796) {
    t = (v - 0.02979991485738612) * 3.5164670658682637;
    fragColor.xyz = mix(vec3(0.729412, 0.0, 0.0), vec3(0.8080544652166989, 0.1346120868219872, 0.014904382064946313), t);
} else if (v < 0.4306887532693984) {
    t = (v - 0.31417624521072796) * 8.582769495412844;
    fragColor.xyz = mix(vec3(0.8080544652166989, 0.1346120868219872, 0.014904382064946313), vec3(1.0, 0.46316471957765515, 0.05128205128205132), t);
} else if (v < 0.5902353966870096) {
    t = (v - 0.4306887532693984) * 6.267759562841528;
    fragColor.xyz = mix(vec3(1.0, 0.4627450980392157, 0.050980392156862744), vec3(1.0, 0.6454532714469555, 0.04796519505460273), t);
} else if (v < 0.6822144725370531) {
    t = (v - 0.5902353966870096) * 10.872037914691953;
    fragColor.xyz = mix(vec3(1.0, 0.6454532714469555, 0.04796519505460273), vec3(1.0, 0.9623783494907132, 0.042735042735042694), t);
} else if (v < 0.7449869224062773) {
    t = (v - 0.6822144725370531) * 15.930555555555534;
    fragColor.xyz = mix(vec3(1.0, 0.9607843137254902, 0.043137254901960784), vec3(1.0, 0.9785392793148799, 0.5153121113492629), t);
} else if (v < 0.8478639930252834) {
    t = (v - 0.7449869224062773) * 9.72033898305085;
    fragColor.xyz = mix(vec3(1.0, 0.9785392793148799, 0.5153121113492629), vec3(1.0, 0.9893728176406091, 0.8034188034188035), t);
} else if (v < 0.8727114210985178) {
    t = (v - 0.8478639930252834) * 40.2456140350878;
    fragColor.xyz = mix(vec3(1.0, 0.9882352941176471, 0.803921568627451), vec3(1.0, 0.8925077911225806, 0.6667597732912364), t);
} else if (v < 0.8782460621541082) {
    t = (v - 0.8727114210985178) * 180.68019045064187;
    fragColor.xyz = mix(vec3(1.0, 0.8925077911225806, 0.6667597732912364), vec3(1.0, 0.4627450980392157, 0.050980392156862786), t);
} else if (v < 0.8837803320561941) {
    t = (v - 0.8782460621541082) * 180.69230769230938;
    fragColor.xyz = mix(vec3(1.0, 0.4627450980392157, 0.050980392156862744), vec3(0.48265816433877357, 0.22334769957637365, 0.024606102495702182), t);
} else if (v < 0.8897122929380994) {
    t = (v - 0.8837803320561941) * 168.5783200375405;
    fragColor.xyz = mix(vec3(0.48265816433877357, 0.22334769957637365, 0.024606102495702182), vec3(0.0, 0.0, 0.0), t);
} else {
    fragColor.xyz = vec3(0.0, 0.0, 0.0);
}
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;`,

}

function getMandelbrotCode(iterations, threshold, colorCode, smooth) {
    return `\
#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

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
        float zxzx = z.x*z.x;
        float zyzy = z.y*z.y;
        float dd = zxzx + zyzy;
        if (dd >= ${toFloatStr(threshold * threshold)}) {
            float v = ${smooth ?
                `float(i + 1) - log(log(dd)) * ${toFloatStr(1 / Math.log(2))}` :
                'float(i + 1)'
            };

            ${colorCode}
            return;
        }
        float zx = zxzx - zyzy + x;
        z.y = 2.0 * z.x*z.y + y;
        z.x = zx;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

function getJuliaCode(iterations, threshold, colorCode, smooth) {
    return `\
#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

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
        float zxzx = z.x*z.x;
        float zyzy = z.y*z.y;
        float dd = zxzx + zyzy;
        if (dd >= ${toFloatStr(threshold * threshold)}) {
            float v = ${smooth ?
                `float(i + 1) - log(log(dd)) * ${toFloatStr(1 / Math.log(2))}` :
                'float(i + 1)'
            };

            ${colorCode}
            return;
        }
        float zx = zxzx - zyzy + c.x;
        z.y = 2.0 * z.x*z.y + c.y;
        z.x = zx;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

function getPhoenixCode(iterations, threshold, colorCode, smooth) {
    return `\
#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

uniform vec2 canvasSize;
uniform vec3 viewPort;
uniform vec2 c;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Zn+1 = Zn^2 + Re(C) + Im(C) * Zn-1

void main() {
    float x = gl_FragCoord.x / canvasSize.y * viewPort.z + viewPort.x;
    float y = gl_FragCoord.y / canvasSize.y * viewPort.z + viewPort.y;
    vec2 z0 = vec2(0.0, 0.0);
    vec2 z = vec2(y, x);

    for (int i = 0; i < ${iterations}; ++ i) {
        float zxzx = z.x*z.x;
        float zyzy = z.y*z.y;

        float dd = zxzx + zyzy;
        if (dd >= ${toFloatStr(threshold * threshold)}) {
            float v = ${smooth ?
                `float(i + 1) - log(log(dd)) * ${toFloatStr(1 / Math.log(2))}` :
                'float(i + 1)'
            };

            ${colorCode}
            return;
        }
        float zx = zxzx - zyzy + c.x + c.y * z0.x;
        float zy = 2.0 * z.x*z.y + c.y * z0.y;

        z0 = z;
        z.x = zx;
        z.y = zy;
    }
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

let colors = colorsParam === 'horizon' ? 'horizonS' : colorsParam;
let colorCode = COLOR_CODES[colors] || COLOR_CODES[DEFAULT_COLORS];
document.getElementById('color-code-preset').value = colors || DEFAULT_COLORS;
document.getElementById('color-code').value = COLOR_CODES.custom;

if (colors === 'custom') {
    document.getElementById('derive-custom-color-code-row').classList.add('hidden');
    document.getElementById('custom-color-code-row').classList.remove('hidden');
} else {
    document.getElementById('derive-custom-color-code-row').classList.remove('hidden');
    document.getElementById('custom-color-code-row').classList.add('hidden');
}

function cycleColors(offset) {
    const presets = document.getElementById('color-code-preset');
    let index = (presets.options.selectedIndex + offset) % presets.options.length;
    if (index < 0) {
        index += presets.options.length;
    }
    const value = presets.options[index].value;
    presets.value = value;
    if (value === 'custom') {
        setColorCode(document.getElementById('color-code').value);
        document.getElementById('derive-custom-color-code-row').classList.add('hidden');
        document.getElementById('custom-color-code-row').classList.remove('hidden');
    } else {
        setColorCode(COLOR_CODES[value]);
        document.getElementById('derive-custom-color-code-row').classList.remove('hidden');
        document.getElementById('custom-color-code-row').classList.add('hidden');
    }
    colors = value;
    setUrlParams();
    showMessage(`set colors to ${presets.options[index].label}`, MSG_LEVEL_INFO);
}

const canvas = document.getElementById("canvas");
const fpsEl = document.getElementById("fps");
const messagesEl = document.getElementById("messages");
const helpEl = document.getElementById("help");

const MSG_LEVEL_INFO = 'info';
const MSG_LEVEL_WARNING = 'warn';
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

let gl;
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
            const filename = `${FRACTAL_NAMES[fractal] || fractal}.png`;
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
                        resolve();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                    }, 0);
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
let isAnimationFrame = false;

const mousePos = {
    x: 0,
    y: 0,
};

const DEFAULT_CR = -0.744;
const DEFAULT_CI = 0.148;

const DEFAULT_VIEW_PORTS = {
    mandelbrot: {
        x: -0.5,
        y: 0,
        z: 2.5,
        cr: DEFAULT_CR,
        ci: DEFAULT_CI,
    },
    julia: {
        x: 0,
        y: 0,
        z: 2,
        cr: DEFAULT_CR,
        ci: DEFAULT_CI,
    },
    phoenix: {
        x: 0,
        y: 0.05,
        z: 2,
        cr: 1/2 + 2/30, // 0.566666,
        ci: -0.5,
    },
};

const viewPort = {
    x: 0,
    y: 0,
    z: 1,
    cr: 0,
    ci: 0,
};

function getUrlHash() {
    const [x, y, z, cr, ci] = location.hash.startsWith('#!') ?
        location.hash.slice(2).split(',') : [];
    const defaultViewPort = DEFAULT_VIEW_PORTS[fractal] || DEFAULT_VIEW_PORTS.mandelbrot;
    viewPort.x = nanColesce(parseFloat(x), defaultViewPort.x);
    viewPort.y = nanColesce(parseFloat(y), defaultViewPort.y);
    viewPort.z = nanColesce(parseFloat(z), defaultViewPort.z);
    viewPort.cr = nanColesce(parseFloat(cr), defaultViewPort.cr);
    viewPort.ci = nanColesce(parseFloat(ci), defaultViewPort.ci);
}

function setUrlParams() {
    const params = [];
    if (fractal !== 'mandelbrot') {
        params.push(`fractal=${encodeURIComponent(fractal)}`);
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
    const colorSpace = gl.drawingBufferColorSpace;
    if (colorSpace !== DEFAULT_COLORSPACE) {
        params.push(`colorspace=${colorSpace}`);
    }
    if (smooth !== DEFAULT_SMOOTH) {
        params.push(`smooth=${smooth}`);
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
        if (event.ctrlKey && (fractal === 'julia' || fractal === 'phoenix')) {
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

let singleTouchTimestamp1 = 0;
let singleTouchTimestamp2 = 0;
let doubleTapTimeout = null;

/**
 * @param {TouchEvent} event 
 */
window.addEventListener('touchstart', function (event) {
    const isHelp = event.target === helpEl || (
        helpEl.compareDocumentPosition(event.target) & Node.DOCUMENT_POSITION_CONTAINED_BY
    ) !== 0;

    if (!isHelp) {
        event.preventDefault();
    }

    if (grabbing || animating) return;

    if (event.touches.length === 1) {
        const now = Date.now();
        if ((now - singleTouchTimestamp1) <= 500) {
            if (doubleTapTimeout !== null) {
                this.clearTimeout(doubleTapTimeout);
                doubleTapTimeout = null;
            }
            toggleHelp();
        } else if ((now - singleTouchTimestamp2) <= 250) {
            if (doubleTapTimeout === null) {
                doubleTapTimeout = setTimeout(() => {
                    doubleTapTimeout = null;
                    toggleFullscreen();
                }, 251);
            }
        }

        singleTouchTimestamp1 = singleTouchTimestamp2;
        singleTouchTimestamp2 = now;
    }

    if (isHelp) {
        return;
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

    if (touchCount2 > 2 && (fractal === 'julia' || fractal === 'phoenix')) {
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
 * @param {KeyboardEvent} event 
 */
window.onkeydown = function (event) {
    try {
        switch (event.key) {
            case '+':
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                viewPort.z /= event.shiftKey ? SMALL_ZOOM_FACTOR : ZOOM_FACTOR;
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case '-':
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                viewPort.z *= event.shiftKey ? SMALL_ZOOM_FACTOR : ZOOM_FACTOR;
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'f':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                toggleFullscreen();
                event.preventDefault();
                break;

            case 'h':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                toggleHelp();
                event.preventDefault();
                break;

            case 'i':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
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
                    document.getElementById('iterations-input').value = iterations;
                }
                event.preventDefault();
                break;

            case 'I':
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
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
                    document.getElementById('iterations-input').value = iterations;
                }
                event.preventDefault();
                break;

            case 't':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                if (threshold < MAX_THRESHOLD) {
                    if (threshold >= 1000) {
                        threshold += 1000;
                    } else if (threshold >= 100) {
                        threshold += 100;
                    } else if (threshold >= 10) {
                        threshold += 10;
                    } else if (threshold >= 2) {
                        threshold += 1;
                    } else if (threshold >= 1) {
                        threshold = (Math.ceil(threshold * 10) + 1) / 10;
                    } else {
                        threshold = (Math.ceil(threshold * 100) + 1) / 100;
                    }
                    showMessage(`increased threshold to ${threshold}`);
                    updateShader();
                    redraw();
                    debouncedSetUrlParams();
                    document.getElementById('threshold-input').value = threshold;
                }
                event.preventDefault();
                break;

            case 'T':
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                if (threshold > 0.01) {
                    if (threshold > 1000) {
                        threshold -= 1000;
                    } else if (threshold > 100) {
                        threshold -= 100;
                    } else if (threshold > 10) {
                        threshold -= 10;
                    } else if (threshold > 2) {
                        threshold -= 1;
                    } else if (threshold > 1) {
                        threshold = (Math.floor(threshold * 10) - 1) / 10;
                    } else {
                        threshold = (Math.floor(threshold * 100) - 1) / 100;
                    }
                    showMessage(`decreased threshold to ${threshold}`);
                    updateShader();
                    redraw();
                    debouncedSetUrlParams();
                    document.getElementById('threshold-input').value = threshold;
                }
                event.preventDefault();
                break;

            case 'p':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                playAnimation(animation);
                event.preventDefault();
                break;

            case 'P':
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                if (animation) {
                    const revAnimation = animation.slice().reverse();
                    for (let index = revAnimation.length - 2; index >= 0; -- index) {
                        revAnimation[index + 1].d = revAnimation[index].d;
                    }
                    playAnimation(revAnimation);
                }
                event.preventDefault();
                break;

            case 'l':
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                if (animation) {
                    const revAnimation = animation.slice().reverse();
                    for (let index = revAnimation.length - 2; index >= 0; -- index) {
                        revAnimation[index + 1].d = revAnimation[index].d;
                    }
                    revAnimation.shift();
                    playAnimation([ ...animation, ...revAnimation ], true);
                }
                event.preventDefault();
                break;

            case 'a':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
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
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                if (animation && animation.length > 0) {
                    const framenr = animation.length;
                    const item = animation.pop();
                    if (animation.length === 0) {
                        animation = null;
                    }
                    setUrlParams();
                    showMessage(`removed key-frame #${framenr}: ${item.x}, ${item.y}, ${item.z}, ${item.d}, ${item.cr}, ${item.ci}`);
                } else {
                    showMessage('no more key-frames to remove');
                }
                event.preventDefault();
                break;

            case 'u':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
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
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
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
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
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
                if (event.metaKey) {
                    break;
                }
                if (event.altKey) {
                    if (event.ctrlKey || event.shiftKey) {
                        break;
                    }
                    // common browser hotkey: history back
                    return;
                }
                if (event.ctrlKey) {
                    viewPort.cr += event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.x += (event.shiftKey ? 0.01 : 0.1) * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowLeft':
                if (event.metaKey) {
                    break;
                }
                if (event.altKey) {
                    if (event.ctrlKey || event.shiftKey) {
                        break;
                    }
                    // common browser hotkey: history forward
                    return;
                }
                if (event.ctrlKey) {
                    viewPort.cr -= event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.x -= (event.shiftKey ? 0.01 : 0.1) * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowUp':
                if (event.altKey || event.metaKey) {
                    break;
                }
                if (event.ctrlKey) {
                    viewPort.ci += event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.y += (event.shiftKey ? 0.01 : 0.1) * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'ArrowDown':
                if (event.altKey || event.metaKey) {
                    break;
                }
                if (event.ctrlKey) {
                    viewPort.ci -= event.shiftKey ? 0.0001 : 0.001;
                } else {
                    viewPort.y -= (event.shiftKey ? 0.01 : 0.1) * viewPort.z;
                }
                debouncedSetUrlParams();
                redraw();
                event.preventDefault();
                break;

            case 'Escape':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                if (!helpEl.classList.contains('hidden')) {
                    helpEl.classList.add('hidden');
                } else {
                    stopAnimation();
                }
                event.preventDefault();
                break;

            case 'Home':
            {
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }

                const newViewPort = DEFAULT_VIEW_PORTS[fractal] || DEFAULT_VIEW_PORTS.mandelbrot;
                viewPort.x = newViewPort.x;
                viewPort.y = newViewPort.y;
                viewPort.z = newViewPort.z;
                if (event.shiftKey) {
                    viewPort.cr = newViewPort.cr;
                    viewPort.ci = newViewPort.ci;
                }

                redraw();
                setUrlParams();
                event.preventDefault();
                break;
            }
            case 'PageUp':
            {
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                const fractalEl = document.getElementById('fractal-input');
                const index = (fractalEl.options.selectedIndex + 1) % fractalEl.options.length;
                const value = fractalEl.options[index].value;
                fractal = value;
                const name = document.title = FRACTAL_NAMES[fractal] || fractal;
                if (event.shiftKey) {
                    const newViewPort = DEFAULT_VIEW_PORTS[fractal] || DEFAULT_VIEW_PORTS.mandelbrot;
                    viewPort.x = newViewPort.x;
                    viewPort.y = newViewPort.y;
                    viewPort.z = newViewPort.z;
                    viewPort.cr = newViewPort.cr;
                    viewPort.ci = newViewPort.ci;
                }
                updateShader();
                redraw();
                setUrlParams();
                fractalEl.value = fractal;
                showMessage(`showing ${name} fractal`);
                event.preventDefault();
                break;
            }
            case 'PageDown':
            {
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                const fractalEl = document.getElementById('fractal-input');
                let index = (fractalEl.options.selectedIndex - 1) % fractalEl.options.length;
                if (index < 0) {
                    index += fractalEl.options.length;
                }
                const value = fractalEl.options[index].value;
                fractal = value;
                const name = document.title = FRACTAL_NAMES[fractal];
                if (event.shiftKey) {
                    const newViewPort = DEFAULT_VIEW_PORTS[fractal] || DEFAULT_VIEW_PORTS.mandelbrot;
                    viewPort.x = newViewPort.x;
                    viewPort.y = newViewPort.y;
                    viewPort.z = newViewPort.z;
                    viewPort.cr = newViewPort.cr;
                    viewPort.ci = newViewPort.ci;
                }
                updateShader();
                redraw();
                setUrlParams();
                fractalEl.value = fractal;
                showMessage(`showing ${name} fractal`);
                event.preventDefault();
                break;
            }
            case 'o':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                sampleRatio = 1 + sampleRatio % 2;
                pixelRatio = window.devicePixelRatio * sampleRatio;
                resizeCanvas();
                redraw();
                showMessage(`set sampling ratio to ${sampleRatio}x${sampleRatio}`);
                event.preventDefault();
                break;

            case 's':
                if (event.altKey || event.metaKey || event.shiftKey) {
                    break;
                } else if (event.ctrlKey) {
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
                } else {
                    toggleColorSpace();
                    setUrlParams();
                    document.getElementById('colorspace-input').value = gl.drawingBufferColorSpace;
                    event.preventDefault();
                }
                break;

            case 'c':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                cycleColors(1);
                event.preventDefault();
                break;

            case 'C':
                if (event.altKey || event.metaKey || event.ctrlKey) {
                    break;
                }
                cycleColors(-1);
                event.preventDefault();
                break;

            case 'g':
                if (event.altKey || event.metaKey || event.shiftKey || event.ctrlKey) {
                    break;
                }
                smooth = !smooth;
                updateShader();
                redraw();
                setUrlParams();
                showMessage(smooth ? 'turned smoothing on' : 'turned smoothing off', MSG_LEVEL_INFO);
                document.getElementById('smooth-input').checked = smooth;
                event.preventDefault();
                break;

            default:
                // console.log(event);
                break;
        }

        if (!event.defaultPrevented && !IGNORE_KEYS.has(event.key)) {
            const items = [];
            if (event.shiftKey) {
                items.push('Shift');
            }
            if (event.ctrlKey) {
                items.push('Ctrl');
            }
            if (event.altKey) {
                items.push('Alt');
            }
            if (event.metaKey) {
                items.push('Meta');
            }
            items.push(
                event.key === ' ' ? 'Space' :
                event.key !== 'ß' && /^\p{Lowercase_Letter}\p{Mn}*$/u.test(event.key) ? event.key.toUpperCase() :
                event.key
            );
            showMessage(`unknown hotkey: ${items.join('+')}`, MSG_LEVEL_WARNING);
        }
    } catch (error) {
        console.error(error);
        showMessage(String(error), MSG_LEVEL_ERROR);
    }
};

const IGNORE_KEYS = new Set([
    'Alt',
    'AltGraph',
    'CapsLock',
    'Control',
    'Fn',
    'FnLock',
    'Hyper',
    'Meta',
    'NumLock',
    'ScrollLock',
    'Shift',
    'Super',
    'Symbol',
    'SymbolLock',
    'ContextMenu',
]);

for (let index = 1; index <= 16; ++ index) {
    IGNORE_KEYS.add(`F${index}`);
}

/**
 * @param {WheelEvent} event 
 */
window.addEventListener('wheel', function (event) {
    event.preventDefault();

    if (event.deltaY === 0 || event.metaKey || event.ctrlKey || event.altKey) {
        return;
    }

    const z1 = viewPort.z;
    const factor = event.shiftKey ? SMALL_ZOOM_FACTOR : ZOOM_FACTOR;
    const z2 = event.deltaY < 0 ? z1 / factor : z1 * factor;

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

function toggleHelp() {
    if (helpEl.classList.contains('hidden')) {
        showHelp();
    } else {
        helpEl.classList.add('hidden');
    }
}

function showHelp() {
    document.getElementById('fractal-input').value = fractal;
    document.getElementById('iterations-input').value = iterations;
    document.getElementById('threshold-input').value = threshold;
    document.getElementById('colorspace-input').value = gl.drawingBufferColorSpace;
    helpEl.classList.remove('hidden');
}

function toggleColorSpace() {
    if (gl.drawingBufferColorSpace === 'srgb') {
        gl.drawingBufferColorSpace = "display-p3";
        showMessage('set color space to Display-P3');
    } else {
        gl.drawingBufferColorSpace = "srgb";
        showMessage('set color space to sRGB');
    }
    redraw();
}

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
    document.title = FRACTAL_NAMES[fractal] || FRACTAL_NAMES.mandelbrot;

    gl = canvas.getContext("webgl2");
    if (!gl) {
        throw new TypeError("WebGL2 not supported!");
    }

    if (colorSpaceParam === 'srgb' || colorSpaceParam === 'display-p3') {
        gl.drawingBufferColorSpace = colorSpaceParam;
    }
    // gl.enable(gl.DITHER);

    const program = gl.createProgram();
    let fragmentCode = (
        fractal === 'julia'   ? getJuliaCode(iterations, threshold, colorCode, smooth) :
        fractal === 'phoenix' ? getPhoenixCode(iterations, threshold, colorCode, smooth) :
        getMandelbrotCode(iterations, threshold, colorCode, smooth)
    );

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_CODE);
    let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    updateShader = function updateShader () {
        gl.detachShader(program, fragmentShader);
        gl.deleteShader(fragmentShader);

        fragmentCode = (
            fractal === 'julia'   ? getJuliaCode(iterations, threshold, colorCode, smooth) :
            fractal === 'phoenix' ? getPhoenixCode(iterations, threshold, colorCode, smooth) :
            getMandelbrotCode(iterations, threshold, colorCode, smooth)
        );

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
        if (isAnimationFrame) {
            cancelAnimationFrame(animationTimer)
        } else {
            clearInterval(animationTimer);
        }
        animationTimer = null;
    }
    animating = false;
}

function playAnimation(animation, loop) {
    console.log("starting animation...");
    if (animationTimer !== null) {
        if (isAnimationFrame) {
            cancelAnimationFrame(animationTimer)
        } else {
            clearInterval(animationTimer);
        }
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

    function animateFrame() {
        const now = Date.now();
        const { x: x1, y: y1, z: z1, cr: cr1, ci: ci1, _ } = animation[animationIndex];
        const { x: x2, y: y2, z: z2, cr: cr2, ci: ci2, d } = animation[animationIndex + 1];
        const dt = now - timestamp;
        let interp = dt / d;
        if (interp > 1) {
            viewPort.x = x2;
            viewPort.y = y2;
            viewPort.z = z2;
            viewPort.cr = cr2;
            viewPort.ci = ci2;
            timestamp = now;
            ++ animationIndex;
            if (animationIndex + 1 >= animation.length) {
                if (loop) {
                    animationIndex = 0;
                } else {
                    animating = false;
                    animationTimer = null;
                }
            }
            if (animating) {
                queueNextFrame();
            }
            redraw();
        } else if (x1 !== x2 || y1 !== y2 || z1 !== z2 || cr1 !== cr2 || ci1 !== ci2) {
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
            if (animating) {
                queueNextFrame();
            }
            redraw();
        }
    }

    function queueNextFrame() {
        if (animationFPS <= 0) {
            animationTimer = requestAnimationFrame(animateFrame);
            isAnimationFrame = true;
        } else {
            animationTimer = setTimeout(animateFrame, 1000/animationFPS);
            isAnimationFrame = false;
        }
    }

    queueNextFrame();
}

try {
    setup();
    if (animation) {
        playAnimation(animation);
    } else {
        redraw();
        showCursor();
        showMessage('Press H for settings and a list of hotkeys. On mobile tripple tap.');
    }
} catch (error) {
    console.error(error);
    showMessage(`Error initializing: ${error}`, MSG_LEVEL_ERROR);
}
