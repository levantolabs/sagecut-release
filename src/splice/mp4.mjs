// Small MP4 readers in Node: top-level atom order (faststart) and the avcC box (SPS/PPS) of the first video track.
import fs from 'node:fs';

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return b.subarray(0, n);
}

// Boxes in [start, end). Returns [{ type, offset, size, header }]. Stops on a broken size.
export function boxes(fd, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    const h = readAt(fd, pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0); let header = 8;
    const type = h.toString('latin1', 4, 8);
    if (size === 1) { if (h.length < 16) break; size = Number(h.readBigUInt64BE(8)); header = 16; }
    else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) { if (size >= header && pos + size > end && out.length === 0) { out.push({ type, offset: pos, size: end - pos, header }); } break; }
    out.push({ type, offset: pos, size, header });
    pos += size;
  }
  return out;
}

export function topLevel(file) {
  const fd = fs.openSync(file, 'r');
  try { return boxes(fd, 0, fs.fstatSync(fd).size); } finally { fs.closeSync(fd); }
}

// true when the moov box comes before the mdat box.
export function isFaststart(file) {
  const top = topLevel(file);
  const moov = top.find((b) => b.type === 'moov'), mdat = top.find((b) => b.type === 'mdat');
  if (!moov || !mdat) return false;
  return moov.offset < mdat.offset;
}

export function avcC(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const find = (start, end, pathTypes) => {
      for (const b of boxes(fd, start, end)) {
        if (b.type !== pathTypes[0]) continue;
        if (pathTypes.length === 1) return b;
        const inner = b.type === 'stsd' ? b.offset + b.header + 8 : b.offset + b.header;
        const r = find(inner, b.offset + b.size, pathTypes.slice(1));
        if (r) return r;
      }
      return null;
    };
    const top = boxes(fd, 0, size).find((b) => b.type === 'moov');
    if (!top) return null;
    // walk every trak until one has an avc sample entry
    for (const trak of boxes(fd, top.offset + top.header, top.offset + top.size).filter((b) => b.type === 'trak')) {
      const stsd = find(trak.offset + trak.header, trak.offset + trak.size, ['mdia', 'minf', 'stbl', 'stsd']);
      if (!stsd) continue;
      const entries = boxes(fd, stsd.offset + stsd.header + 8, stsd.offset + stsd.size);
      for (const e of entries) {
        if (e.type !== 'avc1' && e.type !== 'avc3') continue;
        const inner = boxes(fd, e.offset + e.header + 78, e.offset + e.size).find((b) => b.type === 'avcC');
        if (inner) return readAt(fd, inner.offset + inner.header, inner.size - inner.header);
      }
    }
    return null;
  } finally { fs.closeSync(fd); }
}
