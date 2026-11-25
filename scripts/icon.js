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
// STYLE=scribble draws only the bands' edges as a wobbly pen line on a white
// sheet in the MS Paint palette (FILL=1 adds a pale wash, PEN sets the line
// width, WOBBLE the hand shake, MARGIN the space to the sheet's edge).
// STYLE=chunky renders at SS times the size (default 4) and lets each pixel
// take the majority of its samples, which keeps edges and outlines clean
// (COVER: share of samples a pixel needs to be filled, SEAM: depth step that
// draws a seam, TONES=2: one colour per face). STYLE=woven replaces 3D depth
// between strips with a fixed over-under rule.
// The extension icon (art/icon-32.png) began as
// `TILT=55 LENGTH=0.66 DEPTH=0.2 WIDTH=0.1 PHASE=0.6 node scripts/icon.js 32 <out> 1`
// and was then finished by hand, so re-running this does not reproduce it.

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
const look = process.env.STYLE ?? "pixel";
const margin = Number(process.env.MARGIN ?? ({ scribble: 9, woven: 4 }[look] ?? 2.5));
const fit = (size - margin)/Math.max(maxX - minX, maxY - minY);
const cx = size/2 - fit*(minX + maxX)/2, cy = size/2 + fit*(minY + maxY)/2;
const pixels = new Uint8Array(size*size*4);

if (look === "scribble") {
	scribble();
} else if (look === "woven") {
	woven();
} else if (look === "chunky") {
	chunky();
} else {
	shaded();
}

// Chunky: the shaded bands with real 3D depth, rendered at SS times the
// resolution and brought down by a majority vote of the samples in each pixel.
// One sample per pixel gives ragged edges and broken outlines; the vote keeps
// the shapes and the seams clean.
function chunky() {
	const SS = Number(process.env.SS ?? 4), big = size*SS;
	const zb = new Float64Array(big*big).fill(-Infinity);
	const ob = new Int8Array(big*big).fill(-1);
	const tb = new Int8Array(big*big);
	const h = 1e-4;
	for (let k=0; k<3; k++) {
		const P = strip(k);
		const steps = 40*big, across = 2*big;
		for (let i=0; i<steps; i++) {
			const u = 2*Math.PI*i/steps;
			for (let j=0; j<=across; j++) {
				const v = -width + 2*width*j/across;
				const p = P(u, v);
				const px = Math.floor((cx + fit*p[0])*SS), py = Math.floor((cy - fit*p[1])*SS);
				if (px<0 || py<0 || px>=big || py>=big) continue;
				const idx = py*big + px;
				if (p[2] <= zb[idx]) continue;
				const normal = norm(cross(sub(P(u + h, v), p), sub(P(u, v + h), p)));
				zb[idx] = p[2];
				ob[idx] = k;
				const front = dot(normal, view) >= 0;
				// TONES=2: one colour per face, so the twist shows as light turning dark.
				tb[idx] = process.env.TONES === "2" ? (front ? 3 : 0) : (front ? 2 : 0) + (Math.abs(dot(normal, light)) > 0.55 ? 1 : 0);
			}
		}
	}

	const owner = new Int8Array(size*size).fill(-1);
	const tone = new Int8Array(size*size).fill(-1);
	const z = new Float64Array(size*size).fill(-Infinity);
	const cover = Number(process.env.COVER ?? 0.4);
	for (let y=0; y<size; y++) {
		for (let x=0; x<size; x++) {
			const votes = new Map();
			let filled = 0;
			for (let sy=0; sy<SS; sy++) {
				for (let sx=0; sx<SS; sx++) {
					const s = (y*SS + sy)*big + x*SS + sx;
					if (ob[s] < 0) continue;
					filled++;
					const key = ob[s]*4 + tb[s];
					votes.set(key, (votes.get(key) ?? 0) + 1);
				}
			}
			if (filled < cover*SS*SS) continue;
			const key = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
			const idx = y*size + x;
			owner[idx] = key >> 2;
			tone[idx] = key & 3;
			let sum = 0, n = 0;
			for (let sy=0; sy<SS; sy++) {
				for (let sx=0; sx<SS; sx++) {
					const s = (y*SS + sy)*big + x*SS + sx;
					if (ob[s] === owner[idx]) { sum += zb[s]; n++; }
				}
			}
			z[idx] = sum/n;
		}
	}

	const neighbours = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
		.map(([dx, dy]) => [x + dx, y + dy])
		.filter(([qx, qy]) => qx>=0 && qy>=0 && qx<size && qy<size)
		.map(([qx, qy]) => qy*size + qx);

	for (let y=0; y<size; y++) {
		for (let x=0; x<size; x++) {
			const idx = y*size + x;
			if (owner[idx] < 0) continue;
			const same = neighbours(x, y).filter(q => owner[q] === owner[idx]);
			if (same.length < 3 || same.some(q => tone[q] === tone[idx])) continue;
			const counts = [0, 0, 0, 0];
			same.forEach(q => counts[tone[q]]++);
			const best = counts.indexOf(Math.max(...counts));
			if (counts[best] >= 3) tone[idx] = best;
		}
	}

	const seam = Number(process.env.SEAM ?? 0.6)*width;
	for (let y=0; y<size; y++) {
		for (let x=0; x<size; x++) {
			const idx = y*size + x;
			const near = neighbours(x, y);
			if (owner[idx] < 0) {
				if (near.some(q => owner[q] >= 0)) pixels.set(outline, idx*4);
				continue;
			}
			// Seam on whichever pixel lies clearly behind its neighbour: another
			// strip passing in front, or the same strip folding over at its twist.
			const behind = near.some(q => owner[q] >= 0 && z[q] - z[idx] > seam);
			pixels.set(behind ? outline : palettes[owner[idx]][tone[idx]], idx*4);
		}
	}
}

// Woven: the shaded bands, but where two strips overlap, the one on top is
// chosen by a fixed over-under rule instead of 3D depth, like chain links. In
// this scene the loops really intersect in 3D, which the z-buffer shows as
// ragged clipping; the rule makes them look threaded through each other. At
// each corner the strip that starts there goes over on one side of the line
// from the corner to the centre and under on the other.
function woven() {
	const layers = [0, 1, 2].map(() => ({ z: new Float64Array(size*size).fill(-Infinity), tone: new Int8Array(size*size).fill(-1) }));
	const h = 1e-4;
	for (let k=0; k<3; k++) {
		const P = strip(k);
		const { z, tone } = layers[k];
		const steps = 60*size, across = 3*size;
		for (let i=0; i<steps; i++) {
			const u = 2*Math.PI*i/steps;
			for (let j=0; j<=across; j++) {
				const v = -width + 2*width*j/across;
				const p = P(u, v);
				const px = Math.floor(cx + fit*p[0]), py = Math.floor(cy - fit*p[1]);
				if (px<0 || py<0 || px>=size || py>=size) continue;
				const idx = py*size + px;
				if (p[2] <= z[idx]) continue;
				const normal = norm(cross(sub(P(u + h, v), p), sub(P(u, v + h), p)));
				z[idx] = p[2];
				tone[idx] = (dot(normal, view) >= 0 ? 2 : 0) + (Math.abs(dot(normal, light)) > 0.55 ? 1 : 0);
			}
		}
	}

	const screen = p => [cx + fit*p[0], cy - fit*p[1]];
	const centre = screen([0, -0.12, 0]);
	const corners = [0, 1, 2].map(i => screen(vertex(i)));
	const over = (a, b, x, y) => {
		const shared = sides[a].find(i => sides[b].includes(i));
		const [vx, vy] = corners[shared];
		const left = (centre[0] - vx)*(y + 0.5 - vy) - (centre[1] - vy)*(x + 0.5 - vx) > 0;
		return left === (sides[a][0] === shared);
	};

	const owner = new Int8Array(size*size).fill(-1);
	const tone = new Int8Array(size*size).fill(-1);
	for (let y=0; y<size; y++) {
		for (let x=0; x<size; x++) {
			const idx = y*size + x;
			let top = -1;
			for (let k=0; k<3; k++) {
				if (layers[k].tone[idx] < 0) continue;
				if (top < 0 || over(k, top, x, y)) top = k;
			}
			owner[idx] = top;
			if (top >= 0) tone[idx] = layers[top].tone[idx];
		}
	}

	const neighbours = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
		.map(([dx, dy]) => [x + dx, y + dy])
		.filter(([qx, qy]) => qx>=0 && qy>=0 && qx<size && qy<size);

	// Lone pixels whose shade none of their neighbours share become the majority shade.
	for (let y=0; y<size; y++) {
		for (let x=0; x<size; x++) {
			const idx = y*size + x;
			if (owner[idx] < 0) continue;
			const same = neighbours(x, y).map(([qx, qy]) => qy*size + qx).filter(q => owner[q] === owner[idx]);
			if (same.length < 3 || same.some(q => tone[q] === tone[idx])) continue;
			const counts = [0, 0, 0, 0];
			same.forEach(q => counts[tone[q]]++);
			const best = counts.indexOf(Math.max(...counts));
			if (counts[best] >= 3) tone[idx] = best;
		}
	}

	const fold = Number(process.env.FOLD ?? 1.2)*width;
	for (let y=0; y<size; y++) {
		for (let x=0; x<size; x++) {
			const idx = y*size + x;
			const near = neighbours(x, y).map(([qx, qy]) => [qx, qy, qy*size + qx]);
			const k = owner[idx];
			if (k < 0) {
				if (near.some(([, , q]) => owner[q] >= 0)) pixels.set(outline, idx*4);
				continue;
			}
			// Seam on the lower strip where another strip passes over it, and
			// where a strip folds over itself at its twist.
			const under = near.some(([, , q]) => owner[q] >= 0 && owner[q] !== k && over(owner[q], k, x, y));
			const behindFold = near.some(([, , q]) => owner[q] === k && layers[k].z[q] - layers[k].z[idx] > fold);
			pixels.set(under || behindFold ? outline : palettes[k][tone[idx]], idx*4);
		}
	}
}

// Scribble: only the edge of each band, as a wobbly pen line on a white sheet,
// in the MS Paint palette. A Möbius strip has a single edge that runs around
// twice; where the band turns over, its edge lines cross, and that crossing is
// what shows the twist even at 64 pixels.
function scribble() {
	const ink = [["#880015", "#ed1c24"], ["#22b14c", "#b5e61d"], ["#3f48cc", "#00a2e8"]].map(p => p.map(hex));
	const paper = hex("#ffffff"), rim = hex(process.env.RIM ?? "#c3c3c3");
	const pen = Number(process.env.PEN ?? 1);
	const wobble = Number(process.env.WOBBLE ?? 0.7);
	for (let y=0; y<size; y++) {
		for (let x=0; x<size; x++) {
			const corner = Math.min(x, size - 1 - x) + Math.min(y, size - 1 - y);
			if (corner < 2) continue;
			const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1 || corner === 2;
			pixels.set(edge ? rim : paper, (y*size + x)*4);
		}
	}
	const z = new Float64Array(size*size).fill(-Infinity);
	const plot = (sx, sy, depth, rgba) => {
		for (let dy=0; dy<pen; dy++) {
			for (let dx=0; dx<pen; dx++) {
				const px = Math.round(sx) + dx - (pen >> 1), py = Math.round(sy) + dy - (pen >> 1);
				if (px<1 || py<1 || px>=size - 1 || py>=size - 1) continue;
				const idx = py*size + px;
				if (depth < z[idx]) continue;
				z[idx] = depth;
				pixels.set(rgba, idx*4);
			}
		}
	};
	const h = 1e-4;
	for (let k=0; k<3; k++) {
		const P = strip(k);
		if (process.env.FILL === "1") {
			// A pale wash of the band, so a nearer band hides the lines behind it.
			const wash = ink[k][1].map((c, i) => i === 3 ? 255 : Math.round(c*0.22 + 255*0.78));
			for (let i=0; i<60*size; i++) {
				for (let j=0; j<=3*size; j++) {
					const p = P(2*Math.PI*i/(60*size), -width + 2*width*j/(3*size));
					plot(cx + fit*p[0], cy - fit*p[1], p[2], wash);
				}
			}
		}
		const steps = 400*size;
		const seed = [1.3 + k, 2.1 + 2*k, 0.4 + 0.7*k];
		for (let i=0; i<=steps*1.03; i++) { // a little past the start, like a hand closing a loop
			const t = 4*Math.PI*i/steps;
			const p = P(t, width);
			const normal = cross(sub(P(t + h, width), p), sub(P(t, width + h), p));
			const sx = cx + fit*p[0] + wobble*(Math.sin(3*t + seed[0]) + 0.4*Math.sin(11*t + seed[1]));
			const sy = cy - fit*p[1] + wobble*(Math.cos(2*t + seed[2]) + 0.4*Math.cos(13*t + seed[0]));
			plot(sx, sy, p[2] + 0.05, ink[k][dot(normal, view) >= 0 ? 1 : 0]);
		}
	}
}

function shaded() {
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
