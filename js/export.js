// Export images: the desktop's _daevanion_on_export, which writes one PNG per
// Daevanion board with nodes taken plus skills.png and "skill layout.png"
// into a folder named after the class. A browser cannot write a folder, so
// the same files go into one "<Class>.zip" download.

import { bp } from "./state.js";
import * as D from "./engine/daevanion.js";

export async function exportImages(classKey = bp().character_class) {
  const cls = String(classKey || "").trim();
  const lower = cls.toLowerCase();
  const [daevanion, skills, layout] = await Promise.all([
    import("./pages/daevanion.js"), import("./pages/skills.js"), import("./pages/layout.js"),
  ]);
  await daevanion.prepare(cls);
  const variant = daevanion.variantData();
  const inUse = daevanion.boardsInUse(cls);
  const order = D.classBoards(variant, D.skillsDataClassKey(lower));
  const files = [];
  for (const item of inUse) {
    const index = order.findIndex((b) => b.id === item.board.id) + 1;
    const canvas = daevanion.renderBoard(null, variant, item.board, item.activeSet, { side: 900, dpr: 1 });
    files.push([`${index} - ${item.board.name}.png`, await canvasPng(canvas)]);
  }
  const cards = skills.renderSkillCards(cls, null);
  await cards.ready;
  files.push(["skills.png", await canvasPng(cards)]);
  const bar = layout.renderSkillBar(cls, null);
  await bar.ready;
  files.push(["skill layout.png", await canvasPng(bar)]);
  downloadBlob(zip(files), `${cls[0].toUpperCase() + cls.slice(1)}.zip`);
  return files.length;
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then(resolve) : reject(new Error("PNG encode failed"))), "image/png"));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

// Stored (uncompressed) zip: PNGs are already compressed.
export function zip(entries) {
  const enc = new TextEncoder();
  const [time, date] = dosDateTime();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, buffer] of entries) {
    const data = new Uint8Array(buffer);
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true); central.setUint16(10, 0, true); central.setUint16(12, time, true);
    central.setUint16(14, date, true); central.setUint32(16, crc, true); central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true); central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    locals.push(local.buffer, nameBytes, data);
    centrals.push(central.buffer, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, part) => n + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end.buffer], { type: "application/zip" });
}
