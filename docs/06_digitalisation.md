# Section 6 — Digital Transformation Strategy

> **Status:** Proposed strategy. Vendor selection, budget and scope are subject to feasibility study and project-owner confirmation. No digital system described here currently exists at the site unless separately verified in Section 2.

## 6.1 Vision

Position the platform as **the most digitally advanced land border logistics facility in ASEAN**: a "smart border port" where every container, truck, wagon and pallet is visible in real time, border dwell time is measured and actively managed, and the facility's data itself becomes a revenue-generating asset.

## 6.2 Architecture — five layers

| Layer | Components |
|-------|-----------|
| L5 — Insight & Revenue | Integrated dashboard, digital twin analytics, data products for shippers/agencies, ESG reporting |
| L4 — Applications | TOS, WMS, Truck Management (TMS/VBS), asset management (EAM), billing, customer portal, PMO tools |
| L3 — Platform | Digital twin core (GIS+BIM), IoT platform, video analytics platform, data lake, integration bus (API/EDI) |
| L2 — Network | Fibre backbone, private 4G/5G, LoRaWAN for sensors, redundant WAN links, edge compute |
| L1 — Field | AI CCTV, ANPR cameras, IoT sensors, drones, weighbridges, RFID/OCR gates, smart meters, access control |

## 6.3 Capability modules

1. **Digital Twin** — A live 3D model of the platform fusing GIS (site, corridors, catchment), BIM (as-built assets) and real-time IoT/operations data. Used for design coordination during EPC, then operations simulation (yard capacity, border queue scenarios), then asset lifecycle management.
2. **GIS** — Geospatial base for land parcels, utilities, flood modelling, corridor planning and expansion phasing; integrates state land data where made available.
3. **BIM** — Mandated BIM Level 2+ across all design packages (aligned with Malaysian CIDB BIM guidance); common data environment (CDE) from day one; BIM-to-FM handover so the asset register is born digital.
4. **Drone Operations** — Construction progress capture (photogrammetry into the twin), volumetric earthworks measurement, post-construction: perimeter security patrol, stack audits, solar/roof inspection. Subject to CAAM (Civil Aviation Authority of Malaysia) permits.
5. **IoT** — Reefer telemetry, cold-room monitoring, energy submetering, pavement/structure sensors, environmental (air, noise, flood) sensors, equipment telematics.
6. **AI CCTV** — Video analytics for safety (PPE, intrusion, near-miss), security (loitering, perimeter), and operations (dock occupancy, queue length estimation).
7. **ANPR** — Automatic number plate recognition (Malaysian + Thai plates) at all gates; links truck identity to bookings, customs status and yard position; feeds border queue analytics.
8. **Integrated Command Centre (ICC)** — Single control room combining CCTV walls, TOS/WMS status, gate flows, border queue dashboard, incident management, and emergency response coordination; designed to host agency liaison desks.
9. **Predictive Maintenance** — Equipment telematics + EAM (enterprise asset management) with condition-based maintenance for handling equipment, refrigeration plant, substations; extends asset life and supports concession handback obligations.
10. **Warehouse Automation** — Phased: start with WMS-directed operations, barcode/RFID; provision for conveyor/sortation and AMR (autonomous mobile robots) in e-commerce/VAS zones in later phases.
11. **Truck Management System (TMS) / Vehicle Booking System (VBS)** — Slot booking for gate arrival, driver app (Bahasa Melayu/Thai/English/Chinese), e-call-up from marshalling yard, integration with customs clearance status to release trucks only when documents are ready.
12. **Smart Parking** — Sensor/camera-based occupancy for the truck marshalling yard and staff/visitor parking; dynamic signage; paid overnight truck parking as a revenue line.
13. **Traffic Analytics** — Cross-site and border-approach analytics (queue length, dwell time, throughput per lane); data shareable with police/JKR/customs to manage congestion; historical analytics for capacity planning.
14. **Asset Management Platform (EAM)** — ISO 55000-aligned asset register, lifecycle costing, maintenance planning; the same platform underpins Prospek's proposed long-term asset management services role.
15. **Integrated Dashboard** — Board/agency-level KPI layer: throughput (TEU, tonnes, trucks, wagons), dwell times, revenue, energy, safety, ESG; investor-grade reporting.
16. **Cybersecurity** — IEC 62443 for OT, ISO 27001 for IT, segmentation of customs-facing systems, SOC monitoring (in-house or MSSP), compliance with Malaysia's Cyber Security Act 2024 obligations where the facility is designated critical infrastructure; data residency and PDPA compliance.

## 6.4 Phasing

- **Phase A (with EPC):** CDE/BIM, GIS, drone progress capture, fibre backbone, construction CCTV.
- **Phase B (pre-operations):** TOS, WMS, gates/ANPR, TMS/VBS, ICC, cybersecurity baseline.
- **Phase C (operations maturity):** predictive maintenance, AI analytics at scale, digital twin operations simulation, data products.
- **Phase D (expansion):** warehouse automation, cross-border data corridors (subject to JKDM/Thai Customs cooperation — pending confirmation).

## 6.5 Digital revenue logic (assumptions only — see Section 10)

Digital systems are not only cost: VBS fees, data subscriptions, per-transaction portal fees, reefer-monitoring-as-a-service and ICC services to third parties are recurring income candidates. All figures pending feasibility study.
