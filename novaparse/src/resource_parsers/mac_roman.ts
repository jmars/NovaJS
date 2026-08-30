// MacRoman decoding utilities.
// Nova data strings are encoded in the MacRoman codepage, not latin1/utf8.


// High (>= 0x80) MacRoman byte -> unicode table.
// From https://gist.github.com/jrus/3113240
const HIGH_CHARS_UNICODE = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
    '¿¡¬√ƒ≈∆«»…\u00A0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

export function decodeMacRoman(bytes: Array<number>): string {
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) {
        var byte = bytes[i];
        if (byte < 0x80) {
            out += String.fromCharCode(byte);
        }
        else {
            out += HIGH_CHARS_UNICODE.charAt(byte - 0x80);
        }
    }
    return out;
}

// Reads a null-terminated C string from the given offset in the DataView,
// decoding it as MacRoman. Reads at most maxLen bytes.
export function readCString(data: DataView, offset: number, maxLen: number = 255): string {
    var bytes: Array<number> = [];
    var end = Math.min(offset + maxLen, data.byteLength);
    for (var i = offset; i < end; i += 1) {
        var byte = data.getUint8(i);
        if (byte === 0) {
            break;
        }
        bytes.push(byte);
    }
    return decodeMacRoman(bytes);
}

// Reads a length-prefixed Pascal string from the given offset.
// Returns the string and the total number of bytes consumed (length byte included).
export function readPascalString(data: DataView, offset: number): { str: string, bytesRead: number } {
    var length = data.getUint8(offset);
    var bytes: Array<number> = [];
    var end = Math.min(offset + 1 + length, data.byteLength);
    for (var i = offset + 1; i < end; i += 1) {
        bytes.push(data.getUint8(i));
    }
    return { str: decodeMacRoman(bytes), bytesRead: length + 1 };
}
