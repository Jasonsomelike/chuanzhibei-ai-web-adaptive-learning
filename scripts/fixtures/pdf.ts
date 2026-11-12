import { createCanvas } from "@napi-rs/canvas";
export function pdf(objects: (string | Buffer)[]) {
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const data = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      typeof object === "string" ? Buffer.from(object) : object,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(data);
    size += data.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`,
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}

export function scanPdf() {
  const surface = createCanvas(1200, 250);
  const ctx = surface.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1200, 250);
  ctx.fillStyle = "black";
  ctx.font = "bold 54px Arial";
  ctx.fillText("STACK: LAST IN FIRST OUT", 35, 110);
  const jpg = surface.toBuffer("image/jpeg");
  const paint = "q 600 0 0 125 0 0 cm /Im0 Do Q";
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 125] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 250 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`,
      ),
      jpg,
      Buffer.from("\nendstream"),
    ]),
    `<< /Length ${paint.length} >>\nstream\n${paint}\nendstream`,
  ]);
}
