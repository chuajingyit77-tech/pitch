// Part 1: Front matter, Section 1 (Executive Summary), Section 2 (Public Research), Section 3 (Ecosystem)
module.exports = function build(pres, T) {
  const { C, F, FD, header, chrome, chip, divider, bullets, card, stat, tbl, flow } = T;

  // ── 1. Cover ─────────────────────────────────────────────────────────────
  let s = pres.addSlide();
  chrome(s, { dark: true, noFooter: true });
  s.addShape("rect", { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: C.DEEP }, line: { type: "none" } });
  s.addShape("rect", { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: C.NAVY, transparency: 55 }, line: { type: "none" } });
  s.addText("PROJECT DEVELOPMENT PACKAGE", { x: 0.9, y: 1.15, w: 11, h: 0.4, fontFace: F, fontSize: 14, bold: true, color: C.GOLD, charSpacing: 4, margin: 0 });
  s.addText("Padang Besar\nCross-Border Logistics Platform", { x: 0.9, y: 1.7, w: 11.5, h: 2.2, fontFace: FD, fontSize: 44, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("Perlis, Malaysia  ·  Malaysia–Thailand Border Corridor", { x: 0.9, y: 4.0, w: 10, h: 0.45, fontFace: F, fontSize: 16, color: C.ICE, margin: 0 });
  s.addText([
    { text: "Prepared for discussions with: ", options: { color: "AFC3D4", bold: false } },
    { text: "Government agencies · Investors · Shandong Hi-Speed Group · EPC contractors · Technology partners · Banks", options: { color: "FFFFFF", bold: true } },
  ], { x: 0.9, y: 4.75, w: 11.5, h: 0.6, fontFace: F, fontSize: 12.5, margin: 0 });
  s.addShape("line", { x: 0.9, y: 5.65, w: 11.4, h: 0, line: { color: C.STEEL, width: 1 } });
  s.addText("Draft for discussion  ·  July 2026  ·  Prepared by the Prospek Cerah project development team\nThis document asserts no ownership, concession, operating rights or licences. Items not publicly verified are marked “Pending confirmation from project owner.”",
    { x: 0.9, y: 5.85, w: 11.5, h: 0.9, fontFace: F, fontSize: 10.5, color: "AFC3D4", margin: 0 });

  // ── 2. Basis of preparation ──────────────────────────────────────────────
  s = pres.addSlide();
  header(s, "Basis of preparation", "How this document was built — and what it does not claim", "reco");
  bullets(s, [
    { text: "Prepared by a multi-disciplinary development team covering project development, PPP/infrastructure, inland-port logistics, EPC, digitalisation, financial modelling, investment banking, risk, government relations and presentation design. Each specialist's output was cross-reviewed by the others before inclusion.", options: { paraSpaceAfter: 10 } },
    { text: "Research base: publicly available sources only, verified as of 26 July 2026. Every factual statement in Section 2 carries a reference [R#], consolidated in the References appendix.", options: { paraSpaceAfter: 10 } },
    { text: "Where public sources conflict (e.g., Perlis Inland Port capacity and cost figures), the conflict is disclosed rather than resolved by assumption.", options: { paraSpaceAfter: 10 } },
    { text: "No site visits, data-room access or owner interviews have occurred. Nothing here should be read as confirmation of land, rights, mandates or approvals.", options: { paraSpaceAfter: 10 } },
    { text: "All business models, work packages, structures and financial frameworks are proposals for negotiation — deliberately built so they can be validated or discarded item-by-item in due diligence.", options: {} },
  ], { box: { x: 0.55, y: 1.7, w: 8.1, h: 5.0 }, gap: 10 });
  card(s, 9.0, 1.7, 3.78, 4.6, { fill: C.NAVY });
  s.addText("DOCUMENT DISCIPLINE", { x: 9.25, y: 1.95, w: 3.3, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  bullets(s, [
    { text: "Never fabricate facts", color: "FFFFFF", bold: true },
    { text: "Separate fact tiers on every page", color: "FFFFFF" },
    { text: "Disclose source conflicts", color: "FFFFFF" },
    { text: "State what is unverified", color: "FFFFFF" },
    { text: "No numbers without evidence", color: "FFFFFF" },
  ], { box: { x: 9.25, y: 2.35, w: 3.35, h: 3.7 }, gap: 10 });

  // ── 3. Fact classification ───────────────────────────────────────────────
  s = pres.addSlide();
  header(s, "Reading guide", "Four information tiers — kept separate throughout", null);
  const tiers = [
    { k: "PUBLICLY VERIFIED", c: C.GREEN, d: "Facts supported by cited public sources (media, government, corporate disclosures). Each carries a reference [R#]." },
    { k: "PENDING OWNER CONFIRMATION", c: C.AMBER, d: "Anything about this project's land, rights, mandates, agreements or status. Not asserted anywhere in this package." },
    { k: "PROPOSED", c: C.BLUE, d: "Business model, work packages, structures and strategies designed by the team — for negotiation, not statements of fact." },
    { k: "RECOMMENDATION", c: C.STEEL, d: "The team's professional judgment on sequencing, positioning and process — clearly separated from facts." },
  ];
  tiers.forEach((t, i) => {
    const y = 1.75 + i * 1.28;
    card(s, 0.55, y, 12.23, 1.1, { fill: i % 2 ? C.LIGHT : "EDF1F4" });
    s.addShape("roundRect", { x: 0.85, y: y + 0.38, w: 3.1, h: 0.34, rectRadius: 0.17, fill: { color: t.c }, line: { type: "none" } });
    s.addText(t.k, { x: 0.85, y: y + 0.38, w: 3.1, h: 0.34, fontFace: F, fontSize: 9.5, bold: true, color: "FFFFFF", align: "center", margin: 0 });
    s.addText(t.d, { x: 4.25, y: y + 0.12, w: 8.3, h: 0.9, fontFace: F, fontSize: 11.5, color: C.TEXT, valign: "middle", margin: 0 });
  });

  // ── 4. Contents ──────────────────────────────────────────────────────────
  s = pres.addSlide();
  header(s, "Contents", "Fifteen sections, one investment-grade narrative", null);
  const toc = [
    ["01", "Executive Summary"], ["02", "Public Research (referenced)"], ["03", "Current Ecosystem"],
    ["04", "Project Opportunities"], ["05", "EPC Work Packages WP01–WP20"], ["06", "Digitalisation Strategy"],
    ["07", "Prospek Cerah Business Model"], ["08", "Shandong Hi-Speed Role"], ["09", "Investment Model"],
    ["10", "Financial Model Framework"], ["11", "Due Diligence Checklist"], ["12", "Questions for Project Owner"],
    ["13", "Consortium Structure"], ["14", "Risk Register"], ["15", "Roadmap & Next Steps"],
  ];
  toc.forEach((t, i) => {
    const col = Math.floor(i / 5), row = i % 5;
    const x = 0.55 + col * 4.18, y = 1.85 + row * 0.98;
    card(s, x, y, 3.95, 0.82, {});
    s.addText(t[0], { x: x + 0.16, y: y + 0.13, w: 0.75, h: 0.6, fontFace: FD, fontSize: 22, bold: true, color: C.GOLD, margin: 0 });
    s.addText(t[1], { x: x + 0.95, y, w: 2.95, h: 0.82, fontFace: F, fontSize: 11.5, bold: true, color: C.NAVY, valign: "middle", margin: 0 });
  });
  s.addText("+ Appendix: visual asset recommendations · assumptions register · consolidated references",
    { x: 0.55, y: 6.78, w: 12, h: 0.3, fontFace: F, fontSize: 10.5, color: C.MUT, margin: 0 });

  // ═══ SECTION 1 ═══
  divider(pres, "01", "Executive Summary", "Why Padang Besar, why Malaysia, why border logistics — and the one strategic question that must be answered before any capital moves.",
    ["Why Padang Besar", "Why Malaysia", "Why border logistics", "Opportunities & challenges", "The honest bottom line"]);

  // 6. Why Padang Besar
  s = pres.addSlide();
  header(s, "Section 1 · Executive summary", "Why Padang Besar: the corridor is real, growing and under-built", "verified");
  const stats1 = [
    ["+25.9%", "Padang Besar (Thai) checkpoint trade growth 2024 — 102.3bn baht, 3rd in Thailand for transshipment value [R48]"],
    ["Only", "direct Malaysia–Thailand rail link — juxtaposed customs inside the station [R2, R3]"],
    ["~80%", "utilisation of the 150,000 TEU legacy terminal before operations migrated [R15]"],
    ["16 hrs", "road border window (06:00–22:00) — a solvable structural constraint [R4]"],
  ];
  stats1.forEach((t, i) => {
    const x = 0.55 + (i % 2) * 6.2, y = 1.75 + Math.floor(i / 2) * 1.62;
    card(s, x, y, 6.0, 1.42, {});
    s.addText(t[0], { x: x + 0.2, y: y + 0.12, w: 1.9, h: 1.2, fontFace: F, fontSize: 27, bold: true, color: C.NAVY, valign: "middle", margin: 0 });
    s.addText(t[1], { x: x + 2.2, y: y + 0.12, w: 3.65, h: 1.2, fontFace: F, fontSize: 10.5, color: C.TEXT, valign: "middle", margin: 0 });
  });
  card(s, 0.55, 5.2, 12.23, 1.55, { fill: C.NAVY });
  s.addText([
    { text: "Through this single crossing already run: ", options: { color: C.ICE } },
    { text: "the electrified KTMB double-track corridor, the CMA CGM/Infinity Penang landbridge block trains, the ASEAN Express to Chongqing, and daily freight into the new Perlis Inland Port. ", options: { color: "FFFFFF", bold: true } },
    { text: "The infrastructure conversation at this border has already started — the question is who builds its next layer. [R10–R13]", options: { color: C.ICE } },
  ], { x: 0.85, y: 5.35, w: 11.6, h: 1.25, fontFace: F, fontSize: 12.5, valign: "middle", margin: 0 });

  // 7. Why Malaysia
  s = pres.addSlide();
  header(s, "Section 1 · Executive summary", "Why Malaysia: a policy machine is already funding this corridor", "verified");
  const pol = [
    ["US$30bn", "official Malaysia–Thailand trade target for 2027, with a joint trade-facilitation task force [R46]"],
    ["PIKAS 2030", "national PPP master plan: RM78bn private investment target, competitive RFP model [R61]"],
    ["NCIA / NCER", "statutory development authority for Perlis with logistics as a mandated sector [R56]"],
    ["~RM400m", "government external works already delivered at this border (bonded road, rail spur, flyover) [R23, R36]"],
    ["RM374m", "Bank Pembangunan financing approved for Perlis Inland Port — lender precedent at this exact location [R25]"],
    ["Border Economic Zone", "announced by both Prime Ministers, July 2026 — spanning the northern border states [R60]"],
  ];
  pol.forEach((t, i) => {
    const x = 0.55 + (i % 3) * 4.18, y = 1.8 + Math.floor(i / 3) * 2.15;
    card(s, x, y, 3.95, 1.95, {});
    s.addText(t[0], { x: x + 0.2, y: y + 0.16, w: 3.55, h: 0.55, fontFace: F, fontSize: 17, bold: true, color: C.GOLD, margin: 0 });
    s.addText(t[1], { x: x + 0.2, y: y + 0.72, w: 3.55, h: 1.1, fontFace: F, fontSize: 10, color: C.TEXT, margin: 0, valign: "top" });
  });
  s.addText("Malaysia pairs this policy stack with a common-law system, deep sukuk/project-finance markets, and institutional lenders (BPMB, AIIB partnerships with Maybank/CIMB/AmBank) active in exactly this asset class. [R80]",
    { x: 0.55, y: 6.35, w: 12.2, h: 0.6, fontFace: F, fontSize: 11, italic: true, color: C.MUT, margin: 0 });

  // 8. Why border logistics
  s = pres.addSlide();
  header(s, "Section 1 · Executive summary", "Why border logistics: chokepoint economics with a rail growth option", "mixed");
  bullets(s, [
    { text: "Land-border trade is ~40% of US$25bn bilateral trade (2024) — and this checkpoint grew +25.9% while the total grew single digits. [R47, R48]", bold: true },
    { text: "Border logistics is a chokepoint business: where two customs regimes, two rail operators and two road networks meet, every improvement in flow is monetisable — handling, storage, marshalling, data." },
    { text: "Cross-border flows are the least commoditised, highest-friction segment of ASEAN logistics — friction is the revenue pool." },
    { text: "The China–ASEAN rail narrative (ASEAN Express since 2024; Kunming–Singapore corridor phases to 2031) adds a structural growth option on top of the bilateral base. [R12, R54]" },
    { text: "~70% of southern Thailand's export cargo already transships through Penang — the landbridge through Padang Besar is its land leg. [R51]" },
  ], { box: { x: 0.55, y: 1.75, w: 7.6, h: 4.9 }, gap: 12 });
  card(s, 8.5, 1.75, 4.28, 4.6, { fill: C.LIGHT });
  s.addText("WHY NOW", { x: 8.75, y: 1.95, w: 3.8, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  bullets(s, [
    { text: "PIP operating + FCZ live (May 2026): ecosystem momentum" },
    { text: "SRT Hat Yai–Padang Besar double-tracking at bid stage [R35]" },
    { text: "Border Economic Zone incentives being defined now" },
    { text: "13MP road-to-rail push; KTMB volumes +23.5% YoY [R33, R34]" },
    { text: "Positioning windows close once corridors consolidate" },
  ], { box: { x: 8.75, y: 2.35, w: 3.8, h: 3.9 }, gap: 9 });

  // 9. Honest bottom line
  s = pres.addSlide();
  header(s, "Section 1 · Executive summary", "The honest bottom line — and the strategic question", "reco");
  card(s, 0.55, 1.7, 6.0, 2.4, { fill: "EAF3EE" });
  s.addText("WHAT IS VERIFIED", { x: 0.8, y: 1.85, w: 5.5, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GREEN, charSpacing: 2, margin: 0 });
  bullets(s, [
    "The corridor: trade volumes, growth, rail services, policy support",
    "The precedents: PIP financing, Thanaleng model, Shandong Hi-Speed active in Malaysia",
    "The constraints: border hours, Thai single-track, competition",
  ], { box: { x: 0.8, y: 2.2, w: 5.55, h: 1.8 }, gap: 7 });
  card(s, 6.8, 1.7, 6.0, 2.4, { fill: "F7EFE2" });
  s.addText("WHAT IS NOT VERIFIED", { x: 7.05, y: 1.85, w: 5.5, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.AMBER, charSpacing: 2, margin: 0 });
  bullets(s, [
    "This project's land, rights, mandate and approvals",
    "Its relationship to the operating Perlis Inland Port",
    "Any commitment by Shandong Hi-Speed, government or investors",
  ], { box: { x: 7.05, y: 2.2, w: 5.55, h: 1.8 }, gap: 7 });
  card(s, 0.55, 4.4, 12.23, 2.25, { fill: C.NAVY });
  s.addText("THE STRATEGIC QUESTION", { x: 0.85, y: 4.6, w: 11.5, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  s.addText([
    { text: "Perlis Inland Port is operating in the same town — state-backed, KTMB-run, royally launched. This project must define itself as ", options: { color: C.ICE } },
    { text: "integration, complement, or competitor ", options: { color: "FFFFFF", bold: true } },
    { text: "to PIP before approaching any investor. This package is built to force that answer early (Sections 11–12), then convert the verified corridor thesis into an investable transaction (Sections 13–15).", options: { color: C.ICE } },
  ], { x: 0.85, y: 4.95, w: 11.6, h: 1.55, fontFace: F, fontSize: 13, valign: "top", margin: 0 });

  // ═══ SECTION 2 ═══
  divider(pres, "02", "Public Research", "Only publicly verifiable information, every statement referenced. Conflicting sources are disclosed; unverifiable items are quarantined.",
    ["Border & rail anatomy", "Perlis Inland Port", "Trade statistics", "Policy & stakeholders", "What we could not verify"]);

  // 11. Border system
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "The border system: one town, two regimes, three channels", "verified");
  tbl(s, [
    ["Channel", "Verified facts", "Refs"],
    ["Rail", "Malaysia's only direct rail link with Thailand. Station (1918) hosts juxtaposed MY+TH border controls. KTMB electrified double-track metre-gauge line meets SRT Southern Line. No gauge break — both networks are metre gauge; the standard-gauge break for China traffic is at Thanaleng, Laos.", "R2, R3, R9, R30"],
    ["Road", "ICQS complex handles passenger + cargo vehicles; hours ~06:00–22:00 (not 24h). Federal Route 7 starts at the border; FT79 links south; expressway via Changlun. The busier road crossing is Bukit Kayu Hitam–Sadao, 45 km east — new link road opened July 2026.", "R4, R6–R8, R42, R43"],
    ["Customs", "JKDM/RMCD administers the land entry point. National digital rails: uCustoms/SMK; ASEAN Single Window live for e-Form D across all 10 member states. ACTS transit system piloted by MY–SG–TH. Single-stop inspection studied (CAREC), implementation unverified.", "R18, R21, R44, R45"],
  ], { size: 10.5, hSize: 11, box: { x: 0.55, y: 1.7, w: 12.23, colW: [1.5, 8.9, 1.83] } });
  s.addText("Detail slide 3.2 maps these channels as a flow diagram.", { x: 0.55, y: 6.5, w: 12, h: 0.3, fontFace: F, fontSize: 10, italic: true, color: C.MUT, margin: 0 });

  // 12. Rail services
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "Rail cargo: four services already run through this crossing", "verified");
  const rails = [
    ["KTMB Kargo landbridge", "Container services linking Penang Port, Port Klang and Padang Besar; ~4-day transit concept. [R10]"],
    ["Penang block train (2022)", "CMA CGM / Infinity Penang–Padang Besar service; corridor reported up to 7,500 TEU/month. [R11]"],
    ["ASEAN Express (2024)", "KL (Kontena Nasional ICD) → Padang Besar → Lat Krabang → Thanaleng → Chongqing. ~9–14 days vs 14–21 by sea. [R12, R31]"],
    ["STC Perai–PIP (2025)", "Daily freight into Perlis Inland Port; first train 80 TEU on 1 Dec 2025. [R13]"],
  ];
  rails.forEach((r, i) => {
    const x = 0.55 + (i % 2) * 6.22, y = 1.7 + Math.floor(i / 2) * 1.62;
    card(s, x, y, 6.0, 1.45, {});
    s.addText(r[0], { x: x + 0.2, y: y + 0.12, w: 5.6, h: 0.35, fontFace: F, fontSize: 12.5, bold: true, color: C.NAVY, margin: 0 });
    s.addText(r[1], { x: x + 0.2, y: y + 0.5, w: 5.6, h: 0.9, fontFace: F, fontSize: 10, color: C.TEXT, margin: 0, valign: "top" });
  });
  card(s, 0.55, 5.1, 12.23, 1.6, { fill: C.LIGHT });
  s.addText("Capacity outlook", { x: 0.8, y: 5.25, w: 4, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.NAVY, margin: 0 });
  bullets(s, [
    "13MP-era plans: Padang Besar Depot upgrade, road-to-rail shift, North Butterworth terminal upgrade [R33]; KTMB rail volumes +23.5% YoY Jan 2026 [R34]",
    "Thai side: SRT double-tracking Hat Yai–Padang Besar (45 km, ~7.77bn baht) slated for bidding within 2026 [R35]",
  ], { box: { x: 0.8, y: 5.6, w: 11.7, h: 1.05 }, gap: 6 });

  // 13. PIP timeline
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "Perlis Inland Port: the operating incumbent next door", "verified");
  flow(s, [
    { title: "2022", sub: "Construction launch; NCIA external works (bonded road, rail spur, flyover)" },
    { title: "Mar–Apr 2025", sub: "KTMB O&M agreement; Maersk MOC; Kalmar equipment" },
    { title: "1 Dec 2025", sub: "First commercial freight train (80 TEU, Perai–PIP)" },
    { title: "12 Apr 2026", sub: "Operations migrate from legacy TKPB terminal" },
    { title: "30 May 2026", sub: "Raja of Perlis launches Free Commercial Zone" },
  ], { y: 1.8, h: 1.5, tSize: 12, sSize: 8.5 });
  const pipStats = [
    ["500 acres", "site with bonded road + rail siding [R17]"],
    ["600,000", "TEU/yr stated current capability [R17]"],
    ["RM374m", "BPMB financing approved [R25]"],
    ["80 : 20", "Mutiara Infra : Perlis MB Inc ownership of Mutiara Perlis [R14]"],
  ];
  pipStats.forEach((t, i) => {
    const x = 0.55 + i * 3.12;
    card(s, x, 3.75, 2.95, 1.5, {});
    stat(s, x, 3.92, 2.95, t[0], t[1], { size: 20 });
  });
  card(s, 0.55, 5.5, 12.23, 1.15, { fill: "F7EFE2" });
  s.addText([
    { text: "Disclosed source conflicts: ", options: { bold: true, color: C.AMBER } },
    { text: "total cost reported between RM327m and RM492m across outlets; ultimate capacity reported as both 1M and 2M TEU/yr. Figures used here are the best-attested official statements. [R17, R26, R27, R37, R38]", options: { color: C.TEXT } },
  ], { x: 0.8, y: 5.62, w: 11.7, h: 0.95, fontFace: F, fontSize: 10.5, valign: "middle", margin: 0 });

  // 14. Trade statistics
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "Malaysia–Thailand trade: the demand base is verified", "verified");
  const tr = [
    ["US$25.06bn", "bilateral trade 2024; ~40% via land borders [R47]"],
    ["US$30bn", "official 2027 target (3rd Joint Trade Committee) [R46]"],
    ["102.3bn baht", "Padang Besar checkpoint 2024, +25.9% YoY [R48]"],
    ["315.1bn baht", "Thai–Malaysia border trade 2025 — Thailand's largest border partner [R49]"],
  ];
  tr.forEach((t, i) => {
    const x = 0.55 + i * 3.12;
    card(s, x, 1.75, 2.95, 1.75, {});
    stat(s, x, 1.98, 2.95, t[0], t[1], { size: 19 });
  });
  s.addText("What moves across this border", { x: 0.55, y: 3.85, w: 6, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: C.NAVY, margin: 0 });
  bullets(s, [
    "Exports through Sadao/Padang Besar led by hard disk drives and processed wood; rubber (TSNR) via Songkhla checkpoints +39.3% [R48]",
    "F&B reported as the largest cross-border category, followed by E&E (single source) [R50]",
    "Sadao handles ~2× Padang Besar's trade value — but Padang Besar is growing far faster and owns the rail channel [R48]",
    "~70% of southern Thailand's export cargo transships via Penang — the corridor this platform would serve [R51]",
  ], { box: { x: 0.55, y: 4.25, w: 12.2, h: 2.4 }, gap: 9 });

  // 15. Policy stack
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "Government initiatives: federal, state and bilateral layers", "verified");
  tbl(s, [
    ["Layer", "Initiative", "Relevance", "Refs"],
    ["Bilateral", "US$30bn 2027 target + task force; Border Economic Zone announced Jul 2026; new BKH–Sadao road opened", "Political momentum for border trade infrastructure", "R46, R60, R42"],
    ["Federal", "PIKAS 2030 PPP master plan; National Transport Policy 2019–30; 13MP road-to-rail + Padang Besar Depot upgrade; NIMP 2030 (logistics as enabler)", "Defines the PPP route (UKAS RFP), rail investment pipeline", "R61, R58, R33, R59"],
    ["Regional", "NCIA (Act 687) mandate for NCER; Chuping Valley Industrial Area (2,482 acres, green/halal); IMT-GT corridor", "The statutory sponsor that already co-funded PIP external works", "R56, R57, R53"],
    ["State", "Perlis investment drive (MIDA Invest Series 2025); Padang Besar designated growth area; largest-ever state budget 2026", "State government actively courting logistics investment", "R39, R64, R65"],
    ["Ownership rules", "≥51% Malaysian ownership floor for port/strategic concessions (reaffirmed Jul 2026); Bumiputera equity conditions in logistics licensing", "Hard constraint on consortium design (Section 13)", "R62, R63"],
  ], { size: 9.5, hSize: 10.5, box: { x: 0.55, y: 1.65, w: 12.23, colW: [1.45, 5.3, 3.75, 1.73] } });

  // 16. Thailand side
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "The Thai side: capacity is coming toward this border", "verified");
  bullets(s, [
    { text: "SRT southern double-tracking package includes Hat Yai–Padang Besar (45 km, ~7.77bn baht) — explicitly framed as strategic for the Malaysia corridor; bidding targeted within 2026. [R35]", bold: true },
    { text: "Thai CIQ upgrade plans reported at Padang Besar (single source — scope/budget unpublished). [R20]" },
    { text: "New Sadao CIQ–Bukit Kayu Hitam road opened 10 July 2026 (11 vehicle + 14 immigration lanes/side, dual X-ray cargo terminal) — strengthens the competing road corridor. [R42]" },
    { text: "Songkhla is southern Thailand's logistics province: rubber, wood, seafood export base; Padang Besar (Thai) station is the Southern Line freight terminus. [R48]" },
    { text: "Thai Land Bridge (Chumphon–Ranong) remains in study flux — fresh environmental studies ordered June 2026; a long-run variable, not a near-term constraint. [R55]" },
  ], { box: { x: 0.55, y: 1.75, w: 8.0, h: 4.9 }, gap: 12 });
  card(s, 8.9, 1.75, 3.88, 4.4, { fill: C.LIGHT });
  s.addText("READ-THROUGH", { x: 9.15, y: 1.95, w: 3.4, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  s.addText("Rail capacity into Padang Besar is being doubled from the Thai side while road capacity consolidates at Sadao–BKH. A rail-centred platform at Padang Besar aligns with where both governments are putting steel.",
    { x: 9.15, y: 2.35, w: 3.45, h: 3.6, fontFace: F, fontSize: 11.5, color: C.TEXT, margin: 0, valign: "top" });

  // 17. Stakeholder map
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "Stakeholder map: who already acts in this corridor", "verified");
  tbl(s, [
    ["Cluster", "Stakeholders (published roles)", "Refs"],
    ["Federal", "MOT (rail/logistics policy; PIP champion) · MITI/MIDA (trade target, promotion) · JKDM Customs · UKAS (PPP gatekeeper) · Railway Assets Corporation", "R33, R46, R61"],
    ["Regional/State", "NCIA (external infra funder, CVIA developer) · Perlis state govt & MB Inc (20% of Mutiara Perlis) · Padang Besar growth-area designation", "R14, R23, R56, R65"],
    ["Rail & ports", "KTMB (ASEAN Express, PIP O&M, TKPB) · SRT (Southern Line, double-tracking) · Penang Port (70% of southern-Thai transshipment) · Kontena Nasional (ASEAN Express origin ICD)", "R12, R16, R35, R51"],
    ["Corporate", "Mutiara Perlis / Perlis Inland Port Sdn Bhd · Maersk (MOC) · CMA CGM/Infinity (block train) · Citaglobal, Berjaya Property (equity moves) · Kalmar (equipment)", "R11, R22, R39, R41"],
    ["Thai side", "Thai Customs (Padang Besar & Sadao houses) · SRT · Songkhla province · Thai MOT/OTP", "R35, R42, R48"],
  ], { size: 9.5, hSize: 10.5, box: { x: 0.55, y: 1.65, w: 12.23, colW: [1.7, 8.8, 1.73] } });

  // 18. Could not verify
  s = pres.addSlide();
  header(s, "Section 2 · Public research", "What we could not verify — quarantined from all argumentation", "pending");
  bullets(s, [
    "Ultimate PIP capacity (1M vs 2M TEU/yr) and total PIP cost (RM327m–RM492m across outlets) — conflicting public figures",
    "Malaysian checkpoint-level trade statistics (JKDM does not publish; Thai customs data used instead)",
    "Free Commercial Zone gazettement instrument; bonded warehouse licences at PIP",
    "uCustoms operational status at Padang Besar specifically; single-stop inspection implementation",
    "Any route designated “R15” serving Padang Besar (referenced in early briefs — no such designation found)",
    "Current Shandong Hi-Speed parent credit rating; Chinese trade-press claims of “>RMB 60bn Malaysia orders”",
    "Any MMC Corporation involvement in PIP; any SDHS/CSI mandate in Perlis",
    "Rail share of bilateral trade; ASEAN Express cumulative volumes",
    "Border Economic Zone boundaries and incentives (announced July 2026; details unpublished)",
  ], { box: { x: 0.55, y: 1.75, w: 12.2, h: 4.3 }, gap: 8 });
  card(s, 0.55, 6.15, 12.23, 0.75, { fill: C.LIGHT });
  s.addText("Rule applied: anything on this list is excluded from the business case and routed to due diligence (Section 11) or owner questions (Section 12).",
    { x: 0.8, y: 6.15, w: 11.7, h: 0.75, fontFace: F, fontSize: 11, italic: true, color: C.NAVY, valign: "middle", margin: 0 });

  // ═══ SECTION 3 ═══
  divider(pres, "03", "Current Ecosystem", "How cargo actually moves through Padang Besar today — road, rail, warehouse, container, cold chain, border and customs.",
    ["Corridor flow map", "Border process flows", "Facility inventory", "Ecosystem gaps"]);

  // 20. Corridor flow
  s = pres.addSlide();
  header(s, "Section 3 · Current ecosystem", "Corridor flow: how the pieces connect", "verified");
  // Thailand row
  s.addText("THAILAND · Songkhla", { x: 0.55, y: 1.62, w: 4, h: 0.3, fontFace: F, fontSize: 10, bold: true, color: C.AMBER, charSpacing: 1.5, margin: 0 });
  flow(s, [
    { title: "Hat Yai rail hub", sub: "SRT Southern Line (metre gauge)" },
    { title: "Thai roads / Sadao", sub: "trucking to border" },
  ], { y: 1.95, h: 0.85, x: 0.55, w: 5.6, tSize: 11, sSize: 8.5 });
  // Border node
  card(s, 6.65, 1.7, 2.6, 1.35, { fill: C.NAVY });
  s.addText([
    { text: "PADANG BESAR", options: { bold: true, color: "FFFFFF", fontSize: 12, breakLine: true } },
    { text: "Station (juxtaposed CIQ) + road ICQS 06:00–22:00", options: { color: C.ICE, fontSize: 8.5 } },
  ], { x: 6.7, y: 1.7, w: 2.5, h: 1.35, fontFace: F, align: "center", valign: "middle", margin: 0 });
  // Malaysia row
  s.addText("MALAYSIA · Perlis and beyond", { x: 9.4, y: 1.62, w: 3.9, h: 0.3, fontFace: F, fontSize: 10, bold: true, color: C.GREEN, charSpacing: 1.5, margin: 0 });
  flow(s, [
    { title: "Perlis Inland Port", sub: "500-acre FCZ, bonded road, rail siding" },
  ], { y: 1.95, h: 0.85, x: 9.4, w: 3.38, tSize: 11, sSize: 8.5 });
  // arrows into node
  s.addShape("rightArrow", { x: 6.2, y: 2.25, w: 0.4, h: 0.2, fill: { color: C.GOLD }, line: { type: "none" } });
  s.addShape("rightArrow", { x: 9.3, y: 2.25, w: 0.35, h: 0.2, fill: { color: C.GOLD }, line: { type: "none" } });
  // southbound corridor
  flow(s, [
    { title: "KTMB West Coast Line", sub: "electrified double track, metre gauge" },
    { title: "Penang Port (NBCT)", sub: "landbridge sea gateway — 70% of southern-Thai transshipment" },
    { title: "Klang Valley / Port Klang", sub: "national market + ASEAN Express origin" },
    { title: "China corridor", sub: "via Lat Krabang → Thanaleng (gauge break) → Chongqing" },
  ], { y: 3.6, h: 1.15, tSize: 11, sSize: 8.5 });
  card(s, 0.55, 5.2, 12.23, 1.45, { fill: C.LIGHT });
  s.addText("Key structural facts", { x: 0.8, y: 5.32, w: 5, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.NAVY, margin: 0 });
  bullets(s, [
    "No gauge break at this border (both metre gauge) — rail interchange here is commercial, not technical [R9, R30]",
    "Road cargo constrained by the 16-hour border window; heavy road flows consolidating at Bukit Kayu Hitam–Sadao [R4, R42]",
  ], { box: { x: 0.8, y: 5.66, w: 11.7, h: 0.95 }, gap: 5 });

  // 21. Border process flows
  s = pres.addSlide();
  header(s, "Section 3 · Current ecosystem", "Border process: rail vs road today", "verified");
  s.addText("RAIL CARGO (juxtaposed controls)", { x: 0.55, y: 1.7, w: 6, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.NAVY, margin: 0 });
  flow(s, [
    { title: "Load at origin ICD", sub: "KL / Perai / Lat Krabang" },
    { title: "Line-haul", sub: "KTMB or SRT metre gauge" },
    { title: "Padang Besar station", sub: "MY + TH clearance co-located" },
    { title: "Onward line-haul", sub: "no transshipment needed" },
  ], { y: 2.05, h: 1.0, tSize: 10.5, sSize: 8.5 });
  s.addText("ROAD CARGO (sequential controls, 06:00–22:00)", { x: 0.55, y: 3.4, w: 7, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.NAVY, margin: 0 });
  flow(s, [
    { title: "Queue at approach", sub: "no managed marshalling documented" },
    { title: "Exit CIQ", sub: "origin-side customs & immigration" },
    { title: "Entry ICQS/CIQ", sub: "destination-side inspection" },
    { title: "Onward haulage", sub: "FT7/FT79 → expressway via Changlun" },
  ], { y: 3.75, h: 1.0, tSize: 10.5, sSize: 8.5 });
  card(s, 0.55, 5.15, 12.23, 1.5, { fill: "F7EFE2" });
  s.addText([
    { text: "The friction points are visible: ", options: { bold: true, color: C.AMBER } },
    { text: "unmanaged truck queues against a hard 22:00 cutoff, paper-heavy road clearance, and no published integrated visibility from booking to release. Rail avoids most of this — which is why the corridor's growth is running through it. (Team interpretation based on referenced facts.)", options: { color: C.TEXT } },
  ], { x: 0.8, y: 5.28, w: 11.7, h: 1.25, fontFace: F, fontSize: 11.5, valign: "middle", margin: 0 });

  // 22. Facility inventory
  s = pres.addSlide();
  header(s, "Section 3 · Current ecosystem", "Facility inventory: what exists at the border today", "verified");
  tbl(s, [
    ["Element", "Current state (published)", "Refs"],
    ["Container terminal", "Legacy TKPB: 150,000 TEU/yr, ~80% utilised before migration; operations moved to PIP 12 Apr 2026", "R15, R16"],
    ["Inland port / FCZ", "PIP: 500 acres, 600,000 TEU/yr capability, bonded road, rail siding, FCZ launched 30 May 2026", "R17"],
    ["Warehousing", "PIP warehousing targets halal, automotive, rubber; no other large modern stock documented at the border", "R14"],
    ["Cold chain", "No large-scale multi-user cold-chain facility documented in public sources — apparent white space (interpretation)", "—"],
    ["Truck facilities", "No managed marshalling/booking system documented; border hours 06:00–22:00", "R4"],
    ["Customs facilities", "ICQS complex (road) + juxtaposed controls (rail); Thai CIQ upgrade plans reported (single source)", "R3, R20"],
    ["Handling equipment", "PIP: RM17m Kalmar order (15 units) via Mach 1, May 2025", "R36"],
  ], { size: 9.5, hSize: 10.5, box: { x: 0.55, y: 1.65, w: 12.23, colW: [2.2, 8.3, 1.73] } });

  // 23. Gap analysis
  s = pres.addSlide();
  header(s, "Section 3 · Current ecosystem", "Ecosystem gaps: five white spaces (team interpretation)", "reco");
  const gaps = [
    ["Cold chain at scale", "Perishables flow both ways (Thai fruit/seafood south, Malaysian halal north) with no documented multi-user cold facility at the border."],
    ["Truck marshalling", "A hard 22:00 cutoff with unmanaged queues = monetisable slot booking, secure parking and call-up services."],
    ["Digital corridor visibility", "No published integrated system links booking → gate → customs status → release across the crossing."],
    ["Free-zone VAS", "Labelling, kitting, halal certification support and light processing inside zone conditions — early-stage at PIP."],
    ["24-hour operations", "A bilateral policy matter, repeatedly raised, unresolved — the single biggest unlock, outside private control."],
  ];
  gaps.forEach((g, i) => {
    const x = 0.55 + (i % 3) * 4.18, y = 1.75 + Math.floor(i / 3) * 2.3;
    card(s, x, y, 3.95, 2.1, {});
    s.addText(String(i + 1), { x: x + 0.18, y: y + 0.14, w: 0.6, h: 0.55, fontFace: FD, fontSize: 26, bold: true, color: C.GOLD, margin: 0 });
    s.addText(g[0], { x: x + 0.78, y: y + 0.18, w: 3.0, h: 0.5, fontFace: F, fontSize: 12, bold: true, color: C.NAVY, margin: 0, valign: "top" });
    s.addText(g[1], { x: x + 0.2, y: y + 0.78, w: 3.55, h: 1.25, fontFace: F, fontSize: 9.5, color: C.TEXT, margin: 0, valign: "top" });
  });
  card(s, 8.91, 4.05, 3.87, 2.3, { fill: C.NAVY });
  s.addText("These five gaps are the demand hypotheses the feasibility study must test — they are interpretations, not established markets.",
    { x: 9.15, y: 4.25, w: 3.4, h: 1.9, fontFace: F, fontSize: 11.5, color: "FFFFFF", margin: 0, valign: "top" });
};
