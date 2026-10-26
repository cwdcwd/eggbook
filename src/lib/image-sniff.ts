// Magic-byte sniffing for image upload validation.
// Client-supplied MIME types (multipart file.type, bytes at the start of the
// body) are caller-controlled: an attacker can claim image/png while POSTing
// HTML/JS/PDF payloads that would then be stored and served from our origin
// (stored "image"/XSS or abuse of our blob origin). The claimed type is only
// accepted once the file header agrees.

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export function sniffImageType(b: Uint8Array): SniffedImageType | null {
  // JPEG: FF D8 FF (SOI + any marker)
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A (full 8-byte signature, not just the prefix)
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: "GIF87a" / "GIF89a"
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    const version = String.fromCharCode(b[3], b[4], b[5]);
    if (version === "87a" || version === "89a") {
      return "image/gif";
    }
  }
  // WEBP: "RIFF" + 4 bytes + "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
