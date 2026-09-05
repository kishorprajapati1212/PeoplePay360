/**
 * STORE-only ZIP writer (no compression, no dependency) — enough for "download the month's payslips".
 * Browsers and unzippers accept stored entries; PDFs do not benefit much from deflate anyway.
 */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC[(c ^ buf[i]) & 0xff]; return (c ^ -1) >>> 0; };
export function makeZip(entries) {
  const parts = []; const central = []; let offset = 0;
  const dt = new Date(); const time = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1);
  const date = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  for (const { name, data } of entries) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const n = Buffer.from(name, 'utf8'); const crc = crc32(buf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(buf.length, 18); local.writeUInt32LE(buf.length, 22);
    local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, n, buf);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(buf.length, 20); cen.writeUInt32LE(buf.length, 24);
    cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, n]));
    offset += local.length + n.length + buf.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
