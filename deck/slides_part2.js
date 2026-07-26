// Part 2: Sections 4 (Opportunities), 5 (Work Packages), 6 (Digitalisation), 7 (Prospek), 8 (Shandong)
module.exports = function build(pres, T) {
  const { C, F, FD, header, divider, bullets, card, tbl, flow } = T;
  let s;

  // ═══ SECTION 4 ═══
  divider(pres, "04", "Project Opportunities", "The opportunity map across the platform lifecycle — construction, operations, commercial, asset management, expansion, digital.",
    ["Construction scope", "Operations & commercial", "Asset management", "Expansion & digital"]);

  // Opportunity map: construction + ops
  s = pres.addSlide();
  header(s, "Section 4 · Project opportunities", "Build & operate: the physical opportunity set", "proposed");
  tbl(s, [
    ["Construction (◆ = needs land/rights, ● = needs govt/agency agreement)", "Operations"],
    ["Site development & flood-resilient earthworks ◆", "Terminal operations: rail yard + container yard (self-perform or operator partner)"],
    ["Warehouses: ambient, bonded, cold chain — smart-warehouse spec ◆", "Warehouse operations: 3PL contracts, bonded ops, cold-chain management"],
    ["Rail sidings & terminal trackworks (KTMB agreement) ◆●", "Truck terminal: marshalling, booking slots, secure overnight parking"],
    ["Internal roads, truck marshalling infrastructure ◆", "Facility management, security, equipment maintenance & rental"],
    ["Utilities: substations, water, fire, solar PV, standby power ◆", "Reefer pre-trip inspection, container repair & washing"],
    ["Buildings: admin, commercial, customs/agency facilities ◆●", "Border-services support offered to agencies (inspection support) ●"],
    ["Digital infrastructure built with civil works, not retrofitted ◆", "Energy services: solar PPA, energy-as-a-service for cold tenants"],
  ], { size: 10, hSize: 10.5, box: { x: 0.55, y: 1.7, w: 12.23, colW: [6.1, 6.13] } });
  s.addText("Precedent: the SDHS–PTT Synergy smart-warehousing framework (Sep 2025) shows the build model is already active in Malaysia. [R72, R73]",
    { x: 0.55, y: 6.5, w: 12.2, h: 0.3, fontFace: F, fontSize: 10, italic: true, color: C.MUT, margin: 0 });

  // Commercial / AM / digital
  s = pres.addSlide();
  header(s, "Section 4 · Project opportunities", "Commercial, asset management and digital layers", "proposed");
  const blocks = [
    ["COMMERCIAL", ["Anchor leasing: 3PLs, forwarders, Thai & Malaysian shippers, e-commerce", "Free-zone VAS: labelling, kitting, halal support, light assembly ●", "Trade services cluster: brokers, banks, insurers, surveyors as tenants", "Fuel, retail, F&B concessions serving driver traffic"]],
    ["ASSET MANAGEMENT", ["ISO 55000 regime as a paid service to the SPV and zone tenants", "Capex renewal programme management over a 30+ year life", "Energy management and solar PPA structures", "Digital-twin-driven lifecycle optimisation (Section 6)"]],
    ["DIGITAL", ["Corridor visibility platform: booking → gate → customs → delivery", "Data products for shippers, forwarders and agencies", "Smart-warehouse services on SDHS-ecosystem automation", "Command-centre services to tenants and, potentially, agencies ●"]],
  ];
  blocks.forEach((b, i) => {
    const x = 0.55 + i * 4.18;
    card(s, x, 1.75, 3.95, 4.6, {});
    s.addText(b[0], { x: x + 0.22, y: 1.95, w: 3.5, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
    bullets(s, b[1], { box: { x: x + 0.22, y: 2.4, w: 3.55, h: 3.8 }, gap: 10, color: C.TEXT });
  });
  s.addText("● = requires government/agency agreement — routed to Section 12 owner questions and Phase 1–2 engagement.",
    { x: 0.55, y: 6.5, w: 12.2, h: 0.3, fontFace: F, fontSize: 10, italic: true, color: C.MUT, margin: 0 });

  // Expansion
  s = pres.addSlide();
  header(s, "Section 4 · Project opportunities", "Expansion options: what Phase 2+ can become", "proposed");
  const exp = [
    ["E-commerce fulfilment campus", "Riding cross-border e-commerce growth on the rail corridor"],
    ["Halal logistics hub", "Aligned with Chuping Valley Industrial Area's halal-industry positioning ● [R57]"],
    ["Cold-chain corridor scaling", "Growing with Thai perishables and Malaysian halal exports"],
    ["Standard-gauge readiness", "Passive provision if Pan-Asian rail plans ever extend south ●"],
    ["Model replication", "Apply the platform + digital playbook at other crossings (Rantau Panjang, Bukit Kayu Hitam)"],
    ["Border Economic Zone play", "Participate once incentives are gazetted (announced Jul 2026) ● [R60]"],
  ];
  exp.forEach((e, i) => {
    const x = 0.55 + (i % 3) * 4.18, y = 1.8 + Math.floor(i / 3) * 2.3;
    card(s, x, y, 3.95, 2.05, {});
    s.addText(e[0], { x: x + 0.2, y: y + 0.18, w: 3.55, h: 0.65, fontFace: F, fontSize: 12.5, bold: true, color: C.NAVY, margin: 0, valign: "top" });
    s.addText(e[1], { x: x + 0.2, y: y + 0.88, w: 3.55, h: 1.05, fontFace: F, fontSize: 10, color: C.TEXT, margin: 0, valign: "top" });
  });
  s.addText("All expansion options are design-stage provisions only — safeguarded land and corridors (WP20), not committed scope.",
    { x: 0.55, y: 6.5, w: 12.2, h: 0.3, fontFace: F, fontSize: 10, italic: true, color: C.MUT, margin: 0 });

  // ═══ SECTION 5 ═══
  divider(pres, "05", "EPC Work Packages", "Twenty packages structured for consortium scope allocation, staged financing and early-revenue sequencing. Scope and siting pending owner confirmation.",
    ["WP01–04 Enabling", "WP05–10 Core logistics", "WP11–14 Buildings & border", "WP15–17 Digital", "WP18–20 Readiness & expansion"]);

  // WP 1-10
  s = pres.addSlide();
  header(s, "Section 5 · Work packages", "WP01–WP10: enabling works and core logistics infrastructure", "proposed");
  tbl(s, [
    ["WP", "Package", "Scope highlights"],
    ["WP01", "Site investigation & surveys", "Topo/geotech/hydrology, utilities, boundary, environmental & social baseline, border traffic counts"],
    ["WP02", "Enabling works & earthworks", "Clearance, cut-and-fill, ground improvement, platform formation, construction drainage"],
    ["WP03", "Utilities & services", "Power intake + substations (TNB), water, sewerage, telecom ducting, fire systems, standby power, solar provision"],
    ["WP04", "Roads, drainage, landscape", "Internal heavy-duty pavements, stormwater + flood mitigation, fencing, buffers"],
    ["WP05", "Rail siding & trackworks", "Sidings to KTMB corridor (subject to agreement), turnouts, terminal pavement — no gauge break exists; passive future-gauge provision only"],
    ["WP06", "Rail systems & signalling", "Terminal signalling, main-line interlocking interface, rail weighbridge-in-motion"],
    ["WP07", "Container yard & intermodal", "Paved yard, reefer racks, handling equipment, yard lighting/CCTV masts"],
    ["WP08", "General & bonded warehousing", "Ambient + bonded zones with customs-compliant segregation, docks, VAS areas"],
    ["WP09", "Cold chain facilities", "Multi-temperature rooms, blast freezing, insulated docks, halal-compliant segregation"],
    ["WP10", "Truck terminal & inspection", "Marshalling yards, queue lanes, weighbridges, driver amenities, inspection canopies"],
  ], { size: 8.8, hSize: 10, box: { x: 0.55, y: 1.6, w: 12.23, colW: [0.85, 2.9, 8.48] } });

  // WP 11-20
  s = pres.addSlide();
  header(s, "Section 5 · Work packages", "WP11–WP20: buildings, digital systems and readiness", "proposed");
  tbl(s, [
    ["WP", "Package", "Scope highlights"],
    ["WP11", "Customs & agency facilities", "Office/inspection space offered to JKDM, MAQIS, Immigration; scanner foundations (scanners typically govt-procured — TBC)"],
    ["WP12", "Admin & commercial buildings", "HQ, tenant offices (forwarders, brokers, banks), canteen, surau, clinic, training"],
    ["WP13", "Workshops & MRO", "Container repair/washing, equipment workshops, reefer PTI stations"],
    ["WP14", "Security infrastructure", "Bonded-grade perimeter, access control, guardhouses, secondary inspection areas"],
    ["WP15", "Terminal operating system", "TOS + rail planning module, EDI with KTMB/lines/hauliers, gate integration"],
    ["WP16", "WMS, billing & ERP", "Ambient/bonded/cold WMS, billing engine, customer portal, customs-system interfaces (subject to JKDM availability)"],
    ["WP17", "Site-wide digital infrastructure", "Fibre, private wireless, data centre, IoT, ANPR, AI CCTV, command centre, digital twin, cyber stack"],
    ["WP18", "Testing & operational readiness", "Integrated testing, dry runs with hauliers/forwarders, customs rehearsal, hiring & SOPs"],
    ["WP19", "Taking-over & defects", "Certification, punch lists, as-builts, digital twin handover"],
    ["WP20", "Future expansion provision", "Safeguarded land/utility corridors for Phase 2+ — passive design provision only"],
  ], { size: 8.8, hSize: 10, box: { x: 0.55, y: 1.6, w: 12.23, colW: [0.85, 2.9, 8.48] } });

  // Packaging strategy
  s = pres.addSlide();
  header(s, "Section 5 · Work packages", "Packaging strategy: how the WPs go to market", "reco");
  bullets(s, [
    { text: "Single EPC wrap preferred. A fixed-price, date-certain EPC head contract over WP01–WP14 (+WP17 build) is the lender-friendly route; nominated subcontracts for rail systems and digital where specialists differ.", bold: true },
    { text: "Rail packages are schedule-critical. WP05–WP06 need KTMB technical approval and possession planning — engage before EPC pricing, and design the platform to open road-only if rail consent lags." },
    { text: "Split-out option: WP15–WP17 as a systems-integrator contract under Prospek's integration accountability, if the technology consortium differs from the civil EPC." },
    { text: "Long-lead items to order early: refrigeration plant (WP09), handling equipment (WP07), substation equipment (WP03), scanners/ANPR (WP17)." },
    { text: "Local content is structural, not optional: CIDB registration, Bumiputera contractor programmes and Malaysian subcontracting shape the EPC consortium from day one. [R62, R63]" },
  ], { box: { x: 0.55, y: 1.75, w: 7.9, h: 4.9 }, gap: 13 });
  card(s, 8.8, 1.75, 3.98, 4.6, { fill: C.LIGHT });
  s.addText("SEQUENCING LOGIC", { x: 9.05, y: 1.95, w: 3.5, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  flow(s, [{ title: "WP01–04", sub: "enabling" }, { title: "WP05–10", sub: "core" }], { y: 2.45, h: 0.85, x: 9.05, w: 3.5, tSize: 10, sSize: 8 });
  flow(s, [{ title: "WP11–14", sub: "buildings" }, { title: "WP15–17", sub: "digital" }], { y: 3.55, h: 0.85, x: 9.05, w: 3.5, tSize: 10, sSize: 8 });
  flow(s, [{ title: "WP18–19", sub: "readiness" }, { title: "WP20", sub: "expansion" }], { y: 4.65, h: 0.85, x: 9.05, w: 3.5, tSize: 10, sSize: 8 });

  // ═══ SECTION 6 ═══
  divider(pres, "06", "Digitalisation Strategy", "The most digitally advanced land-border logistics facility in ASEAN — where the data layer is a revenue line, not a cost line.",
    ["Five-layer architecture", "Sixteen capability modules", "Command centre & cyber", "Phasing & digital revenue"]);

  // Architecture
  s = pres.addSlide();
  header(s, "Section 6 · Digitalisation", "Five-layer architecture: field sensors to revenue insight", "proposed");
  const layers = [
    ["L5 · INSIGHT & REVENUE", "Integrated dashboard · digital twin analytics · data products · ESG reporting", C.GOLD],
    ["L4 · APPLICATIONS", "TOS · WMS · truck management/VBS · asset management (EAM) · billing · customer portal", C.STEEL],
    ["L3 · PLATFORM", "Digital twin core (GIS + BIM) · IoT platform · video analytics · data lake · API/EDI bus", "3A6EA5"],
    ["L2 · NETWORK", "Fibre backbone · private 4G/5G · LoRaWAN · redundant WAN · edge compute", "2F6B8A"],
    ["L1 · FIELD", "AI CCTV · ANPR · IoT sensors · drones · weighbridges · RFID/OCR gates · smart meters · access control", C.NAVY],
  ];
  layers.forEach((l, i) => {
    const y = 1.72 + i * 0.98;
    card(s, 0.55, y, 12.23, 0.84, { fill: l[2] });
    s.addText(l[0], { x: 0.8, y, w: 3.4, h: 0.84, fontFace: F, fontSize: 11.5, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
    s.addText(l[1], { x: 4.3, y, w: 8.3, h: 0.84, fontFace: F, fontSize: 10.5, color: "FFFFFF", valign: "middle", margin: 0 });
  });
  s.addText("Open standards at every layer — no vendor lock-in; Chinese, Malaysian and international vendors compete at subsystem level.",
    { x: 0.55, y: 6.68, w: 12.2, h: 0.3, fontFace: F, fontSize: 10, italic: true, color: C.MUT, margin: 0 });

  // Modules 1
  s = pres.addSlide();
  header(s, "Section 6 · Digitalisation", "Capability modules (1 of 2): the built environment goes digital", "proposed");
  const mod1 = [
    ["Digital Twin", "Live 3D model fusing GIS + BIM + IoT: design coordination → operations simulation → asset lifecycle"],
    ["GIS", "Land parcels, utilities, flood modelling, corridor and expansion planning"],
    ["BIM", "Level 2+ mandated across design (CIDB-aligned); CDE from day one; BIM-to-FM handover"],
    ["Drones", "Construction photogrammetry, volumetrics; then perimeter patrol and stack audits (CAAM permits)"],
    ["IoT", "Reefer telemetry, cold rooms, energy submetering, pavement/structure and flood sensors"],
    ["AI CCTV", "Safety (PPE, intrusion), security (perimeter), operations (dock occupancy, queue estimation)"],
    ["ANPR", "Malaysian + Thai plates at all gates; links truck identity to bookings and customs status"],
    ["Predictive maintenance", "Telematics + EAM condition-based maintenance for equipment, refrigeration, substations"],
  ];
  mod1.forEach((m, i) => {
    const x = 0.55 + (i % 4) * 3.12, y = 1.75 + Math.floor(i / 4) * 2.4;
    card(s, x, y, 2.95, 2.2, {});
    s.addText(m[0], { x: x + 0.16, y: y + 0.14, w: 2.65, h: 0.55, fontFace: F, fontSize: 11.5, bold: true, color: C.NAVY, margin: 0, valign: "top" });
    s.addText(m[1], { x: x + 0.16, y: y + 0.72, w: 2.65, h: 1.4, fontFace: F, fontSize: 8.8, color: C.TEXT, margin: 0, valign: "top" });
  });

  // Modules 2
  s = pres.addSlide();
  header(s, "Section 6 · Digitalisation", "Capability modules (2 of 2): operations, flow and trust", "proposed");
  const mod2 = [
    ["Command Centre (ICC)", "One control room: CCTV walls, TOS/WMS status, gates, border queue dashboard, incident management; hosts agency liaison desks"],
    ["Warehouse automation", "Phased: WMS-directed → RFID/barcode → conveyor/sortation and AMRs in e-commerce zones"],
    ["Truck management (TMS/VBS)", "Slot booking, driver app (BM/Thai/EN/CN), e-call-up, release tied to customs status"],
    ["Smart parking", "Occupancy sensing for marshalling + staff parking; dynamic signage; paid overnight parking"],
    ["Traffic analytics", "Queue length, dwell, lane throughput — shareable with police/JKR/customs"],
    ["Asset management (EAM)", "ISO 55000 register, lifecycle costing — underpins the long-term asset management services role"],
    ["Integrated dashboard", "Board/agency KPI layer: TEU, dwell, revenue, energy, safety, ESG — investor-grade reporting"],
    ["Cybersecurity", "IEC 62443 (OT) + ISO 27001 (IT), segmented customs-facing systems, SOC, Cyber Security Act 2024 compliance, PDPA"],
  ];
  mod2.forEach((m, i) => {
    const x = 0.55 + (i % 4) * 3.12, y = 1.75 + Math.floor(i / 4) * 2.4;
    card(s, x, y, 2.95, 2.2, {});
    s.addText(m[0], { x: x + 0.16, y: y + 0.14, w: 2.65, h: 0.55, fontFace: F, fontSize: 11.5, bold: true, color: C.NAVY, margin: 0, valign: "top" });
    s.addText(m[1], { x: x + 0.16, y: y + 0.72, w: 2.65, h: 1.4, fontFace: F, fontSize: 8.8, color: C.TEXT, margin: 0, valign: "top" });
  });

  // Phasing + revenue
  s = pres.addSlide();
  header(s, "Section 6 · Digitalisation", "Phasing and the digital revenue logic", "proposed");
  flow(s, [
    { title: "Phase A · with EPC", sub: "CDE/BIM, GIS, drone capture, fibre, construction CCTV" },
    { title: "Phase B · pre-ops", sub: "TOS, WMS, ANPR gates, VBS, ICC, cyber baseline" },
    { title: "Phase C · maturity", sub: "predictive maintenance, AI analytics, twin simulation, data products" },
    { title: "Phase D · expansion", sub: "warehouse automation, cross-border data corridors (subject to customs cooperation)" },
  ], { y: 1.85, h: 1.35, tSize: 11, sSize: 8.5 });
  s.addText("Digital as a revenue line (categories only — quantification pending feasibility, Section 10)", { x: 0.55, y: 3.6, w: 12, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: C.NAVY, margin: 0 });
  const rev = [
    ["VBS fees", "per-booking charges on truck slots"],
    ["Data subscriptions", "border-flow analytics for shippers & forwarders"],
    ["Monitoring services", "reefer/cold-chain monitoring-as-a-service"],
    ["Portal & EDI fees", "per-transaction charges"],
    ["ICC services", "monitoring/security sold to zone tenants"],
  ];
  rev.forEach((r, i) => {
    const x = 0.55 + i * 2.5;
    card(s, x, 4.1, 2.34, 1.6, { fill: C.LIGHT });
    s.addText(r[0], { x: x + 0.14, y: 4.25, w: 2.05, h: 0.5, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, margin: 0 });
    s.addText(r[1], { x: x + 0.14, y: 4.75, w: 2.05, h: 0.85, fontFace: F, fontSize: 8.8, color: C.TEXT, margin: 0, valign: "top" });
  });
  card(s, 0.55, 6.0, 12.23, 0.85, { fill: C.NAVY });
  s.addText("Principle: every digital system must either cut border dwell time or create a recurring income line — ideally both.",
    { x: 0.8, y: 6.0, w: 11.7, h: 0.85, fontFace: F, fontSize: 12, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });

  // ═══ SECTION 7 ═══
  divider(pres, "07", "Prospek Cerah Business Model", "Not a broker: a developer with capital at risk, contracted deliverables and income that arrives only if the project is built and operates well.",
    ["Why not a broker", "Eight roles", "Lifecycle fit", "Governance position"]);

  // Not a broker
  s = pres.addSlide();
  header(s, "Section 7 · Prospek Cerah", "Why Prospek Cerah is not a broker", "proposed");
  tbl(s, [
    ["Dimension", "Broker", "Prospek Cerah (proposed)"],
    ["Time horizon", "Transaction close", { text: "Full lifecycle: development → operations → expansion", bold: true }],
    ["Accountability", "None after introduction", { text: "Contracted deliverables: milestones, PMO KPIs, digital SLAs", bold: true }],
    ["Capital", "No skin in the game", { text: "Development capital at risk pre-financial-close; proposed SPV equity", bold: true }],
    ["Value creation", "Access", { text: "Project definition, structuring, integration, delivery capability", bold: true }],
    ["Revenue", "One-off commission", { text: "Milestone-earned fees + long-term recurring income", bold: true }],
    ["Relationships", "Introduces, then exits", { text: "Holds and manages stakeholder relationships permanently", bold: true }],
  ], { size: 10.5, hSize: 11, box: { x: 0.55, y: 1.7, w: 12.23, colW: [2.4, 3.6, 6.23] } });
  s.addText("The economic point for partners: the majority of Prospek's proposed income arrives only if the project is built and operates well.",
    { x: 0.55, y: 6.45, w: 12.2, h: 0.35, fontFace: F, fontSize: 11.5, italic: true, bold: true, color: C.NAVY, margin: 0 });

  // Eight roles
  s = pres.addSlide();
  header(s, "Section 7 · Prospek Cerah", "Eight roles across the project lifecycle", "proposed");
  const roles = [
    ["1 · Project Developer", "Originates and defines the project; funds pre-development; carries risk to financial close"],
    ["2 · Consortium Builder", "Assembles SPV shareholders, EPC, technology, operator, financiers as one integrated package"],
    ["3 · Business Development", "Builds the cargo book: shipper pre-commitments, anchor tenants, Thai counterparts"],
    ["4 · PMO", "Owner's-side programme management across WP01–WP20: schedule, cost, risk, lender reporting"],
    ["5 · Technology Integrator", "Accountable for WP15–WP17 systems working together and with government systems"],
    ["6 · Digitalisation Partner", "Long-term operator of the digital layer under SLA — recurring service income"],
    ["7 · Asset Management", "ISO 55000 management of the asset across its life; handback compliance if concession applies"],
    ["8 · Strategic Partner", "Standing counterpart to owner, state, federal and Shandong for expansion and replication"],
  ];
  roles.forEach((r, i) => {
    const x = 0.55 + (i % 4) * 3.12, y = 1.75 + Math.floor(i / 4) * 2.32;
    card(s, x, y, 2.95, 2.12, {});
    s.addText(r[0], { x: x + 0.16, y: y + 0.14, w: 2.65, h: 0.6, fontFace: F, fontSize: 11, bold: true, color: C.GOLD, margin: 0, valign: "top" });
    s.addText(r[1], { x: x + 0.16, y: y + 0.74, w: 2.65, h: 1.3, fontFace: F, fontSize: 8.8, color: C.TEXT, margin: 0, valign: "top" });
  });
  s.addText("Develop (Yr 0–2): roles 1–3 · Deliver (Yr 2–5): roles 4–5 · Operate (Yr 5+): roles 6–8. Governance: SPV shareholder + contracted PMO + digital/AM services — all related-party contracts disclosed and market-benchmarked.",
    { x: 0.55, y: 6.5, w: 12.2, h: 0.45, fontFace: F, fontSize: 9.5, italic: true, color: C.MUT, margin: 0 });

  // ═══ SECTION 8 ═══
  divider(pres, "08", "Shandong Hi-Speed Role", "What SDHS could undertake — structured for negotiation. No commitment by SDHS exists; corporate facts are referenced.",
    ["Verified profile", "Strategic fit", "Scope options", "Commercial postures"]);

  // SDHS profile
  s = pres.addSlide();
  header(s, "Section 8 · Shandong Hi-Speed", "Verified profile: scale, rail logistics and live Malaysia activity", "verified");
  const sd = [
    [">9,000 km", "expressways operated — provincial SOE, HQ Jinan [R66, R68]"],
    ["RMB 1.76tn", "reported total assets; Fortune Global 500 #401 (company-published — cross-check in DD) [R67]"],
    ["Qilu Express", "China–Europe freight brand; 2,500 Shandong-handled trips in 2023 [R69]"],
    ["RMB ~70bn", "revenue of listed EPC arm Shandong Hi-Speed Road & Bridge (000498.SZ) [R70]"],
  ];
  sd.forEach((t, i) => {
    const x = 0.55 + i * 3.12;
    card(s, x, 1.75, 2.95, 1.7, {});
    s.addText(t[0], { x: x + 0.15, y: 1.9, w: 2.65, h: 0.5, fontFace: F, fontSize: 17, bold: true, color: C.NAVY, margin: 0 });
    s.addText(t[1], { x: x + 0.15, y: 2.42, w: 2.65, h: 0.95, fontFace: F, fontSize: 9, color: C.TEXT, margin: 0, valign: "top" });
  });
  bullets(s, [
    { text: "Live in Malaysia: framework agreement with Bursa-listed PTT Synergy (23 Sep 2025) for smart/automated warehousing — reported ~RM2bn (Malaysian media) vs RM6bn/2M pallet positions (Chinese trade press); discrepancy disclosed. [R72, R73]", bold: true },
    { text: "China Shandong International (CSI), wholly-owned since 2008, has a Malaysian-registered entity. [R71]" },
    { text: "Ratings: Moody's first-time A3 (2018; current parent rating not publicly confirmable); Fitch A－/Stable on HK-listed Shandong Hi-Speed Holdings. [R74]" },
    { text: "No published SDHS commitment to Perlis or Padang Besar exists — the role described in this section is proposal-stage only.", color: C.AMBER, bold: true },
  ], { box: { x: 0.55, y: 3.75, w: 12.2, h: 3.0 }, gap: 10 });

  // SDHS scope + postures
  s = pres.addSlide();
  header(s, "Section 8 · Shandong Hi-Speed", "Scope SDHS could undertake — and three commercial postures", "proposed");
  tbl(s, [
    ["Domain", "Potential SDHS scope", "WPs"],
    ["Civil & infrastructure", "Earthworks, roads, pavements, rail sidings & systems (with KTMB approval), utilities", "WP02–07, 10"],
    ["Warehousing & buildings", "Ambient/bonded/cold warehouses; customs, admin, commercial buildings; workshops", "WP08–09, 11–13"],
    ["Digital & ICT", "Site-wide digital infrastructure delivery; fibre, data centre — under Prospek integration", "WP15–17"],
    ["Operations & maintenance", "Terminal O&M participation via logistics arms; long-term infrastructure maintenance", "Ops phase"],
    ["Future expansion", "EPC for Phase 2+; potential co-investment in expansion capex", "WP20"],
  ], { size: 9.5, hSize: 10.5, box: { x: 0.55, y: 1.65, w: 12.23, colW: [2.6, 7.6, 2.03] } });
  const post = [
    ["Posture 1", "EPC contractor only — date-certain, price-certain wrap; simplest entry"],
    ["Posture 2", "EPC + SPV equity — aligns delivery and ownership; needs related-party safeguards"],
    ["Posture 3", "EPC + equity + O&M — deepest integration; shares operating risk and upside"],
  ];
  post.forEach((p, i) => {
    const x = 0.55 + i * 4.18;
    card(s, x, 5.0, 3.95, 1.35, { fill: i === 1 ? C.NAVY : C.LIGHT });
    s.addText(p[0], { x: x + 0.2, y: 5.12, w: 3.5, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: i === 1 ? C.GOLD : C.GOLD, margin: 0 });
    s.addText(p[1], { x: x + 0.2, y: 5.44, w: 3.55, h: 0.85, fontFace: F, fontSize: 9.5, color: i === 1 ? "FFFFFF" : C.TEXT, margin: 0, valign: "top" });
  });
  s.addText("SDHS internal-approval needs: verified land/rights, bankable feasibility, tenure clarity, governance framework, CIDB licensing and Chinese outbound approvals (NDRC/MOFCOM/SAFE).",
    { x: 0.55, y: 6.5, w: 12.2, h: 0.4, fontFace: F, fontSize: 9.5, italic: true, color: C.MUT, margin: 0 });
};
