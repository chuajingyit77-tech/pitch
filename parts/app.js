/* ══ DATA — copy kept deliberately short ══ */
const LEDGER=[
 ['A1',['Building inspection','楼宇检查'],['Crews on ropes and ladders, patchy records','人工高空巡检，记录零散'],'50–60%',[50,55,60]],
 ['A2',['Branch energy','分行能源'],['HVAC running into empty nights','空调整夜空转'],'18–25%',[18,21,25]],
 ['A3',['Maintenance','设备维护'],['Breakdowns cost 3–5× planned work','突发故障成本是计划维护的3–5倍'],'20–25%',[20,22,25]],
 ['A4',['Branch network','网点网络'],['Overlapping catchments, prime rent on quiet sites','服务半径重叠，冷门点位付黄金地段租金'],'10–15%',[10,12,15]],
 ['A5',['Security &amp; guarding','安保值守'],['Night shifts are a third of the bill','夜班占安保开支三分之一'],'20–30%',[20,25,30]],
 ['A6',['ATM operations','ATM运维'],['Checked twice a day; skimmers are invisible to that','每日巡查两次，隐蔽篡改看不出来'],'~60%',[55,60,65]],
 ['A7',['Collateral valuation','抵押品评估'],['3–5 days and a travel bill per revaluation','每次重估3–5天加差旅'],'30–40%',[30,35,40]],
 ['A8',['Insurance premium','物业保险费'],['Priced on industry average because you have no data','按行业均值定价，因为你拿不出数据'],'8–15%',[8,11,15]],
];
const CFLOW=[
 [['A1 inspection','A1 巡检'],['A7 revaluation','A7 重估'],['same flight, two outputs','同一次飞行，两种产出']],
 [['A7 revaluation','A7 重估'],['B3 monitoring','B3 监测'],['a valuation becomes a live baseline','一次估值变成持续基线']],
 [['A1–A7 data','A1–A7 数据'],['A8 premium','A8 保费'],['operations data becomes leverage over the insurer','运营数据变成对保险公司的筹码']],
 [['A6 ATM','A6 ATM'],['B5 fraud','B5 欺诈'],['tamper signals feed the fraud model','篡改信号喂入反欺诈模型']],
 [['B1 warning','B1 预警'],['B2 recovery','B2 追偿'],['if it fails, the evidence file already exists','项目一旦失败，证据档案已经在了']],
];
const CBASE=[['Digital twin','数字孪生'],['GIS','GIS地理信息'],['AI analysis','AI智能分析'],['Drone survey','无人机巡检'],['Big-data risk control','大数据风控'],['E-signature / PKI','电子签章与PKI']];
const EXPOSE=[
 ['00',['Diagnostic','诊断'],['4–6 weeks','4–6周'],0,['We read your bills at our cost and hand back a signed savings baseline.','我方自费拆解你的账单，交回一份双方签署的节省基线。'],['RM 0','RM 0']],
 ['01',['90-day pilot','90天试点'],['10–15 branches · 3–5 projects','10–15家分行 · 3–5个项目'],22,['One capped fee, credited back in full against Phase 02.','一笔封顶费，在第二阶段全额抵扣。'],['Capped · credited','封顶 · 可抵扣']],
 ['02',['Scale','推广'],['Gain-share','节省分成'],0,['Paid out of verified savings. Nothing verified in a period, nothing charged.','从已核验的节省里支付。某期没核验出节省，该期不收费。'],['From savings only','只从节省里出']],
];
const PILLS=[['Live progress monitoring','进度实时监测'],['Automatic delay warning','延期自动预警'],['Drawdown compliance check','提款合规验证'],['Contractor risk tracking','承包商风险追踪'],['Digital-twin view','数字孪生视图'],['GIS portfolio map','GIS组合地图']];
const WHOROW=[['28',['years','年历史']],['400+',['IP rights','知识产权']],['30',['provinces','省份']],['12',['national awards','国家级奖项']]];
const MTAB=[
 [['Scale','体量'],['Typical','典型项目'],['What we watch for','监测重点'],['Model','模型']],
 [['Small','小'],['Single factory, shophouse, low-rise','单栋厂房、商铺、低层'],['Drawdown before ground is broken; no activity for days; invoices not matching quantities','未开工即提款；连日无活动；发票与工程量不符'],['Rule engine + three-way match of plan, imagery and payment','规则引擎＋计划/影像/付款三方匹配']],
 [['Medium','中'],['Housing blocks, industrial park, schools','住宅小区、产业园、学校'],['Disbursement ahead of progress; a block stopped; materials or labour dropping; milestones uncertified','拨付快于进度；某楼栋停工；材料或劳务下降；节点未认证'],['Progress–disbursement–contract linkage scoring per block and floor','按楼栋楼层的进度—拨付—履约联动评分']],
 [['Large','大'],['Townships, mixed-use, urban renewal','大型片区、综合体、城市更新'],['Collections below cash need; supervised account outflow; several sections late; valuation cut','回款低于现金需求；监管账户异常流出；多标段延误；估值下调'],['Cash-flow stress test + performance score + dynamic collateral valuation','现金流压力测试＋履约评分＋抵押品动态估值']],
];
const EV=[
 [['Source','来源'],['What it shows','说明'],['Result','成效'],['Grade','等级']],
 [['Yunxingyu · listed disclosure','云星宇 · 上市披露'],['28 years, 400+ IP, RMB 3.0bn contracts','28年、400+知识产权、30亿合同额'],['Publicly filed corporate record','公开披露的公司业绩'],'L1'],
 [['Partner reference model','交付方参考模型'],['A1–A8 on a benchmark bank estate','A1–A8在基准银行资产上的测算'],['RMB 57.4m–84.7m/yr — that estate, not AFFIN','每年5740–8470万元 —— 该行资产，非AFFIN'],'L4'],
 [['China Merchants Bank','招商银行'],['Satellite post-loan progress monitoring','卫星遥感贷后进度监测'],['Check efficiency ×3 · manpower −70%','检查效率×3 · 人力−70%'],'L2'],
 [['Agricultural Bank of China','中国农业银行'],['Space-air-ground digital twin','空天地数字孪生'],['Inspection labour −70% · risk 3–6 mo earlier','巡查人力−70% · 风险提前3–6个月'],'L2'],
 [['ICBC','中国工商银行'],['Fixed-asset digital-twin risk hub','固定资产数字孪生风控中台'],['Warning response T+7 → T+1','预警响应T+7→T+1'],'L2'],
 [['Industrial Bank','兴业银行'],['Under-construction monitoring','在建工程监测'],['Property-loan NPL formation −22% YoY','地产贷不良发生率同比−22%'],'L2'],
 [['Malaysia infra / GIS','马来西亚基建 / GIS'],['Municipal digital twin (non-bank)','市政数字孪生（非银行）'],['Local delivery capability, not a bank ROI claim','本地交付能力，非银行ROI主张'],'L3'],
];
const TL=[
 [['Week 0–2','第0–2周'],['Sign the baseline','签署基线'],['Both sides agree in writing what today costs. Nothing can be argued later.','双方白纸黑字确认"今天的成本"，之后无从争论。']],
 [['Week 3–6','第3–6周'],['Install and shadow','部署与影子运行'],['Capture goes live. B1 runs beside your process and changes no decision yet.','采集上线。B1在现有流程旁运行，暂不改变任何决策。']],
 [['Week 7–11','第7–11周'],['Switch to exceptions','转为异常驱动'],['People go only where the system flags. Every avoided visit is logged.','只对系统标记的异常派人。每一次避免的现场检查都记录在案。']],
 [['Week 12','第12周'],['You measure. You decide.','你测算，你决定'],['AFFIN scores it against the signed baseline and calls Go or No-Go.','AFFIN对照签署基线打分，作出Go或No-Go。']],
];
const OBJ=[
 [['Is this just another subscription?','这是不是又一笔订阅费？'],['There is nothing to subscribe to. We are paid a share of savings your finance team has verified. Nothing verified, nothing charged — the cost line never appears.','没有订阅费。我们按你财务团队已核验的节省分成。没核验出节省就不收费 —— 这条成本根本不会出现。']],
 [['Our data cannot leave Malaysia. And BNM RMiT?','数据不能离开马来西亚，还有BNM RMiT？'],['Target is 100% Malaysia-hosted with no remote access, designed toward RMiT and validated with Group Technology, Risk and Compliance before Phase 1 — not claimed afterwards.','目标是100%本地部署、无远程访问，朝RMiT对齐，并在第一阶段前与技术、风险、合规共同验证 —— 不是事后声明。']],
 [['Will this disrupt my credit officers and QS?','会不会打乱我的信贷官和工料测量师？'],['Shadow Mode runs beside the existing process for the whole pilot. The system flags; your people and committee decide. No authority moves.','整个试点期间影子模式与现有流程并行。系统只标记，你的人和委员会决定。权限不动。']],
 [['Those China numbers could be marketing.','那些中国数字可能只是营销。'],['Which is why they are graded L2 and kept out of the argument. The partner\'s own record is L1 listed-company disclosure. The pilot proves value on your assets, not on our slides.','所以它们被标为L2并排除在论证之外。交付方自身业绩是L1上市披露。试点在你的资产上验证，而不是在我们的幻灯片上。']],
 [['Core-system integration is a huge project.','核心系统对接是个大工程。'],['The pilot needs read-only baseline data and a few live projects. No core integration is required to prove value.','试点只需只读基线数据和少量在运行项目。验证价值不需要核心对接。']],
 [['What if the pilot fails?','如果试点失败？'],['It stops, we absorb the shortfall, there is no lock-in — and you keep the signed cost baseline and the evidence file you did not have before.','就停止，差额我方吸收，没有锁定 —— 你保留已签署的成本基线和原本没有的证据档案。']],
 [['Shariah compliance for Affin Islamic?','Affin Islamic的Shariah合规？'],['A Conventional + Islamic dual track with Shariah risk represented, confirmed with your Shariah function during pilot design, not retrofitted.','Conventional + Islamic双轨并纳入Shariah风险代表，在试点设计阶段与你的Shariah职能确认，不是事后补做。']],
 [['Why you and not a big vendor?','为什么是你们，不是大厂？'],['A big vendor sells one box at full price. And none of them will put their fee at risk on savings you verify.','大厂卖一个盒子按全价收费。而且没有一家会像我们这样，把自己的费用押在你核验出的节省上。']],
];
const ASKS=[
 [['Approve the diagnostic','批准诊断'],['Anonymised bills plus a drawdown sample. Costs you nothing. Four to six weeks.','匿名账单加一份提款样本。对你零成本。四到六周。']],
 [['Half a day in one room','一间会议室，半天'],['Operations, Finance, Corporate Banking, Credit, Risk, Technology. Pick two A-modules and the B1 scope.','运营、财务、公司银行、信贷、风险、技术。选定两个A模块和B1范围。']],
 [['Name three owners','指定三位负责人'],['An executive sponsor, a B1 business owner, a risk owner. Without names, nothing moves.','一位执行发起人、一位B1业务负责人、一位风险负责人。没有具体的人，事情不动。']],
 [['Set the hurdle in writing','书面确定门槛'],['Agree the Benefit-to-Cost bar and the Day-90 method now, so the decision is arithmetic.','现在就定好收益成本比与Day-90测算方法，让决策变成算术。']],
];
const CALCA=[
 ['ia1',['Building inspection &amp; survey','楼宇检查与勘察'],[50,55,60]],
 ['ia2',['Branch energy','分行能源'],[18,21,25]],
 ['ia3',['Maintenance incl. emergency','维护含紧急'],[20,22,25]],
 ['ia4',['Branch rent &amp; fixed network','网点租金与固定成本'],[10,12,15]],
 ['ia5',['Security &amp; guarding','安保与值守'],[20,25,30]],
 ['ia6',['ATM operations','ATM运维'],[55,60,65]],
 ['ia7',['Collateral valuation','抵押品评估'],[30,35,40]],
 ['ia8',['Property insurance premium','物业保险费'],[8,11,15]],
];
const CALCB=[
 ['ib1',['Construction-finance drawdown volume','建筑融资年提款额'],null,'RM',''],
 ['ib2',['of which over-drawdown / mismatch exposure','其中过度提款/进度错配敞口'],[15,30,45],'%','B1'],
 ['ib3',['Credit loss booked on monitored collateral','监测抵押品已确认年度信贷损失'],[25,30,35],'RM','B3'],
 ['ib4',['NPL / stalled-project book value','不良与烂尾项目账面价值'],[15,17.5,20],'RM','B2'],
 ['ib5',['Post-loan inspection &amp; verification cost','贷后检查与核验成本'],[55,65,70],'RM','B1/B3'],
];

/* ══ I18N ══ */
const T={
"n.money":["The money","钱在哪"],"n.offer":["The offer","条件"],"n.calc":["Your numbers","你的数字"],"n.b1":["B1","B1"],"n.who":["Who we are","我们是谁"],"n.ask":["The ask","请求"],
"h.k":["FOR AFFIN BANK BERHAD · CONFIDENTIAL","呈交 AFFIN BANK BERHAD · 机密"],
"h.t":["You are already<br>paying for this.","这笔钱<br>你已经在付了。"],
"h.s":["Inspections. Emergency repairs. Wasted power. Guarding hours. ATM call-outs. Valuation trips. An insurance premium you have no data to argue with.","巡检。紧急维修。浪费的电。值守工时。ATM上门。评估差旅。一份你拿不出数据去争的保险费。"],
"h.s2":["We take that money back — and you pay us nothing until it is back.","我们把这些钱拿回来 —— 拿回来之前，你一分不付。"],
"z.k":["WHAT THIS COSTS AFFIN TO FIND OUT","AFFIN为搞清楚这件事要付多少"],
"z.p":["The diagnostic is at our cost. The pilot fee is capped and credited back. After that we are paid only from savings your own finance team has verified.","诊断由我方承担。试点费封顶且全额抵扣。之后我们只从你财务团队已核验的节省里取酬。"],
"z.x":["No verified saving. No fee. Ever.","没有核验出的节省，就没有费用。永远。"],
"m.t":["Eight bills. Every one of them too big.","八张账单，每一张都太大。"],
"m.s":["These are lines already on AFFIN's P&amp;L. The percentages are the reduction bands our delivery partner achieves on comparable estates — applied to your baseline, not ours.","这些都是AFFIN损益表上已有的科目。百分比是交付方在可比资产上实现的降幅区间 —— 套用在你的基线上，不是我们的。"],
"m.f1":["Partner reference model, whole programme","交付方参考模型，全计划"],
"m.f2":["per year, sized for that bank's estate — not AFFIN's","每年，按该行资产规模测算 —— 非AFFIN"],
"e.t":["One flight.<br>Thirteen returns.","飞一次，<br>十三个回报。"],
"e.s":["The drone that inspects a building for A1 also revalues collateral for A7, verifies progress for B1 and feeds monitoring for B3. Same flight. Four outputs. The thirteenth module costs a fraction of the first.","为A1巡检楼宇的那架无人机，同时为A7重估抵押品、为B1核验进度、为B3提供监测数据。同一次飞行，四种产出。第十三个模块的成本只是第一个的零头。"],
"c.t":["Why it cannot be bought piece by piece","为什么不能拆开买"],
"c.bk":["ONE TECHNOLOGY BASE","一套技术底座"],
"o.t":["Where your money sits, phase by phase","你的钱在每个阶段的位置"],
"o.s":["Your cash exposure, drawn honestly. It stays at zero until the bank itself confirms the savings are real.","如实画出你的现金敞口。在银行自己确认节省属实之前，它都是零。"],
"o.gh":["And if Day 90 falls short","如果第90天不达标"],
"o.gp":["If your own measurement shows verified savings below the pilot cost, <b>we absorb the shortfall</b>. The pilot fee is credited or waived. Your downside is written down before a single sensor is installed.","如果你自己的测算显示已核验节省低于试点成本，<b>差额由我方吸收</b>。试点费抵扣或豁免。你的下行风险在装第一个传感器之前就白纸黑字写清楚。"],
"k.t":["Put your own numbers in","把你自己的数字放进去"],
"k.s":["Every field starts empty. Drag the share to see exactly what AFFIN keeps.","每一栏都从空白开始。拖动分成比例，看AFFIN到底拿走多少。"],
"k.ta":["Track A · Hard savings","A轨 · 硬节省"],"k.tb":["Track B · Avoided loss","B轨 · 避免损失"],
"k.src":["Each Track B coefficient traces to a stated reference result: B1 interdiction of flagged exposure, B3 loan-loss reduction 25–35%, B2 recovery uplift 15–20%, post-loan verification effort −55–70%. Reported as loss avoidance, never added to Track A.","B轨每个系数都可追溯到已列明的参考成效：B1对已标记敞口的拦截、B3贷款损失降低25–35%、B2回收率提升15–20%、贷后核验工作量−55–70%。以损失避免列示，绝不与A轨相加。"],
"k.share":["Our share of verified savings","我方在已核验节省中的分成"],
"k.impl":["Year-1 implementation cost borne by AFFIN (RM)","AFFIN承担的第一年实施成本 (RM)"],
"k.o1":["Gross annual benefit","年度总收益"],"k.o2":["AFFIN keeps","AFFIN拿走"],"k.o2d":["after our share &amp; cost","扣除我方分成与成本"],
"k.o3":["Our share","我方分成"],"k.o3d":["only on verified savings","仅按已核验节省"],"k.o4":["Benefit-to-Cost","收益成本比"],"k.o4d":["base case","基准情景"],
"f.t":["B1 — the one with the biggest loss behind it","B1 —— 背后损失最大的那一个"],
"f.s":["Drawdown runs ahead of the concrete. You find out months later. This closes that gap.","提款跑在混凝土前面，你几个月后才发现。这个模块把这段差距关掉。"],
"f.gt":["Drawdown vs verified physical progress","提款 vs 已核验实体进度"],
"f.g1":["Physical progress","实体进度"],"f.g2":["Cumulative drawdown","累计提款"],
"f.gf":["19-point gap. Release held pending an exception visit. Your committee still decides — it just decides on better evidence.","19个百分点差距。暂缓放款，等待异常现场核查。委员会依然做决定 —— 只是决定所依据的证据更好。"],
"f.more":["The risk model scales with building size","风控模型随建筑体量分级"],
"f.bh":["Stated limit.","明示边界。"],
"f.bp":["Aerial capture cannot measure interior M&amp;E or fit-out. Those stages need milestone imagery, documents, fixed cameras and QS certification. We augment human judgement; we never replace it.","航拍无法测量室内机电与精装修。这些阶段需要里程碑影像、文件、固定相机与工料测量师认证。我们增强人的判断，绝不取代。"],
"w.k":["THE TECHNOLOGY IS BUILT BY A LISTED COMPANY","技术由一家上市公司建造"],
"w.p":["北京云星宇交通科技股份有限公司 · Beijing Stock Exchange. Twenty-eight years, 400+ registered IP rights, RMB 3.0bn of contracts across 30 provinces. A listed company's capability claims carry legal consequence.","北京云星宇交通科技股份有限公司 · 北京证券交易所。二十八年，400+项知识产权，30亿元合同额，覆盖全国30省。上市公司对能力的陈述是要负法律责任的。"],
"w.more":["External results — graded, not asserted","外部成效 —— 分级列示，不作断言"],
"w.ef":["The pilot exists precisely so AFFIN never has to rely on any of these.","试点的存在，正是为了让AFFIN完全不必依赖这些数字。"],
"d.t":["Ninety days, then you decide","九十天，然后你决定"],
"v.t":["The questions you are about to ask","你接下来会问的问题"],
"a.k":["WHAT WE ARE ASKING FOR TODAY","我们今天请求的"],
"a.t":["Approve the diagnostic.<br>That is the whole ask.","批准诊断阶段。<br>就这一件事。"],
"a.c":["The only thing AFFIN risks by starting is finding out how much it has been overpaying.","AFFIN开始这件事唯一的风险，是发现自己一直多付了多少钱。"],
"ft.d":["Reduction bands and external case results are the delivery partner's model and partner-provided data, pending independent verification, shown for planning and capability reference only. All ringgit figures are generated from inputs entered by the reader — no result is presented as achieved until measured and confirmed by AFFIN. Commercial terms are indicative and subject to written agreement.","降幅区间与外部案例成效为交付方模型及合作方提供数据，待独立核验，仅用于规划与能力参考。所有令吉数字均由阅读者输入生成 —— 在AFFIN测算并确认之前，任何成效都不作为已实现列示。商业条款为指示性，以书面协议为准。"],
"ft.date":["July 2026","2026年7月"],
"lbl.now":["Now","现在"],"lbl.after":["After","之后"],
};

/* ══ RENDER ══ */
let L=0;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const tx=a=>Array.isArray(a)?a[L]:a;
const rm=n=>'RM '+Math.round(n).toLocaleString('en-MY');

function ledger(){
 $('#ledger').innerHTML=LEDGER.map(r=>`<li class="lg">
   <span class="lg-c">${r[0]}</span>
   <span class="lg-t"><b>${tx(r[1])}</b><i>${tx(r[2])}</i></span>
   <span class="lg-b" data-n="${r[4][2]}">${r[3]}</span>
   <span class="lg-bar"><i style="width:${r[4][2]}%"></i></span></li>`).join('');
}
function cflow(){
 $('#cflow').innerHTML=CFLOW.map(f=>`<div class="cl">
   <span class="cl-a">${tx(f[0])}</span><span class="cl-x">→</span><span class="cl-b">${tx(f[1])}</span>
   <em>${tx(f[2])}</em></div>`).join('');
 $('#cbase').innerHTML=CBASE.map(b=>`<li>${tx(b)}</li>`).join('');
}
function expose(){
 $('#expose').innerHTML=EXPOSE.map(p=>`<article class="ex ${p[3]===0?'ex-zero':'ex-cap'}">
   <header><span class="ex-n">${p[0]}</span><div><b>${tx(p[1])}</b><i>${tx(p[2])}</i></div></header>
   <div class="ex-chart"><span class="ex-fill" style="height:${p[3]}%"></span><span class="ex-base"></span></div>
   <div class="ex-tag">${tx(p[5])}</div>
   <p>${tx(p[4])}</p></article>`).join('');
}
function pills(){ $('#pills').innerHTML=PILLS.map(p=>`<li>${tx(p)}</li>`).join(''); }
function mtable(){ $('#mtable').innerHTML='<thead><tr>'+MTAB[0].map(h=>`<th>${tx(h)}</th>`).join('')+'</tr></thead><tbody>'+
 MTAB.slice(1).map(r=>'<tr>'+r.map((c,i)=>`<td${i===0?' class="sc"':''}>${tx(c)}</td>`).join('')+'</tr>').join('')+'</tbody>'; }
function whorow(){ $('#whorow').innerHTML=WHOROW.map(w=>`<div><b>${w[0]}</b><span>${tx(w[1])}</span></div>`).join(''); }
function evtable(){ $('#evtable').innerHTML='<thead><tr>'+EV[0].map(h=>`<th>${tx(h)}</th>`).join('')+'</tr></thead><tbody>'+
 EV.slice(1).map(r=>`<tr><td class="sc">${tx(r[0])}</td><td>${tx(r[1])}</td><td>${tx(r[2])}</td><td><span class="gd-${r[3]}">${r[3]}</span></td></tr>`).join('')+'</tbody>'; }
function tline(){ $('#tline').innerHTML=TL.map((t,i)=>`<div class="tl"><span class="tl-n">${i+1}</span><span class="tl-w">${tx(t[0])}</span><h4>${tx(t[1])}</h4><p>${tx(t[2])}</p></div>`).join(''); }
function acc(){ $('#acc').innerHTML=OBJ.map(o=>`<details class="ac"><summary>${tx(o[0])}</summary><p>${tx(o[1])}</p></details>`).join(''); }
function asks(){ $('#asks').innerHTML=ASKS.map((a,i)=>`<li><span>${i+1}</span><div><b>${tx(a[0])}</b><p>${tx(a[1])}</p></div></li>`).join(''); }
function calcInputs(){
 $('#inA').innerHTML=CALCA.map((c,i)=>`<label><span class="il">${tx(c[1])} (RM)<i>A${i+1} · ${c[2][0]}–${c[2][2]}%</i></span><input type="number" id="${c[0]}" placeholder="0" min="0"></label>`).join('');
 $('#inB').innerHTML=CALCB.map(c=>`<label><span class="il">${tx(c[1])}${c[3]==='%'?' (%)':' (RM)'}${c[2]?`<i>${c[4]} · ${c[2][0]}–${c[2][2]}%</i>`:''}</span><input type="number" id="${c[0]}" placeholder="0" min="0"${c[3]==='%'?' max="100"':''}></label>`).join('');
 $$('.cin-grid input').forEach(i=>i.addEventListener('input',calc));
}
let CT='a';
const v=id=>{const e=document.getElementById(id);return e?Math.max(0,parseFloat(e.value)||0):0;};
function calc(){
 let lo=0,bs=0,hi=0;
 if(CT==='a'){CALCA.forEach(c=>{const x=v(c[0]);lo+=x*c[2][0]/100;bs+=x*c[2][1]/100;hi+=x*c[2][2]/100;});}
 else{const ex=v('ib1')*v('ib2')/100,ls=v('ib3'),np=v('ib4'),ip=v('ib5');
  lo=ex*.15+ls*.25+np*.15+ip*.55; bs=ex*.30+ls*.30+np*.175+ip*.65; hi=ex*.45+ls*.35+np*.20+ip*.70;}
 const sh=+$('#share').value,im=v('impl'),us=bs*sh/100,bank=bs-us-im,cost=us+im;
 $('#oGross').textContent=rm(bs);
 $('#oGrossR').textContent=bs?rm(lo)+' – '+rm(hi):'—';
 $('#oBank').textContent=rm(bank); $('#oBank').classList.toggle('neg',bank<0);
 $('#oUs').textContent=rm(us);
 $('#oBcr').textContent=cost>0?(bs/cost).toFixed(2)+'×':'—';
}
function render(){
 document.documentElement.lang=L?'zh':'en';
 $$('[data-t]').forEach(e=>{const k=e.getAttribute('data-t');if(T[k])e.innerHTML=T[k][L];});
 $$('.lang button').forEach(b=>b.classList.toggle('on',(b.dataset.l==='zh')===!!L));
 document.getElementById('app').classList.toggle('zh',!!L);
 ledger();cflow();expose();pills();mtable();whorow();evtable();tline();acc();asks();
 const keep={};CALCA.concat(CALCB).forEach(c=>{const e=document.getElementById(c[0]);if(e)keep[c[0]]=e.value;});
 calcInputs();
 Object.keys(keep).forEach(k=>{const e=document.getElementById(k);if(e)e.value=keep[k];});
 calc();
}
/* wiring */
$$('.lang button').forEach(b=>b.onclick=()=>{L=b.dataset.l==='zh'?1:0;render();});
$$('.ct').forEach(b=>b.onclick=()=>{CT=b.dataset.c;$$('.ct').forEach(x=>x.classList.toggle('on',x===b));
 $$('.cpanel').forEach(p=>p.classList.toggle('on',p.dataset.c===CT));calc();});
$('#share').oninput=e=>{$('#shareOut').textContent=e.target.value+'%';calc();};
$('#impl').oninput=calc;
const spy=$$('.nav a'),secs=spy.map(a=>document.querySelector(a.getAttribute('href')));
addEventListener('scroll',()=>{const h=document.documentElement,m=h.scrollHeight-h.clientHeight;
 $('#prog').style.width=(m>0?h.scrollTop/m*100:0)+'%';
 let c=0;secs.forEach((s,i)=>{if(s&&s.getBoundingClientRect().top<=140)c=i;});
 spy.forEach((a,i)=>a.classList.toggle('here',i===c));},{passive:true});
/* reveal + animate bars/gauges once */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{threshold:.12});
function observe(){$$('.sec,.stop,.band,.ask,.hin>*').forEach(e=>{e.classList.add('rev');io.observe(e);});}
const gio=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){
 e.target.querySelectorAll('.gb i').forEach(i=>i.style.width=i.dataset.w+'%');gio.unobserve(e.target);}}),{threshold:.4});
render();observe();
const g=document.querySelector('.gauge'); if(g) gio.observe(g);
