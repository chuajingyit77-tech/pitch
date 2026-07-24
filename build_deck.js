const pptxgen = require('pptxgenjs');
const p = new pptxgen();
p.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
p.layout = 'W';
p.author = 'Prospek Cerah Inovasi IT Sdn. Bhd.';
p.title = 'AFFIN Bank — Cost Reduction & Credit Loss Prevention Programme';

// ---- palette (Ledger & Site) ----
const INK='0A0F1A', SLATE='131E30', PANEL='16233A', LINE='2A3B54';
const PAPER='F4F5F2', CARD='FFFFFF', CARDLINE='DDE1DA';
const TX='EAF0F7', TXD='9DAABC';
const INKT='16202E', BODY='45525F', MUTE='7C8794';
const TEAL='159AA8', TEALB='2FC0CE', BRASS='B98A38', BRASSB='D9AE5C';
const OK='3FA06B', WARN='D98A20', RISK='D9503C';
const HEAD='Cambria', SANS='Calibri', MONO='Consolas';
const IMG_HERO='assets/img/hero_b1.jpg', IMG_TWIN='assets/img/digital_twin.jpg';

const M=0.7, W=13.333, H=7.5, CW=W-2*M;

function eyebrow(s,txt,x,y,color){ s.addText(txt,{x,y,w:6,h:0.3,fontFace:MONO,fontSize:11,color:color||TEAL,charSpacing:3,bold:true}); }
function pageno(s,n){ s.addText(String(n).padStart(2,'0'),{x:W-1.0,y:H-0.5,w:0.6,h:0.3,fontFace:MONO,fontSize:10,color:MUTE,align:'right'});
  s.addText('Prospek Cerah Inovasi IT',{x:M,y:H-0.5,w:5,h:0.3,fontFace:MONO,fontSize:9,color:MUTE}); }
function card(s,x,y,w,h,fill){ s.addShape(p.ShapeType.roundRect,{x,y,w,h,rectRadius:0.09,fill:{color:fill||CARD},line:{color:CARDLINE,width:1},shadow:{type:'outer',blur:9,offset:3,angle:90,color:'B9BFB4',opacity:0.5}}); }
function tag(s,txt,x,y,w,col){ s.addShape(p.ShapeType.roundRect,{x,y,w,h:0.34,rectRadius:0.06,fill:{color:col,transparency:84},line:{type:'none'}});
  s.addText(txt.toUpperCase(),{x,y,w,h:0.34,align:'center',fontFace:MONO,fontSize:10,bold:true,color:col,charSpacing:1}); }

/* ============ 1 · TITLE ============ */
let s=p.addSlide(); s.background={color:INK};
s.addImage({path:IMG_HERO,x:0,y:0,w:W,h:H,sizing:{type:'cover',w:W,h:H}});
s.addShape(p.ShapeType.rect,{x:0,y:0,w:W,h:H,fill:{color:INK,transparency:34}});
s.addShape(p.ShapeType.rect,{x:0,y:H*0.42,w:W,h:H*0.58,fill:{color:INK,transparency:8}});
eyebrow(s,'CONFIDENTIAL PROGRAMME PROPOSAL  ·  JULY 2026',M,0.85,TEALB);
s.addText('A programme that removes cost —\nnot one that adds a system.',{x:M,y:2.7,w:11.4,h:2.1,fontFace:HEAD,fontSize:46,bold:true,color:'FFFFFF',lineSpacing:48});
s.addText('A cost-reduction and credit-loss-prevention programme for AFFIN Bank, sized entirely against AFFIN’s own baseline data.',
  {x:M,y:4.95,w:9.6,h:0.8,fontFace:SANS,fontSize:16,color:'DCE4EE'});
// equation strip
const eq=['Existing cost removed','+','Avoidable credit loss','−','Total implementation cost','=','Net benefit'];
let ex=M; const ehy=6.1;
eq.forEach((t)=>{ const op=['+','−','='].includes(t);
  const w=op?0.35:(t==='Net benefit'?1.9:2.35);
  if(op){ s.addText(t,{x:ex,y:ehy,w,h:0.5,align:'center',fontFace:HEAD,fontSize:18,color:t==='='?TEALB:'AEBACb'}); }
  else{ const isRes=t==='Net benefit'; s.addShape(p.ShapeType.roundRect,{x:ex,y:ehy,w,h:0.5,rectRadius:0.06,fill:{color:isRes?BRASS:PANEL,transparency:isRes?70:18},line:{color:isRes?BRASSB:LINE,width:1}});
    s.addText(t,{x:ex,y:ehy,w,h:0.5,align:'center',fontFace:MONO,fontSize:10.5,bold:isRes,color:isRes?BRASSB:'CBD5E1'}); }
  ex+=w+0.12; });
s.addText([{text:'Prepared for  ',options:{color:MUTE,fontFace:MONO,fontSize:10}},{text:'AFFIN Bank Berhad',options:{color:'FFFFFF',fontFace:SANS,fontSize:12}},
  {text:'      Prepared by  ',options:{color:MUTE,fontFace:MONO,fontSize:10}},{text:'Prospek Cerah Inovasi IT Sdn. Bhd.',options:{color:'FFFFFF',fontFace:SANS,fontSize:12}}],
  {x:M,y:6.95,w:12,h:0.35});

/* ============ 2 · EXECUTIVE MESSAGE ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'01 · THE EXECUTIVE MESSAGE',M,0.55);
s.addText('We start from your bills — not from our technology.',{x:M,y:0.95,w:CW,h:0.8,fontFace:HEAD,fontSize:32,bold:true,color:INKT});
// quote card
card(s,M,2.05,6.4,4.6);
s.addShape(p.ShapeType.rect,{x:M+0.35,y:2.5,w:0.06,h:3.7,fill:{color:BRASS}});
s.addText('“If the bank keeps every existing task and simply adds our platform on top, of course it becomes a new cost. So we have changed the proposal completely. This version does not start from technology — it starts from AFFIN’s current bills and workflows.”',
  {x:M+0.6,y:2.5,w:5.5,h:3.7,fontFace:HEAD,italic:true,fontSize:19,color:INKT,lineSpacing:28,valign:'top'});
// three principles
const pr=[['Remove, don’t add.','Convert full manual checking into exception-driven checking.',TEAL],
  ['Prove before scale.','A financial Go/No-Go gate sits before any wide deployment.',BRASS],
  ['Bank owns the maths.','Baselines and thresholds are AFFIN’s; we supply the instrument.',OK]];
let py=2.05; const px=7.35, pw=CW-6.65;
pr.forEach(([h,b,c])=>{ card(s,px,py,pw,1.4);
  s.addShape(p.ShapeType.ellipse,{x:px+0.35,y:py+0.42,w:0.55,h:0.55,fill:{color:c,transparency:82},line:{color:c,width:1.5}});
  s.addShape(p.ShapeType.rect,{x:px+0.575,y:py+0.55,w:0.1,h:0.3,fill:{color:c}});
  s.addText(h,{x:px+1.15,y:py+0.24,w:pw-1.4,h:0.4,fontFace:SANS,fontSize:17,bold:true,color:INKT});
  s.addText(b,{x:px+1.15,y:py+0.68,w:pw-1.4,h:0.6,fontFace:SANS,fontSize:13,color:BODY});
  py+=1.6; });
pageno(s,2);

/* ============ 3 · WHERE MONEY LEAKS ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'02 · WHERE THE MONEY ACTUALLY LEAKS',M,0.55);
s.addText('Two independent pathways — proven separately',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:32,bold:true,color:INKT});
const cols=[['Track A · Operating cost','Hard savings you can bank',BRASS,
  ['Emergency repairs that should have been planned maintenance','ATM downtime, redundant replenishment routes, low-use sites','HVAC over-run, night load, inefficient branch equipment','Duplicate vendors, price variance, auto-renewals, double billing']],
  ['Track B · Credit loss','Losses caught earlier',TEAL,
  ['Drawdowns released ahead of real physical progress','Stalled projects detected months late, after value bleeds away','Fund diversion and progress–payment mismatch','Collateral erosion tracked quarterly, not continuously']]];
cols.forEach(([tg,h,c,items],i)=>{ const x=M+i*(CW/2+0.15)*0+i*(6.55); const cx=M+i*6.7, cwid=6.25;
  card(s,cx,1.95,cwid,4.9);
  tag(s,tg,cx+0.4,2.3,3.1,c);
  s.addText(h,{x:cx+0.4,y:2.85,w:cwid-0.8,h:0.55,fontFace:HEAD,fontSize:23,bold:true,color:INKT});
  let iy=3.65; items.forEach(it=>{ s.addShape(p.ShapeType.rect,{x:cx+0.42,y:iy+0.12,w:0.16,h:0.03,fill:{color:c}});
    s.addText(it,{x:cx+0.72,y:iy-0.05,w:cwid-1.1,h:0.7,fontFace:SANS,fontSize:13.5,color:BODY,valign:'top'}); iy+=0.78; }); });
pageno(s,3);

/* ============ 4 · WHY AFFIN ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'03 · WHY AFFIN, WHY NOW');
s.addText('Public, verifiable facts only',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:32,bold:true,color:INKT});
s.addText('Everything below is drawn from AFFIN Group’s own public profile — no assumptions.',{x:M,y:1.6,w:CW,h:0.4,fontFace:SANS,fontSize:14,color:BODY});
const stats=[['145','branch network nationwide — scale for controlled A-track pilots'],
  ['5','business lines: Community, Enterprise, Corporate, Treasury & IB'],
  ['Affin\nIslamic','enables a Conventional + Islamic dual-track workflow with Shariah risk'],
  ['Corp &\nEnterprise','a clear B1 entry: developer, contractor, factory & project finance']];
const sw=(CW-3*0.3)/4;
stats.forEach(([f,l],i)=>{ const x=M+i*(sw+0.3); card(s,x,2.25,sw,3.0);
  const big=f.length<=4; s.addText(f,{x:x+0.3,y:2.55,w:sw-0.6,h:big?1.2:1.2,fontFace:HEAD,fontSize:big?52:26,bold:true,color:big?BRASS:TEAL,valign:'top',lineSpacing:big?52:26});
  s.addText(l,{x:x+0.3,y:3.85,w:sw-0.6,h:1.2,fontFace:SANS,fontSize:12.5,color:BODY,valign:'top'});
  s.addText('PUBLIC',{x:x+0.3,y:4.85,w:1.4,h:0.28,fontFace:MONO,fontSize:9,bold:true,color:MUTE,charSpacing:1}); });
s.addText('Mid-sized with a national footprint: large enough for real ROI, but with a shorter decision chain and pilots that won’t become as complex as a mega-bank’s. That is precisely why AFFIN is the right first partner.',
  {x:M,y:5.7,w:CW,h:0.9,fontFace:HEAD,italic:true,fontSize:16,color:INKT});
pageno(s,4);

/* ============ 5 · TRACK A ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'04 · TRACK A — FROM FULL MANUAL TO EXCEPTION-DRIVEN');
s.addText('Stop inspecting everything. Inspect only the exceptions.',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:30,bold:true,color:INKT});
// before/after
card(s,M,1.95,5.75,1.5,'EEF0EC');
s.addText('CURRENT PROCESS',{x:M+0.35,y:2.2,w:5,h:0.3,fontFace:MONO,fontSize:10,bold:true,color:MUTE,charSpacing:1});
s.addText('Every site · every asset · fixed calendar → full manual inspection → report → react',{x:M+0.35,y:2.55,w:5.1,h:0.8,fontFace:SANS,fontSize:13,color:BODY,valign:'top'});
s.addText('→',{x:M+5.85,y:2.25,w:0.75,h:0.9,align:'center',fontFace:HEAD,fontSize:30,color:TEAL});
s.addShape(p.ShapeType.roundRect,{x:M+6.6,y:1.95,w:CW-6.6,h:1.5,rectRadius:0.09,fill:{color:TEAL,transparency:90},line:{color:TEAL,width:1.5}});
s.addText('FUTURE PROCESS',{x:M+6.95,y:2.2,w:5,h:0.3,fontFace:MONO,fontSize:10,bold:true,color:TEAL,charSpacing:1});
s.addText('Continuous monitoring → system flags the anomaly → people sent only to exceptions → intervene early',{x:M+6.95,y:2.55,w:5.3,h:0.8,fontFace:SANS,fontSize:13,color:INKT,valign:'top'});
// 4 modules
const mods=[['A7 · ATM','ATM Network Cost Intelligence','Predict failures, optimise replenishment mileage, merge low-value sites. Easiest hard saving.'],
  ['A2 · Maintenance','Predictive Maintenance','Turn emergency call-outs and premature replacement into scheduled, cheaper planned work.'],
  ['A3 · Energy','Energy Optimisation','Anomaly detection, time-of-use control and equipment efficiency. 3–6 months to verify.'],
  ['A4 · Procurement','Cost & Vendor Analysis','Vendor consolidation, re-negotiation, duplicate-invoice and price-variance detection.']];
const mw=(CW-3*0.3)/4;
mods.forEach(([k,h,b],i)=>{ const x=M+i*(mw+0.3); card(s,x,3.8,mw,2.9);
  s.addText(k,{x:x+0.3,y:4.05,w:mw-0.6,h:0.3,fontFace:MONO,fontSize:11,bold:true,color:TEAL});
  s.addText(h,{x:x+0.3,y:4.4,w:mw-0.6,h:0.7,fontFace:SANS,fontSize:15,bold:true,color:INKT,valign:'top'});
  s.addText(b,{x:x+0.3,y:5.15,w:mw-0.6,h:1.4,fontFace:SANS,fontSize:12,color:BODY,valign:'top'}); });
pageno(s,5);

/* ============ 6 · NET-BENEFIT MODEL ============ */
s=p.addSlide(); s.background={color:INK};
eyebrow(s,'05 · THE NET-BENEFIT MODEL',M,0.55,TEALB);
s.addText('Nothing is pre-written. The bank owns every input.',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:32,bold:true,color:'FFFFFF'});
s.addText('AFFIN enters its own baseline figures; the model returns Low / Base / High scenarios. A framework, not a promise.',{x:M,y:1.62,w:CW,h:0.4,fontFace:SANS,fontSize:14,color:TXD});
// equation big
const eq2=[['Existing cost\nremoved',TEAL],['+',null],['Avoidable\ncredit loss',TEAL],['−',null],['Implementation\ncost',RISK],['=',null],['Net benefit',BRASS]];
let qx=M; const qy=2.35;
eq2.forEach(([t,c])=>{ const op=c===null&&t.length<=1; const w=op?0.45:2.3;
  if(op){ s.addText(t,{x:qx,y:qy,w,h:1.3,align:'center',fontFace:HEAD,fontSize:30,color:t==='='?TEALB:TXD}); }
  else{ const res=t==='Net benefit'; s.addShape(p.ShapeType.roundRect,{x:qx,y:qy,w,h:1.3,rectRadius:0.1,fill:{color:res?BRASS:PANEL,transparency:res?60:0},line:{color:res?BRASSB:LINE,width:1.5}});
    s.addText(t,{x:qx,y:qy,w,h:1.3,align:'center',fontFace:SANS,fontSize:15,bold:res,color:res?BRASSB:'DCE4EE',lineSpacing:18}); }
  qx+=w+0.15; });
// reduction bands table
s.addText('ILLUSTRATIVE REDUCTION BANDS  ·  ADJUSTED WITH AFFIN DATA IN THE DISCOVERY WORKSHOP',{x:M,y:4.05,w:CW,h:0.3,fontFace:MONO,fontSize:10,bold:true,color:TXD,charSpacing:1});
const bands=[['','Low','Base','High'],['Emergency repair','10%','18%','25%'],['Branch energy','8%','15%','22%'],['ATM operations','6%','12%','18%'],['Vendor / procurement','3%','6%','10%']];
const btot=bands.length, colw=[3.2,1.9,1.9,1.9]; let bx=M, by=4.45;
const rows=bands.map((r,ri)=>r.map((cell,ci)=>({text:cell,options:{
  fontFace:ci===0?SANS:MONO,fontSize:13,bold:ri===0,align:ci===0?'left':'center',
  color:ri===0?TEALB:(ci===0?'DCE4EE':(ci===1?'AEBACb':ci===2?TEALB:BRASSB)),
  fill:{color:ri===0?PANEL:(ri%2?SLATE:INK)},valign:'middle',margin:[3,6,3,6]}})));
s.addTable(rows,{x:M,y:by,w:8.9,colW:colw,rowH:0.42,border:{type:'solid',color:LINE,pt:0.5}});
// gate box
s.addShape(p.ShapeType.roundRect,{x:9.85,y:4.45,w:2.8,h:2.1,rectRadius:0.09,fill:{color:OK,transparency:88},line:{color:OK,width:1.5}});
s.addShape(p.ShapeType.ellipse,{x:10.15,y:4.75,w:0.28,h:0.28,fill:{color:OK}});
s.addText('GO / NO-GO GATE',{x:10.55,y:4.72,w:2,h:0.3,fontFace:MONO,fontSize:10,bold:true,color:OK});
s.addText('No roll-out until bank-confirmed net benefit is positive AND the Benefit-to-Cost Ratio clears a jointly-agreed hurdle.',
  {x:10.15,y:5.15,w:2.35,h:1.3,fontFace:SANS,fontSize:12.5,color:'DCE4EE',valign:'top'});
pageno(s,6);

/* ============ 7 · B1 LIFECYCLE ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'06 · B1 — CONSTRUCTION FINANCE ASSURANCE');
s.addText('Independent evidence — without removing your team’s authority',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:28,bold:true,color:INKT});
const life=[['Pre-lending','Verify land parcel, approved drawings, project baseline, contractor & developer risk profile.'],
  ['During','Satellite / drone / camera / IoT capture by stage; compare to plan, QS quantities & drawdown schedule.'],
  ['Early warning','Flag prolonged inactivity, works behind schedule, drawdown outrunning progress, rising contractor risk.'],
  ['Post','A time-stamped evidence file for restructuring, recovery, valuation and disposal.']];
const lw=(CW-3*0.3)/4;
life.forEach(([h,b],i)=>{ const x=M+i*(lw+0.3); card(s,x,2.1,lw,2.7);
  s.addShape(p.ShapeType.ellipse,{x:x+0.3,y:2.4,w:0.5,h:0.5,fill:{color:TEAL}});
  s.addText(String(i+1),{x:x+0.3,y:2.4,w:0.5,h:0.5,align:'center',fontFace:HEAD,fontSize:18,bold:true,color:'FFFFFF'});
  s.addText(h,{x:x+0.95,y:2.45,w:lw-1.1,h:0.5,fontFace:SANS,fontSize:15,bold:true,color:INKT,valign:'middle'});
  s.addText(b,{x:x+0.3,y:3.15,w:lw-0.6,h:1.5,fontFace:SANS,fontSize:12.5,color:BODY,valign:'top'}); });
// boundary
s.addShape(p.ShapeType.roundRect,{x:M,y:5.15,w:CW,h:1.4,rectRadius:0.09,fill:{color:BRASS,transparency:90},line:{color:BRASS,width:1.25}});
s.addText('⟡',{x:M+0.35,y:5.45,w:0.6,h:0.8,fontFace:HEAD,fontSize:26,color:BRASS,align:'center'});
s.addText([{text:'Boundary of the tool.  ',options:{bold:true,color:INKT}},{text:'Aerial capture cannot authoritatively measure interior M&E or fit-out — those stages combine milestone imagery, documents, fixed cameras and QS certification. We augment human judgement; we never replace it.',options:{color:BODY}}],
  {x:M+1.1,y:5.35,w:CW-1.5,h:1.05,fontFace:SANS,fontSize:14,valign:'middle',lineSpacing:19});
pageno(s,7);

/* ============ 8 · B1 INSTRUMENT ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'06 · B1 — DRAWDOWN vs PHYSICAL PROGRESS');
s.addText('The assurance check, in one view',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:30,bold:true,color:INKT});
// twin image
card(s,M,2.0,6.4,4.6);
s.addImage({path:IMG_TWIN,x:M+0.18,y:2.18,w:6.04,h:3.9,sizing:{type:'cover',w:6.04,h:3.9}});
s.addText('Project-level digital twin — colour-coded construction-progress status across a development.',{x:M+0.2,y:6.15,w:6.0,h:0.4,fontFace:MONO,fontSize:10,color:MUTE,valign:'middle'});
// gauge card
const gx=7.35, gw=CW-6.65;
card(s,gx,2.0,gw,4.6);
s.addText('DRAWDOWN vs PHYSICAL PROGRESS',{x:gx+0.4,y:2.35,w:gw-0.8,h:0.3,fontFace:MONO,fontSize:11,bold:true,color:BODY,charSpacing:1});
function gauge(y,label,pct,col){ s.addText(label,{x:gx+0.4,y:y-0.02,w:2.0,h:0.3,fontFace:SANS,fontSize:12,color:BODY});
  s.addShape(p.ShapeType.roundRect,{x:gx+2.35,y:y,w:2.5,h:0.26,rectRadius:0.05,fill:{color:'E4E7E0'},line:{type:'none'}});
  s.addShape(p.ShapeType.roundRect,{x:gx+2.35,y:y,w:2.5*pct/100,h:0.26,rectRadius:0.05,fill:{color:col},line:{type:'none'}});
  s.addText(pct+'%',{x:gx+4.95,y:y-0.02,w:0.55,h:0.3,fontFace:MONO,fontSize:12,bold:true,color:INKT,align:'right'}); }
gauge(3.1,'Physical progress',62,OK);
gauge(3.75,'Cumulative drawdown',81,RISK);
s.addShape(p.ShapeType.line,{x:gx+0.4,y:4.35,w:gw-0.8,h:0,line:{color:CARDLINE,width:1,dashType:'dash'}});
tag(s,'WATCH',gx+0.4,4.55,1.2,WARN);
s.addText('19-point gap',{x:gx+1.75,y:4.55,w:3,h:0.34,fontFace:SANS,fontSize:14,bold:true,color:INKT,valign:'middle'});
s.addText('Drawdown is ahead of physical works. The system holds release pending an exception site visit — no committee authority is bypassed.',
  {x:gx+0.4,y:5.1,w:gw-0.8,h:1.3,fontFace:SANS,fontSize:13.5,color:BODY,valign:'top',lineSpacing:19});
pageno(s,8);

/* ============ 9 · EVIDENCE MATRIX ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'07 · EVIDENCE — GRADED HONESTLY');
s.addText('Capability reference, not board-grade proof',{x:M,y:0.95,w:CW,h:0.6,fontFace:HEAD,fontSize:30,bold:true,color:INKT});
s.addText('Every quantified result below is Partner-Provided and Pending Independent Verification (Level 2). Shown for capability.',{x:M,y:1.58,w:CW,h:0.35,fontFace:SANS,fontSize:13.5,color:BODY});
const ev=[['Institution','Use case','Reported benefit','Grade'],
  ['Agricultural Bank of China','Space-air-ground 3D digital-twin loan risk platform','−70% on-site inspection labour · risk 3–6 mo earlier','L2'],
  ['ICBC','Fixed-asset holographic digital-twin risk hub','Risk quantification +55% · warning T+7 → T+1','L2'],
  ['Bank of Communications','Drone digital-twin post-loan verification','−65% offline verification · overdue detection +60%','L2'],
  ['Industrial Bank','Space digital-twin under-construction monitoring','Property-loan NPL formation −22% YoY','L2'],
  ['China Merchants Bank','Satellite remote-sensing progress monitoring','Post-loan check efficiency ×3','L2'],
  ['SPD Bank','Infrastructure BIM digital-twin platform','Inflated-works fraud largely eliminated','L2'],
  ['Malaysia infra / GIS','Digital-twin & GIS for municipal (non-bank)','Local delivery capability — not a bank ROI claim','L3']];
const colW2=[2.9,3.9,4.0,0.9];
const gcol={L1:OK,L2:WARN,L3:TEAL,L4:MUTE};
const erows=ev.map((r,ri)=>r.map((cell,ci)=>{ const head=ri===0;
  if(ci===3&&!head){ return {text:cell,options:{fontFace:MONO,fontSize:11,bold:true,align:'center',color:gcol[cell]||MUTE,fill:{color:PAPER},valign:'middle',margin:[3,3,3,3]}}; }
  return {text:cell,options:{fontFace:ci===0?SANS:SANS,fontSize:11.5,bold:head||ci===0,align:'left',
    color:head?'FFFFFF':(ci===0?INKT:BODY),fill:{color:head?SLATE:(ri%2?'EEF0EC':CARD)},valign:'middle',margin:[4,7,4,7]}}; }));
s.addTable(erows,{x:M,y:2.1,w:CW,colW:colW2,rowH:[0.4,0.55,0.55,0.55,0.55,0.55,0.55,0.55],border:{type:'solid',color:CARDLINE,pt:0.5}});
s.addText([{text:'L1 ',options:{bold:true,color:OK,fontFace:MONO}},{text:'Verified   ',options:{color:BODY}},
  {text:'L2 ',options:{bold:true,color:WARN,fontFace:MONO}},{text:'Partner-provided   ',options:{color:BODY}},
  {text:'L3 ',options:{bold:true,color:TEAL,fontFace:MONO}},{text:'Capability reference   ',options:{color:BODY}},
  {text:'L4 ',options:{bold:true,color:MUTE,fontFace:MONO}},{text:'Illustrative',options:{color:BODY}}],
  {x:M,y:6.55,w:CW,h:0.4,fontFace:SANS,fontSize:12,valign:'middle'});
pageno(s,9);

/* ============ 10 · PILOTS ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'08 · TWO PILOTS — NOT THE WHOLE PLATFORM');
s.addText('Small, measurable, reversible',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:32,bold:true,color:INKT});
const pil=[['Pilot A · Operating cost','10–15 branches + 1 ATM cluster',BRASS,'Pick only 2 of ATM / maintenance / energy / procurement',
  ['Emergency-repair reduction vs baseline','ATM uptime & replenishment-route saving','Weather-adjusted energy saving','Verified vendor saving & net benefit']],
  ['Pilot B1 · Construction finance','3–5 projects · Shadow Mode',TEAL,'At least one high-rise, one industrial/factory, one non-BIM project',
  ['Baseline inspection cost captured','Anomaly lead-time vs current detection','Drawdown-vs-progress variance found','Net-cost model & Go/No-Go']]];
pil.forEach(([tg,h,c,scope,kpis],i)=>{ const cx=M+i*6.7, cwid=6.25; card(s,cx,1.95,cwid,4.85);
  tag(s,tg,cx+0.4,2.3,3.4,c);
  s.addText(h,{x:cx+0.4,y:2.85,w:cwid-0.8,h:0.5,fontFace:HEAD,fontSize:22,bold:true,color:INKT});
  s.addText([{text:'Scope:  ',options:{bold:true,color:INKT}},{text:scope,options:{color:BODY}}],{x:cx+0.4,y:3.45,w:cwid-0.8,h:0.6,fontFace:SANS,fontSize:13,valign:'top'});
  let ky=4.15; kpis.forEach(k=>{ s.addText('✓',{x:cx+0.42,y:ky,w:0.3,h:0.3,fontFace:SANS,fontSize:14,bold:true,color:OK});
    s.addText(k,{x:cx+0.8,y:ky-0.02,w:cwid-1.2,h:0.45,fontFace:SANS,fontSize:13,color:BODY,valign:'top'}); ky+=0.6; }); });
pageno(s,10);

/* ============ 11 · GOVERNANCE ============ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'09 · COMMERCIAL GATE · DATA · SECURITY · EXIT');
s.addText('Reversible by design',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:32,bold:true,color:INKT});
const gov=[['Commercial gate','No large-scale roll-out until AFFIN confirms net benefit is positive and the Benefit-to-Cost Ratio clears a jointly-agreed hurdle.'],
  ['Data residency','Target: 100% Malaysia-hosted with no remote access — a commitment to be validated with Group Technology, not a marketing claim.'],
  ['Regulatory alignment','Designed toward BNM RMiT alignment and Shariah representation for Affin Islamic; confirmed with Risk, Compliance & Legal.'],
  ['Exit','Pilot-first and reversible. If a pilot fails its Go/No-Go, it stops — no lock-in, no scaled cost.']];
const govW=(CW-0.3)/2, gh=2.15;
gov.forEach(([h,b],i)=>{ const x=M+(i%2)*(govW+0.3), y=2.1+Math.floor(i/2)*(gh+0.3); card(s,x,y,govW,gh);
  s.addText(h,{x:x+0.4,y:y+0.32,w:govW-0.8,h:0.5,fontFace:HEAD,fontSize:20,bold:true,color:TEAL});
  s.addText(b,{x:x+0.4,y:y+0.95,w:govW-0.8,h:1.0,fontFace:SANS,fontSize:14,color:BODY,valign:'top',lineSpacing:20}); });
pageno(s,11);

/* ============ 12 · THE ASK ============ */
s=p.addSlide(); s.background={color:INK};
eyebrow(s,'10 · THE EXACT ASK',M,0.55,TEALB);
s.addText('One workshop. Named owners. Baseline data. Two pilot dates.',{x:M,y:0.95,w:CW,h:0.7,fontFace:HEAD,fontSize:30,bold:true,color:'FFFFFF'});
const ask=[['Convene a Cost & Risk Discovery Workshop','Operations, Finance, Corporate Banking, Credit, Risk & Technology select one A-track and one B1 pilot together.'],
  ['Name the owners','Executive sponsor (Group CEO / COO), B1 business owner (Corporate / Enterprise / Credit), risk owner (Group CRO / Recovery).'],
  ['Share anonymised baseline data','Inspection counts, ATM & energy bills, vendor contracts, drawdown & holding-cost data — the model’s inputs.'],
  ['Fix two pilot dates','A 10–15 branch A-pilot and a 3–5 project B1 Shadow-Mode pilot, each with a Day-90 deliverable.']];
let ay=2.15;
ask.forEach(([h,b],i)=>{ s.addShape(p.ShapeType.roundRect,{x:M,y:ay,w:CW,h:0.95,rectRadius:0.08,fill:{color:PANEL},line:{color:LINE,width:1}});
  s.addText(String(i+1),{x:M+0.3,y:ay,w:0.8,h:0.95,align:'center',fontFace:HEAD,fontSize:34,bold:true,color:BRASSB,valign:'middle'});
  s.addText(h,{x:M+1.25,y:ay+0.14,w:CW-1.5,h:0.4,fontFace:SANS,fontSize:16,bold:true,color:'FFFFFF'});
  s.addText(b,{x:M+1.25,y:ay+0.52,w:CW-1.5,h:0.4,fontFace:SANS,fontSize:12.5,color:TXD});
  ay+=1.12; });
pageno(s,12);

/* ============ 13 · CLOSING ============ */
s=p.addSlide(); s.background={color:INK};
s.addImage({path:IMG_HERO,x:0,y:0,w:W,h:H,sizing:{type:'cover',w:W,h:H}});
s.addShape(p.ShapeType.rect,{x:0,y:0,w:W,h:H,fill:{color:INK,transparency:22}});
s.addText('We remove existing cost.\nWe don’t add a system.',{x:M,y:2.4,w:11.5,h:1.8,fontFace:HEAD,fontSize:44,bold:true,color:'FFFFFF',lineSpacing:50});
s.addText('Start with the Cost & Risk Discovery Workshop.',{x:M,y:4.35,w:10,h:0.6,fontFace:SANS,fontSize:19,color:TEALB});
s.addShape(p.ShapeType.rect,{x:M,y:5.9,w:CW,h:0.02,fill:{color:LINE}});
s.addText('All China-market case results are Partner-Provided and Pending Independent Verification, shown for capability reference only. Public AFFIN facts are drawn from AFFIN Group’s public profile. All value figures are generated from AFFIN’s own baseline inputs — no result is presented as achieved until verified.',
  {x:M,y:6.05,w:CW,h:0.9,fontFace:SANS,fontSize:11,color:TXD,valign:'top',lineSpacing:15});
s.addText('Prospek Cerah Inovasi IT Sdn. Bhd.  ·  Confidential — for AFFIN Bank internal evaluation  ·  July 2026',{x:M,y:H-0.5,w:CW,h:0.3,fontFace:MONO,fontSize:10,color:MUTE});

p.writeFile({fileName:'dist/AFFIN-Programme-Deck.pptx'}).then(f=>console.log('WROTE',f));
