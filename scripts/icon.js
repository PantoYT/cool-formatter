// Renders the icon: three Möbius strips (red, green, blue) along the sides of
// an equilateral triangle, passing through each other at the corners. The
// strips are real 3D surfaces, drawn into a tiny z-buffer and quantized to a
// fixed palette, so the result is pixel art rather than a smoothed render.
//
//   node scripts/icon.js [pixels] [out.png] [scale]
//
// `pixels` is the native resolution (default 32), `scale` the nearest-neighbour
// upscale (default 128/pixels, so the file is 128x128 for the Marketplace).
// TILT, LENGTH, DEPTH, WIDTH and PHASE in the environment change the shape.
// art/icon.png is `node scripts/icon.js 32 art/icon.png`,
// art/icon-64.png is `node scripts/icon.js 64 art/icon-64.png`.

import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const N = Number(process.argv[2] ?? 32);
const out = process.argv[3] ?? "icon.png";
const scale = Number(process.argv[4] ?? Math.round(128/N));

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
// Per strip: [back dark, back light, front dark, front light].
const palettes = [
	["#5e1426", "#8f1d2c", "#d83a3a", "#ff7a62"], // red, left side
	["#0f5a35", "#1c8a45", "#7cc935", "#c4ef68"], // green, right side
	["#1c2777", "#2b45bf", "#2c95e6", "#86dcff"], // blue, bottom
].map(p => p.map(hex));
const outline = hex("#140f1f");

// --- small vector helpers ---------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const norm = a => mul(a, 1/Math.hypot(...a));

// --- scene -------------------------------------------------------------------
// Equilateral triangle, apex up, in the image plane (z towards the viewer).
const R = 1;
const vertex = k => {
	const angle = Math.PI/2 + k*2*Math.PI/3;
	return [R*Math.cos(angle), R*Math.sin(angle) - 0.12, 0];
};
const sides = [[0, 1], [2, 0], [1, 2]]; // left (apex to bottom-left), right, bottom
const L = Math.sqrt(3)*R;
const tilt = Number(process.env.TILT ?? 35)*Math.PI/180; // how far each loop leans out of the image plane
const length = Number(process.env.LENGTH ?? 0.64)*L;     // semi-major axis: past the corners, so loops link
const depth = Number(process.env.DEPTH ?? 0.24)*L;        // semi-minor axis
const width = Number(process.env.WIDTH ?? (N<=32 ? 0.06 : 0.05))*L; // half width of the band
const phase = Number(process.env.PHASE ?? 2.2);           // where along the loop the half twist sits

function strip(k) {
	const [a, b] = sides[k].map(vertex);
	const mid = mul(add(a, b), 0.5);
	const d = norm(sub(b, a));
	const inward = norm(sub([0, -0.12, 0], mid));
	const e = norm(add(mul(inward, Math.cos(tilt)), [0, 0, Math.sin(tilt)]));
	const n = cross(d, e);
	return (u, v) => {
		const c = add(mid, add(mul(d, length*Math.cos(u)), mul(e, depth*Math.sin(u))));
		const radial = norm(add(mul(d, depth*Math.cos(u)), mul(e, length*Math.sin(u))));
		const w = add(mul(radial, Math.cos(u/2 + phase)), mul(n, Math.sin(u/2 + phase)));
		return add(c, mul(w, v));
	};
}

// --- render --------------------------------------------------------------------
const light = norm([-0.45, 0.7, 0.55]);
const view = [0, 0, 1];
const size = N;
const zbuf = new Float64Array(size*size).fill(-Infinity);
const owner = new Int8Array(size*size).fill(-1);
const tone = new Int8Array(size*size);
// Fit the drawing to the canvas with one pixel left for the outline.
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let k=0; k<3; k++) {
	const P = strip(k);
	for (let i=0; i<720; i++) {
		for (const v of [-width, width]) {
			const p = P(2*Math.PI*i/720, v);
			minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
			minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
		}
	}
}
const fit = (size - 2.5)/Math.max(maxX - minX, maxY - minY);
const cx = size/2 - fit*(minX + maxX)/2, cy = size/2 + fit*(minY + maxY)/2;

for (let k=0; k<3; k++) {
	const P = strip(k);
	const steps = 60*size, across = 3*size, h = 1e-4;
	for (let i=0; i<steps; i++) {
		const u = 2*Math.PI*i/steps;
		for (let j=0; j<=across; j++) {
			const v = -width + 2*width*j/across;
			const p = P(u, v);
			const px = Math.floor(cx + fit*p[0]);
			const py = Math.floor(cy - fit*p[1]);
			if (px<0 || py<0 || px>=size || py>=size) continue;
			const idx = py*size + px;
			if (p[2] <= zbuf[idx]) continue;
			const normal = norm(cross(sub(P(u + h, v), p), sub(P(u, v + h), p)));
			const front = dot(normal, view) >= 0;
			const lit = Math.abs(dot(normal, light)) > 0.55;
			zbuf[idx] = p[2];
			owner[idx] = k;
			tone[idx] = (front ? 2 : 0) + (lit ? 1 : 0);
		}
	}
}

// --- pixel-art finish: outer outline, and a dark seam where one strip passes behind another
const pixels = new Uint8Array(size*size*4);
const put = (idx, rgba) => pixels.set(rgba, idx*4);
for (let y=0; y<size; y++) {
	for (let x=0; x<size; x++) {
		const idx = y*size + x;
		const around = [[1, 0], [-1, 0], [0, 1], [0, -1]]
			.map(([dx, dy]) => [x + dx, y + dy])
			.filter(([qx, qy]) => qx>=0 && qy>=0 && qx<size && qy<size)
			.map(([qx, qy]) => qy*size + qx);
		if (owner[idx] < 0) {
			if (around.some(q => owner[q] >= 0)) put(idx, outline);
			continue;
		}
		const behind = around.some(q => owner[q] >= 0 && owner[q] !== owner[idx] && zbuf[q] > zbuf[idx] + 0.04);
		put(idx, behind ? outline : palettes[owner[idx]][tone[idx]]);
	}
}

// --- PNG (RGBA, nearest-neighbour upscale) -----------------------------------
function png(width, height, rgba) {
	const rows = Buffer.alloc((width*4 + 1)*height);
	for (let y=0; y<height; y++) {
		rows[y*(width*4 + 1)] = 0;
		Buffer.from(rgba.buffer, y*width*4, width*4).copy(rows, y*(width*4 + 1) + 1);
	}
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type), data]);
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const W = size*scale;
const big = new Uint8Array(W*W*4);
for (let y=0; y<W; y++) {
	for (let x=0; x<W; x++) {
		const s = (Math.floor(y/scale)*size + Math.floor(x/scale))*4;
		big.set(pixels.subarray(s, s + 4), (y*W + x)*4);
	}
}
writeFileSync(out, png(W, W, big));
console.log(`${out}: ${N}x${N} pixels, ${W}x${W} file`);
