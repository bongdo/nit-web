export type Rgb = [number, number, number];

let probe: CanvasRenderingContext2D | null = null;

export function parseColor(css: string): Rgb {
  if (!probe) probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const context = probe;
  if (!context) return [1, 1, 1];
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = css.trim() || "#000";
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return [data[0] / 255, data[1] / 255, data[2] / 255];
}

export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export function compile(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const build = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "shader";
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error("program");
  const vert = build(gl.VERTEX_SHADER, VERT);
  const frag = build(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "link");
  }
  return program;
}

export function drawTriangle(gl: WebGL2RenderingContext, buffer: WebGLBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function fullscreenBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return buffer;
}

export const ATLAS_COLS = 8;
export const ATLAS_CELL = 64;

export function glyphAtlas(
  chars: string[],
  font: string,
): { canvas: HTMLCanvasElement; rows: number } {
  const rows = Math.ceil(chars.length / ATLAS_COLS);
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * ATLAS_CELL;
  canvas.height = rows * ATLAS_CELL;
  const context = canvas.getContext("2d");
  if (!context) return { canvas, rows };
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.font = `700 ${Math.round(ATLAS_CELL * 0.8)}px ${font}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  chars.forEach((char, index) => {
    const x = (index % ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2;
    const y = Math.floor(index / ATLAS_COLS) * ATLAS_CELL + ATLAS_CELL / 2;
    context.fillText(char, x, y);
  });
  return { canvas, rows };
}
