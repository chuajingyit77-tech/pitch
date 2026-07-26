// Shared visual system for the Padang Besar deck.
// Motif: every content slide carries a fact-classification chip (VERIFIED /
// PENDING CONFIRMATION / PROPOSED / RECOMMENDATION) in the top-right corner.

const C = {
  NAVY: "13293D",   // primary dark
  DEEP: "0C1C2B",   // divider background
  STEEL: "33566E",  // secondary
  GOLD: "C9962E",   // accent
  PAPER: "FFFFFF",
  LIGHT: "F2F5F7",  // card tint
  LINE: "D8DFE5",
  TEXT: "22323F",
  MUT: "5D6E7C",
  GREEN: "2F7D5B",  // verified
  AMBER: "B26A00",  // pending
  BLUE: "3A6EA5",   // proposed
  RED: "A94442",
  ICE: "CADCFC",
};

const PAGE = { W: 13.33, H: 7.5 };
const F = "Arial";
const FD = "Cambria";

const CHIPS = {
  verified: { label: "PUBLICLY VERIFIED", color: C.GREEN },
  pending: { label: "PENDING OWNER CONFIRMATION", color: C.AMBER },
  proposed: { label: "PROPOSED", color: C.BLUE },
  reco: { label: "RECOMMENDATION", color: C.STEEL },
  mixed: { label: "VERIFIED FACTS + PROPOSAL", color: C.GOLD },
};

let pageNum = 0;

function chrome(slide, opts = {}) {
  // background
  slide.background = { color: opts.dark ? C.DEEP : C.PAPER };
  // footer
  pageNum += 1;
  if (!opts.noFooter) {
    slide.addText(
      "Padang Besar Cross-Border Logistics Platform  ·  Project Development Package  ·  Draft for discussion — not an offer or representation of rights",
      { x: 0.55, y: 7.12, w: 10.5, h: 0.3, fontFace: F, fontSize: 7.5,
        color: opts.dark ? "7D8EA0" : C.MUT, align: "left", margin: 0 }
    );
    slide.addText(String(pageNum), {
      x: 12.55, y: 7.12, w: 0.5, h: 0.3, fontFace: F, fontSize: 8,
      color: opts.dark ? "7D8EA0" : C.MUT, align: "right", margin: 0,
    });
  }
  return pageNum;
}

function chip(slide, kind, opts = {}) {
  const c = CHIPS[kind];
  if (!c) return;
  const w = opts.w || (c.label.length * 0.1 + 0.32);
  const x = PAGE.W - 0.55 - w;
  slide.addShape("roundRect", {
    x, y: 0.3, w, h: 0.3, rectRadius: 0.15,
    fill: { color: c.color }, line: { type: "none" },
  });
  slide.addText(c.label, {
    x, y: 0.3, w, h: 0.3, fontFace: F, fontSize: 8.5, bold: true,
    color: "FFFFFF", align: "center", margin: 0, charSpacing: 1,
  });
}

function header(slide, kicker, title, chipKind, opts = {}) {
  chrome(slide, opts);
  slide.addText(kicker.toUpperCase(), {
    x: 0.55, y: 0.34, w: 9.6, h: 0.28, fontFace: F, fontSize: 10.5, bold: true,
    color: C.GOLD, charSpacing: 2, margin: 0,
  });
  slide.addText(title, {
    x: 0.55, y: 0.62, w: opts.titleW || 11.0, h: 0.78, fontFace: F, fontSize: 24,
    bold: true, color: opts.dark ? "FFFFFF" : C.NAVY, margin: 0, valign: "top",
  });
  if (chipKind) chip(slide, chipKind);
}

function divider(pres, num, title, subtitle, itemsLeft) {
  const slide = pres.addSlide();
  chrome(slide, { dark: true });
  slide.addText(num, {
    x: 0.7, y: 1.15, w: 3.4, h: 2.2, fontFace: FD, fontSize: 120, bold: true,
    color: C.GOLD, margin: 0,
  });
  slide.addText(title, {
    x: 0.75, y: 3.45, w: 9.6, h: 1.0, fontFace: F, fontSize: 34, bold: true,
    color: "FFFFFF", margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.75, y: 4.45, w: 8.8, h: 1.5, fontFace: F, fontSize: 14,
      color: C.ICE, margin: 0, valign: "top",
    });
  }
  if (itemsLeft && itemsLeft.length) {
    slide.addText(
      itemsLeft.map((t, i) => ({
        text: t,
        options: { bullet: { code: "2013", indent: 12 }, breakLine: i < itemsLeft.length - 1, paraSpaceAfter: 6 },
      })),
      { x: 9.0, y: 1.3, w: 3.7, h: 4.2, fontFace: F, fontSize: 11.5, color: "AFC3D4", valign: "top" }
    );
  }
  return slide;
}

function bullets(slide, items, opts = {}) {
  slide.addText(
    items.map((it, i) => {
      const t = typeof it === "string" ? { text: it } : it;
      return {
        text: t.text,
        options: Object.assign(
          { bullet: t.noBullet ? false : { code: "2013", indent: 12 },
            bold: !!t.bold, color: t.color || opts.color || C.TEXT,
            breakLine: i < items.length - 1, paraSpaceAfter: opts.gap == null ? 8 : opts.gap },
          t.options || {}
        ),
      };
    }),
    Object.assign({ fontFace: F, fontSize: 12.5, valign: "top", margin: 0 }, opts.box)
  );
}

function card(slide, x, y, w, h, opts = {}) {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.055,
    fill: { color: opts.fill || C.LIGHT },
    line: opts.lineColor ? { color: opts.lineColor, width: 1 } : { type: "none" },
    shadow: opts.shadow ? { type: "outer", color: "9AA7B1", blur: 6, offset: 2, angle: 90, opacity: 0.35 } : undefined,
  });
}

function stat(slide, x, y, w, big, label, opts = {}) {
  slide.addText(big, {
    x, y, w, h: 0.75, fontFace: F, fontSize: opts.size || 30, bold: true,
    color: opts.color || C.NAVY, align: "center", margin: 0,
  });
  slide.addText(label, {
    x, y: y + 0.72, w, h: 0.75, fontFace: F, fontSize: 10, color: C.MUT,
    align: "center", margin: 0, valign: "top",
  });
}

function tbl(slide, rows, opts = {}) {
  const headerRow = rows[0].map((t) => ({
    text: t,
    options: { fill: { color: C.NAVY }, color: "FFFFFF", bold: true, fontSize: opts.hSize || 10.5, valign: "middle" },
  }));
  const body = rows.slice(1).map((r, ri) =>
    r.map((cell) => {
      const c = typeof cell === "string" ? { text: cell } : cell;
      return {
        text: c.text,
        options: Object.assign(
          { fill: { color: ri % 2 ? C.PAPER : C.LIGHT }, color: c.color || C.TEXT,
            bold: !!c.bold, fontSize: opts.size || 10, valign: "top" },
          c.options || {}
        ),
      };
    })
  );
  slide.addTable([headerRow, ...body], Object.assign({
    x: 0.55, y: 1.55, w: 12.23, fontFace: F,
    border: { type: "solid", color: C.LINE, pt: 0.5 },
    autoPage: false, margin: 0.06,
  }, opts.box || {}));
}

// horizontal process flow: boxes joined by arrows
function flow(slide, steps, opts = {}) {
  const y = opts.y || 2.0;
  const h = opts.h || 0.9;
  const gap = 0.32;
  const x0 = opts.x || 0.55;
  const totalW = opts.w || 12.23;
  const bw = (totalW - gap * (steps.length - 1)) / steps.length;
  steps.forEach((s, i) => {
    const x = x0 + i * (bw + gap);
    card(slide, x, y, bw, h, { fill: s.fill || C.LIGHT, lineColor: s.line });
    slide.addText([
      { text: s.title, options: { bold: true, fontSize: opts.tSize || 11, color: s.color || C.NAVY, breakLine: !!s.sub } },
      ...(s.sub ? [{ text: s.sub, options: { fontSize: opts.sSize || 9, color: C.MUT } }] : []),
    ], { x: x + 0.08, y, w: bw - 0.16, h, fontFace: F, align: "center", valign: "middle", margin: 0 });
    if (i < steps.length - 1) {
      slide.addShape("rightArrow", {
        x: x + bw + 0.035, y: y + h / 2 - 0.09, w: gap - 0.07, h: 0.18,
        fill: { color: C.GOLD }, line: { type: "none" },
      });
    }
  });
}

module.exports = { C, PAGE, F, FD, CHIPS, chrome, chip, header, divider, bullets, card, stat, tbl, flow };
