/* AFFIN board deck — rebuilt on the gain-share story (A1–A8, Yunxingyu, RM 0 risk) */
const pptxgen = require('pptxgenjs');
const p = new pptxgen();
p.defineLayout({ name:'W', width:13.333, height:7.5 });
p.layout='W';
p.author='Prospek Cerah Inovasi IT Sdn. Bhd.';
p.title='AFFIN — You are already paying for this';

/* palette */
const INK='06090F', PNL='0D141D', LINE='22303F';
const PAPER='F6F5F1', CARD='FFFFFF', CLINE='DCDBD4';
const TXW='FFFFFF', TXD='9AAABC', TXDK='101922', BODY='48545F', MUTE='78838D';
const CY='0B8892', CYB='3FD5E0', GOLD='8A6620', GOLDB='EFC978';
const OK='2E8757', WN='A9701B', RK='B8402D';
const H='Helvetica', HB='Helvetica-Bold', S='Times-Roman', SI='Times-Italic';
const HERO='assets/img/hero_scrim.jpg', TWIN='assets/img/twin_scrim.jpg';
const M=0.72, W=13.333, HT=7.5, CW=W-2*M;

/* ── geometry recorder: lets us render a faithful preview without LibreOffice ── */
const REC=[]; let SLIDE=0;
const _addSlide=p.addSlide.bind(p);
p.addSlide=function(){const s=_addSlide();SLIDE++;const n=SLIDE;
  const wrap=(fn,kind)=>{const o=s[fn].bind(s);s[fn]=function(a,b){
    const opt=(kind==='text')?b:(kind==='image'?a:b);
    REC.push({slide:n,kind,text:(kind==='text')?a:null,shape:(kind==='shape')?String(a):null,opt:JSON.parse(JSON.stringify(opt||{}))});
    return o(a,b);};};
  wrap('addText','text');wrap('addShape','shape');wrap('addImage','image');
  const ob=Object.getOwnPropertyDescriptor(s,'background');
  s.__bg=null; Object.defineProperty(s,'background',{set(v){s.__bg=v;REC.push({slide:n,kind:'bg',opt:v});},get(){return s.__bg;},configurable:true});
  return s;};


const card=(s,x,y,w,h,fill)=>s.addShape(p.ShapeType.roundRect,{x,y,w,h,rectRadius:.09,
  fill:{color:fill||CARD},line:{color:CLINE,width:1}});
const foot=(s,n)=>{ s.addText('Prospek Cerah Inovasi IT × 云星宇 873806',{x:M,y:HT-.46,w:6,h:.28,fontFace:H,fontSize:8,color:MUTE});
  s.addText(String(n).padStart(2,'0'),{x:W-1.1,y:HT-.46,w:.6,h:.28,fontFace:H,fontSize:9,color:MUTE,align:'right'}); };
const eyebrow=(s,t,c)=>s.addText(t,{x:M,y:.52,w:CW,h:.3,fontFace:H,fontSize:10,bold:true,color:c||CY,charSpacing:2.6});
const title=(s,t,c)=>s.addText(t,{x:M,y:.92,w:CW,h:1.0,fontFace:HB,fontSize:34,color:c||TXDK});

/* ═══ 1 · COVER ═══ */
let s=p.addSlide(); s.background={color:INK};
s.addImage({path:HERO,x:0,y:0,w:W,h:HT,sizing:{type:'cover',w:W,h:HT}});

s.addText('FOR AFFIN BANK BERHAD  ·  CONFIDENTIAL  ·  JULY 2026',
  {x:M,y:.9,w:9,h:.3,fontFace:H,fontSize:10,bold:true,color:CYB,charSpacing:2.6});
s.addText('You are already\npaying for this.',
  {x:M,y:2.0,w:9.2,h:2.5,fontFace:HB,fontSize:60,color:TXW,lineSpacing:60});
s.addText('Inspections. Emergency repairs. Wasted power. Guarding hours. ATM call-outs.\nValuation trips. An insurance premium you have no data to argue with.',
  {x:M,y:4.75,w:8.4,h:.9,fontFace:H,fontSize:14,color:'B9C6D4',lineSpacing:22});
s.addText('We take that money back — and you pay us nothing until it is back.',
  {x:M,y:5.75,w:8.4,h:.4,fontFace:HB,fontSize:16,color:TXW});
s.addText('Prospek Cerah Inovasi IT Sdn. Bhd.   ×   云星宇 Yunxingyu · Beijing Stock Exchange 873806',
  {x:M,y:HT-.75,w:11,h:.3,fontFace:H,fontSize:11,color:'B9C6D4'});

/* ═══ 2 · RM 0 ═══ */
s=p.addSlide(); s.background={color:INK};
s.addText('WHAT THIS COSTS AFFIN TO FIND OUT',
  {x:0,y:1.5,w:W,h:.3,align:'center',fontFace:H,fontSize:10,bold:true,color:'6C7A8B',charSpacing:3});
s.addText('RM 0',{x:0,y:1.95,w:W,h:2.7,align:'center',fontFace:HB,fontSize:150,color:GOLDB});
s.addText('The diagnostic is at our cost. The pilot fee is capped and credited back. After that we are paid\nonly from savings your own finance team has verified.',
  {x:2.2,y:4.75,w:W-4.4,h:.8,align:'center',fontFace:H,fontSize:13,color:'A9B7C6',lineSpacing:20});
s.addText('No verified saving.  No fee.  Ever.',
  {x:0,y:5.7,w:W,h:.6,align:'center',fontFace:HB,fontSize:26,color:TXW});

/* ═══ 3 · EIGHT BILLS ═══ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'01 · WHERE THE MONEY GOES');
title(s,'Eight bills. Every one of them too big.');
const L=[['A1','Building inspection','Crews on ropes and ladders, patchy records','50–60%',60],
 ['A2','Branch energy','HVAC running into empty nights','18–25%',25],
 ['A3','Maintenance','Breakdowns cost 3–5× planned work','20–25%',25],
 ['A4','Branch network','Overlapping catchments, prime rent on quiet sites','10–15%',15],
 ['A5','Security & guarding','Night shifts are a third of the bill','20–30%',30],
 ['A6','ATM operations','Checked twice a day; skimmers are invisible to that','~60%',60],
 ['A7','Collateral valuation','3–5 days and a travel bill per revaluation','30–40%',40],
 ['A8','Insurance premium','Priced on industry average because you have no data','8–15%',15]];
let y=2.0; const RH=.545, BARX=8.0, BARW=2.7;
s.addShape(p.ShapeType.line,{x:M,y:y-.12,w:CW,h:0,line:{color:TXDK,width:1}});
L.forEach(([c,n,d,b,pct])=>{
  s.addText(c,{x:M,y:y,w:.5,h:.26,fontFace:HB,fontSize:10,color:CY});
  s.addText(n,{x:M+.55,y:y-.02,w:3.5,h:.3,fontFace:HB,fontSize:13.5,color:TXDK});
  s.addText(d,{x:M+.55,y:y+.24,w:6.6,h:.26,fontFace:H,fontSize:10,color:MUTE});
  s.addShape(p.ShapeType.roundRect,{x:BARX,y:y+.09,w:BARW,h:.11,rectRadius:.05,fill:{color:CLINE},line:{type:'none'}});
  s.addShape(p.ShapeType.roundRect,{x:BARX,y:y+.09,w:BARW*pct/100,h:.11,rectRadius:.05,fill:{color:GOLD},line:{type:'none'}});
  s.addText(b,{x:BARX+BARW+.25,y:y-.04,w:1.8,h:.36,fontFace:HB,fontSize:19,color:GOLD,align:'right'});
  s.addShape(p.ShapeType.line,{x:M,y:y+.47,w:CW,h:0,line:{color:CLINE,width:.75}});
  y+=RH;
});
s.addText('A8 feeds the risk data from A1–A7 to the insurer. The eighth module is the interest on the first seven.',
  {x:M,y:6.52,w:CW,h:.5,fontFace:SI,fontSize:12.5,color:BODY,lineSpacing:17});
foot(s,3);

/* ═══ 4 · ONE FLIGHT, THIRTEEN RETURNS ═══ */
s=p.addSlide(); s.background={color:INK};
s.addImage({path:TWIN,x:0,y:0,w:W,h:HT,sizing:{type:'cover',w:W,h:HT}});

s.addText('13',{x:M,y:1.3,w:3,h:1.5,fontFace:HB,fontSize:86,color:GOLDB});
s.addText('One flight.\nThirteen returns.',{x:M,y:2.75,w:6.6,h:1.7,fontFace:HB,fontSize:40,color:TXW,lineSpacing:44});
s.addText('The drone that inspects a building for A1 also revalues collateral for A7, verifies progress for B1 and feeds monitoring for B3. Same flight. Four outputs.',
  {x:M,y:4.7,w:6.4,h:1.0,fontFace:H,fontSize:13,color:'B9C6D4',lineSpacing:20});
s.addText('The 13th module costs a fraction of the 1st — which is why buying it piecemeal from three vendors costs more and delivers less.',
  {x:M,y:5.72,w:6.4,h:.95,fontFace:HB,fontSize:13,color:TXW,lineSpacing:20});

/* ═══ 5 · THE OFFER ═══ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'02 · THE COMMERCIAL MODEL',GOLD);
title(s,'Where your money sits, phase by phase');
const PH=[['00','Diagnostic','4–6 weeks','RM 0',OK,'We read your bills at our cost and hand back a jointly-signed savings baseline.'],
 ['01','90-day pilot','10–15 branches · 3–5 projects','Capped · credited',WN,'One capped fee, credited back in full against Phase 02.'],
 ['02','Scale','Gain-share','From savings only',GOLD,'Paid out of verified savings. Nothing verified in a period, nothing charged.']];
const PW=(CW-2*.3)/3;
PH.forEach(([n,t,sub,tag,col,desc],i)=>{
  const x=M+i*(PW+.3);
  card(s,x,2.0,PW,2.9);
  s.addText(n,{x:x+.35,y:2.2,w:1,h:.5,fontFace:HB,fontSize:26,color:MUTE});
  s.addText(t,{x:x+.35,y:2.72,w:PW-.7,h:.35,fontFace:HB,fontSize:17,color:TXDK});
  s.addText(sub,{x:x+.35,y:3.06,w:PW-.7,h:.3,fontFace:H,fontSize:10.5,color:MUTE});
  s.addShape(p.ShapeType.roundRect,{x:x+.35,y:3.45,w:2.3,h:.36,rectRadius:.06,
    fill:{color:col,transparency:84},line:{color:col,width:1}});
  s.addText(tag,{x:x+.35,y:3.45,w:2.3,h:.36,align:'center',fontFace:HB,fontSize:11,color:col});
  s.addText(desc,{x:x+.35,y:3.98,w:PW-.7,h:.8,fontFace:H,fontSize:11.5,color:BODY,valign:'top',lineSpacing:17});
});
s.addShape(p.ShapeType.roundRect,{x:M,y:5.15,w:CW,h:1.35,rectRadius:.09,
  fill:{color:GOLD,transparency:90},line:{color:GOLD,width:1.25}});
s.addText('And if Day 90 falls short',{x:M+.4,y:5.32,w:6,h:.32,fontFace:HB,fontSize:15,color:GOLD});
s.addText([{text:'If your own measurement shows verified savings below the pilot cost, ',options:{color:BODY}},
  {text:'we absorb the shortfall',options:{bold:true,color:TXDK}},
  {text:'. The pilot fee is credited or waived. Your downside is written down before a single sensor is installed.',options:{color:BODY}}],
  {x:M+.4,y:5.68,w:CW-.8,h:.7,fontFace:H,fontSize:12.5,valign:'top',lineSpacing:19});
foot(s,5);

/* ═══ 6 · B1 ═══ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'03 · B1 CONSTRUCTION FINANCE ASSURANCE');
title(s,'Drawdown runs ahead of the concrete');
s.addText('You find out months later. This closes that gap.',{x:M,y:1.95,w:CW,h:.3,fontFace:H,fontSize:13,color:BODY});
card(s,M,2.45,7.2,2.5);
s.addText('DRAWDOWN vs VERIFIED PHYSICAL PROGRESS',{x:M+.4,y:2.7,w:6.4,h:.28,fontFace:HB,fontSize:9.5,color:BODY,charSpacing:1});
const gb=(gy,lab,pct,col)=>{ s.addText(lab,{x:M+.4,y:gy-.03,w:2.1,h:.3,fontFace:H,fontSize:11.5,color:BODY});
  s.addShape(p.ShapeType.roundRect,{x:M+2.6,y:gy+.05,w:3.2,h:.17,rectRadius:.08,fill:{color:'E4E7E0'},line:{type:'none'}});
  s.addShape(p.ShapeType.roundRect,{x:M+2.6,y:gy+.05,w:3.2*pct/100,h:.17,rectRadius:.08,fill:{color:col},line:{type:'none'}});
  s.addText(pct+'%',{x:M+5.95,y:gy-.05,w:.85,h:.32,fontFace:HB,fontSize:14,color:TXDK,align:'right'}); };
gb(3.15,'Physical progress',62,OK);
gb(3.62,'Cumulative drawdown',81,RK);
s.addShape(p.ShapeType.roundRect,{x:M+.4,y:4.12,w:.95,h:.32,rectRadius:.06,fill:{color:WN,transparency:82},line:{color:WN,width:1}});
s.addText('HOLD',{x:M+.4,y:4.12,w:.95,h:.32,align:'center',fontFace:HB,fontSize:10,color:WN});
s.addText('19-point gap. Release held pending an exception visit. Your committee still decides — it just decides on better evidence.',
  {x:M+1.5,y:4.08,w:5.3,h:.7,fontFace:H,fontSize:11,color:BODY,valign:'top',lineSpacing:16});
const PIL=['Live progress monitoring','Automatic delay warning','Drawdown compliance check',
  'Contractor risk tracking','Digital-twin view','GIS portfolio map'];
let py=2.45; const PX=M+7.5, PWD=CW-7.5;
PIL.forEach(t=>{ card(s,PX,py,PWD,.36);
  s.addShape(p.ShapeType.ellipse,{x:PX+.2,y:py+.13,w:.1,h:.1,fill:{color:CY},line:{type:'none'}});
  s.addText(t,{x:PX+.42,y:py,w:PWD-.6,h:.36,fontFace:H,fontSize:11,color:TXDK,valign:'middle'}); py+=.44; });
s.addShape(p.ShapeType.roundRect,{x:M,y:5.2,w:CW,h:1.05,rectRadius:.09,
  fill:{color:GOLD,transparency:92},line:{color:GOLD,width:1}});
s.addText([{text:'Stated limit.  ',options:{bold:true,color:GOLD}},
  {text:'Aerial capture cannot measure interior M&E or fit-out. Those stages need milestone imagery, documents, fixed cameras and QS certification. We augment human judgement; we never replace it.',options:{color:BODY}}],
  {x:M+.4,y:5.38,w:CW-.8,h:.75,fontFace:H,fontSize:11.5,valign:'top',lineSpacing:17});
foot(s,6);

/* ═══ 7 · WHO ═══ */
s=p.addSlide(); s.background={color:INK};
s.addText('THE TECHNOLOGY IS BUILT BY A LISTED COMPANY',
  {x:0,y:1.15,w:W,h:.3,align:'center',fontFace:H,fontSize:10,bold:true,color:'6C7A8B',charSpacing:3});
s.addText('873806',{x:0,y:1.55,w:W,h:1.9,align:'center',fontFace:HB,fontSize:104,color:CYB});
s.addText('北京云星宇交通科技股份有限公司  ·  Beijing Stock Exchange',
  {x:0,y:3.45,w:W,h:.36,align:'center',fontFace:HB,fontSize:16,color:TXW});
s.addText('A listed company’s capability claims carry legal consequence.',
  {x:0,y:3.88,w:W,h:.3,align:'center',fontFace:H,fontSize:12.5,color:'A9B7C6'});
const CR=[['28','years in IT'],['400+','IP rights'],['RMB 3.0bn','contracts, 100+ projects'],['30','provinces'],['12','national awards']];
const CWD=(CW-4*.28)/5;
CR.forEach(([v,l],i)=>{ const x=M+i*(CWD+.28);
  s.addShape(p.ShapeType.roundRect,{x,y:4.55,w:CWD,h:1.15,rectRadius:.09,
    fill:{color:PNL},line:{color:LINE,width:1}});
  s.addText(v,{x,y:4.7,w:CWD,h:.5,align:'center',fontFace:HB,fontSize:22,color:TXW});
  s.addText(l,{x,y:5.2,w:CWD,h:.35,align:'center',fontFace:H,fontSize:10,color:'8B9AAC'}); });
s.addText('External case results from comparable markets are partner-provided and pending independent verification. They are shown for capability reference only — the pilot exists so AFFIN never has to rely on any of them.',
  {x:M,y:6.15,w:CW,h:.6,align:'center',fontFace:H,fontSize:10,color:'6C7A8B',lineSpacing:15});

/* ═══ 8 · 90 DAYS ═══ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'04 · THE FIRST NINETY DAYS');
title(s,'Ninety days, then you decide');
const TLD=[['Week 0–2','Sign the baseline','Both sides agree in writing what today costs. Nothing can be argued later.'],
 ['Week 3–6','Install and shadow','Capture goes live. B1 runs beside your process and changes no decision yet.'],
 ['Week 7–11','Switch to exceptions','People go only where the system flags. Every avoided visit is logged.'],
 ['Week 12','You measure. You decide.','AFFIN scores it against the signed baseline and calls Go or No-Go.']];
const TW=(CW-3*.3)/4;
TLD.forEach(([w,t,d],i)=>{ const x=M+i*(TW+.3);
  card(s,x,2.2,TW,2.6);
  s.addShape(p.ShapeType.ellipse,{x:x+.35,y:2.45,w:.42,h:.42,fill:{color:CY},line:{type:'none'}});
  s.addText(String(i+1),{x:x+.35,y:2.45,w:.42,h:.42,align:'center',fontFace:HB,fontSize:14,color:'FFFFFF'});
  s.addText(w,{x:x+.35,y:3.0,w:TW-.7,h:.26,fontFace:HB,fontSize:10,color:CY});
  s.addText(t,{x:x+.35,y:3.28,w:TW-.7,h:.6,fontFace:HB,fontSize:14,color:TXDK,valign:'top'});
  s.addText(d,{x:x+.35,y:3.92,w:TW-.7,h:.8,fontFace:H,fontSize:11,color:BODY,valign:'top',lineSpacing:16}); });
s.addShape(p.ShapeType.roundRect,{x:M,y:5.15,w:CW,h:1.0,rectRadius:.09,
  fill:{color:GOLD,transparency:90},line:{color:GOLD,width:1.25}});
s.addText('DAY 90 · GO / NO-GO',{x:M+.4,y:5.32,w:3,h:.3,fontFace:HB,fontSize:12,color:GOLD,charSpacing:1});
s.addText('Positive and above the hurdle → scale under gain-share. Below the hurdle → it stops, we absorb the shortfall, and you keep the baseline and evidence file you never had before.',
  {x:M+.4,y:5.63,w:CW-.8,h:.5,fontFace:H,fontSize:12,color:BODY,lineSpacing:17});
foot(s,8);

/* ═══ 9 · THE ASK ═══ */
s=p.addSlide(); s.background={color:INK};
s.addText('WHAT WE ARE ASKING FOR TODAY',{x:M,y:.9,w:CW,h:.3,fontFace:H,fontSize:10,bold:true,color:'6C7A8B',charSpacing:3});
s.addText('Approve the diagnostic.\nThat is the whole ask.',{x:M,y:1.35,w:CW,h:1.5,fontFace:HB,fontSize:40,color:TXW,lineSpacing:44});
const AK=[['Approve the diagnostic','Anonymised bills plus a drawdown sample. Costs you nothing. Four to six weeks.'],
 ['Half a day in one room','Operations, Finance, Corporate Banking, Credit, Risk, Technology. Pick two A-modules and the B1 scope.'],
 ['Name three owners','An executive sponsor, a B1 business owner, a risk owner. Without names, nothing moves.'],
 ['Set the hurdle in writing','Agree the Benefit-to-Cost bar and the Day-90 method now, so the decision is arithmetic.']];
const AW=(CW-.3)/2;
AK.forEach(([t,d],i)=>{ const x=M+(i%2)*(AW+.3), yy=3.15+Math.floor(i/2)*1.15;
  s.addShape(p.ShapeType.roundRect,{x,y:yy,w:AW,h:1.0,rectRadius:.09,fill:{color:PNL},line:{color:LINE,width:1}});
  s.addText(String(i+1),{x:x+.3,y:yy+.18,w:.45,h:.4,fontFace:HB,fontSize:20,color:GOLDB});
  s.addText(t,{x:x+.85,y:yy+.15,w:AW-1.2,h:.32,fontFace:HB,fontSize:14,color:TXW});
  s.addText(d,{x:x+.85,y:yy+.47,w:AW-1.2,h:.5,fontFace:H,fontSize:10.5,color:'A9B7C6',valign:'top',lineSpacing:15}); });
s.addShape(p.ShapeType.line,{x:M,y:5.75,w:CW,h:0,line:{color:LINE,width:1}});
s.addText('The only thing AFFIN risks by starting is finding out how much it has been overpaying.',
  {x:M,y:5.95,w:10.5,h:.8,fontFace:SI,fontSize:22,color:TXW,lineSpacing:30});

/* ═══ 10 · DISCLOSURE ═══ */
s=p.addSlide(); s.background={color:PAPER};
eyebrow(s,'APPENDIX · EVIDENCE DISCIPLINE');
title(s,'What is proven, and what is not');
const EVR=[['L1','Verified',OK,'Yunxingyu listed-company disclosure: 28 years, 400+ IP, RMB 3.0bn contracts, 30 provinces.'],
 ['L2','Partner-provided, pending verification',WN,'Comparable-market results (post-loan check efficiency ×3, inspection labour −70%, warning T+7→T+1, property-loan NPL formation −22% YoY). Named clients, not independently audited.'],
 ['L3','Capability reference',CY,'Municipal and infrastructure digital-twin delivery, including Malaysia. Proves delivery capability, not a banking ROI claim.'],
 ['L4','Reference model',MUTE,'The A1–A8 reduction bands and the RMB 57.4m–84.7m programme total. Sized for the partner’s benchmark bank estate — not AFFIN’s. AFFIN’s figure is computed from AFFIN’s own bills in the Diagnostic.']];
let ey=2.05;
EVR.forEach(([g,lab,col,txt])=>{
  card(s,M,ey,CW,1.02);
  s.addShape(p.ShapeType.roundRect,{x:M+.32,y:ey+.3,w:.62,h:.4,rectRadius:.06,fill:{color:col,transparency:82},line:{color:col,width:1}});
  s.addText(g,{x:M+.32,y:ey+.3,w:.62,h:.4,align:'center',fontFace:HB,fontSize:13,color:col});
  s.addText(lab,{x:M+1.15,y:ey+.16,w:4.2,h:.3,fontFace:HB,fontSize:13,color:TXDK});
  s.addText(txt,{x:M+1.15,y:ey+.46,w:CW-1.6,h:.5,fontFace:H,fontSize:10.5,color:BODY,valign:'top',lineSpacing:15});
  ey+=1.12; });
s.addText('No result is presented as achieved until measured and confirmed by AFFIN. Commercial terms are indicative and subject to written agreement.',
  {x:M,y:6.72,w:CW,h:.4,fontFace:H,fontSize:10,color:MUTE});
foot(s,10);

require('fs').writeFileSync('dist/deck-geometry.json',JSON.stringify(REC));
p.writeFile({fileName:'dist/AFFIN-Board-Deck.pptx'}).then(f=>console.log('WROTE',f,'| elements:',REC.length));
