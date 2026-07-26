// Part 3: Sections 9-15 + Appendix
module.exports = function build(pres, T) {
  const { C, F, FD, header, divider, bullets, card, tbl, flow, chrome } = T;
  let s;

  // ═══ SECTION 9 ═══
  divider(pres, "09", "Investment Model", "Investor universe, revenue streams, capital and equity structure, PPP options, risk allocation, funding stages and exits — structures only, no invented numbers.",
    ["Investor universe", "Revenue streams", "Capital & PPP structure", "Risk allocation & exits"]);

  // Investor universe
  s = pres.addSlide();
  header(s, "Section 9 · Investment model", "The investor universe — and what each needs to see", "proposed");
  tbl(s, [
    ["Investor category", "Examples of type", "What they need to see"],
    ["Strategic — construction/infra", "Shandong Hi-Speed Group and peers", "EPC pipeline + equity upside; government endorsement"],
    ["Strategic — logistics operators", "Terminal operators, rail logistics groups, 3PLs", "Operating control or strong agreements; cargo commitments"],
    ["Logistics real estate platforms", "Regional industrial developers & funds (e.g., LOGOS-type JVs) [R81]", "Leasable product, tenant covenants, yield profile"],
    ["Financial — infrastructure funds", "ASEAN/Asia infra and PE funds", "Contracted revenue share, credible exit, governance rights"],
    ["Malaysian institutions", "GLIC/pension-type investors (mandate-dependent)", "National-interest alignment, stable yield, local partner quality"],
    ["DFIs / policy lenders", "IFC, AIIB, ECAs, policy banks — Thanaleng precedent [R75, R76]", "ESG compliance, trade-facilitation impact, sovereign context"],
    ["State/federal vehicles", "State economic corporations, facilitation funds", "Jobs, state revenue, border modernisation outcomes"],
  ], { size: 9.5, hSize: 10.5, box: { x: 0.55, y: 1.65, w: 12.23, colW: [3.0, 4.4, 4.83] } });

  // Revenue streams
  s = pres.addSlide();
  header(s, "Section 9 · Investment model", "Revenue architecture: six stream families", "proposed");
  const revs = [
    ["CORE TERMINAL", "Rail handling · container lift/storage · transshipment · reefer plugs · empty depot"],
    ["WAREHOUSING", "Ambient/bonded/cold leasing · VAS (kitting, labelling) · e-fulfilment"],
    ["BORDER SERVICES", "Truck marshalling/slot fees · weighbridge · inspection support · paid parking"],
    ["COMMERCIAL", "Office/retail rents · fuel & service concessions · advertising"],
    ["DIGITAL", "VBS fees · data products · reefer monitoring · portal transaction fees"],
    ["DEVELOPMENT & MGMT", "PMO fees · asset management fees · expansion development fees (accrue to service providers, not SPV)"],
  ];
  revs.forEach((r, i) => {
    const x = 0.55 + (i % 3) * 4.18, y = 1.75 + Math.floor(i / 3) * 2.3;
    card(s, x, y, 3.95, 2.05, {});
    s.addText(r[0], { x: x + 0.2, y: y + 0.18, w: 3.55, h: 0.35, fontFace: F, fontSize: 11, bold: true, color: C.GOLD, charSpacing: 1.5, margin: 0 });
    s.addText(r[1], { x: x + 0.2, y: y + 0.62, w: 3.55, h: 1.3, fontFace: F, fontSize: 10, color: C.TEXT, margin: 0, valign: "top" });
  });
  s.addText("No stream is quantified in this package: each enters the lender base case only with an identified contractual or statistical basis (Section 10).",
    { x: 0.55, y: 6.45, w: 12.2, h: 0.4, fontFace: F, fontSize: 10.5, italic: true, color: C.MUT, margin: 0 });

  // Capital structure + PPP
  s = pres.addSlide();
  header(s, "Section 9 · Investment model", "Capital structure logic and PPP model options", "proposed");
  s.addText("CAPITAL STACK (logic, no figures)", { x: 0.55, y: 1.7, w: 5.5, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.GOLD, charSpacing: 1.5, margin: 0 });
  const stack = [
    ["Senior debt", "Project finance sized on contracted revenue — BPMB precedent at PIP; AIIB–Malaysian bank platforms; ECA cover; sukuk-capable [R25, R80]", C.NAVY],
    ["Mezzanine", "Optional gap layer from strategic sponsors", C.STEEL],
    ["Sponsor equity", "Consortium equity, staged against milestones", "3A6EA5"],
    ["Govt support", "To be explored, never assumed: tenure, incentives (MIDA/zone), facilitation funding [G]", C.AMBER],
  ];
  stack.forEach((t, i) => {
    const y = 2.1 + i * 1.12;
    card(s, 0.55, y, 5.6, 0.98, { fill: t[2] });
    s.addText(t[0], { x: 0.75, y, w: 1.55, h: 0.98, fontFace: F, fontSize: 11, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
    s.addText(t[1], { x: 2.4, y: y + 0.06, w: 3.6, h: 0.88, fontFace: F, fontSize: 8.6, color: "FFFFFF", valign: "middle", margin: 0 });
  });
  s.addText("PPP MODEL OPTIONS (depends entirely on true land position)", { x: 6.6, y: 1.7, w: 6.2, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: C.GOLD, charSpacing: 1.5, margin: 0 });
  tbl(s, [
    ["Model", "When it fits"],
    ["Private land, build-own-operate", "Land privately held; licensed private facility"],
    ["State land lease + BOT/BOO", "State land; requires state agreement"],
    ["Concession incl. agency facilities", "Government wants integrated border facilities (WP11)"],
    ["Hybrid landlord model", "SPV as landlord; specialist operators as tenants — reduces operating risk"],
  ], { size: 9.5, hSize: 10, box: { x: 6.6, y: 2.1, w: 6.18, colW: [2.7, 3.48] } });
  s.addText("PIKAS 2030 preference: competitive RFP and user-pays projects — engagement route via UKAS if any government facility/concession element applies. [R61]",
    { x: 6.6, y: 5.55, w: 6.2, h: 0.9, fontFace: F, fontSize: 9.5, italic: true, color: C.MUT, margin: 0, valign: "top" });

  // Risk allocation, funding stages, exits
  s = pres.addSlide();
  header(s, "Section 9 · Investment model", "Risk allocation, funding stages and exit options", "proposed");
  tbl(s, [
    ["Risk", "Allocated to", "Instrument"],
    ["Construction", "EPC contractor", "Fixed-price date-certain wrap, LDs, performance security"],
    ["Cargo / market", "Shared", "Anchor pre-commitments + sponsor equity buffer"],
    ["Operating performance", "Operator", "KPI-linked O&M contract with step-in rights"],
    ["Border policy / customs", "Not transferable", "Government engagement; diversified revenue mix"],
    ["Land / approvals", "Development phase", "Precondition to financial close — never carried by lenders"],
  ], { size: 9.5, hSize: 10.5, box: { x: 0.55, y: 1.68, w: 7.4, colW: [1.9, 1.9, 3.6] } });
  flow(s, [
    { title: "1 · Development capital", sub: "sponsors, highest risk" },
    { title: "2 · Financial close", sub: "equity + debt committed" },
    { title: "3 · Construction", sub: "milestone drawdowns" },
    { title: "4 · Operations ramp", sub: "working capital" },
    { title: "5 · Expansion", sub: "retained cash / new partners" },
  ], { y: 5.15, h: 1.1, tSize: 9.5, sSize: 8 });
  card(s, 8.35, 1.68, 4.43, 3.1, { fill: C.LIGHT });
  s.addText("EXIT OPTIONS", { x: 8.6, y: 1.85, w: 4, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  bullets(s, [
    "Trade sale to strategic operator or logistics RE platform",
    "Infra fund sale once cash flows season",
    "REIT injection of stabilised warehouse assets",
    "IPO of the platform company at scale",
    "Refinancing for partial sponsor liquidity",
  ], { box: { x: 8.6, y: 2.2, w: 3.95, h: 2.5 }, gap: 7 });

  // ═══ SECTION 10 ═══
  divider(pres, "10", "Financial Model Framework", "Deliberately no invented numbers. The model structure and every assumption class that must be evidenced before a single figure is entered.",
    ["Modelling principles", "Revenue categories", "Cost categories & sensitivities", "Outputs per audience"]);

  // Principles + revenue categories
  s = pres.addSlide();
  header(s, "Section 10 · Financial framework", "Modelling principles and revenue categories (no figures)", "proposed");
  card(s, 0.55, 1.7, 12.23, 1.05, { fill: C.NAVY });
  s.addText("Every input traces to evidence · three cases minimum (base/downside/upside) · MYR model with THB/USD/CNY sensitivity · no revenue in the lender case without a contractual or statistical basis",
    { x: 0.8, y: 1.7, w: 11.7, h: 1.05, fontFace: F, fontSize: 11.5, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
  tbl(s, [
    ["Category", "Potential lines (to be quantified only after evidence)"],
    ["Terminal & rail", "Rail handling per TEU · storage & empty depot · reefer plugs · wagon/shunting services (KTMB commercial terms pending)"],
    ["Warehousing & property", "Ambient rents · bonded premiums · cold chamber/pallet/blast-freeze · built-to-suit returns · sub-lease income (tenure permitting)"],
    ["Border & vehicle services", "Marshalling slots · secure parking · weighbridge · driver amenities & concessions"],
    ["Operating income", "Handling labour, VAS · customs brokerage facilitation (licensing pending) · equipment rental"],
    ["Recurring income", "Multi-year leases & anchor tenancies · third-party O&M · utility resale margins (regulatory check required)"],
    ["Digital / PMO / AM / concession", "VBS & data subscriptions · portal fees · PMO & development fees · asset management fees · concession/availability income if structure eventuates (pending)"],
  ], { size: 9.3, hSize: 10.5, box: { x: 0.55, y: 3.0, w: 12.23, colW: [2.7, 9.53] } });

  // Costs + sensitivities + outputs
  s = pres.addSlide();
  header(s, "Section 10 · Financial framework", "Cost classes, sensitivities and outputs per audience", "proposed");
  s.addText("COST CLASSES (priced, not guessed)", { x: 0.55, y: 1.7, w: 6, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 1.5, margin: 0 });
  bullets(s, [
    "EPC capex per WP — from contractor pricing, not benchmarks alone",
    "Land cost/lease — from confirmed tenure terms (pending)",
    "Equipment capex and renewal cycles",
    "Energy (largest cold-chain driver), labour, maintenance, insurance",
    "Digital opex: licences, SOC, connectivity, refresh cycles",
    "Concession fees/royalties if applicable (pending)",
  ], { box: { x: 0.55, y: 2.08, w: 5.9, h: 2.7 }, gap: 6 });
  s.addText("KEY SENSITIVITIES", { x: 0.55, y: 4.95, w: 6, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 1.5, margin: 0 });
  bullets(s, [
    "Throughput growth vs verified baselines · ramp-up length · anchor pre-commitment share",
    "Cross-border rail interchange capture (KTMB–SRT service patterns) · energy tariffs · MYR/THB",
  ], { box: { x: 0.55, y: 5.3, w: 5.9, h: 1.3 }, gap: 6 });
  tbl(s, [
    ["Audience", "Model outputs required"],
    ["Banks", "DSCR profile, gearing, tenor/tail, security coverage"],
    ["Investors", "Equity IRR, payback, dividend profile, exit valuation logic"],
    ["Government", "Jobs, state revenue, trade-facilitation KPIs, fiscal cost of support"],
    ["Board", "Funding plan, milestone cash needs, downside survivability"],
  ], { size: 10, hSize: 10.5, box: { x: 6.85, y: 2.08, w: 5.93, colW: [1.7, 4.23] } });

  // ═══ SECTION 11 ═══
  divider(pres, "11", "Due Diligence Checklist", "Eleven workstreams. Every item answered with documents, not statements — the evidence set for investment committees and bank credit processes.",
    ["Corporate · Land · Project", "Government · Technical", "Financial · Legal · Commercial", "ESG · Operational · Digital"]);

  // DD 1
  s = pres.addSlide();
  header(s, "Section 11 · Due diligence", "Workstreams A–E: the existential checks", "reco");
  tbl(s, [
    ["Workstream", "Key items (abridged — full checklist in package document)"],
    ["A · Corporate", "SSM extracts, UBOs, board authorisations, audited accounts, charges & litigation searches, all existing MOUs/agreements with status"],
    ["B · Land", "Titles per parcel (owner, category, conditions) · state/reserve/Malay Reserve status · encumbrances & caveats · zoning · KTMB/Railway Assets Corporation land involvement · flood history"],
    ["C · Project", "Existing studies & master plans · what exists today vs aspiration · prior tenders/liabilities · utilities availability · interface with PIP and legacy terminal operators"],
    ["D · Government", "Written state support · federal engagement status (MOT, MITI, JKDM, UKAS) · NCIA status · KTMB engagement · issued gazettes/licences · Thai-side engagement"],
    ["E · Technical", "Geotech adequacy · rail connection feasibility (gradient, possessions) · road capacity · utility loads (cold-chain power) · flood modelling · EIA screening"],
  ], { size: 9.3, hSize: 10.5, box: { x: 0.55, y: 1.68, w: 12.23, colW: [2.0, 10.23] } });
  s.addText("Workstream B (Land) is the gating item: nothing proceeds without title verification.", { x: 0.55, y: 6.5, w: 12, h: 0.35, fontFace: F, fontSize: 11, bold: true, italic: true, color: C.AMBER, margin: 0 });

  // DD 2
  s = pres.addSlide();
  header(s, "Section 11 · Due diligence", "Workstreams F–K: bankability and operability", "reco");
  tbl(s, [
    ["Workstream", "Key items (abridged)"],
    ["F · Financial", "Owner funding capacity · existing financing/liens · tax structure & incentive eligibility · basis of any previously circulated figures (validate or discard)"],
    ["G · Legal", "Rights held vs rights claimed (evidence per item) · foreign investment limits · licensing map (bonded, forwarding, CIDB, CAAM) · sanctions screening of all counterparties"],
    ["H · Commercial", "Verified cargo baseline (KTMB/Customs data requests) · named anchor prospects & commitment status · competing facilities pipeline · tariff benchmarks · demand interviews"],
    ["I · Environmental & Social", "EIA determination · site occupants/displacement · heritage · IFC Performance Standards / Equator alignment · climate resilience"],
    ["J · Operational", "Operating model & candidate operators · labour availability in Perlis · border hours as throughput cap · bonded security requirements"],
    ["K · Digital", "Existing systems · fibre/carrier availability · JKDM interface constraints · PDPA & Cyber Security Act 2024 obligations · vendor landscape"],
  ], { size: 9.0, hSize: 10.5, box: { x: 0.55, y: 1.68, w: 12.23, colW: [2.3, 9.93] } });

  // ═══ SECTION 12 ═══
  divider(pres, "12", "Questions for the Project Owner", "Collaborative, professional questions that help the owner assemble what investors, Shandong, technology partners and banks will ask for anyway.",
    ["Foundation & land", "Government & commercial", "Structure & finances", "Timeline & process"]);

  s = pres.addSlide();
  header(s, "Section 12 · Owner questions", "Twenty-six questions in seven groups (selection)", "reco");
  const qs = [
    ["Foundation", "How did the project originate and what exists today? What does success look like in 5 and 15 years?"],
    ["Land & rights", "Which parcels, what tenure, any existing agreements? Does any element rely on railway reserve or KTMB land?"],
    ["Government", "Who has been engaged, and is there anything in writing? Any JKDM discussions on bonded/zone status? KTMB response on sidings?"],
    ["Commercial", "Which cargo flows anchor demand, and on what evidence? How is the platform positioned vs Perlis Inland Port — integration, complement, or competition?"],
    ["Structure", "What role does the owner wish to retain? What are expectations on ownership and control? Any commitments a consortium must respect?"],
    ["Finances", "What has been invested to date and by whom? Expected owner/partner/bank funding split? Any liabilities attached to land or project?"],
    ["Process", "What timeline and external deadlines apply? Openness to structured DD under NDA with a data room? Who is authorised to negotiate?"],
  ];
  qs.forEach((q, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.55 + col * 6.22, y = 1.7 + row * 1.28;
    card(s, x, y, 6.0, 1.12, {});
    s.addText(q[0].toUpperCase(), { x: x + 0.2, y: y + 0.1, w: 5.6, h: 0.26, fontFace: F, fontSize: 9, bold: true, color: C.GOLD, charSpacing: 1.5, margin: 0 });
    s.addText(q[1], { x: x + 0.2, y: y + 0.36, w: 5.6, h: 0.72, fontFace: F, fontSize: 9.3, color: C.TEXT, margin: 0, valign: "top" });
  });
  s.addText("Tone: these questions accelerate the owner's own fundraising — they are the same list any serious counterpart will bring.",
    { x: 0.55, y: 6.55, w: 12.2, h: 0.35, fontFace: F, fontSize: 10.5, italic: true, color: C.MUT, margin: 0 });

  // ═══ SECTION 13 ═══
  divider(pres, "13", "Consortium Structure", "A single-purpose Malaysian SPV with clean contracts around it — designed to satisfy the ≥51% Malaysian ownership floor and lender governance standards.",
    ["SPV structure", "Roles & candidates", "Agreements map", "Governance principles"]);

  // Structure diagram
  s = pres.addSlide();
  header(s, "Section 13 · Consortium", "Proposed SPV structure (percentages deliberately unstated)", "proposed");
  // Government top
  card(s, 4.4, 1.6, 4.5, 0.85, { fill: C.AMBER });
  s.addText([
    { text: "GOVERNMENT (State / Federal)", options: { bold: true, fontSize: 11, color: "FFFFFF", breakLine: true } },
    { text: "tenure · approvals · incentives · possible state equity", options: { fontSize: 8.5, color: "FFFFFF" } },
  ], { x: 4.45, y: 1.6, w: 4.4, h: 0.85, fontFace: F, align: "center", valign: "middle", margin: 0 });
  // SPV centre
  card(s, 4.4, 3.0, 4.5, 1.15, { fill: C.NAVY });
  s.addText([
    { text: "PROJECT SPV (Malaysia)", options: { bold: true, fontSize: 13, color: "FFFFFF", breakLine: true } },
    { text: "single-purpose company · owns & finances the platform · ≥51% Malaysian [R62]", options: { fontSize: 8.5, color: C.ICE } },
  ], { x: 4.45, y: 3.0, w: 4.4, h: 1.15, fontFace: F, align: "center", valign: "middle", margin: 0 });
  s.addShape("line", { x: 6.65, y: 2.45, w: 0, h: 0.55, line: { color: C.MUT, width: 1.5 } });
  // Sponsors left
  card(s, 0.55, 2.85, 3.3, 1.45, { fill: C.LIGHT });
  s.addText([
    { text: "SPONSOR EQUITY", options: { bold: true, fontSize: 10, color: C.GOLD, breakLine: true } },
    { text: "Prospek Cerah · Shandong Hi-Speed (optional) · local partner(s) · project owner (land) · financial investors", options: { fontSize: 9, color: C.TEXT } },
  ], { x: 0.75, y: 2.95, w: 2.95, h: 1.3, fontFace: F, valign: "top", margin: 0 });
  s.addShape("line", { x: 3.85, y: 3.55, w: 0.55, h: 0, line: { color: C.MUT, width: 1.5 } });
  // Lenders right
  card(s, 9.45, 2.85, 3.3, 1.45, { fill: C.LIGHT });
  s.addText([
    { text: "LENDERS", options: { bold: true, fontSize: 10, color: C.GOLD, breakLine: true } },
    { text: "Malaysian/regional banks · BPMB · ECAs · DFIs (IFC/AIIB precedent at Thanaleng) — security over SPV", options: { fontSize: 9, color: C.TEXT } },
  ], { x: 9.65, y: 2.95, w: 2.95, h: 1.3, fontFace: F, valign: "top", margin: 0 });
  s.addShape("line", { x: 8.9, y: 3.55, w: 0.55, h: 0, line: { color: C.MUT, width: 1.5 } });
  // Contract row
  const contracts = [
    ["EPC Contract", "SDHS-led + mandatory local participation"],
    ["Technology", "Prospek-integrated vendor consortium"],
    ["Operator(s)", "Terminal & warehouse O&M, KPI-linked"],
    ["PMO / Dev Mgmt", "Prospek, with lender's engineer oversight"],
  ];
  contracts.forEach((cn, i) => {
    const x = 0.55 + i * 3.12;
    card(s, x, 5.0, 2.95, 1.1, {});
    s.addText([
      { text: cn[0], options: { bold: true, fontSize: 10.5, color: C.NAVY, breakLine: true } },
      { text: cn[1], options: { fontSize: 8.5, color: C.MUT } },
    ], { x: x + 0.12, y: 5.0, w: 2.7, h: 1.1, fontFace: F, align: "center", valign: "middle", margin: 0 });
    s.addShape("line", { x: x + 1.47, y: 4.15, w: 0, h: 0.85, line: { color: C.MUT, width: 1, dashType: "dash" } });
  });
  s.addText("The SPV contracts everything outward; related-party contracts (Prospek services, SDHS EPC) disclosed, benchmarked and approved by non-conflicted directors.",
    { x: 0.55, y: 6.35, w: 12.2, h: 0.4, fontFace: F, fontSize: 10, italic: true, color: C.MUT, margin: 0 });

  // Agreements + governance
  s = pres.addSlide();
  header(s, "Section 13 · Consortium", "Nine key agreements and four governance principles", "proposed");
  tbl(s, [
    ["#", "Agreement"],
    ["1", "Shareholders' Agreement — governance, reserved matters, transfers, deadlock"],
    ["2", "Land lease / SPA / land-for-equity — form follows verified tenure"],
    ["3", "Concession / development agreement with state (if applicable)"],
    ["4", "EPC Contract (FIDIC Silver/Yellow basis for lender-financed EPC)"],
    ["5", "O&M / Terminal Operating Agreement(s)"],
    ["6", "Technology supply, integration and SLA agreements"],
    ["7", "Development Management / PMO Agreement"],
    ["8", "Financing documents — facility, security, lender direct agreements"],
    ["9", "Anchor customer / tenancy pre-commitments"],
  ], { size: 9.3, hSize: 10, box: { x: 0.55, y: 1.68, w: 6.6, colW: [0.5, 6.1] } });
  card(s, 7.5, 1.68, 5.28, 4.7, { fill: C.LIGHT });
  s.addText("GOVERNANCE PRINCIPLES", { x: 7.75, y: 1.88, w: 4.8, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  bullets(s, [
    { text: "Board proportional to equity, with protective minority rights" },
    { text: "Related-party contracts disclosed, market-benchmarked, approved by non-conflicted directors — essential for lenders and co-investors" },
    { text: "Independent lender's engineer and model auditor at financial close" },
    { text: "ESG and compliance committee from day one — a border/customs environment demands clean governance (the PKFZ lesson) [R79]" },
  ], { box: { x: 7.75, y: 2.3, w: 4.8, h: 3.9 }, gap: 12 });

  // ═══ SECTION 14 ═══
  divider(pres, "14", "Risk Register", "Twenty-five risks across ten categories, qualitatively scored pre-feasibility. Five are gating: they must be addressed before money moves.",
    ["Gating risks", "Full register by category", "Mitigation ownership"]);

  // Gating risks
  s = pres.addSlide();
  header(s, "Section 14 · Risk register", "Five gating risks — address before money", "reco");
  const gr = [
    ["R01 · Land & rights", "Position weaker than represented; project premise fails", "Land DD as Phase 1 gate; zero capital before title verification"],
    ["R02 · Government support", "Not secured, or shifts with political cycles", "Written instruments early; multi-party alignment (state + NCIA + federal)"],
    ["R06 · Demand evidence", "Cargo volumes below case; slow ramp", "Anchor pre-commitments before financial close; conservative lender case"],
    ["R09 · Financeability", "Greenfield border asset fails to raise acceptable debt", "ECA/DFI tracks in parallel; staged capex; strong sponsor equity signal"],
    ["R15 · Rail connection", "KTMB siding approval/possession delays", "Early technical agreement; design to operate road-only in interim"],
  ];
  gr.forEach((g, i) => {
    const y = 1.7 + i * 1.0;
    card(s, 0.55, y, 12.23, 0.88, { fill: i % 2 ? C.LIGHT : "EDF1F4" });
    s.addText(g[0], { x: 0.75, y, w: 2.6, h: 0.88, fontFace: F, fontSize: 10.5, bold: true, color: C.RED, valign: "middle", margin: 0 });
    s.addText(g[1], { x: 3.45, y: y + 0.06, w: 4.3, h: 0.78, fontFace: F, fontSize: 9.5, color: C.TEXT, valign: "middle", margin: 0 });
    s.addText(g[2], { x: 7.95, y: y + 0.06, w: 4.6, h: 0.78, fontFace: F, fontSize: 9.5, color: C.NAVY, valign: "middle", margin: 0 });
  });
  s.addText("Column 3 = mitigation. Ratings are qualitative team judgments at pre-feasibility stage — to be re-scored quantitatively in due diligence.",
    { x: 0.55, y: 6.75, w: 12.2, h: 0.3, fontFace: F, fontSize: 9.5, italic: true, color: C.MUT, margin: 0 });

  // Register summary
  s = pres.addSlide();
  header(s, "Section 14 · Risk register", "Register overview: 25 risks across ten categories", "reco");
  tbl(s, [
    ["Category", "Representative risks (L/I at pre-feasibility)", "Core mitigations"],
    ["Government & border", "Licences delayed (M/H) · border policy shifts (M/H) · Thai-side lag (M/M)", "Early JKDM engagement; design to operate without zone status initially; bilateral corridor dialogues"],
    ["Commercial", "Competition from PIP/BKH/Thai facilities (M/M) · anchor concentration (M/M) · KTMB haulage economics (M/M)", "Complement/integrate positioning; tenant diversification; early KTMB commercial MOU"],
    ["Financial", "FX (M/M) · energy escalation vs cold chain (M/M)", "Natural hedging; tariff pass-through; solar PV"],
    ["Construction & technical", "Ground/flood conditions (M/M) · EPC overrun (M/H) · interfaces (M/M) · utility capacity (M/M)", "Full GI before pricing; fixed-price wrap; single-wrap preference; early TNB application"],
    ["Technology & operations", "Integration failure (M/M) · cyber breach (M/H) · operator underperformance (L/M) · labour gap (M/M)", "Open standards + escrow; IEC 62443/ISO 27001 + SOC; KPI O&M with step-in; NCIA training programmes"],
    ["Political & ESG", "Geopolitics (L/M) · sanctions exposure (L/H) · EIA conditions (M/M) · DFI ESG bar (L/H)", "Balanced consortium; DD screening + substitution rights; IFC PS-aligned ESMS from Phase 1"],
  ], { size: 8.8, hSize: 10, box: { x: 0.55, y: 1.65, w: 12.23, colW: [2.0, 5.1, 5.13] } });

  // ═══ SECTION 15 ═══
  divider(pres, "15", "Roadmap", "Seven phases, five governance gates. Indicative durations only — the critical path runs through land verification and government process.",
    ["Phase plan", "Governance gates", "First 90 days"]);

  // Phases
  s = pres.addSlide();
  header(s, "Section 15 · Roadmap", "Seven phases from due diligence to operations", "proposed");
  flow(s, [
    { title: "1 · Due Diligence", sub: "3–6 mo · land & rights gate, red-flag report" },
    { title: "2 · Consortium", sub: "3–6 mo · heads of terms, feasibility, partners" },
    { title: "3 · Investment", sub: "6–12 mo · SPV, land agreements, financial close" },
    { title: "4 · Engineering", sub: "9–12 mo · EIA, FEED in BIM, EPC tender" },
  ], { y: 1.9, h: 1.5, tSize: 10.5, sSize: 8.5 });
  flow(s, [
    { title: "5 · Construction", sub: "24–36 mo · phased, early-revenue sequencing" },
    { title: "6 · Digitalisation", sub: "runs phases 4–7 · ICC live at opening day" },
    { title: "7 · Operations & growth", sub: "ramp-up, ISO 55000 regime, refinancing, Phase 2 triggers" },
  ], { y: 3.85, h: 1.5, tSize: 10.5, sSize: 8.5 });
  card(s, 0.55, 5.75, 12.23, 1.0, { fill: C.LIGHT });
  s.addText("Phases 1–2 overlap deliberately: consortium conversations begin during due diligence, but no party commits capital until Gate G1 clears.",
    { x: 0.8, y: 5.75, w: 11.7, h: 1.0, fontFace: F, fontSize: 11.5, italic: true, color: C.NAVY, valign: "middle", margin: 0 });

  // Gates + 90 days
  s = pres.addSlide();
  header(s, "Section 15 · Roadmap", "Five governance gates — and the first 90 days", "reco");
  tbl(s, [
    ["Gate", "Decision", "Evidence required"],
    ["G1", "Proceed past DD", "Clean land/rights, government support signals, demand baseline"],
    ["G2", "Sign consortium", "Positive feasibility, aligned partners, heads of terms with owner"],
    ["G3", "Financial close", "Bankable package: contracts, approvals, committed funding"],
    ["G4", "Notice to proceed", "EPC signed, land access, insurance, CPs met"],
    ["G5", "Open for operations", "Commissioning complete, licences in force, operator ready"],
  ], { size: 9.5, hSize: 10.5, box: { x: 0.55, y: 1.68, w: 7.2, colW: [0.75, 2.2, 4.25] } });
  card(s, 8.15, 1.68, 4.63, 4.9, { fill: C.NAVY });
  s.addText("FIRST 90 DAYS", { x: 8.4, y: 1.88, w: 4.1, h: 0.3, fontFace: F, fontSize: 10.5, bold: true, color: C.GOLD, charSpacing: 2, margin: 0 });
  bullets(s, [
    { text: "Execute NDA + information request (Section 11 list) with project owner", color: "FFFFFF" },
    { text: "Land title searches and encumbrance checks", color: "FFFFFF" },
    { text: "Owner workshop on the 26 questions (Section 12)", color: "FFFFFF" },
    { text: "Soundings: state government, NCIA, KTMB, JKDM", color: "FFFFFF" },
    { text: "Brief Shandong Hi-Speed on posture options (Section 8)", color: "FFFFFF" },
    { text: "Commission cargo demand scan and PIP positioning study", color: "FFFFFF" },
    { text: "Output: Red Flag Report → G1 go/no-go", color: C.GOLD, bold: true },
  ], { box: { x: 8.4, y: 2.3, w: 4.15, h: 4.2 }, gap: 8 });

  // ═══ APPENDIX ═══
  divider(pres, "A", "Appendix", "Visual asset recommendations · assumptions register · consolidated references.",
    ["Photo & map plan", "Assumptions A01–A24", "References R1–R82"]);

  // Visual assets
  s = pres.addSlide();
  header(s, "Appendix", "Visual asset plan: photos, maps and icons for the final deck", "reco");
  tbl(s, [
    ["Asset", "Recommendation", "Source / rights note"],
    ["Hero photo", "Padang Besar station rail yard with freight wagons at dawn; alternative: ASEAN Express launch imagery", "Commission photographer on site visit; Bernama/KTMB imagery requires licence"],
    ["Border imagery", "ICQS complex approach, truck queue (illustrates the marshalling case)", "Site visit photography; avoid security-sensitive angles — clear with ICQS authorities"],
    ["PIP context", "Perlis Inland Port gate/yard (establishes the incumbent honestly)", "Mutiara Perlis/NCIA press assets with permission"],
    ["Corridor map", "Peninsular map: Padang Besar–Penang–Klang rail spine + Hat Yai–Bangkok–Laos–China; inset: border-town detail", "Redraw from OpenStreetMap (ODbL attribution) — do not screenshot Google Maps"],
    ["Site plan", "Only after owner confirms parcels — placeholder schematic until then", "Owner survey data; licensed surveyor output"],
    ["Icons", "Single-line style (rail, truck, warehouse, snowflake, shield, satellite) — one family throughout", "Licensed icon set (e.g., Streamline/Noun Project licence)"],
    ["Drone footage", "Construction-phase progress films for investor updates (Phase 5)", "CAAM permit required near border zone — check restricted airspace"],
  ], { size: 8.8, hSize: 10, box: { x: 0.55, y: 1.65, w: 12.23, colW: [1.7, 6.0, 4.53] } });

  // Assumptions 1
  s = pres.addSlide();
  header(s, "Appendix", "Assumptions register (1 of 2): A01–A12", "pending");
  tbl(s, [
    ["#", "Assumption", "Class"],
    ["A01", "A defined project exists with an owner able to grant land/rights", "Owner"],
    ["A02", "Sufficient land near border/rail can be secured on lender-acceptable tenure", "Owner"],
    ["A03", "Project can position as complement/integrator to Perlis Inland Port", "Owner/Market"],
    ["A04", "KTMB will agree to siding connection and commercial services", "Government"],
    ["A05", "Customs/bonded/FCZ licensing obtainable for the site", "Government"],
    ["A06", "Border cargo demand keeps growing in line with verified trends", "Market"],
    ["A07", "Cold-chain white space exists at the border", "Judgment/Market"],
    ["A08", "Truck marshalling services are monetisable against border hours", "Judgment/Market"],
    ["A09", "Shandong Hi-Speed would consider EPC and/or equity roles", "Owner"],
    ["A10", "Prospek Cerah can evidence capability for its eight roles", "Owner"],
    ["A11", "Consortium can satisfy 51% Malaysian floor + Bumiputera conditions", "Government"],
    ["A12", "Project financing achievable given BPMB/IFC/AIIB precedents", "Market"],
  ], { size: 8.6, hSize: 9.5, box: { x: 0.55, y: 1.62, w: 12.23, colW: [0.7, 9.2, 2.33] } });

  // Assumptions 2
  s = pres.addSlide();
  header(s, "Appendix", "Assumptions register (2 of 2): A13–A24", "pending");
  tbl(s, [
    ["#", "Assumption", "Class"],
    ["A13", "The 20-WP breakdown matches final master plan scope", "Judgment"],
    ["A14", "Digital systems can interface with JKDM systems at reasonable cost", "Government"],
    ["A15", "Indicative phase durations achievable if gating items clear", "Judgment"],
    ["A16", "State support for additional logistics investment is obtainable", "Government"],
    ["A17", "Border Economic Zone will produce usable incentives", "Government"],
    ["A18", "SRT Hat Yai–Padang Besar double-tracking proceeds on reported timeline", "Government/Market"],
    ["A19", "Qualitative risk ratings reflect the true pre-feasibility profile", "Judgment"],
    ["A20", "No adverse existing agreements encumber the project or site", "Owner"],
    ["A21", "Thai counterparts cooperate on corridor improvements", "Government"],
    ["A22", "Published PIP figures are broadly accurate despite source conflicts", "Judgment"],
    ["A23", "Financial model structure covers all material categories", "Judgment"],
    ["A24", "Consortium roles map is negotiable to signature without structural change", "Judgment"],
  ], { size: 8.6, hSize: 9.5, box: { x: 0.55, y: 1.62, w: 12.23, colW: [0.7, 9.2, 2.33] } });

  // References 1
  s = pres.addSlide();
  header(s, "Appendix", "References (1 of 2): border, rail, PIP, trade", "verified");
  bullets(s, [
    "R1–R5 Border town, station, juxtaposed controls, operating hours — Wikivoyage; Border Crossing Hub; Wikipedia (Padang Besar railway station); FMT (2017); Mekong Region guide",
    "R6–R8 Roads — Wikipedia FT7/FT79; paultan.org (BKH–Sadao road, 10 Jul 2026)",
    "R9–R13 Rail & services — China Daily (gauge); KTMB Kargo; The Star (block train 2022; ASEAN Express 2024); railmarket.com (STC, Dec 2025)",
    "R14–R28 Perlis Inland Port — The Edge; The Star (25 Mar 2025); Railway Gazette (13 Apr 2025); Bernama (30 May 2026); BPMB; NCER; MIDA; FMT (14 Jul 2026); Harakah Daily; RMCD; WCO News; CAREC; Citaglobal reports",
    "R29–R41 Rail policy & PIP ecosystem — KTMB ETS; Nation Thailand (Thanaleng gauge, SRT double-tracking); FMT; SCMP; Malay Mail (13MP rail); ANN; NST (Kalmar); The Edge (GDC, Maritime Corridor); MIDA (MOU/MOC); Business Today (Berjaya)",
    "R42–R51 Border & trade — Thai PRD; Malaysiakini; Singapore Customs (ASW); ACTS portal; MITI (JTC US$30bn); Nation Thailand (trade 2024/2025, checkpoint values); Thairath; KLSE Screener; The Star (Penang 70%)",
  ], { box: { x: 0.55, y: 1.7, w: 12.2, h: 4.9 }, gap: 10 });
  s.addText("Full citation list with URLs: docs/17_references.md in the package repository.", { x: 0.55, y: 6.6, w: 12, h: 0.3, fontFace: F, fontSize: 9.5, italic: true, color: C.MUT, margin: 0 });

  // References 2
  s = pres.addSlide();
  header(s, "Appendix", "References (2 of 2): policy, Perlis, Shandong, benchmarks", "verified");
  bullets(s, [
    "R52–R55 ASEAN & corridors — ASEAN Connectivity Strategic Plan 2026–2035; ADB (IMT-GT); Wikipedia (Kunming–Singapore); Bangkok Post (Land Bridge)",
    "R56–R63 Federal & rules — NCER/NCIA; MIDA (CVIA); PMO (NTP 2019–2030); MOT (LTFM); Malay Mail (Border Economic Zone; 51% ports rule); UKAS/The Star (PIKAS 2030); MITI (equity conditions)",
    "R64–R65 Perlis state — Malay Mail (2026 budget); Perlis state portal (growth areas)",
    "R66–R74 Shandong Hi-Speed — Wikipedia; Baidu Baike (flagged company-published); Devex; Xinhua Silk Road (Qilu); Alpha Spread (000498.SZ); CSI/CTOS record; The Star & The Edge (PTT Synergy, Sep 2025); Moody's (2018 A3)",
    "R75–R82 Benchmarks & financing — IFC & AIIB (Thanaleng); UNESCAP (Lat Krabang, Malaysian dry ports); ResearchGate; The Edge (PKFZ); AIIB (US$6bn Malaysian bank partnership); Sime Darby Property/Mingtiandi (LOGOS fund)",
  ], { box: { x: 0.55, y: 1.7, w: 12.2, h: 4.4 }, gap: 12 });
  card(s, 0.55, 6.05, 12.23, 0.85, { fill: C.LIGHT });
  s.addText("Citation-quality note: aggregator and trade-press items are flagged in text and must be replaced with primary documents (Bursa filings, gazettes, audited statements) during due diligence.",
    { x: 0.8, y: 6.05, w: 11.7, h: 0.85, fontFace: F, fontSize: 10, italic: true, color: C.NAVY, valign: "middle", margin: 0 });

  // Closing
  s = pres.addSlide();
  chrome(s, { dark: true });
  s.addText("NEXT STEP", { x: 0.9, y: 1.5, w: 10, h: 0.4, fontFace: F, fontSize: 13, bold: true, color: C.GOLD, charSpacing: 3, margin: 0 });
  s.addText("One meeting with the project owner\nunlocks everything else.", { x: 0.9, y: 2.0, w: 11.5, h: 1.7, fontFace: FD, fontSize: 36, bold: true, color: "FFFFFF", margin: 0 });
  bullets(s, [
    { text: "The corridor thesis is verified; the project's rights are not — Phase 1 due diligence resolves that in 3–6 months at development-capital cost only", color: C.ICE },
    { text: "The 26 owner questions and 11 due-diligence workstreams in this package are the agenda for that meeting", color: C.ICE },
    { text: "No capital, no commitments and no representations until Gate G1 clears", color: C.ICE },
  ], { box: { x: 0.9, y: 4.0, w: 11.0, h: 1.9 }, gap: 12 });
  s.addText("This document contains no representation of ownership, concession, operating rights or licences. All items not publicly verified are pending confirmation from the project owner.",
    { x: 0.9, y: 6.3, w: 11.5, h: 0.6, fontFace: F, fontSize: 10, italic: true, color: "7D8EA0", margin: 0 });
};
