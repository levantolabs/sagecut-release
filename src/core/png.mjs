// Minimal PNG encoder for raw RGB / gray buffers (contact sheets, synthetic controls). Node built-ins only.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// pixels: Buffer/Uint8Array of width*height*channels (channels 1 = gray, 3 = RGB, 4 = RGBA)
export function encodePng(pixels, width, height, channels = 3) {
  const colorType = { 1: 0, 3: 2, 4: 6 }[channels];
  if (colorType === undefined) throw new Error(`encodePng: channels must be 1, 3 or 4 (got ${channels})`);
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;   // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Paste an RGB tile into an RGB canvas at (x, y). Both are width*height*3 buffers.
export function paste(canvas, cw, tile, tw, th, x, y) {
  for (let row = 0; row < th; row++) {
    const cy = y + row;
    if (cy < 0) continue;
    const src = row * tw * 3;
    const dst = (cy * cw + x) * 3;
    Buffer.from(tile.buffer, tile.byteOffset + src, tw * 3).copy(canvas, dst);
  }
}
