#!/usr/bin/env python3

from typing import NamedTuple

import json
import re

NON_IDENT = re.compile('[^a-zA-Z_]')

class Segment(NamedTuple):
    left: float
    mid: float
    right: float
    color1: tuple[float, float, float, float]
    color2: tuple[float, float, float, float]
    blend: int
    color_space: int
    color_type: int

class Gradient(NamedTuple):
    name: str
    segments: list[Segment]

class GradientCode(NamedTuple):
    key: str
    name: str
    code: str

def parse_ggr(ggr: str) -> Gradient:
    lines = ggr.split("\n")
    if len(lines) < 3 or lines[0] != 'GIMP Gradient':
        raise ValueError('not a GIMP Gradient file')

    key, value = lines[1].split(':', 1)
    key = key.strip()
    value = value.strip()
    if key != 'Name':
        raise ValueError('illegal GIMP Gradient file')
    name = value

    segment_count = int(lines[2])

    segments: list[Segment] = []
    for index in range(segment_count):
        line = lines[index + 3].strip().split()
        
        floats = map(float, line[:11])
        ints = [int(x) for x in line[11:]]
        
        left, mid, right, r1, g1, b1, a1, r2, g2, b2, a2 = floats
        blend = ints[0]
        color_space = ints[1]
        color_type = ints[2] if len(ints) > 2 else 0

        segments.append(Segment(
            left = left,
            mid = mid,
            right = right,
            color1 = (r1, g1, b1, a1),
            color2 = (r2, g2, b2, a2),
            blend = blend,
            color_space = color_space,
            color_type = color_type,
        ))

    return Gradient(
        name = name,
        segments = segments,
    )

def convert_ggr(ggr: str, reverse: bool = False) -> GradientCode:
    grad = parse_ggr(ggr)


    segment_count = len(grad.segments)
    code: list[str] = [
        '''\
v *= 0.05;
v = mod(v, 1.0);
float t;
'''
    ]

    segments = reversed(grad.segments) if reverse else grad.segments
    for index, segment in enumerate(segments):
        left   = segment.left
        mid    = segment.mid
        right  = segment.right
        color1 = segment.color1
        color2 = segment.color2
        if reverse:
            left  = 1.0 - left
            mid   = 1.0 - mid
            right = 1.0 - right

            left, right = right, left
            color1, color2 = color2, color1
            
        (r1, g1, b1, a1) = color1
        (r2, g2, b2, a2) = color2

        if segment.blend != 0 and False:
            raise TypeError(f'unsupported blend type: {segment.blend}')

        if segment.color_space != 0:
            raise TypeError(f'unsupported color space: {segment.color_space}')

        if index > 0:
            code.append(' else ')

        if color1 == color2:
            # solid color

            if index + 1 >= segment_count:
                code.append('{\n')
            else:
                code.append(f'if (v < {right}) {{\n')

            code.append(f'    fragColor.xyz = vec3({r1}, {g1}, {b1});\n')

        elif abs((right + left) / 2 - mid) < 0.000001:
            # one segment

            if index + 1 >= segment_count:
                code.append('{\n')
            else:
                code.append(f'if (v < {right}) {{\n')

            if index > 0:
                code.append(f'    t = (v - {left}) * {1.0 / (right - left)};\n')
            else:
                code.append(f'    t = v * {1.0 / (right - left)};\n')

            code.append(f'    fragColor.xyz = mix(vec3({r1}, {g1}, {b1}), vec3({r2}, {g2}, {b2}), t);\n')

        else:
            # split as two segments

            code.append(f'if (v < {mid}) {{\n')
            
            if index > 0:
                code.append(f'    t = (v - {left}) * {1.0 / (mid - left)};\n')
            else:
                code.append(f'    t = v * {1.0 / (mid - left)};\n')

            t1 = (mid - left) / (right - left)
            t2 = 1.0 - t1
            rm = r1 * t1 + r2 * t2
            gm = g1 * t1 + g2 * t2
            bm = b1 * t1 + b2 * t2

            code.append(f'    fragColor.xyz = mix(vec3({r1}, {g1}, {b1}), vec3({rm}, {gm}, {bm}), t);\n')
            code.append('} else ')

            if index + 1 >= segment_count:
                code.append('{\n')
            else:
                code.append(f'if (v < {right}) {{\n')
                
            code.append(f'    t = (v - {mid}) * {1.0 / (right - mid)};\n')
            code.append(f'    fragColor.xyz = mix(vec3({rm}, {gm}, {bm}), vec3({r2}, {g2}, {b2}), t);\n')

        code.append('}')

    code.append('''
fragColor.x = pow(fragColor.x, 1.0/2.2);
fragColor.y = pow(fragColor.y, 1.0/2.2);
fragColor.z = pow(fragColor.z, 1.0/2.2);
fragColor.w = 1.0;''')

    return GradientCode(
        key = ''.join(
            x.title() if i > 0 else x.lower()
            for i, x in enumerate(NON_IDENT.split(grad.name))
        ),
        name = grad.name,
        code = ''.join(code),
    )

def print_grad(grad: GradientCode) -> None:
    print(f'// {grad.name}')
    print(f'    {grad.key}: `\\')
    print(grad.code + '`,\n')

if __name__ == '__main__':
    import sys
    args = sys.argv[1:]
    if args:
        for arg in args:
            with open(arg) as fp:
                code = fp.read()
            print_grad(convert_ggr(code))
    else:
        code = sys.stdin.read()
        print_grad(convert_ggr(code))
