
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const INPUT_PDF = path.resolve("data/latest.pdf");
const OUT_JSON = path.resolve("public/data/latest.json");

function parseNum(s) {
  if (s == null) return 0;
  s = String(s).trim().replace("R$", "").replace(/\s+/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma) {
    if (/(,\d{1,2})$/.test(s)) {
      s = s.replace(/\./g, "");
      s = s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasDot) {
    if (!/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  }

  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

function parseWinthor315(text) {
  const out = [];
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const reA =
    /^(\d{1,6})\s+([A-ZÀ-Ü0-9.\-\s]{3,80}?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)/;
  const reB =
    /^([A-ZÀ-Ü0-9.\-\s]{3,80}?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d{1,6})\s+([\d.,]+)/;

  for (const L of lines) {
    if (/^315\b/i.test(L)) continue;
    if (/^Per[ií]odo\b/i.test(L)) continue;
    if (/^C[oó]digo\s+Rca\b/i.test(L)) continue;
    if (/^P[aá]gina\b/i.test(L)) continue;
    if (/^Total do Supervisor\b/i.test(L)) break;
    if (/^Estat[ií]stica\b/i.test(L)) break;

    let m = L.match(reA);
    if (m) {
      const rca = String(parseInt(m[1], 10) || "");
      const name = m[2].trim();
      const cliPosit = parseInt(m[4], 10) || 0;
      const mix = parseInt(m[8], 10) || 0;
      const sales = parseNum(m[10]);
      if (rca) out.push({ rca, name, cliPosit, mix, sales });
      continue;
    }

    m = L.match(reB);
    if (m) {
      out.push({
        name: m[1].trim(),
        cliPosit: parseInt(m[3], 10) || 0,
        mix: parseInt(m[4], 10) || 0,
        rca: String(parseInt(m[6], 10) || ""),
        sales: parseNum(m[7]),
      });
    }
  }

  const dedup = new Map();
  for (const r of out) dedup.set(r.rca, r);
  return Array.from(dedup.values());
}

async function extractTextFromPdf(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;

  let fullText = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let pageText = "";
    for (const it of tc.items) pageText += (it.str || "") + (it.hasEOL ? "\n" : " ");
    fullText += "\n" + pageText;
  }
  return fullText;
}

function sha256File(filePath) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return h.digest("hex").slice(0, 16);
}

async function main() {
  if (!fs.existsSync(INPUT_PDF)) {
    console.error("❌ PDF não encontrado em:", INPUT_PDF);
    process.exit(1);
  }

  const text = await extractTextFromPdf(INPUT_PDF);
  const rows = parseWinthor315(text);

  if (!rows.length) {
    console.error("❌ Nenhuma linha reconhecida no padrão 315. Verifique o PDF.");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    pdfHash: sha256File(INPUT_PDF),
    rows, // [{rca,name,cliPosit,mix,sales}]
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  console.log("✅ JSON gerado:", OUT_JSON);
  console.log("   RCAs extraídos:", rows.length);
}

main().catch((e) => {
  console.error("❌ Falha no build:", e);
  process.exit(1);
});
