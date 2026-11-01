import { createClient } from '@supabase/supabase-js';
import qrcode from 'qrcode-generator';


const today=()=>new Date().toLocaleDateString('en-CA');
const dayOf=ts=>new Date(ts).toLocaleDateString('en-CA');
const fmt=n=>String(Math.round(n||0)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const usd=n=>'$'+(Math.round((n||0)*100)/100).toFixed(2);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,9);
const STATUSES=[['qabul','Qabul qilindi'],['diag','Diagnostika'],['tamir',"Ta'mirda"],['tayyor','Tayyor'],['berildi','Topshirildi']];
const stName=k=>(STATUSES.find(s=>s[0]===k)||['',k])[1];

let S=null;
const me=()=>S.users.find(u=>u.id===S.cur)||{id:S.cur,name:'?',role:'sotuvchi'};
const owner=()=>me().role==='owner';
const uName=id=>(S.users.find(u=>u.id===id)||{name:'—'}).name;
const ICONS={
 mening:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
 xodimlar:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.6 5.2"/>',
 sotuv:'<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16.5 5v14M20 5v14"/>',
 ombor:'<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
 ustaxona:'<path d="M14.5 6.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2z"/>',
 nasiya:'<path d="M12 3v18M16.5 7.5C16 6 14.3 5 12 5c-2.6 0-4.5 1.3-4.5 3.2 0 4.3 9 2.3 9 6.6 0 2-2 3.2-4.5 3.2-2.4 0-4.2-1.1-4.7-2.8"/>',
 mijozlar:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.8-1.7 2-2.5 3.5-2.5s2.7.8 3.5 2.5M15 9h3M15 13h3"/>',
 rasxod:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/><path d="M6 6l9-3 1 3"/>',
 qarz:'<path d="M4 4h12l4 4v12H4z"/><path d="M8 11h8M8 15h5M15 4v4h4"/>',
 hisobot:'<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
 sozlamalar:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'};
const ROLES={owner:'Rahbar',usta:'Usta',sotuvchi:'Sotuvchi'};
const SKINS=[['yashil','Yashil',['#11704a','#e1f1e9','#eef2f0']],['kok',"Ko'k",['#1f5fae','#e2ebf7','#eef2f0']],['bordo','Bordo',['#9b2c3c','#f6e3e6','#eef2f0']],
 ['binafsha','Binafsha',['#5b3fa0','#ebe5f6','#eef2f0']],['grafit','Grafit (qora)',['#f0a830','#1b1e23','#121417']],['tun','Tun (qora)',['#4fd1c5','#121a30','#0b1020']]].slice(0,6);
const CATS={qism:'Ehtiyot qism',transport:'Transport',ovqat:'Ovqat',kommunal:'Kommunal / internet',ijara:'Ijara',oylik:'Oylik / avans',boshqa:'Boshqa'};
const canExp=()=>S.mods.expenses&&(owner()||me().canExpense);
const canReturn=()=>S.mods.returns!==false&&(owner()||me().canReturn);
const canCredit=()=>S.mods.credit!==false&&(owner()||me().canCredit);
const canDebt=()=>S.mods.debts!==false&&(owner()||me().canDebt);
const monthOf=ts=>dayOf(ts).slice(0,7);
function payroll(u){const p=S.payroll[u.id]||{};return {base:+p.base||0,kpiSum:+p.kpi_sum||0,total:+p.total||0,paid:+p.paid||0,left:+p.left_to_pay||0};}
const kpiLabel=u=>u.role==='usta'?'topshirilgan remontlar summasidan':(u.kpiBase==='tushum'?'savdo tushumidan':'savdo foydasidan');
const C128=('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '+
'221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '+
'231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '+
'314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '+
'111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '+
'114131 311141 411131 211412 211214 211232 2331112').split(' ');
function code128Svg(text,h){
  text=String(text); let vals;
  if(/^\d+$/.test(text)&&text.length%2===0&&text.length>=4){vals=[105];for(let i=0;i<text.length;i+=2)vals.push(+text.slice(i,i+2));}
  else{vals=[104];for(const ch of text){const c=ch.charCodeAt(0)-32;vals.push(c>=0&&c<95?c:0);}}
  let sum=vals[0];for(let i=1;i<vals.length;i++)sum+=vals[i]*i;vals.push(sum%103);vals.push(106);
  let x=10,bars='';
  for(const v of vals){const p=C128[v];for(let i=0;i<p.length;i++){const w=+p[i];if(i%2===0)bars+=`<rect x="${x}" y="0" width="${w}" height="${h}"/>`;x+=w;}}
  return `<svg class="bc" viewBox="0 0 ${x+10} ${h}" preserveAspectRatio="none" aria-label="Shtrix-kod ${esc(text)}" fill="#000">${bars}</svg>`;
}

const brandHtml=()=>{const n=esc(S.company.name||'');const i=n.indexOf('-');return i>0?n.slice(0,i)+'<i>-</i>'+n.slice(i+1):n;};
const LINE_NAMES={servis:'Servis',noutbuk:'Noutbuklar',kompyuter:'Kompyuterlar (korpus, gaming, qismlar)'};
const LINE_SHORT={servis:'Servis',noutbuk:'Noutbuk',kompyuter:'Kompyuter'};
const lineOf=k=>S.company.lines[k]||S.company.lines.kompyuter;
// Yo'nalish brendi: NOUTBUK SAVDOSI, KOMPYUTER.UZ; bo'sh bo'lsa kompaniya nomi
const brandOf=k=>(lineOf(k).brand||'').trim()||S.company.name;
const contactsHtml=k=>{const c=lineOf(k);return `<div class="contacts">${c.phone?`<b>Tel: ${esc(c.phone)}</b><br>`:''}${[c.telegram&&'TG '+esc(c.telegram),c.instagram&&'IG '+esc(c.instagram)].filter(Boolean).join(' · ')}</div>`;};
const PRESETS=['58x40','58x30','50x30','40x30','30x20','70x50'];
function sizeOpts(cur){return PRESETS.map(z=>`<option value="${z}" ${z===cur?'selected':''}>${z.replace('x',' × ')} mm</option>`).join('')+`<option value="custom" ${PRESETS.includes(cur)?'':'selected'}>Qo'lda kiritish</option>`;}
function dims(size){let [w,h]=String(size).split('x').map(Number);w=Math.min(120,Math.max(20,w||58));h=Math.min(120,Math.max(15,h||40));return [w,h];}
function sizeFields(pre,w,h){return `<label>O'lchami<select id="${pre}_size">${sizeOpts(w+'x'+h)}</select></label>
  <label>Eni (mm)<input id="${pre}_w" type="number" min="20" max="120" value="${w}" class="num"></label>
  <label>Bo'yi (mm)<input id="${pre}_h" type="number" min="15" max="120" value="${h}" class="num"></label>`;}
function readSize(pre,fromSel){const g=x=>document.getElementById(pre+'_'+x);
  const sel=g('size').value; if(sel!=='custom'&&fromSel){const [w,h]=dims(sel);g('w').value=w;g('h').value=h;}
  const [w,h]=dims(g('w').value+'x'+g('h').value); const m=w+'x'+h; if(PRESETS.includes(m)) g('size').value=m; else g('size').value='custom'; return m;}
function labelHtml(p,size,price){const c=lineOf(p.line);
  const [w,h]=dims(size), fs=Math.max(6.5,Math.min(w*.215,h*.31)).toFixed(1);
  return `<div class="label" style="width:${w}mm;height:${h}mm;font-size:${fs}px;--bch:${(h*.21).toFixed(1)}mm"><div class="lt"><span>${esc(brandOf(p.line))}</span><span>${esc(c.phone)}</span></div>
  <div class="ln">${esc(p.name)}</div>${price?`<div class="lp">${fmt(priceUzs(p))} <span style="font-size:.5em">so'm</span></div>`:''}
  <div>${code128Svg(p.barcode,40)}<div class="bn">${esc(p.barcode)}</div></div>
  <div class="lf">${c.telegram?`<div><b>Telegram</b> ${esc(c.telegram)}</div>`:''}${c.instagram?`<div><b>Instagram</b> ${esc(c.instagram)}</div>`:''}</div></div>`;}
function labelModal(id){
  const p=S.products.find(x=>x.id===id); if(!p.barcode){toast('Avval shtrix-kod kiriting');return;}
  const size=S.printers.labelW+'x'+S.printers.labelH; const [lw,lh]=dims(size);
  modal(`<h3>Etiketka: ${esc(p.name)}</h3>
  <div class="form">${sizeFields('lb',lw,lh)}
  <label>Nechta<input id="lb_n" type="number" min="1" max="200" value="${Math.max(1,p.qty)}" class="num"></label>
  <label class="full row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" id="lb_price" ${S.company.labelPrice?'checked':''} style="width:auto"> Narxni ko'rsatish</label></div>
  <div class="labels-sheet" id="lbSheet" data-p="${p.id}">${labelHtml(p,size,S.company.labelPrice)}</div>
  <p class="small muted" style="margin:0">Printer: ${esc(S.printers.label)}. Narx qo'yilsa, u bugungi kurs bo'yicha bo'ladi.</p>
  <div class="row" style="justify-content:flex-end"><button type="button" data-close>Yopish</button>${printBtn('labels')}</div>`);
}
const PAYN={naqd:'Naqd',karta:'Karta',otkazma:"O'tkazma",nasiya:'Nasiya'};
function receiptModal(sale){const c=S.company; const bl=sale.items[0]?.line||'kompyuter', bn=brandOf(bl);
  modal(`<h3>Sotuv cheki</h3><div class="ticket" ${tkAttr()}>
  <div class="hd"><b>${esc(bn)}</b><br>${bn!==c.name?esc(c.name)+' · ':''}${esc(c.sub)}</div><hr>
  <div class="kv"><span>Sana:</span><span>${new Date(sale.ts).toLocaleString('uz',{dateStyle:'short',timeStyle:'short'})}</span></div>
  <div class="kv"><span>Chek №:</span><span>${sale.no||''}</span></div>
  <div class="kv"><b>Chek berdi:</b><b>${esc(uName(sale.userId))}</b></div><hr>
  ${sale.items.map(i=>`<div>${esc(i.name)}</div><div class="kv"><span>${i.qty} × ${fmt(i.priceUzs)}</span><span>${fmt(i.qty*i.priceUzs)}</span></div>`).join('')}<hr>
  <div class="kv" style="font-size:13px;font-weight:800"><span>JAMI:</span><span>${fmt(sale.totalUzs)} so'm</span></div>
  <div class="kv"><span>To'lov:</span><span>${esc(PAYN[sale.pay]||sale.pay)}</span></div><hr>
  ${sale.pay==='nasiya'?(()=>{const d=S.cdebts.find(x=>x.saleId===sale.id); return d?`<div class="kv"><span>Mijoz:</span><span>${esc(d.name)}</span></div><div class="kv"><span>Tel:</span><span>${esc(d.phone)}</span></div>
    <div class="kv"><span>To'landi:</span><span>${fmt(d.paid)}</span></div><div class="kv" style="font-weight:800"><span>QARZ:</span><span>${fmt(d.amount-d.paid)} so'm</span></div>
    <div class="kv"><span>Muddat:</span><span>${dmy(d.due)}</span></div><div style="margin-top:14px">Mijoz imzosi: ____________</div><hr>`:''})():''}
  ${[...new Set(sale.items.map(i=>i.line||'kompyuter'))].map(k=>contactsHtml(k)).join('<hr>')}<div class="c" style="margin-top:3px">Xaridingiz uchun rahmat!</div></div>
  <div class="row" style="justify-content:flex-end"><button type="button" data-close>Yopish</button>${printBtn('ticket')}</div>`);}
const tgUrl=h=>h?'https://t.me/'+h.replace(/^@/,''):'';
function qrSvg(text){try{const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:2,margin:0,scalable:true});}catch(e){return '';}}
const STK_TITLE={servis:'Servis xizmati',noutbuk:'Noutbuklar',kompyuter:'Kompyuterlar'};
function stickerHtml(o){const c=lineOf(o.line); const q=o.qr&&c.telegram?qrSvg(tgUrl(c.telegram)):'';
  let till='';if(+o.warranty){const d=new Date(o.from||Date.now());d.setMonth(d.getMonth()+(+o.warranty));till=d.toLocaleDateString('uz');}
  const [w,h]=dims(o.size), fs=Math.max(6,Math.min(w*.19,h*.275)).toFixed(1);
  return `<div class="stk ${q?'':'noqr'}" style="width:${w}mm;height:${h}mm;font-size:${fs}px;--qr:${Math.min(h*.36,w*.25).toFixed(1)}mm">
  <div><div class="sb">${esc(brandOf(o.line))}</div><div class="ss">${brandOf(o.line)!==S.company.name?esc(S.company.name):(STK_TITLE[o.line]||'')}</div>
  <div class="sp">${esc(c.phone)}</div><div class="so">${c.telegram?'TG '+esc(c.telegram):''}<br>${c.instagram?'IG '+esc(c.instagram):''}</div></div>
  ${q?`<div class="qr">${q}</div>`:''}
  <div class="sf"><span>${till?'Kafolat: '+till+' gacha':'Servis uchun murojaat qiling'}</span><span>${o.ref?esc(o.ref):''}</span></div></div>`;}
let stkCtx={};
function stickerModal(ctx){stkCtx=ctx;
  modal(`<h3>Yopishtirgich${ctx.ref?' · '+esc(ctx.ref):''}</h3>
  <div class="form">
    <label>Yo'nalish<select id="sk_line">${Object.keys(STK_TITLE).map(k=>`<option value="${k}" ${k===ctx.line?'selected':''}>${STK_TITLE[k]}</option>`).join('')}</select></label>
    ${sizeFields('sk',S.printers.stkW,S.printers.stkH)}
    <label>Kafolat<select id="sk_war"><option value="0">Yo'q</option><option value="1">1 oy</option><option value="3">3 oy</option><option value="6">6 oy</option><option value="12">12 oy</option></select></label>
    <label>Nechta<input id="sk_n" type="number" min="1" max="100" value="1" class="num"></label>
    <label class="full row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" id="sk_qr" checked style="width:auto"> Telegram QR kod</label>
  </div>
  <div class="labels-sheet" id="skSheet"></div>
  <p class="small muted" style="margin:0">QR kod skanerlansa, tanlangan yo'nalishning Telegram sahifasi ochiladi. Printer: ${esc(S.printers.label)}.</p>
  <div class="row" style="justify-content:flex-end"><button type="button" data-close>Yopish</button>${printBtn('stickers')}</div>`);
  document.getElementById('sk_war').value=ctx.warranty||'0'; drawStickers();}
function drawStickers(fromSel){const g=id=>document.getElementById(id); if(!g('skSheet')) return;
  const o={line:g('sk_line').value,size:readSize('sk',fromSel),warranty:g('sk_war').value,qr:g('sk_qr').checked,ref:stkCtx.ref,from:stkCtx.from};
  const n=Math.min(100,Math.max(1,+g('sk_n').value||1)); g('skSheet').innerHTML=Array(Math.min(n,12)).fill(stickerHtml(o)).join('')+(n>12?`<p class="small muted" style="width:100%;text-align:center;margin:0">… jami ${n} ta</p>`:'');}
function dayReport(d){
  const ss=S.sales.filter(s=>dayOf(s.ts)===d), ex=S.mods.expenses?S.expenses.filter(e=>dayOf(e.ts)===d):[];
  const rp=S.repairs.filter(r=>r.status==='berildi'&&r.doneTs&&dayOf(r.doneTs)===d), rin=S.repairs.filter(r=>dayOf(r.ts)===d);
  const sum=(l,f)=>l.reduce((a,x)=>a+f(x),0);
  const pay={}; ss.forEach(s=>pay[s.pay]=(pay[s.pay]||0)+s.totalUzs);
  const cats={}; ex.forEach(e=>cats[e.cat]=(cats[e.cat]||0)+e.amountUzs);
  const rev=sum(ss,s=>s.totalUzs), rep=sum(rp,r=>+r.feeUzs||0), exp=sum(ex,e=>e.amountUzs), prof=sum(ss,saleProfit);
  return {d,ss,ex,rp,rin,pay,cats,rev,rep,exp,prof,cash:rev+rep-exp};
}
function reportText(R){
  const L=[`📊 ${S.company.name} · ${R.d.split('-').reverse().join('.')} kunlik hisobot`,'',
  `🛒 Sotuv: ${R.ss.length} ta · ${fmt(R.rev)} so'm`,
  ...Object.entries(R.pay).map(([k,v])=>`   ${k}: ${fmt(v)}`),
  `🔧 Remont: qabul ${R.rin.length} ta · topshirildi ${R.rp.length} ta · ${fmt(R.rep)} so'm`,
  `💸 Rasxod: ${R.ex.length} ta · ${fmt(R.exp)} so'm`,
  ...Object.entries(R.cats).map(([k,v])=>`   ${CATS[k]}: ${fmt(v)}`),
  '',`💰 Kassa qoldig'i: ${fmt(R.cash)} so'm`];
  if(S.tg.profit) L.push(`📈 Sof foyda: ${fmt(R.prof+R.rep-R.exp)} so'm`);
  L.push(`💵 Kurs: 1$ = ${fmt(S.rate)} so'm`);
  return L.join('\n');
}
function drawReport(cv,R){
  const W=900,H=560,dpr=1; cv.width=W;cv.height=H; const x=cv.getContext('2d');
  const cs=getComputedStyle(document.documentElement), acc=cs.getPropertyValue('--accent').trim()||'#0f7a4f';
  x.fillStyle='#0d1411';x.fillRect(0,0,W,H);
  x.fillStyle='rgba(255,255,255,.06)';for(let i=14;i<W;i+=22)for(let j=14;j<H;j+=22){x.beginPath();x.arc(i,j,1.4,0,7);x.fill();}
  x.fillStyle='#fff';x.font='800 38px Unbounded, Arial Black, sans-serif';x.fillText(S.company.name,48,78);
  x.fillStyle='rgba(255,255,255,.65)';x.font='500 22px Onest, sans-serif';x.fillText('Kunlik hisobot · '+R.d.split('-').reverse().join('.'),48,114);
  const items=[['Sotuv',R.rev,acc],['Remont',R.rep,'#6ea6ee'],['Rasxod',R.exp,'#f07d81']];
  const max=Math.max(1,...items.map(i=>i[1]));
  items.forEach(([n,v,c],i)=>{const y=170+i*92;
    x.fillStyle='rgba(255,255,255,.75)';x.font='600 22px Onest, sans-serif';x.fillText(n,48,y);
    x.fillStyle='rgba(255,255,255,.08)';x.fillRect(48,y+14,560,30);
    x.fillStyle=c;x.fillRect(48,y+14,Math.max(4,560*v/max),30);
    x.fillStyle='#fff';x.font='700 26px JetBrains Mono, monospace';x.textAlign='right';x.fillText(fmt(v),852,y+40);x.textAlign='left';});
  x.strokeStyle='rgba(255,255,255,.2)';x.setLineDash([6,6]);x.beginPath();x.moveTo(48,458);x.lineTo(852,458);x.stroke();x.setLineDash([]);
  x.fillStyle='rgba(255,255,255,.7)';x.font='600 22px Onest, sans-serif';x.fillText("Kassa qoldig'i",48,510);
  x.fillStyle='#fff';x.font='800 40px Unbounded, Arial Black, sans-serif';x.textAlign='right';x.fillText(fmt(R.cash)+" so'm",852,514);x.textAlign='left';
}
function reportModal(){
  const R=dayReport(today());
  modal(`<h3>Bugungi hisobot</h3>
  <canvas id="repCv" style="width:100%;border-radius:10px;display:block"></canvas>
  <pre style="white-space:pre-wrap;margin:0;font-family:var(--sans);font-size:14px;background:var(--sunk);padding:12px;border-radius:10px;border:1px solid var(--line)">${esc(reportText(R))}</pre>
  <p class="note" style="margin:0">Guruhga shunga o'xshash rasm va matn yuboriladi. Ma'lumotlar bugungi sotuv va rasxodlardan olingan.</p>
  <div class="row" style="justify-content:flex-end"><button data-close class="pri">Yopish</button></div>`);
  drawReport(document.getElementById('repCv'),R);
}
function genBarcode(){let b;do{b='20'+String(Date.now()).slice(-8)+String(Math.floor(Math.random()*90+10));}while(S.products.some(p=>p.barcode===b));return b;}
function applySkin(){document.documentElement.dataset.skin=S.skin||'yashil';}
const priceUzs=p=>Math.ceil(p.sellUsd*S.rate/1000)*1000;
let cart=[]; let tab='sotuv'; let rFilter='aktiv'; let rSearch=''; let oSearch=''; let cSearch='';

function toast(t){const el=document.getElementById('toast');el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>el.hidden=true,2600);}

function header(){
  const chip=document.getElementById('rateChip');
  document.getElementById('brandRail').innerHTML=brandHtml(); document.getElementById('brandMob').innerHTML=brandHtml();
  document.getElementById('brandSub').textContent=S.company.sub||''; document.getElementById('footPhone').textContent=lineOf('servis').phone||'';
  document.getElementById('footSoc').textContent=lineOf('servis').telegram||'';
  const stale=S.rateDate!==today();
  chip.className='chip '+(stale?'warn':'ok');
  chip.innerHTML=`1$ = <span class="num">${fmt(S.rate)}</span> so'm${stale?' · bugun yangilanmagan':''}${owner()?' <span aria-hidden="true">✎</span>':''}`;
  chip.title=owner()?"Kursni o'zgartirish uchun bosing":'';
  let cc=document.getElementById('credChip');
  if(!cc){cc=document.createElement('button');cc.id='credChip';cc.type='button';cc.className='chip bad';chip.parentNode.insertBefore(cc,chip);}
  const od=canCredit()?S.cdebts.filter(d=>!d.closed&&d.due&&d.due<today()):[];
  cc.hidden=!od.length; cc.innerHTML=`⚠ ${od.length} ta nasiya muddati o'tgan`;
  document.getElementById('roleBtn').innerHTML=`<span class="ava">${esc(me().name.trim()[0]||'?').toUpperCase()}</span><span><span class="who">${esc(me().name)}</span> <span class="muted small">· ${ROLES[me().role]}</span></span>`;
  const tabs=[['mening','Mening blokim'],['sotuv','Sotuv'],['ombor','Ombor'],['ustaxona','Ustaxona'],['mijozlar','Mijozlar']];
  if(canExp()) tabs.push(['rasxod','Rasxodlar']);
  if(canCredit()) tabs.splice(tabs.findIndex(t=>t[0]==='mijozlar')+1,0,['nasiya','Nasiya']);
  if(canDebt()) tabs.push(['qarz','Qarzlar']);
  if(owner()) {tabs[0]=['xodimlar','Xodimlar']; tabs.push(['hisobot','Hisobot']);}
  tabs.push(['sozlamalar','Sozlamalar']);
  if(!tabs.some(t=>t[0]===tab)) tab=tabs[0][0];
  document.getElementById('tabs').innerHTML=tabs.map(([k,n])=>`<a href="#${k}" class="${k===tab?'on':''}" ${k===tab?'aria-current="page"':''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]||''}</svg><span>${n}</span></a>`).join('');
  const cur=tabs.find(t=>t[0]===tab); document.getElementById('pageTitle').textContent=cur?cur[1]:'';
  document.getElementById('pageDate').textContent=new Date().toLocaleDateString('uz-UZ',{weekday:'long',day:'numeric',month:'long'});
}

/* ---------- SOTUV ---------- */
function vSotuv(){
  if(!saleDate) saleDate=today(); if(!histDay) histDay=today();
  const total=cart.reduce((a,c)=>a+c.priceUzs*c.qty,0);
  return `<div class="grid2">
  <section class="panel">
    <h2>Shtrix-kod orqali sotish</h2>
    <form id="scanF" class="scan"><input id="scanIn" autocomplete="off" placeholder="Skanerlang yoki nomini yozing…"><button class="pri">Qo'shish</button></form>
    <div id="sugg" class="sugg"></div>
    <p class="small muted">Skaner bilan o'qing yoki nomini yozib Enter bosing. Narx dollar kursi bo'yicha so'mda chiqadi.</p>
  </section>
  <section class="panel">
    <h2>Savat</h2>
    ${cart.length?`<div class="tbl"><table><thead><tr><th>Tovar</th><th class="r">Soni</th><th class="r">Summa</th><th></th></tr></thead><tbody>
    ${cart.map((c,i)=>`<tr><td>${esc(c.name)}<div class="small muted num">${fmt(c.priceUzs)} so'm</div></td>
      <td class="r"><div class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="sm ghost" data-q="${i}" data-d="-1">−</button><span class="num">${c.qty}</span><button class="sm ghost" data-q="${i}" data-d="1">+</button></div></td>
      <td class="r num">${fmt(c.priceUzs*c.qty)}</td><td><button class="sm ghost" data-rm="${i}" aria-label="O'chirish">✕</button></td></tr>`).join('')}
    </tbody></table></div>`:`<p class="muted">Savat bo'sh. Tovarni skanerlang.</p>`}
    <div class="total"><span>Jami</span><span class="big">${fmt(total)} so'm</span></div>
    <div class="row" style="margin-top:12px">
      <select id="pay" style="width:auto"><option value="naqd">Naqd</option><option value="karta">Karta</option><option value="otkazma">O'tkazma</option>${canCredit()?'<option value="nasiya">Nasiya (qarzga)</option>':''}</select>
      <label class="row" style="gap:6px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)">Sana <input id="saleDate" type="date" value="${saleDate}" max="${today()}" style="width:auto"></label>
      <button class="pri" id="sellBtn" ${cart.length?'':'disabled'}>Sotish</button>
    </div>
    ${saleDate!==today()?`<p class="note" style="margin:10px 0 0">Sotuv <b>${saleDate}</b> kuniga yoziladi. Unutib qolgan sotuvlarni shu yo'l bilan kiriting.</p>`:''}
    ${payMode==='nasiya'?nasiyaFields(total):''}
  </section></div>
  ${salesHistory()}`;
}
let saleDate=null, histDay=null, extraSales={}, extraReturns={}, payMode='naqd', nas={phone:'',name:'',prepaid:'',due:'',note:''};
const addDays=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return x.toLocaleDateString('en-CA');};
const dmy=d=>d?d.split('-').reverse().join('.'):'';
const daysTo=d=>Math.round((new Date(d+'T12:00:00')-new Date(today()+'T12:00:00'))/864e5);
function clientDebt(phone){return S.cdebts.filter(d=>!d.closed&&d.phone===phone).reduce((a,d)=>a+d.amount-d.paid,0);}
function nasiyaFields(total){
  const days=+(S.credit?.days||30), lim=+(S.credit?.limit||0);
  if(!nas.due) nas.due=addDays(saleDate||today(),days);
  const owed=nas.phone?clientDebt(nas.phone.replace(/\s/g,'')):0, pre=+nas.prepaid||0, after=owed+total-pre;
  return `<div style="margin-top:12px;padding:12px;border:1px dashed var(--warn);border-radius:10px;display:grid;gap:10px;background:var(--warn-soft)">
    <b style="color:var(--warn)">Nasiya: mijoz ma'lumotlari</b>
    <div class="form">
      <label>Telefon<input id="ns_phone" required inputmode="tel" list="phonesN" value="${esc(nas.phone)}" placeholder="+998 90 123 45 67"></label>
      <datalist id="phonesN">${S.clients.map(c=>`<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('')}</datalist>
      <label>Ism<input id="ns_name" required value="${esc(nas.name)}"></label>
      <label>Oldindan to'lov (so'm)<input id="ns_pre" type="number" min="0" step="1000" value="${esc(nas.prepaid)}" class="num" placeholder="0"></label>
      <label>To'lash muddati<input id="ns_due" type="date" value="${nas.due}" min="${today()}"></label>
      <label class="full">Izoh<input id="ns_note" value="${esc(nas.note)}" placeholder="pasport, kafil, kelishuv…"></label>
    </div>
    <div class="row small" style="gap:14px">
      <span>Qarzga qoladi: <b class="num">${fmt(Math.max(total-pre,0))}</b></span>
      ${owed?`<span style="color:var(--bad)">Eski qarzi: <b class="num">${fmt(owed)}</b></span>`:''}
      ${lim?`<span class="${after>lim?'':'muted'}" style="${after>lim?'color:var(--bad);font-weight:600':''}">Chegara: ${fmt(lim)}${after>lim?(owner()?' · oshib ketdi (rahbar sifatida ruxsat)':' · oshib ketdi'):''}</span>`:''}
    </div></div>`;
}
function daySales(d){return (extraSales[d]||S.sales).filter(s=>dayOf(s.ts)===d);}
function dayReturns(d){return (extraReturns[d]||S.returns).filter(r=>dayOf(r.ts)===d);}
const returnedQty=itemId=>[...S.returns,...Object.values(extraReturns).flat()].filter((r,i,a)=>r.itemId===itemId&&a.findIndex(x=>x.id===r.id)===i).reduce((a,r)=>a+r.qty,0);
function salesHistory(){
  const d=histDay, list=daySales(d), rets=dayReturns(d);
  const rev=list.reduce((a,s)=>a+s.totalUzs,0), back=rets.reduce((a,r)=>a+r.refund,0);
  return `<section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:12px">
    <h2 style="margin:0">${d===today()?'Bugungi sotuvlar':'Sotuvlar · '+d}</h2>
    <input id="histDay" type="date" value="${d}" max="${today()}" style="width:auto"></div>
    <div class="row small" style="margin-bottom:10px;gap:14px"><span>Sotuv: <b class="num">${fmt(rev)}</b></span>${back?`<span>Vazvrat: <b class="num" style="color:var(--bad)">−${fmt(back)}</b></span><span>Sof: <b class="num">${fmt(rev-back)}</b></span>`:''}</div>
    ${salesTable(list)}
    ${rets.length?`<h2 style="margin:18px 0 10px">Vazvratlar</h2><div class="tbl"><table><thead><tr><th>Tovar</th><th class="r">Soni</th><th class="r">Qaytarilgan pul</th><th>Sabab</th><th>Kim</th></tr></thead><tbody>
      ${rets.map(r=>`<tr><td>${esc(r.name)}<div class="small muted">sotuv №${r.saleNo||''}</div></td><td class="r num">${r.qty}</td><td class="r num">−${fmt(r.refund)}</td><td>${esc(r.reason)}</td><td>${esc(uName(r.userId))}</td></tr>`).join('')}
      </tbody></table></div>`:''}</section>`;
}
function returnModal(saleId){
  const s=[...S.sales,...Object.values(extraSales).flat()].find(x=>x.id===saleId); if(!s) return;
  const rows=s.items.map(i=>({...i,left:i.qty-returnedQty(i.id)})).filter(i=>i.left>0);
  if(!rows.length) return toast("Bu sotuvdagi hamma tovar qaytarilgan");
  modal(`<h3>Vazvrat · sotuv №${s.no||''} (${dayOf(s.ts)})</h3>
  <form id="retF" style="display:grid;gap:10px">
    <label>Tovar<select id="rt_item">${rows.map(i=>`<option value="${i.id}" data-left="${i.left}">${esc(i.name)} — ${fmt(i.priceUzs)} so'm (qaytarish mumkin: ${i.left})</option>`).join('')}</select></label>
    <label>Soni<input id="rt_qty" type="number" min="1" max="${rows[0].left}" value="1" required class="num"></label>
    <label>Sababi<input id="rt_reason" placeholder="ishlamadi, mos kelmadi…"></label>
    <label>Vazvrat sanasi<input id="rt_date" type="date" value="${today()}" min="${dayOf(s.ts)}" max="${today()}"></label>
    <p class="small muted" style="margin:0">${s.pay==='nasiya'?"Nasiya sotuvi: mijozning qarzi kamayadi, ortiqcha to'langan bo'lsa naqd qaytariladi.":"Tovar omborga qaytadi, pul summasi kassadan ayriladi."}</p>
    <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri">Vazvrat qilish</button></div></form>`);
}
function salesTable(list){
  if(!list.length) return '<p class="muted">Hali sotuv yo\'q.</p>';
  return `<div class="tbl"><table><thead><tr><th>№ / vaqt</th><th>Tovarlar</th><th>Sotuvchi</th><th>To'lov</th><th class="r">Summa</th>${owner()?'<th class="r">Foyda</th>':''}<th></th></tr></thead><tbody>
  ${list.slice().reverse().map(s=>{const late=s.enteredTs&&dayOf(s.enteredTs)!==dayOf(s.ts);
    return `<tr><td class="num">${s.no?'№'+s.no:''}<div class="small muted">${late?'keyin kiritilgan':new Date(s.ts).toLocaleTimeString('uz',{hour:'2-digit',minute:'2-digit'})}</div></td>
  <td>${s.items.map(i=>{const b=returnedQty(i.id);return esc(i.name)+' ×'+i.qty+(b?` <span class="chip bad" style="font-size:11px;padding:1px 7px">${b} qaytgan</span>`:'');}).join('<br>')}</td><td>${esc(uName(s.userId))}</td><td>${esc(s.pay)}</td><td class="r num">${fmt(s.totalUzs)}</td>
  ${owner()?`<td class="r num">${fmt(saleProfit(s))}</td>`:''}
  <td><div class="row" style="flex-wrap:nowrap"><button class="sm" data-receipt="${s.id}">Chek</button>${canReturn()?`<button class="sm" data-return="${s.id}">Vazvrat</button>`:''}</div></td></tr>`}).join('')}</tbody></table></div>`;
}
const saleCost=s=>s.items.reduce((a,i)=>a+i.costUsd*i.rate*i.qty,0);
const saleProfit=s=>s.totalUzs-saleCost(s);
function addToCart(p){
  const inCart=cart.find(c=>c.id===p.id);
  const have=inCart?inCart.qty:0;
  if(have+1>p.qty){toast(`Omborda faqat ${p.qty} dona bor`);return;}
  if(inCart) inCart.qty++; else cart.push({id:p.id,name:p.name,line:p.line,qty:1,priceUzs:priceUzs(p),costUsd:p.costUsd});
  render(); setTimeout(()=>document.getElementById('scanIn')?.focus(),0);
}

/* ---------- OMBOR ---------- */
function vOmbor(){
  const q=oSearch.toLowerCase();
  const list=S.products.filter(p=>!q||p.name.toLowerCase().includes(q)||p.barcode.includes(q));
  const stockVal=S.products.reduce((a,p)=>a+p.costUsd*p.qty,0);
  return `${owner()?`<section class="panel"><h2>Kirim qilish</h2>
    <form id="kirimF" class="form">
      <label>Shtrix-kod<span class="row" style="flex-wrap:nowrap"><input id="k_bar" required inputmode="numeric" placeholder="Skanerlang"><button type="button" class="sm" id="genBar" title="Shtrix-kodi yo'q tovar uchun">Yaratish</button></span></label>
      <label class="full">Nomi<input id="k_name" required placeholder="Masalan: SSD Samsung 870 EVO 500GB"></label>
      <label>Yo'nalish (etiketka uchun)<select id="k_line"><option value="noutbuk">Noutbuk</option><option value="kompyuter" selected>Kompyuter / qism</option><option value="servis">Servis</option></select></label>
      <label>Soni<input id="k_qty" type="number" min="1" value="1" required></label>
      <label>Kelish narxi ($)<input id="k_cost" type="number" step="0.01" min="0" required></label>
      <label>Sotish narxi ($)<input id="k_sell" type="number" step="0.01" min="0" required></label>
      <div class="full row"><button class="pri">Omborga qo'shish</button><span class="small muted" id="k_hint">Bor shtrix-kod kiritilsa, soni qo'shiladi va narx yangilanadi.</span></div>
    </form></section>`:''}
  <section class="panel">
    <div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">Tovarlar qoldig'i</h2>
    ${owner()?`<span class="chip">Ombor qiymati: <span class="num">${usd(stockVal)}</span></span>`:''}</div>
    <input id="oSearch" placeholder="Qidirish: nomi yoki shtrix-kod" value="${esc(oSearch)}" style="margin-bottom:10px">
    <div class="tbl"><table><thead><tr><th>Nomi</th><th>Shtrix-kod</th><th class="r">Soni</th>${owner()?'<th class="r">Kelish $</th><th class="r">Sotish $</th>':''}<th class="r">Narxi (so'm)</th><th></th></tr></thead><tbody>
    ${list.map(p=>`<tr><td>${esc(p.name)}<div><span class="chip" style="font-size:11px;padding:1px 8px;margin-top:3px">${LINE_SHORT[p.line]||'Kompyuter'}</span></div></td><td class="num small">${esc(p.barcode)}</td>
    <td class="r">${p.qty<=2?`<span class="chip ${p.qty?'warn':'bad'} num">${p.qty}</span>`:`<span class="num">${p.qty}</span>`}</td>
    ${owner()?`<td class="r num">${usd(p.costUsd)}</td><td class="r num">${usd(p.sellUsd)}</td>`:''}
    <td class="r num">${fmt(priceUzs(p))}</td><td><div class="row" style="flex-wrap:nowrap"><button class="sm" data-label="${p.id}">Etiketka</button><button class="sm" data-stk="p${p.id}">Yopishtirgich</button></div></td></tr>`).join('')}
    </tbody></table></div>
    ${owner()?'':'<div class="lock" style="margin-top:12px">Kelish narxi va kirim faqat rahbar rejimida ko\'rinadi.</div>'}
  </section>`;
}

/* ---------- USTAXONA ---------- */
function vUstaxona(){
  const q=rSearch.toLowerCase().replace(/^t(?=\d)/,'');
  let list=S.repairs.slice().reverse();
  if(rFilter==='aktiv') list=list.filter(r=>r.status!=='berildi');
  else if(rFilter!=='hammasi') list=list.filter(r=>r.status===rFilter);
  if(q) list=list.filter(r=>String(r.talon).includes(q)||r.phone.includes(q)||r.name.toLowerCase().includes(q)||(r.model||'').toLowerCase().includes(q));
  return `<section class="panel"><h2>Qurilma qabul qilish · keyingi talon <span class="talonno">№${S.nextTalon}</span></h2>
    <form id="qabulF" class="form">
      <label>Telefon raqami<input id="r_phone" required inputmode="tel" placeholder="+998 90 123 45 67" list="phones"></label>
      <datalist id="phones">${S.clients.map(c=>`<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('')}</datalist>
      <label>Mijoz ismi<input id="r_name" required></label>
      <label>Qurilma<select id="r_dev"><option>Noutbuk</option><option>Kompyuter (sistema blok)</option><option>Monoblok</option><option>Printer</option><option>Monitor</option><option>Boshqa</option></select></label>
      <label>Modeli<input id="r_model" placeholder="Acer Aspire 5"></label>
      <label>Seriya raqami<input id="r_serial"></label>
      <label>Komplekt<input id="r_acc" placeholder="Zaryadka, sumka…"></label>
      <label class="full">Nosozlik sababi<textarea id="r_prob" required placeholder="Mijoz aytgan muammo"></textarea></label>
      <label>Taxminiy narx (so'm)<input id="r_fee" type="number" min="0" step="1000"></label>
      <label>Usta<select id="r_master">${S.users.filter(u=>u.role==='usta'&&u.active).map(u=>`<option value="${u.id}" ${u.id===S.cur?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>
      <div class="full row"><button class="pri">Qabul qilish va talon chiqarish</button></div>
    </form></section>
  <section class="panel">
    <div class="row" style="margin-bottom:10px">
      <select id="rFilter" style="width:auto"><option value="aktiv">Faol (topshirilmagan)</option>${STATUSES.map(s=>`<option value="${s[0]}">${s[1]}</option>`).join('')}<option value="hammasi">Hammasi</option></select>
      <input id="rSearch" placeholder="Talon №, telefon, ism…" value="${esc(rSearch)}" style="flex:1;min-width:160px">
    </div>
    <div class="tbl"><table><thead><tr><th>Talon</th><th>Mijoz</th><th>Qurilma / muammo</th><th>Holati</th><th class="r">Narx</th><th></th></tr></thead><tbody>
    ${list.map(r=>`<tr><td class="talonno">№${r.talon}<div class="small muted">${new Date(r.ts).toLocaleDateString('uz')}</div></td>
      <td>${esc(r.name)}<div class="small muted num">${esc(r.phone)}</div></td>
      <td>${esc(r.device)}${r.model?' · '+esc(r.model):''}<div class="small muted">${esc(r.problem)}</div><div class="small muted">Usta: ${esc(uName(r.masterId))}</div></td>
      <td><select data-st="${r.talon}" style="width:auto;padding:4px 8px" aria-label="Holati">${STATUSES.map(s=>`<option value="${s[0]}" ${s[0]===r.status?'selected':''}>${s[1]}</option>`).join('')}</select>
        <div style="margin-top:4px"><span class="status s-${r.status}">${stName(r.status)}</span></div></td>
      <td class="r"><input data-fee="${r.talon}" type="number" step="1000" min="0" value="${r.feeUzs||''}" style="width:110px;text-align:right" class="num" aria-label="Narx"></td>
      <td><div class="row" style="flex-wrap:nowrap"><button class="sm" data-talon="${r.talon}">Talon</button><button class="sm" data-stk="r${r.talon}">Yopishtirgich</button></div></td></tr>`).join('')||'<tr><td colspan="6" class="muted">Topilmadi</td></tr>'}
    </tbody></table></div>
  </section>`;
}
function tkAttr(){const w=Math.min(120,Math.max(40,+S.printers.receiptW||80));return `data-w="${w>=70?80:58}" style="width:${w}mm"`;}
function ticketHtml(r){
  return `<div class="ticket" ${tkAttr()}>
  <div class="hd"><b>${esc(brandOf('servis'))}</b><br>${esc(S.company.sub)}</div><hr>
  <div class="tn"><span>TALON</span><span class="bigno">№${r.talon}</span></div>
  <div class="kv"><span>${new Date(r.ts).toLocaleDateString('uz')}</span><span>${new Date(r.ts).toLocaleTimeString('uz',{hour:'2-digit',minute:'2-digit'})}</span></div>
  ${code128Svg('T'+r.talon,30)}<hr>
  <div class="f"><span>Mijoz</span><span>${esc(r.name)}</span><span>Tel</span><span>${esc(r.phone)}</span>
  <span>Qurilma</span><span>${esc(r.device)} ${esc(r.model||'')}</span>${r.serial?`<span>S/N</span><span>${esc(r.serial)}</span>`:''}
  ${r.acc?`<span>Komplekt</span><span>${esc(r.acc)}</span>`:''}<span>Muammo</span><span>${esc(r.problem)}</span>
  ${r.feeUzs?`<span>Narx ~</span><span>${fmt(r.feeUzs)} so'm</span>`:''}
  ${r.acceptedBy?`<span>Qabul qildi</span><span>${esc(uName(r.acceptedBy))}</span>`:''}${r.masterId?`<span>Usta</span><span>${esc(uName(r.masterId))}</span>`:''}</div><hr>
  ${contactsHtml('servis')}<div class="c" style="margin-top:3px">Qurilmani olishda talonni ko'rsating</div></div>`;
}
function showTalon(t){
  const r=S.repairs.find(x=>x.talon===t); if(!r) return;
  modal(`<h3>Talon №${r.talon}</h3>${ticketHtml(r)}
  <div class="row" style="justify-content:flex-end"><button type="button" data-close>Yopish</button>${printBtn('ticket')}</div>`);
}

/* ---------- MIJOZLAR ---------- */
function vMijozlar(){
  const q=cSearch.toLowerCase();
  const list=S.clients.filter(c=>!q||c.phone.includes(q)||c.name.toLowerCase().includes(q));
  return `<section class="panel"><h2>Mijozlar bazasi <span class="muted small">(${S.clients.length})</span></h2>
  <input id="cSearch" placeholder="Telefon yoki ism" value="${esc(cSearch)}" style="margin-bottom:10px">
  <div class="tbl"><table><thead><tr><th>Ism</th><th>Telefon</th><th class="r">Remontlar</th><th>Oxirgi talon</th>${canCredit()?'<th class="r">Nasiya qarzi</th>':''}</tr></thead><tbody>
  ${list.map(c=>{const rs=S.repairs.filter(r=>r.phone===c.phone);const last=rs[rs.length-1];
    return `<tr><td>${esc(c.name)}</td><td class="num">${esc(c.phone)}</td><td class="r num">${rs.length}</td>
    <td>${last?`<button class="sm" data-talon="${last.talon}">№${last.talon}</button> <span class="status s-${last.status}">${stName(last.status)}</span>`:'<span class="muted">—</span>'}</td>${canCredit()?(()=>{const o=clientDebt(c.phone);return `<td class="r num">${o?`<b style="color:var(--bad)">${fmt(o)}</b>`:'—'}</td>`;})():''}</tr>`}).join('')}
  </tbody></table></div></section>
  ${owner()?`<section class="panel"><h2>Daftardan mijozlarni ko'chirish</h2><form id="impClF" style="display:grid;gap:10px">
    <label>Har qatorga bitta mijoz: telefon; ism<textarea id="imp_txt" rows="6" placeholder="+998901234567; Akmal&#10;+998935551122; Dilnoza"></textarea></label>
    <div class="row"><button class="pri">Qo'shish</button><span class="small muted">Talon raqamini davom ettirish uchun Sozlamalarda "Keyingi talon raqami"ni qo'ying.</span></div></form></section>`:''}`;
}

/* ---------- HISOBOT ---------- */
function vHisobot(){
  if(!owner()) return `<section class="panel"><div class="lock">Bu bo'lim faqat rahbar uchun.</div></section>`;
  const days=[...Array(7)].map((_,i)=>{const d=new Date(Date.now()-i*86400000).toLocaleDateString('en-CA');
    const ss=S.sales.filter(s=>dayOf(s.ts)===d), rr=S.returns.filter(r=>dayOf(r.ts)===d);
    const back=rr.reduce((a,r)=>a+r.refund,0), backCost=rr.reduce((a,r)=>a+r.costUzs,0);
    const rev=ss.reduce((a,s)=>a+s.totalUzs,0)-back, prof=ss.reduce((a,s)=>a+saleProfit(s),0)-(back-backCost);
    const rep=S.repairs.filter(r=>r.status==='berildi'&&r.doneTs&&dayOf(r.doneTs)===d).reduce((a,r)=>a+(+r.feeUzs||0),0);
    const exp=S.mods.expenses?S.expenses.filter(e=>dayOf(e.ts)===d).reduce((a,e)=>a+e.amountUzs,0):0;
    return {d,cnt:ss.length,rev,prof,rep,exp,net:prof+rep-exp};});
  const t=days[0]; const w=days.reduce((a,x)=>({rev:a.rev+x.rev,prof:a.prof+x.prof,rep:a.rep+x.rep,exp:a.exp+x.exp,net:a.net+x.net}),{rev:0,prof:0,rep:0,exp:0,net:0});
  const max=Math.max(1,...days.map(x=>Math.abs(x.net)));
  return `<section class="panel"><h2>Bugun</h2><div class="stats">
    <div class="stat"><div class="k">Savdo tushumi</div><div class="v">${fmt(t.rev)}</div></div>
    <div class="stat"><div class="k">Savdo foydasi</div><div class="v pos">${fmt(t.prof)}</div></div>
    <div class="stat"><div class="k">Remont tushumi</div><div class="v">${fmt(t.rep)}</div></div>
    ${S.mods.expenses?`<div class="stat"><div class="k">Rasxodlar</div><div class="v">−${fmt(t.exp)}</div></div>`:''}
    <div class="stat"><div class="k">Sof foyda</div><div class="v pos">${fmt(t.net)}</div></div></div></section>
  <section class="panel"><h2>Oxirgi 7 kun <span class="muted small">· sof foyda ${fmt(w.net)} so'm</span></h2>
  <div class="tbl"><table><thead><tr><th>Sana</th><th class="r">Sotuvlar</th><th class="r">Tushum</th><th class="r">Savdo foydasi</th><th class="r">Remont</th>${S.mods.expenses?'<th class="r">Rasxod</th>':''}<th style="width:28%">Sof foyda</th></tr></thead><tbody>
  ${days.map(x=>`<tr><td class="num">${x.d}</td><td class="r num">${x.cnt}</td><td class="r num">${fmt(x.rev)}</td><td class="r num">${fmt(x.prof)}</td><td class="r num">${fmt(x.rep)}</td>${S.mods.expenses?`<td class="r num">${fmt(x.exp)}</td>`:''}
  <td><div style="display:flex;align-items:center;gap:8px"><div style="height:10px;border-radius:3px;background:${x.net<0?'var(--bad)':'var(--accent)'};width:${(Math.abs(x.net)/max*100).toFixed(1)}%;min-width:${x.net?2:0}px"></div><span class="num small">${fmt(x.net)}</span></div></td></tr>`).join('')}
  </tbody></table></div><p class="small muted">Savdo foydasi har bir sotuv vaqtidagi dollar kursi bo'yicha hisoblanadi.</p></section>`;
}

/* ---------- SOZLAMALAR ---------- */
function vSozlamalar(){
  return `${owner()?`<section class="panel"><h2>Firma ma'lumotlari</h2><form id="compF" class="form">
    <label>Firma nomi<input id="c_name" required value="${esc(S.company.name)}"></label>
    <label>Qisqa izoh<input id="c_sub" value="${esc(S.company.sub)}"></label>
    ${Object.keys(LINE_NAMES).map(k=>{const c=lineOf(k);return `<div class="full" style="display:grid;gap:8px;padding:12px;border:1px dashed var(--line);border-radius:10px">
      <b style="font-size:14px">${LINE_NAMES[k]} <span class="muted small" style="font-weight:400">· ${k==='servis'?'remont talonida chiqadi':'shu yo\'nalishdagi etiketka va chekda chiqadi'}</span></b>
      <div class="form"><label>Nomi (etiketka va chekda)<input id="c_${k}_brand" value="${esc(c.brand||'')}" placeholder="${esc(S.company.name)}"></label>
      <label>Telefon<input id="c_${k}_phone" value="${esc(c.phone)}" inputmode="tel"></label>
      <label>Telegram<input id="c_${k}_tg" value="${esc(c.telegram)}" placeholder="@kanal"></label>
      <label>Instagram<input id="c_${k}_ig" value="${esc(c.instagram)}" placeholder="@sahifa"></label></div></div>`;}).join('')}
    <label class="full row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" id="c_lblprice" ${S.company.labelPrice?'checked':''} style="width:auto"> Etiketkada narx odatda ko'rsatilsin</label>
    <div class="full row"><button class="pri">Saqlash</button></div>
  </form></section>`:''}
  <section class="panel"><h2>Mavzu (rang)</h2><div class="skins">
  ${SKINS.map(([k,n,c])=>`<button class="skin ${S.skin===k?'on':''}" data-skin="${k}"><span class="sw">${c.map(x=>`<i style="background:${x}"></i>`).join('')}</span><span>${n}</span></button>`).join('')}
  </div><p class="small muted">Mavzu shu qurilmada saqlanadi.</p></section>
  <section class="panel"><h2>Dollar kursi va talon</h2>
  ${owner()?`<form id="setF" class="form">
    <label>Bugungi kurs (1$ = so'm)<input id="s_rate" type="number" min="1" value="${S.rate}" class="num"></label>
    <label>Keyingi talon raqami<input id="s_talon" type="number" min="1" value="${S.nextTalon}" class="num"></label>
    <div class="full row"><button class="pri">Saqlash</button><span class="small muted">Talon raqamini daftardagi oxirgi raqamdan keyingisiga qo'ying, keyin avtomatik davom etadi.</span></div>
  </form>`:`<div class="lock">Kurs, talon raqami va PIN faqat rahbar rejimida o'zgartiriladi. Hozirgi kurs: <b class="num">${fmt(S.rate)}</b> so'm.</div>`}
  </section>
  ${owner()?`<section class="panel"><h2>Modullar</h2><div style="display:grid;gap:10px">
    <label class="row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" data-mod="expenses" ${S.mods.expenses?'checked':''} style="width:auto"> Kunlik rasxodlar</label>
    <label class="row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" data-mod="salary" ${S.mods.salary?'checked':''} style="width:auto"> Oylik va KPI hisobi</label>
    <label class="row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" data-mod="debts" ${S.mods.debts!==false?'checked':''} style="width:auto"> Tovar qarzlari</label>
    <label class="row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" data-mod="returns" ${S.mods.returns!==false?'checked':''} style="width:auto"> Vazvrat (tovarni qaytarish)</label>
    <label class="row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" data-mod="credit" ${S.mods.credit!==false?'checked':''} style="width:auto"> Nasiya (mijozlar qarzi)</label>
    <p class="small muted" style="margin:0">O'chirilgan modul hech kimga, xodimlarga ham ko'rinmaydi. Ma'lumotlar o'chmaydi.</p></div></section>`:''}
  ${owner()?`<section class="panel"><h2>Printerlar</h2><form id="prF" class="form">
    <label>Chek va talon printeri<input id="pr_r" value="${esc(S.printers.receipt)}"></label>
    <label>Chek qog'ozi eni (mm)<input id="pr_w" type="number" min="40" max="120" value="${esc(S.printers.receiptW)}" class="num" list="rwl"></label>
    <datalist id="rwl"><option value="80"><option value="58"><option value="57"><option value="76"></datalist>
    <label>Etiketka va stiker printeri<input id="pr_l" value="${esc(S.printers.label)}"></label>
    <label>Etiketka eni × bo'yi (mm)<span class="row" style="flex-wrap:nowrap"><input id="pr_lw" type="number" min="20" max="120" value="${S.printers.labelW}" class="num"><span>×</span><input id="pr_lh" type="number" min="15" max="120" value="${S.printers.labelH}" class="num"></span></label>
    <label>Stiker eni × bo'yi (mm)<span class="row" style="flex-wrap:nowrap"><input id="pr_sw" type="number" min="20" max="120" value="${S.printers.stkW}" class="num"><span>×</span><input id="pr_sh" type="number" min="15" max="120" value="${S.printers.stkH}" class="num"></span></label>
    <div class="full row"><button class="pri">Saqlash</button><span class="small muted">Har qanday o'lchamni qo'lda yozishingiz mumkin. Etiketka va stiker oynasida ham o'lchamni har safar o'zgartirsa bo'ladi.</span></div></form></section>`:''}
  ${owner()?`<section class="panel"><h2>Telegram</h2><form id="tgF" class="form">
      <label>Kunlik hisobot guruhi (ID)<input id="tg_group" value="${esc(S.tg.group)}" class="num"></label>
      <label>Yuborish vaqti<input id="tg_rt" type="time" value="${esc(S.tg.reportTime)}"></label>
      <label>Zaxira baza kanali (ID)<input id="tg_ch" value="${esc(S.tg.channel)}" class="num"></label>
      <label>Zaxira vaqti<input id="tg_bt" type="time" value="${esc(S.tg.backupTime)}"></label>
      <label class="full row" style="text-transform:none;letter-spacing:0;font-size:15px;color:var(--fg)"><input type="checkbox" id="tg_profit" ${S.tg.profit?'checked':''} style="width:auto"> Guruhga sof foydani ham yuborish</label>
      <div class="full row"><button class="pri">Saqlash</button><button type="button" id="repPrev">Hisobot namunasini ko'rish</button></div>
    </form>
    <p class="note" style="margin-top:12px">Har kuni ${esc(S.tg.reportTime)} da guruhga kunlik sotuv va rasxod (rasm + matn), ${esc(S.tg.backupTime)} da kanalga butun baza fayli yuboriladi. Mijozga "Tayyor" xabari ham Telegram va SMS orqali ketadi.</p></section>`:''}
  ${owner()?`<section class="panel"><h2>Zaxira</h2><p class="small muted" style="margin-top:0">Butun baza har kuni Telegram kanalga avtomatik yuboriladi. Qo'shimcha nusxa kerak bo'lsa:</p>
    <div class="row"><button id="copyDb">Ko'rinib turgan ma'lumotlarni nusxalash (JSON)</button></div></section>`:''}`;
}

/* ---------- XODIM BLOKI ---------- */
let viewUser=null;
function userBlock(u){
  const t=today(), mon=t.slice(0,7);
  const head=`<div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">${esc(u.name)} <span class="muted small">· ${ROLES[u.role]}</span></h2></div>`;
  if(u.role==='usta'){
    const mine=S.repairs.filter(r=>r.masterId===u.id);
    const act=mine.filter(r=>r.status!=='berildi').reverse();
    const doneMon=mine.filter(r=>r.status==='berildi'&&r.doneTs&&dayOf(r.doneTs).startsWith(mon));
    const ready=mine.filter(r=>r.status==='tayyor').length;
    return `<section class="panel">${head}<div class="stats">
      <div class="stat"><div class="k">Ishdagi qurilmalar</div><div class="v">${act.length}</div></div>
      <div class="stat"><div class="k">Tayyor, olib ketilmagan</div><div class="v">${ready}</div></div>
      <div class="stat"><div class="k">Shu oy topshirildi</div><div class="v">${doneMon.length}</div></div>
      <div class="stat"><div class="k">Shu oy ish summasi</div><div class="v">${fmt(doneMon.reduce((a,r)=>a+(+r.feeUzs||0),0))}</div></div></div></section>
    <section class="panel"><h2>Ishdagi qurilmalar</h2><div class="tbl"><table><thead><tr><th>Talon</th><th>Qurilma / muammo</th><th>Mijoz</th><th>Holati</th><th></th></tr></thead><tbody>
    ${act.map(r=>`<tr><td class="talonno">№${r.talon}<div class="small muted">${new Date(r.ts).toLocaleDateString('uz')}</div></td>
      <td>${esc(r.device)}${r.model?' · '+esc(r.model):''}<div class="small muted">${esc(r.problem)}</div></td>
      <td>${esc(r.name)}<div class="small muted num">${esc(r.phone)}</div></td>
      <td><select data-st="${r.talon}" style="width:auto;padding:4px 8px" aria-label="Holati">${STATUSES.map(s=>`<option value="${s[0]}" ${s[0]===r.status?'selected':''}>${s[1]}</option>`).join('')}</select></td>
      <td><button class="sm" data-talon="${r.talon}">Talon</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Hozir ishda qurilma yo\'q</td></tr>'}
    </tbody></table></div></section>`;
  }
  const mine=S.sales.filter(s=>s.userId===u.id);
  const td=mine.filter(s=>dayOf(s.ts)===t), mo=mine.filter(s=>dayOf(s.ts).startsWith(mon));
  const sum=l=>l.reduce((a,s)=>a+s.totalUzs,0);
  return `<section class="panel">${head}<div class="stats">
    <div class="stat"><div class="k">Bugun sotuvlar</div><div class="v">${td.length}</div></div>
    <div class="stat"><div class="k">Bugun tushum</div><div class="v">${fmt(sum(td))}</div></div>
    <div class="stat"><div class="k">Shu oy sotuvlar</div><div class="v">${mo.length}</div></div>
    <div class="stat"><div class="k">Shu oy tushum</div><div class="v">${fmt(sum(mo))}</div></div></div></section>
  <section class="panel"><h2>Bugungi sotuvlarim</h2>${salesTable(td)}</section>`;
}
function vMening(){
  if(me().role==='owner') return vXodimlar();
  return userBlock(me())+(S.mods.salary&&me().seeSalary?salaryCard(me()):'');
}
function vXodimlar(){
  if(!owner()) return `<section class="panel"><div class="lock">Bu bo'lim faqat rahbar uchun.</div></section>`;
  const vu=viewUser&&S.users.find(u=>u.id===viewUser);
  return `${vu?`<div class="row"><button class="sm" data-view="">← Barcha xodimlar</button></div>`+userBlock(vu):''}
  <section class="panel"><h2>Xodimlar</h2>
  <div class="tbl"><table><thead><tr><th>Ism</th><th>Lavozim</th><th class="r">Bugun</th><th class="r">Shu oy</th><th>Login</th><th></th></tr></thead><tbody>
  ${S.users.map(u=>{const mon=today().slice(0,7);let a='—',b='—';
    if(u.role==='usta'){const m=S.repairs.filter(r=>r.masterId===u.id);a=m.filter(r=>r.status!=='berildi').length+' ishda';b=m.filter(r=>r.status==='berildi'&&r.doneTs&&dayOf(r.doneTs).startsWith(mon)).length+' topshirildi';}
    if(u.role==='sotuvchi'){const m=S.sales.filter(s=>s.userId===u.id);a=fmt(m.filter(s=>dayOf(s.ts)===today()).reduce((x,s)=>x+s.totalUzs,0));b=fmt(m.filter(s=>dayOf(s.ts).startsWith(mon)).reduce((x,s)=>x+s.totalUzs,0));}
    return `<tr><td class="who">${esc(u.name)}</td><td>${ROLES[u.role]}</td><td class="r num">${a}</td><td class="r num">${b}</td><td class="num">${esc(u.login||'')}${u.active?'':' <span class="chip bad" style="font-size:11px;padding:1px 8px">o\'chirilgan</span>'}</td>
    <td><div class="row" style="flex-wrap:nowrap">${u.role!=='owner'?`<button class="sm" data-view="${u.id}">Blokini ko'rish</button><button class="sm" data-setpin="${u.id}">Tahrirlash</button>${u.active?`<button class="sm ghost" data-active="0" data-u="${u.id}">O'chirish</button>`:`<button class="sm" data-active="1" data-u="${u.id}">Yoqish</button>`}`:''}</div></td></tr>`}).join('')}
  </tbody></table></div></section>
  <section class="panel"><h2>Ruxsatlar</h2>
  <div class="tbl"><table><thead><tr><th>Xodim</th><th>Rasxod kiritish</th><th>Oyligini ko'rish</th><th>Qarz kiritish</th><th>Vazvrat</th><th>Nasiya</th></tr></thead><tbody>
  ${S.users.filter(u=>u.role!=='owner'&&u.active).map(u=>`<tr><td>${esc(u.name)}</td>
    <td><label class="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)"><input type="checkbox" data-perm="canExpense" data-u="${u.id}" ${u.canExpense?'checked':''} ${S.mods.expenses?'':'disabled'} style="width:auto"> ${u.canExpense?'Yoqilgan':"O'chiq"}</label></td>
    <td><label class="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)"><input type="checkbox" data-perm="seeSalary" data-u="${u.id}" ${u.seeSalary?'checked':''} ${S.mods.salary?'':'disabled'} style="width:auto"> ${u.seeSalary?'Yoqilgan':"O'chiq"}</label></td>
    <td><label class="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)"><input type="checkbox" data-perm="canDebt" data-u="${u.id}" ${u.canDebt?'checked':''} ${S.mods.debts!==false?'':'disabled'} style="width:auto"> ${u.canDebt?'Yoqilgan':"O'chiq"}</label></td>
    <td><label class="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)"><input type="checkbox" data-perm="canReturn" data-u="${u.id}" ${u.canReturn?'checked':''} ${S.mods.returns!==false?'':'disabled'} style="width:auto"> ${u.canReturn?'Yoqilgan':"O'chiq"}</label></td>
    <td><label class="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)"><input type="checkbox" data-perm="canCredit" data-u="${u.id}" ${u.canCredit?'checked':''} ${S.mods.credit!==false?'':'disabled'} style="width:auto"> ${u.canCredit?'Yoqilgan':"O'chiq"}</label></td></tr>`).join('')}
  </tbody></table></div>
  ${!S.mods.expenses||!S.mods.salary?'<p class="small muted">O\'chirilgan modullar Sozlamalarda yoqiladi.</p>':''}</section>
  ${S.mods.salary?`<section class="panel"><h2>Oylik hisobi · ${today().slice(0,7)}</h2>
  <div class="tbl"><table><thead><tr><th>Xodim</th><th class="r">Oklad</th><th class="r">KPI</th><th class="r">Hisoblangan</th><th class="r">Berilgan</th><th class="r">Qoldiq</th><th></th></tr></thead><tbody>
  ${S.users.filter(u=>u.role!=='owner'&&u.active).map(u=>{const p=payroll(u);
    return `<tr><td>${esc(u.name)}<div class="small muted">${u.kpi}% ${kpiLabel(u)}</div></td><td class="r num">${fmt(u.oklad)}</td><td class="r num">${fmt(p.kpiSum)}</td>
    <td class="r num">${fmt(p.total)}</td><td class="r num">${fmt(p.paid)}</td><td class="r num"><b>${fmt(p.left)}</b></td>
    <td><button class="sm" data-pay="${u.id}">Sozlash / to'lash</button></td></tr>`}).join('')}
  </tbody></table></div><p class="small muted">To'langan oylik avtomatik "Oylik / avans" rasxodi bo'lib yoziladi.</p></section>`:''}
  <section class="panel"><h2>Yangi xodim qo'shish</h2><form id="userF" class="form">
    <label>Ism<input id="u_name" required></label>
    <label>Lavozim<select id="u_role"><option value="usta">Usta</option><option value="sotuvchi">Sotuvchi</option></select></label>
    <label>Login (istalgan so'z)<input id="u_login" required maxlength="30" autocapitalize="none" placeholder="aziz"></label>
    <label>Parol (istalgan so'z yoki raqam)<input id="u_pin" required maxlength="30" autocapitalize="none" placeholder="masalan: 7 yoki ganiyev"></label>
    <div class="full row"><button class="pri">Qo'shish</button><span class="small muted">Xodim login va parol bilan kiradi, faqat o'z blokini ko'radi.</span></div>
  </form></section>`;
}

/* ---------- NASIYA (mijozlar qarzi) ---------- */
let nFilter='faol', nSearch='';
function dueBadge(d){
  if(d.closed) return '<span class="status s-tayyor">Yopilgan</span>';
  if(!d.due) return '<span class="muted small">muddatsiz</span>';
  const n=daysTo(d.due);
  if(n<0) return `<span class="chip bad" style="font-size:12px">${-n} kun o'tdi</span>`;
  if(n===0) return `<span class="chip warn" style="font-size:12px">bugun</span>`;
  if(n<=3) return `<span class="chip warn" style="font-size:12px">${n} kun qoldi</span>`;
  return `<span class="muted small num">${dmy(d.due)}</span>`;
}
function debtItems(d){const s=S.sales.find(x=>x.id===d.saleId); return s?s.items.map(i=>esc(i.name)+' ×'+i.qty).join(', '):(d.saleId?'sotuv':'daftardan');}
function vNasiya(){
  if(!canCredit()) return `<section class="panel"><div class="lock">Nasiya bo'limi sizga yoqilmagan. Rahbardan ruxsat so'rang.</div></section>`;
  const t=today(), open=S.cdebts.filter(d=>!d.closed);
  const left=d=>d.amount-d.paid;
  const over=open.filter(d=>d.due&&d.due<t), week=open.filter(d=>d.due&&d.due>=t&&daysTo(d.due)<=7);
  const inToday=S.cpays.filter(p=>dayOf(p.ts)===t).reduce((a,p)=>a+p.amount,0);
  const q=nSearch.toLowerCase();
  let list=S.cdebts.slice();
  if(nFilter==='faol') list=list.filter(d=>!d.closed); else if(nFilter==='otgan') list=over.slice(); else if(nFilter==='hafta') list=week.slice(); else if(nFilter==='yopiq') list=list.filter(d=>d.closed);
  if(q) list=list.filter(d=>(d.name+' '+d.phone+' '+d.note).toLowerCase().includes(q));
  list.sort((a,b)=>(a.closed-b.closed)||((a.due||'9')<(b.due||'9')?-1:1));
  const cr=S.credit||{};
  return `<section class="panel"><h2>Mijozlar qarzi (nasiya)</h2><div class="stats">
    <div class="stat"><div class="k">Jami qarz</div><div class="v">${fmt(open.reduce((a,d)=>a+left(d),0))}</div></div>
    <div class="stat"><div class="k">Muddati o'tgan · ${over.length} ta</div><div class="v" style="${over.length?'color:var(--bad)':''}">${fmt(over.reduce((a,d)=>a+left(d),0))}</div></div>
    <div class="stat"><div class="k">7 kun ichida · ${week.length} ta</div><div class="v">${fmt(week.reduce((a,d)=>a+left(d),0))}</div></div>
    <div class="stat"><div class="k">Bugun undirildi</div><div class="v pos">${fmt(inToday)}</div></div></div>
    <p class="small muted" style="margin:12px 0 0">Nasiyaga sotish: <b>Sotuv</b> bo'limida to'lov turini <b>"Nasiya"</b> qiling.</p></section>
  <section class="panel"><div class="row" style="margin-bottom:10px">
    <select id="nFilter" style="width:auto"><option value="faol">Faol qarzlar</option><option value="otgan">Muddati o'tgan</option><option value="hafta">7 kun ichida</option><option value="yopiq">Yopilganlar</option><option value="hammasi">Hammasi</option></select>
    <input id="nSearch" placeholder="Ism, telefon…" value="${esc(nSearch)}" style="flex:1;min-width:160px"></div>
    <div class="tbl"><table><thead><tr><th>Mijoz</th><th>Nima olgan</th><th class="r">Summa</th><th class="r">To'langan</th><th class="r">Qoldiq</th><th>Muddat</th><th></th></tr></thead><tbody>
    ${list.map(d=>`<tr style="${!d.closed&&d.due&&d.due<t?'background:var(--bad-soft)':''}">
      <td class="who">${esc(d.name)}<div class="small muted num">${esc(d.phone)}</div></td>
      <td class="small">${debtItems(d)}<div class="muted">${dayOf(d.ts)}${d.note?' · '+esc(d.note):''}</div></td>
      <td class="r num">${fmt(d.amount)}</td><td class="r num">${fmt(d.paid)}</td>
      <td class="r num"><b>${left(d)<0?'<span style="color:var(--info)">mijozga '+fmt(-left(d))+'</span>':fmt(left(d))}</b></td>
      <td>${dueBadge(d)}</td>
      <td><div class="row" style="flex-wrap:nowrap">${d.closed?'':`<button class="sm pri" data-cpay="${d.id}">To'lov</button><button class="sm" data-cdue="${d.id}">Muddat</button><button class="sm" data-cmsg="${d.id}" title="Eslatma matnini nusxalash">Eslatma</button>`}${owner()?`<button class="sm ghost" data-cdel="${d.id}" aria-label="O'chirish">✕</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="7" class="muted">Qarz yo\'q</td></tr>'}
    </tbody></table></div></section>
  <section class="panel"><h2>Daftardan eski qarzni kiritish</h2><form id="oldDebtF" class="form">
    <label>Telefon<input id="od_phone" required inputmode="tel" list="phonesO" placeholder="+998 90 123 45 67"></label>
    <datalist id="phonesO">${S.clients.map(c=>`<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('')}</datalist>
    <label>Ism<input id="od_name" required></label>
    <label>Qarz summasi (so'm)<input id="od_sum" type="number" min="1" step="1000" required class="num"></label>
    <label>To'lash muddati<input id="od_due" type="date"></label>
    <label class="full">Nima olgan / izoh<input id="od_note" placeholder="Masalan: HP noutbuk, 2026-10-15"></label>
    <div class="full row"><button class="pri">Qarzni kiritish</button></div></form></section>
  ${owner()?`<section class="panel"><h2>Nasiya sozlamalari</h2><form id="credSetF" class="form">
    <label>Odatiy muddat (kun)<input id="cs_days" type="number" min="1" max="365" value="${+(cr.days||30)}" class="num"></label>
    <label>Bir mijozga qarz chegarasi (so'm, 0 = cheklovsiz)<input id="cs_limit" type="number" min="0" step="10000" value="${+(cr.limit||0)}" class="num"></label>
    <label>Muddatdan necha kun oldin eslatish<input id="cs_rem" type="number" min="0" max="30" value="${+(cr.remindDays??3)}" class="num"></label>
    <div class="full row"><button class="pri">Saqlash</button><span class="small muted">Chegara xodimlarga amal qiladi, rahbar oshira oladi. Eslatma mijozga Telegram yoki SMS orqali ketadi (bot ulangach).</span></div>
  </form></section>`:''}`;
}
function credMsg(d){const l=lineOf('servis');return `Assalomu alaykum, ${d.name}! ${S.company.name}: sizning ${fmt(d.amount-d.paid)} so'm qarzingiz${d.due?' to\'lash muddati '+dmy(d.due):''}. Tel: ${l.phone||''}`;}
function cpayModal(id){
  const d=S.cdebts.find(x=>x.id===id), l=d.amount-d.paid, hist=S.cpays.filter(p=>p.debtId===id);
  modal(`<h3>${esc(d.name)}: to'lov qabul qilish</h3>
  <p class="muted" style="margin:0">Qoldiq qarz: <b>${fmt(l)} so'm</b>${d.due?' · muddat '+dmy(d.due):''}</p>
  ${hist.length?`<div class="small">${hist.map(p=>`<div style="display:flex;justify-content:space-between"><span class="muted">${dayOf(p.ts)} · ${PAYN[p.pay]||p.pay}${p.note?' · '+esc(p.note):''}</span><span class="num">${fmt(p.amount)}</span></div>`).join('')}</div>`:''}
  <form id="cpayF" data-d="${d.id}" style="display:grid;gap:10px">
    <label>Summa (so'm)<input id="cp_sum" type="number" min="1" step="1000" max="${l}" value="${l}" required class="num" style="font-size:20px"></label>
    <label>To'lov turi<select id="cp_pay"><option value="naqd">Naqd</option><option value="karta">Karta</option><option value="otkazma">O'tkazma</option></select></label>
    <label>Izoh<input id="cp_note"></label>
    <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri">To'lovni qabul qilish</button></div></form>`);
}
function cpayReceipt(d, amount, pay){const c=S.company, left=d.amount-d.paid;
  modal(`<h3>To'lov cheki</h3><div class="ticket" ${tkAttr()}>
  <div class="hd"><b>${esc(c.name)}</b><br>Nasiya to'lovi</div><hr>
  <div class="kv"><span>Sana:</span><span>${new Date().toLocaleString('uz',{dateStyle:'short',timeStyle:'short'})}</span></div>
  <div class="kv"><span>Mijoz:</span><span>${esc(d.name)}</span></div><div class="kv"><span>Tel:</span><span>${esc(d.phone)}</span></div><hr>
  <div class="kv" style="font-weight:800"><span>TO'LANDI:</span><span>${fmt(amount)} so'm</span></div><div class="kv"><span>Turi:</span><span>${PAYN[pay]||pay}</span></div>
  <div class="kv"><span>Qolgan qarz:</span><span>${fmt(Math.max(left,0))} so'm</span></div>${left<=0?'<div class="c" style="font-weight:800;margin-top:4px">QARZ TO\'LIQ YOPILDI</div>':''}<hr>
  <div class="kv"><b>Qabul qildi:</b><b>${esc(me().name)}</b></div><hr>${contactsHtml('servis')}</div>
  <div class="row" style="justify-content:flex-end"><button type="button" data-close>Yopish</button>${printBtn('ticket')}</div>`);}

/* ---------- QARZLAR (tovar qarzga olingan) ---------- */
let dFilter='ochiq', dSearch='';
const money=(v,cur)=>cur==='usd'?usd(v):fmt(v)+" so'm";
function vQarz(){
  if(!canDebt()) return `<section class="panel"><div class="lock">Qarz kiritish sizga yoqilmagan. Rahbardan ruxsat so'rang.</div></section>`;
  const q=dSearch.toLowerCase();
  let list=S.debts.slice().reverse();
  if(dFilter==='ochiq') list=list.filter(d=>!d.closed); else if(dFilter==='yopiq') list=list.filter(d=>d.closed);
  if(q) list=list.filter(d=>(d.supplier+' '+d.phone+' '+d.type+' '+d.name).toLowerCase().includes(q));
  const open=S.debts.filter(d=>!d.closed);
  const leftUsd=open.filter(d=>d.cur==='usd').reduce((a,d)=>a+d.amount-d.paid,0), leftUzs=open.filter(d=>d.cur==='uzs').reduce((a,d)=>a+d.amount-d.paid,0);
  const bySup={}; open.forEach(d=>{const k=d.supplier.trim().toLowerCase(); (bySup[k]=bySup[k]||{name:d.supplier,phone:d.phone,n:0,usd:0,uzs:0}); const b=bySup[k]; b.n++; b[d.cur]+=d.amount-d.paid; if(!b.phone&&d.phone)b.phone=d.phone;});
  const sups=Object.values(bySup).sort((a,b)=>(b.usd*S.rate+b.uzs)-(a.usd*S.rate+a.uzs));
  const today0=today();
  return `<section class="panel"><h2>Qarzga tovar olish</h2><form id="debtF" class="form">
    <label>Kimdan (firma yoki ism)<input id="d_sup" required list="supList" placeholder="Masalan: Ali optom"></label>
    <datalist id="supList">${[...new Set(S.debts.map(d=>d.supplier))].map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
    <label>Telefon raqami<input id="d_phone" inputmode="tel" placeholder="+998 90 123 45 67"></label>
    <label>Tovar turi<input id="d_type" list="typeList" placeholder="SSD, noutbuk, korpus…"></label>
    <datalist id="typeList">${[...new Set(S.debts.map(d=>d.type).filter(Boolean))].map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
    <label>Tovar nomi<input id="d_name" required placeholder="Kingston A400 240GB"></label>
    <label>Soni<input id="d_qty" type="number" min="1" value="1" required class="num"></label>
    <label>Jami summa<input id="d_sum" type="number" min="0.01" step="0.01" required class="num"></label>
    <label>Valyuta<select id="d_cur"><option value="usd">Dollar ($)</option><option value="uzs">So'm</option></select></label>
    <label>To'lash muddati<input id="d_due" type="date"></label>
    <label class="full">Izoh<input id="d_note" placeholder="ixtiyoriy"></label>
    <div class="full row"><button class="pri">Qarzni yozish</button></div></form></section>
  ${owner()?`<section class="panel"><h2>Umumiy qarz</h2><div class="stats">
    <div class="stat"><div class="k">Dollarda qarz</div><div class="v">${usd(leftUsd)}</div></div>
    <div class="stat"><div class="k">So'mda qarz</div><div class="v">${fmt(leftUzs)}</div></div>
    <div class="stat"><div class="k">Jami (kurs bo'yicha)</div><div class="v">${fmt(leftUsd*S.rate+leftUzs)}</div></div>
    <div class="stat"><div class="k">Ochiq qarzlar</div><div class="v">${open.length}</div></div></div>
    ${sups.length?`<div class="tbl" style="margin-top:14px"><table><thead><tr><th>Kimdan</th><th>Telefon</th><th class="r">Ochiq</th><th class="r">Qoldiq $</th><th class="r">Qoldiq so'm</th></tr></thead><tbody>
    ${sups.map(b=>`<tr><td class="who">${esc(b.name)}</td><td class="num">${esc(b.phone)}</td><td class="r num">${b.n}</td><td class="r num">${b.usd?usd(b.usd):'—'}</td><td class="r num">${b.uzs?fmt(b.uzs):'—'}</td></tr>`).join('')}
    </tbody></table></div>`:''}</section>`:''}
  <section class="panel"><div class="row" style="margin-bottom:10px">
    <select id="dFilter" style="width:auto"><option value="ochiq">Ochiq qarzlar</option><option value="yopiq">To'langanlar</option><option value="hammasi">Hammasi</option></select>
    <input id="dSearch" placeholder="Kimdan, telefon, tovar…" value="${esc(dSearch)}" style="flex:1;min-width:160px"></div>
    <div class="tbl"><table><thead><tr><th>Sana</th><th>Kimdan</th><th>Tovar</th><th class="r">Summa</th><th class="r">To'langan</th><th class="r">Qoldiq</th><th></th></tr></thead><tbody>
    ${list.map(d=>{const left=d.amount-d.paid, late=!d.closed&&d.due&&d.due<today0;
      return `<tr><td class="num small">${dayOf(d.ts)}${d.due?`<div class="small ${late?'':'muted'}" style="${late?'color:var(--bad)':''}">muddat ${d.due}</div>`:''}</td>
      <td class="who">${esc(d.supplier)}<div class="small muted num">${esc(d.phone)}</div></td>
      <td>${d.type?`<span class="chip" style="font-size:11px;padding:1px 8px">${esc(d.type)}</span> `:''}${esc(d.name)} <span class="muted">× ${d.qty}</span>${d.note?`<div class="small muted">${esc(d.note)}</div>`:''}${owner()?`<div class="small muted">kiritdi: ${esc(uName(d.userId))}</div>`:''}</td>
      <td class="r num">${money(d.amount,d.cur)}</td><td class="r num">${money(d.paid,d.cur)}</td>
      <td class="r num">${d.closed?'<span class="status s-tayyor">To\'langan</span>':`<b>${money(left,d.cur)}</b>`}</td>
      <td>${owner()?`<div class="row" style="flex-wrap:nowrap">${d.closed?'':`<button class="sm pri" data-paydebt="${d.id}">To'lash</button>`}<button class="sm ghost" data-deldebt="${d.id}" aria-label="O'chirish">✕</button></div>`:''}</td></tr>`}).join('')||'<tr><td colspan="7" class="muted">Qarz yo\'q</td></tr>'}
    </tbody></table></div></section>`;
}
function payDebtModal(id){
  const d=S.debts.find(x=>x.id===id), left=d.amount-d.paid;
  const hist=S.debtPays.filter(p=>p.debtId===id);
  modal(`<h3>${esc(d.supplier)}: qarzni to'lash</h3>
  <p class="muted" style="margin:0">${esc(d.name)} × ${d.qty} · qoldiq <b>${money(left,d.cur)}</b></p>
  ${hist.length?`<div class="small">${hist.map(p=>`<div class="kv" style="display:flex;justify-content:space-between"><span class="muted">${dayOf(p.ts)}${p.note?' · '+esc(p.note):''}</span><span class="num">${money(p.amount,d.cur)}</span></div>`).join('')}</div>`:''}
  <form id="payDebtF" data-d="${d.id}" style="display:grid;gap:10px">
    <label>To'lov summasi (${d.cur==='usd'?'$':"so'm"})<input id="pd_sum" type="number" min="0.01" step="0.01" max="${left}" value="${left}" required class="num"></label>
    <label>Izoh<input id="pd_note" placeholder="naqd, karta…"></label>
    <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri">To'lash</button></div></form>`);
}

/* ---------- RASXODLAR ---------- */
let eMonth=null;
function vRasxod(){
  if(!canExp()) return `<section class="panel"><div class="lock">Rasxod kiritish sizga yoqilmagan. Rahbardan ruxsat so'rang.</div></section>`;
  const mon=eMonth||today().slice(0,7);
  let list=S.expenses.filter(e=>monthOf(e.ts)===mon);
  if(!owner()) list=list.filter(e=>e.userId===S.cur);
  const tday=list.filter(e=>dayOf(e.ts)===today());
  const sum=l=>l.reduce((a,e)=>a+e.amountUzs,0);
  const byCat=Object.keys(CATS).map(k=>[k,sum(list.filter(e=>e.cat===k))]).filter(x=>x[1]>0);
  const cats=Object.entries(CATS).filter(([k])=>owner()||k!=='oylik');
  return `<section class="panel"><h2>Rasxod kiritish</h2><form id="expF" class="form">
    <label>Turi<select id="e_cat">${cats.map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label>
    <label>Summa (so'm)<input id="e_sum" type="number" min="1" step="1000" required class="num"></label>
    ${owner()?`<label>Kimga (oylik uchun)<select id="e_to"><option value="">—</option>${S.users.filter(u=>u.role!=='owner').map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>`:''}
    <label class="full">Izoh<input id="e_note" placeholder="Nima uchun"></label>
    <div class="full row"><button class="pri">Saqlash</button></div></form></section>
  <section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">${owner()?'Barcha rasxodlar':'Mening rasxodlarim'}</h2>
    <input id="eMonth" type="month" value="${mon}" style="width:auto"></div>
    <div class="stats"><div class="stat"><div class="k">Bugun</div><div class="v">${fmt(sum(tday))}</div></div>
    <div class="stat"><div class="k">Shu oy jami</div><div class="v">${fmt(sum(list))}</div></div>
    ${byCat.slice(0,2).map(([k,v])=>`<div class="stat"><div class="k">${CATS[k]}</div><div class="v">${fmt(v)}</div></div>`).join('')}</div>
    <div class="tbl" style="margin-top:14px"><table><thead><tr><th>Sana</th><th>Turi</th><th>Izoh</th>${owner()?'<th>Kiritgan</th>':''}<th class="r">Summa</th>${owner()?'<th></th>':''}</tr></thead><tbody>
    ${list.slice().reverse().map(e=>`<tr><td class="num small">${dayOf(e.ts)}</td><td>${CATS[e.cat]}${e.toUser?`<div class="small muted">→ ${esc(uName(e.toUser))}</div>`:''}</td><td>${esc(e.note)}</td>
    ${owner()?`<td>${esc(uName(e.userId))}</td>`:''}<td class="r num">${fmt(e.amountUzs)}</td>${owner()?`<td><button class="sm ghost" data-delexp="${e.id}" aria-label="O'chirish">✕</button></td>`:''}</tr>`).join('')||`<tr><td colspan="6" class="muted">Bu oyda rasxod yo'q</td></tr>`}
    </tbody></table></div></section>`;
}
function salaryCard(u){
  const p=payroll(u);
  return `<section class="panel"><h2>Shu oy oyligim</h2><div class="stats">
    <div class="stat"><div class="k">Oklad</div><div class="v">${fmt(u.oklad)}</div></div>
    <div class="stat"><div class="k">KPI ${u.kpi}% · ${kpiLabel(u)}</div><div class="v">${fmt(p.kpiSum)}</div></div>
    <div class="stat"><div class="k">Berilgan (avans)</div><div class="v">${fmt(p.paid)}</div></div>
    <div class="stat"><div class="k">Qoldiq</div><div class="v pos">${fmt(p.left)}</div></div></div></section>`;
}
function payModal(id){
  const u=S.users.find(x=>x.id===id), p=payroll(u);
  modal(`<h3>${esc(u.name)}: oylik sozlamasi</h3><form id="payF" data-u="${u.id}" style="display:grid;gap:10px">
  <label>Oklad (so'm/oy)<input id="p_oklad" type="number" min="0" step="10000" value="${u.oklad}" class="num"></label>
  <label>KPI foizi (%)<input id="p_kpi" type="number" min="0" max="100" step="0.5" value="${u.kpi}" class="num"></label>
  ${u.role==='sotuvchi'?`<label>KPI qaysi summadan<select id="p_base"><option value="foyda" ${u.kpiBase==='foyda'?'selected':''}>Savdo foydasidan</option><option value="tushum" ${u.kpiBase==='tushum'?'selected':''}>Savdo tushumidan</option></select></label>`:'<p class="small muted" style="margin:0">Usta KPI: o\'zi topshirgan remontlar summasidan</p>'}
  <label>Hozir to'lash (avans/oylik, so'm)<input id="p_pay" type="number" min="0" step="10000" placeholder="Qoldiq: ${fmt(p.left)}" class="num"></label>
  <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri">Saqlash</button></div></form>`);
}

/* ---------- modal / role ---------- */
function modal(html){document.getElementById('modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;}
function closeModal(){document.getElementById('modalRoot').innerHTML='';}
/* ---------- render & events ---------- */
const views={nasiya:vNasiya,qarz:vQarz,rasxod:vRasxod,mening:vMening,xodimlar:vXodimlar,sotuv:vSotuv,ombor:vOmbor,ustaxona:vUstaxona,mijozlar:vMijozlar,hisobot:vHisobot,sozlamalar:vSozlamalar};
function render(){
  header();
  document.getElementById('main').innerHTML=views[tab]();
  const rf=document.getElementById('rFilter'); if(rf) rf.value=rFilter;
  const df=document.getElementById('dFilter'); if(df) df.value=dFilter;
  const nf=document.getElementById('nFilter'); if(nf) nf.value=nFilter;
  const ps=document.getElementById('pay'); if(ps&&[...ps.options].some(o=>o.value===payMode)) ps.value=payMode; else payMode='naqd';
}
function route(){const h=location.hash.slice(1); if(views[h]) tab=h; render(); if(tab==='sotuv') setTimeout(()=>document.getElementById('scanIn')?.focus(),0);}
window.addEventListener('hashchange',route);


/* ================== BAZA BILAN ISHLASH (Supabase) ================== */
const CFG_KEY = 'comtech_cfg';
function getCfg() {
  if (window.COMTECH_CONFIG?.url) return window.COMTECH_CONFIG;
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
}
let db = null;
const DOMAIN = 'comtech.app';
// Login istalgan matn bo'lishi mumkin: lotin bo'lmasa, emailga xavfsiz ko'rinishda o'giriladi
const normLogin = (l) => String(l || '').trim().toLowerCase();
function loginToEmail(l) {
  l = normLogin(l);
  if (l.includes('@')) return l;
  if (/^[a-z0-9._-]{1,40}$/.test(l)) return `${l}@${DOMAIN}`;
  return 'x' + [...new TextEncoder().encode(l)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 60) + '@' + DOMAIN;
}
// Supabase kamida 6 belgi talab qiladi: qisqa PIN ichkarida uzaytiriladi (server bilan bir xil)
const pinPw = (pin) => `ct#${String(pin).trim()}#pin`;
const sinceIso = () => new Date(Date.now() - 62 * 864e5).toISOString();
const ms = (t) => (t ? Date.parse(t) : null);
const one = (x) => (Array.isArray(x) ? x[0] : x);

async function must(p) { const { data, error } = await p; if (error) throw error; return data; }
async function allRows(q) {
  const out = [];
  for (let f = 0; ; f += 1000) { const d = await must(q().range(f, f + 999)); out.push(...d); if (d.length < 1000) return out; }
}

function mapReturn(r) {
  const it = one(r.sale_items) || {}, c = one(it.sale_item_costs);
  return { id: r.id, ts: ms(r.created_at), saleId: r.sale_id, saleNo: one(r.sales)?.no, itemId: r.item_id, qty: r.qty, refund: +r.refund_uzs,
    costUzs: c ? +c.cost_usd * +c.rate * r.qty : 0, toDebt: !!r.to_debt, cash: r.cash_uzs == null ? (r.to_debt ? 0 : +r.refund_uzs) : +r.cash_uzs, userId: r.user_id, reason: r.reason || '', name: it.name || '' };
}
// 62 kundan eski kunlarni so'ralganda yuklash
async function loadDay(d) {
  if (d >= new Date(Date.now() - 60 * 864e5).toLocaleDateString('en-CA')) return;
  const a = new Date(d + 'T00:00:00').toISOString(), b = new Date(d + 'T23:59:59').toISOString();
  const [ss, rr] = await Promise.all([
    must(db.from('sales').select('*, sale_items(*, sale_item_costs(*))').gte('created_at', a).lte('created_at', b).order('created_at')),
    must(db.from('sale_returns').select('*, sale_items(name, sale_item_costs(cost_usd, rate)), sales(no)').gte('created_at', a).lte('created_at', b)),
  ]);
  extraSales[d] = ss.map((s) => ({ id: s.id, no: s.no, ts: ms(s.created_at), enteredTs: ms(s.entered_at), userId: s.user_id, pay: s.pay, totalUzs: +s.total_uzs,
    items: (s.sale_items || []).map((i) => { const c = one(i.sale_item_costs); return { id: i.id, name: i.name, line: i.line, qty: i.qty, priceUzs: +i.price_uzs, costUsd: +(c?.cost_usd || 0), rate: +(c?.rate || s.rate) }; }) }));
  extraReturns[d] = rr.map(mapReturn);
}
async function refresh() {
  const uid = (await db.auth.getUser()).data.user?.id;
  const since = sinceIso();
  const [st, profs, pays, prods, costs, cls, reps, sales, exps, pr, debts, rets, cdebts] = await Promise.all([
    must(db.from('settings').select('*').eq('id', 1).single()),
    must(db.from('profiles').select('*').order('created_at')),
    must(db.from('staff_pay').select('*')),
    allRows(() => db.from('products').select('*').order('name')),
    must(db.from('product_costs').select('*')),
    allRows(() => db.from('clients').select('phone,name,tg_chat_id').order('created_at')),
    allRows(() => db.from('repairs').select('*').or(`status.neq.berildi,created_at.gte.${since},done_at.gte.${since}`).order('talon')),
    allRows(() => db.from('sales').select('*, sale_items(*, sale_item_costs(*))').gte('created_at', since).order('created_at')),
    allRows(() => db.from('expenses').select('*').gte('created_at', since).order('created_at')),
    db.rpc('payroll', { p_month: today().slice(0, 7) }),
    allRows(() => db.from('supplier_debts').select('*').or(`closed.eq.false,created_at.gte.${since}`).order('created_at')),
    allRows(() => db.from('sale_returns').select('*, sale_items(name, sale_item_costs(cost_usd, rate)), sales(no)').gte('created_at', since).order('created_at')),
    allRows(() => db.from('customer_debts').select('*').or(`closed.eq.false,created_at.gte.${since}`).order('created_at')),
  ]);
  const cdIds = cdebts.map((d) => d.id);
  const cpays = cdIds.length ? await must(db.from('customer_payments').select('*').in('debt_id', cdIds).order('created_at')) : [];
  const debtIds = debts.map((d) => d.id);
  const dpays = debtIds.length ? await must(db.from('debt_payments').select('*').in('debt_id', debtIds).order('created_at')) : [];
  const payMap = Object.fromEntries(pays.map((p) => [p.user_id, p]));
  const costMap = Object.fromEntries(costs.map((c) => [c.product_id, +c.cost_usd]));
  S = {
    cur: uid, skin: S?.skin || (() => { try { return localStorage.getItem('comtech_skin') || 'yashil'; } catch { return 'yashil'; } })(),
    company: st.company, rate: +st.rate, rateDate: st.rate_date, nextTalon: st.next_talon,
    mods: st.mods, tg: st.tg, printers: st.printers,
    users: profs.map((p) => ({
      id: p.id, name: p.name, login: p.login, role: p.role, active: p.active,
      canExpense: p.can_expense, seeSalary: p.see_salary, canDebt: p.can_debt, canReturn: p.can_return, canCredit: p.can_credit,
      oklad: +(payMap[p.id]?.oklad || 0), kpi: +(payMap[p.id]?.kpi || 0), kpiBase: payMap[p.id]?.kpi_base || 'foyda',
    })),
    products: prods.map((p) => ({ id: p.id, name: p.name, barcode: p.barcode, line: p.line, qty: p.qty, sellUsd: +p.sell_usd, costUsd: costMap[p.id] ?? 0 })),
    clients: cls.map((c) => ({ phone: c.phone, name: c.name, tg: !!c.tg_chat_id })),
    repairs: reps.map((r) => ({
      talon: r.talon, ts: ms(r.created_at), phone: r.client_phone, name: r.client_name, device: r.device, model: r.model || '',
      serial: r.serial || '', problem: r.problem, acc: r.accessories || '', status: r.status, feeUzs: +r.fee_uzs,
      masterId: r.master_id, acceptedBy: r.accepted_by, doneTs: ms(r.done_at),
    })),
    sales: sales.map((s) => ({
      id: s.id, no: s.no, ts: ms(s.created_at), enteredTs: ms(s.entered_at), userId: s.user_id, pay: s.pay, totalUzs: +s.total_uzs,
      items: (s.sale_items || []).map((i) => { const c = one(i.sale_item_costs); return { id: i.id, name: i.name, line: i.line, qty: i.qty, priceUzs: +i.price_uzs, costUsd: +(c?.cost_usd || 0), rate: +(c?.rate || s.rate) }; }),
    })),
    expenses: exps.map((e) => ({ id: e.id, ts: ms(e.created_at), userId: e.user_id, cat: e.cat, amountUzs: +e.amount_uzs, note: e.note || '', toUser: e.to_user })),
    payroll: Object.fromEntries((pr.data || []).map((x) => [x.user_id, x])),
    debts: debts.map((d) => ({ id: d.id, ts: ms(d.created_at), userId: d.user_id, supplier: d.supplier, phone: d.phone || '', type: d.item_type || '',
      name: d.item_name, qty: d.qty, amount: +d.amount, cur: d.currency, due: d.due_date, note: d.note || '', paid: +d.paid, closed: d.closed })),
    returns: rets.map(mapReturn),
    credit: st.credit || { days: 30, limit: 0, remindDays: 3 },
    cdebts: cdebts.map((d) => ({ id: d.id, ts: ms(d.created_at), saleId: d.sale_id, phone: d.client_phone, name: d.client_name, amount: +d.amount_uzs, paid: +d.paid_uzs,
      due: d.due_date, note: d.note || '', userId: d.user_id, closed: d.closed })),
    cpays: cpays.map((p) => ({ id: p.id, debtId: p.debt_id, ts: ms(p.created_at), amount: +p.amount_uzs, pay: p.pay, note: p.note || '' })),
    debtPays: dpays.map((x) => ({ id: x.id, debtId: x.debt_id, ts: ms(x.created_at), amount: +x.amount, note: x.note || '' })),
  };
  applySkin();
}

/* ---------- jonli yangilanish: boshqa qurilmada o'zgarsa ---------- */
let rtTimer = null, pendingRender = false;
const busy = () => !!document.querySelector('.modal-bg') || (document.activeElement && document.activeElement.closest?.('#main form'));
async function liveUpdate() {
  try { await refresh(); } catch (e) { return; }
  if (busy()) { pendingRender = true; return; }
  keepScroll(render);
}
function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !busy()) { pendingRender = false; keepScroll(render); } }, 400));
function subscribe() {
  db.channel('comtech-live')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => { clearTimeout(rtTimer); rtTimer = setTimeout(liveUpdate, 700); })
    .subscribe();
}

/* ---------- chop etish (brauzer orqali termoprinterga) ---------- */
function printHtml(inner, wmm, hmm) {
  const css = [...document.querySelectorAll('style')].map((s) => s.outerHTML).join('');
  const fonts = document.querySelector('link[href*="fonts.googleapis"]')?.outerHTML || '';
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8">${fonts}${css}
    <style>@page{size:${wmm}mm ${hmm ? hmm + 'mm' : 'auto'};margin:0}
    html,body{background:#fff!important;margin:0;padding:0}:root{padding:0!important}
    .ticket,.label,.stk{box-shadow:none!important;border-top:0!important;border-bottom:0!important;margin:0!important;max-width:none!important}
    .label,.stk{break-after:page;border-radius:0;border-color:transparent}.pg{break-after:page}</style></head><body>${inner}</body></html>`);
  f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Chop etib bo\'lmadi'); } setTimeout(() => f.remove(), 60000); }, 600);
}
const printBtn = (what) => `<button type="button" class="pri" data-print="${what}">Chop etish</button>`;

/* ---------- kirish ekrani ---------- */
function showSetup() {
  document.getElementById('gate').innerHTML = `<form id="cfgF" class="gate-card">
    <div class="gate-mark">COMPMIR</div><h1>Bazaga ulash</h1>
    <p class="muted small">Bir marta kiritiladi. Supabase → Project Settings → API bo'limidan oling.</p>
    <label>Project URL<input id="cf_url" required placeholder="https://xxxx.supabase.co"></label>
    <label>Anon (public) key<input id="cf_key" required placeholder="eyJ... yoki sb_publishable_..."></label>
    <button class="pri">Saqlash</button></form>`;
  document.getElementById('gate').hidden = false;
}
function showLogin(err) {
  document.getElementById('gate').innerHTML = `<form id="loginF" class="gate-card">
    <div class="gate-mark">${S?.company ? brandHtml() : 'COMPMIR'}</div><h1>Tizimga kirish</h1>
    <label>Login<input id="li_login" required autocomplete="username" autocapitalize="none" placeholder="masalan: aziz"></label>
    <label>PIN yoki parol<input id="li_pin" type="password" required autocomplete="current-password"></label>
    ${err ? `<p class="small" style="color:var(--bad);margin:0">${esc(err)}</p>` : ''}
    <button class="pri">Kirish</button></form>`;
  document.getElementById('gate').hidden = false;
  setTimeout(() => document.getElementById('li_login')?.focus(), 0);
}
async function enter() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return showLogin();
  let prof = (await db.from('profiles').select('id,active').eq('id', session.user.id).maybeSingle()).data;
  if (!prof) { await db.rpc('claim_owner', { p_name: 'Rahbar' }); prof = (await db.from('profiles').select('id,active').eq('id', session.user.id).maybeSingle()).data; }
  if (!prof || !prof.active) { await db.auth.signOut(); return showLogin('Bu hisobga ruxsat berilmagan. Rahbarga murojaat qiling.'); }
  try { await refresh(); } catch (e) { return showLogin('Bazadan o\'qib bo\'lmadi: ' + e.message); }
  document.getElementById('gate').hidden = true;
  if (!location.hash) tab = owner() ? 'xodimlar' : 'mening';
  route(); subscribe();
}

/* ---------- harakatlar ---------- */
async function act(fn, okMsg) {
  try { const r = await fn(); await refresh(); keepScroll(render); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e?.message || String(e)); if (e && typeof e === 'object') e._shown = true; throw e; }
}
async function adminUsers(body) {
  const { data, error } = await db.functions.invoke('admin-users', { body });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data;
}
const settingsUpd = (patch) => must(db.from('settings').update(patch).eq('id', 1));

function accountModal() {
  const u = me();
  modal(`<h3>${esc(u.name)}</h3><p class="muted" style="margin:0">${ROLES[u.role]} · login: <b class="num">${esc(u.login || '')}</b></p>
  <p class="small muted" style="margin:0">Boshqa xodim kirishi uchun chiqing.</p>
  <div class="row" style="justify-content:flex-end"><button type="button" data-close>Yopish</button><button class="pri" id="logoutBtn">Chiqish</button></div>`);
}

document.addEventListener('submit', async (e) => {
  e.preventDefault(); const id = e.target.id; const v = (x) => document.getElementById(x)?.value?.trim() ?? '';
  try {
    if (id === 'cfgF') {
      const cfg = { url: v('cf_url').replace(/\/+$/, ''), key: v('cf_key') };
      try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
      return boot();
    }
    if (id === 'loginF') {
      const email = loginToEmail(v('li_login'));
      const raw = document.getElementById('li_pin').value;
      let { error } = await db.auth.signInWithPassword({ email, password: pinPw(raw) });
      if (error && raw.length >= 6) ({ error } = await db.auth.signInWithPassword({ email, password: raw }));
      if (error) return showLogin('Login yoki PIN noto\'g\'ri');
      return enter();
    }
    if (id === 'scanF') {
      const val = v('scanIn'); if (!val) return;
      const p = S.products.find((p) => p.barcode === val);
      if (p) return addToCart(p);
      const m = S.products.filter((p) => p.name.toLowerCase().includes(val.toLowerCase()));
      if (m.length === 1) return addToCart(m[0]);
      return toast(m.length ? 'Bir nechta tovar topildi, ro\'yxatdan tanlang' : 'Bu shtrix-kod omborda yo\'q');
    }
    if (id === 'kirimF') {
      const q = +v('k_qty'), name = v('k_name');
      await act(() => db.rpc('stock_in', { p_barcode: v('k_bar'), p_name: name, p_line: v('k_line'), p_qty: q, p_cost: +v('k_cost'), p_sell: +v('k_sell') }).then(must0), `${name}: +${q} dona`);
    }
    if (id === 'qabulF') {
      const r = await act(() => must(db.rpc('intake_repair', { p: {
        phone: v('r_phone').replace(/\s/g, ''), name: v('r_name'), device: v('r_dev'), model: v('r_model'), serial: v('r_serial'),
        problem: v('r_prob'), accessories: v('r_acc'), fee_uzs: +v('r_fee') || 0, master_id: v('r_master') } })), (r) => `Talon №${r.talon} berildi`);
      showTalon(r.talon);
    }
    if (id === 'userF') {
      await act(() => adminUsers({ action: 'create', name: v('u_name'), login: v('u_login'), role: v('u_role'), pin: v('u_pin') }), 'Xodim qo\'shildi');
    }
    if (id === 'pinSetF') {
      await act(() => adminUsers({ action: 'update', user_id: e.target.dataset.u, name: v('ps_name'), login: v('ps_login'), pin: v('ps_pin') }), 'Xodim ma\'lumotlari saqlandi');
      closeModal();
    }
    if (id === 'expF') {
      const to = v('e_to');
      if (v('e_cat') === 'oylik' && !to) return toast('Oylik uchun xodimni tanlang');
      await act(() => must(db.from('expenses').insert({ user_id: S.cur, cat: v('e_cat'), amount_uzs: +v('e_sum'), note: v('e_note'), to_user: to || null })), 'Rasxod saqlandi');
    }
    if (id === 'payF') {
      const uidv = e.target.dataset.u, pay = +v('p_pay') || 0;
      await act(async () => {
        await must(db.from('staff_pay').upsert({ user_id: uidv, oklad: +v('p_oklad') || 0, kpi: +v('p_kpi') || 0, kpi_base: v('p_base') || 'foyda' }));
        if (pay > 0) await must(db.from('expenses').insert({ user_id: S.cur, cat: 'oylik', amount_uzs: pay, to_user: uidv, note: 'Oylik to\'lovi' }));
      }, pay > 0 ? `${fmt(pay)} so'm to'landi` : 'Saqlandi');
      closeModal();
    }
    if (id === 'compF') {
      const lines = {}; for (const k of Object.keys(LINE_NAMES)) lines[k] = { brand: v(`c_${k}_brand`), phone: v(`c_${k}_phone`), telegram: v(`c_${k}_tg`), instagram: v(`c_${k}_ig`) };
      await act(() => settingsUpd({ company: { ...S.company, name: v('c_name'), sub: v('c_sub'), labelPrice: document.getElementById('c_lblprice').checked, lines } }), 'Firma ma\'lumotlari saqlandi');
    }
    if (id === 'prF') {
      const [lw, lh] = dims(v('pr_lw') + 'x' + v('pr_lh')), [sw, sh] = dims(v('pr_sw') + 'x' + v('pr_sh'));
      await act(() => settingsUpd({ printers: { receipt: v('pr_r') || 'WP230', receiptW: String(Math.min(120, Math.max(40, +v('pr_w') || 80))), label: v('pr_l') || 'XP-365B', labelW: lw, labelH: lh, stkW: sw, stkH: sh } }), 'Printer sozlamalari saqlandi');
    }
    if (id === 'tgF') {
      await act(() => settingsUpd({ tg: { group: v('tg_group'), channel: v('tg_ch'), reportTime: v('tg_rt') || '21:00', backupTime: v('tg_bt') || '00:00', profit: document.getElementById('tg_profit').checked } }), 'Telegram sozlamalari saqlandi');
    }
    if (id === 'rateF') {
      const nr = +v('rf_rate'); if (!(nr > 0)) return toast("Kursni to'g'ri kiriting");
      await act(() => settingsUpd({ rate: nr, rate_date: today() }), `Kurs saqlandi: 1$ = ${fmt(nr)} so'm`); closeModal();
    }
    if (id === 'setF') {
      const nr = +v('s_rate'), nt = +v('s_talon'), patch = {};
      if (nr > 0) { patch.rate = nr; patch.rate_date = today(); }
      if (nt > 0) patch.next_talon = nt;
      await act(() => settingsUpd(patch), 'Saqlandi. Narxlar yangi kurs bo\'yicha hisoblanadi');
    }
    if (id === 'retF') {
      const it = +v('rt_item'), qty = +v('rt_qty'), d = v('rt_date');
      await act(async () => {
        const r = await must(db.rpc('make_return', { p_item: it, p_qty: qty, p_reason: v('rt_reason'), p_date: d && d !== today() ? d : null }));
        for (const k of Object.keys(extraSales)) { delete extraSales[k]; delete extraReturns[k]; }
        if (histDay) await loadDay(histDay);
        return r;
      }, (r) => r.to_debt ? `Vazvrat: qarz ${fmt(r.refund_uzs)} so'mga kamaydi${+r.cash_uzs ? ', mijozga naqd ' + fmt(r.cash_uzs) + " so'm" : ''}` : `Vazvrat qilindi: ${fmt(r.refund_uzs)} so'm qaytariladi`);
      closeModal();
    }
    if (id === 'cpayF') {
      const did = e.target.dataset.d, amt = +v('cp_sum'), pm = v('cp_pay');
      await act(() => must(db.from('customer_payments').insert({ debt_id: did, user_id: S.cur, amount_uzs: amt, pay: pm, note: v('cp_note') })), `To'lov qabul qilindi: ${fmt(amt)} so'm`);
      const d = S.cdebts.find((x) => x.id === did); if (d) cpayReceipt(d, amt, pm); else closeModal();
    }
    if (id === 'cdueF') {
      await act(() => must(db.from('customer_debts').update({ due_date: v('cd_due') || null, note: v('cd_note') }).eq('id', e.target.dataset.d)), 'Muddat saqlandi');
      closeModal();
    }
    if (id === 'oldDebtF') {
      const ph = v('od_phone').replace(/\s/g, ''), nm = v('od_name');
      await act(async () => {
        await must(db.from('clients').upsert({ phone: ph, name: nm }, { onConflict: 'phone' }));
        await must(db.from('customer_debts').insert({ user_id: S.cur, client_phone: ph, client_name: nm, amount_uzs: +v('od_sum'), due_date: v('od_due') || null, note: v('od_note') }));
      }, 'Eski qarz kiritildi');
    }
    if (id === 'credSetF') {
      await act(() => settingsUpd({ credit: { days: +v('cs_days') || 30, limit: +v('cs_limit') || 0, remindDays: +v('cs_rem') || 0 } }), 'Nasiya sozlamalari saqlandi');
    }
    if (id === 'debtF') {
      await act(() => must(db.from('supplier_debts').insert({ user_id: S.cur, supplier: v('d_sup'), phone: v('d_phone'), item_type: v('d_type'), item_name: v('d_name'),
        qty: +v('d_qty') || 1, amount: +v('d_sum'), currency: v('d_cur'), due_date: v('d_due') || null, note: v('d_note') })), 'Qarz yozildi');
    }
    if (id === 'payDebtF') {
      await act(() => must(db.from('debt_payments').insert({ debt_id: e.target.dataset.d, user_id: S.cur, amount: +v('pd_sum'), note: v('pd_note') })), "To'lov yozildi");
      closeModal();
    }
    if (id === 'impClF') {
      const rows = v('imp_txt').split('\n').map((l) => l.split(/[;,\t]/).map((x) => x.trim())).filter((r) => r[0] && r[1]);
      const list = rows.map(([phone, name]) => ({ phone: phone.replace(/\s/g, ''), name }));
      if (!list.length) return toast('Har qatorda: telefon; ism');
      await act(() => must(db.from('clients').upsert(list, { onConflict: 'phone' })), `${list.length} ta mijoz qo'shildi`);
    }
  } catch (err) { if (!err?._shown) toast(err?.message || String(err)); }
});
const must0 = (r) => { if (r.error) throw r.error; return r.data; };

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'scanIn') {
    const val = t.value.trim().toLowerCase(); const box = document.getElementById('sugg');
    if (val.length < 2 || /^\d+$/.test(val)) { box.innerHTML = ''; return; }
    box.innerHTML = S.products.filter((p) => p.name.toLowerCase().includes(val)).slice(0, 6)
      .map((p) => `<button type="button" data-add="${p.id}"><span>${esc(p.name)} <span class="muted small">· ${p.qty} dona</span></span><span class="num">${fmt(priceUzs(p))}</span></button>`).join('');
  }
  const keep = (id, set) => { if (t.id !== id) return; set(t.value); const pos = t.selectionStart; render(); const n = document.getElementById(id); n.focus(); n.setSelectionRange(pos, pos); };
  keep('oSearch', (x) => (oSearch = x)); keep('cSearch', (x) => (cSearch = x)); keep('rSearch', (x) => (rSearch = x)); keep('dSearch', (x) => (dSearch = x)); keep('nSearch', (x) => (nSearch = x));
  if (t.id === 'ns_phone') { nas.phone = t.value; const c = S.clients.find((c) => c.phone === t.value.replace(/\s/g, '')); if (c) { nas.name = c.name; const n = document.getElementById('ns_name'); if (n) n.value = c.name; } }
  if (t.id === 'ns_name') nas.name = t.value;
  if (t.id === 'ns_pre') nas.prepaid = t.value;
  if (t.id === 'ns_due') nas.due = t.value;
  if (t.id === 'ns_note') nas.note = t.value;
  if (t.id === 'od_phone') { const c = S.clients.find((c) => c.phone === t.value.replace(/\s/g, '')); if (c) document.getElementById('od_name').value = c.name; }
  if (t.id === 'r_phone') { const c = S.clients.find((c) => c.phone === t.value.replace(/\s/g, '')); if (c) document.getElementById('r_name').value = c.name; }
  if (t.id === 'k_bar') {
    const p = S.products.find((p) => p.barcode === t.value.trim());
    if (p) { k_name.value = p.name; k_line.value = p.line || 'kompyuter'; k_cost.value = p.costUsd; k_sell.value = p.sellUsd; k_hint.textContent = `Mavjud tovar: omborda ${p.qty} dona`; }
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.id === 'rFilter') { rFilter = t.value; render(); }
    if (t.id === 'eMonth') { eMonth = t.value; render(); }
    if (t.id === 'dFilter') { dFilter = t.value; render(); }
    if (t.id === 'nFilter') { nFilter = t.value; render(); }
    if (t.id === 'pay') { payMode = t.value; render(); }
    if (t.id === 'ns_phone' || t.id === 'ns_pre') keepScroll(render);
    if (t.id === 'saleDate') { saleDate = t.value && t.value <= today() ? t.value : today(); render(); }
    if (t.id === 'histDay') { const d = t.value && t.value <= today() ? t.value : today(); await loadDay(d); histDay = d; render(); }
    if (t.id === 'rt_item') { const o = t.selectedOptions[0]; const q = document.getElementById('rt_qty'); q.max = o.dataset.left; if (+q.value > +o.dataset.left) q.value = o.dataset.left; }
    if (t.id && t.id.startsWith('sk_')) drawStickers(t.id === 'sk_size');
    if (['lb_size', 'lb_w', 'lb_h', 'lb_n', 'lb_price'].includes(t.id)) drawLabels(t.id === 'lb_size');
    if (t.dataset.perm) {
      const col = { canExpense: 'can_expense', seeSalary: 'see_salary', canDebt: 'can_debt', canReturn: 'can_return', canCredit: 'can_credit' }[t.dataset.perm];
      await act(() => must(db.from('profiles').update({ [col]: t.checked }).eq('id', t.dataset.u)), t.checked ? 'Ruxsat yoqildi' : "Ruxsat o'chirildi");
    }
    if (t.dataset.mod) await act(() => settingsUpd({ mods: { ...S.mods, [t.dataset.mod]: t.checked } }), t.checked ? 'Modul yoqildi' : "Modul o'chirildi");
    if (t.dataset.st) {
      const talon = +t.dataset.st, st = t.value;
      await act(() => must(db.from('repairs').update({ status: st, ...(st === 'tayyor' ? { notified_at: null } : {}) }).eq('talon', talon)),
        st === 'tayyor' ? `№${talon} tayyor. Mijozga 5 daqiqa ichida xabar ketadi` : `№${talon}: ${stName(st)}`);
    }
    if (t.dataset.fee) await act(() => must(db.from('repairs').update({ fee_uzs: +t.value || 0 }).eq('talon', +t.dataset.fee)), 'Narx saqlandi');
  } catch {}
});

function drawLabels(fromSel) {
  const sh = document.getElementById('lbSheet'); if (!sh) return;
  const pr = S.products.find((x) => x.id === sh.dataset.p);
  const n = Math.min(200, Math.max(1, +document.getElementById('lb_n').value || 1));
  sh.innerHTML = Array(Math.min(n, 24)).fill(labelHtml(pr, readSize('lb', fromSel), document.getElementById('lb_price').checked)).join('') +
    (n > 24 ? `<p class="small muted" style="width:100%;text-align:center;margin:0">… jami ${n} ta</p>` : '');
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button,[data-close]');
  if (e.target.classList.contains('modal-bg')) { closeModal(); return; }
  if (!b) return;
  try {
    if (b.id === 'roleBtn') accountModal();
    if (b.id === 'rateChip') {
      if (!owner()) return toast("Kursni faqat rahbar o'zgartiradi");
      modal(`<h3>Bugungi dollar kursi</h3><form id="rateF" style="display:grid;gap:10px">
        <label>1 $ = necha so'm<input id="rf_rate" type="number" min="1" step="1" required value="${S.rate}" class="num" style="font-size:22px"></label>
        <p class="small muted" style="margin:0">Saqlangach, barcha tovarlarning so'mdagi narxi yangi kurs bo'yicha hisoblanadi.</p>
        <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri">Saqlash</button></div></form>`);
      setTimeout(() => { const i = document.getElementById('rf_rate'); i?.focus(); i?.select(); }, 0);
    }
    if (b.id === 'logoutBtn') { await db.auth.signOut(); closeModal(); cart = []; location.hash = ''; showLogin(); }
    if (b.dataset.pay) payModal(b.dataset.pay);
    if (b.dataset.label) labelModal(b.dataset.label);
    if (b.id === 'repPrev') reportModal();
    if (b.dataset.stk) {
      const k = b.dataset.stk;
      if (k[0] === 'r') { const r = S.repairs.find((x) => x.talon == k.slice(1)); stickerModal({ line: 'servis', ref: '№' + r.talon, warranty: '1', from: r.doneTs || Date.now() }); }
      else { const p = S.products.find((x) => x.id === k.slice(1)); stickerModal({ line: p.line, warranty: p.line === 'noutbuk' || p.line === 'kompyuter' ? '12' : '0' }); }
    }
    if (b.id === 'genBar') { document.getElementById('k_bar').value = genBarcode(); document.getElementById('k_name').focus(); }
    if (b.dataset.paydebt) payDebtModal(b.dataset.paydebt);
    if (b.id === 'credChip') { nFilter = 'otgan'; location.hash = 'nasiya'; }
    if (b.dataset.cpay) cpayModal(b.dataset.cpay);
    if (b.dataset.cdue) {
      const d = S.cdebts.find((x) => x.id === b.dataset.cdue);
      modal(`<h3>${esc(d.name)}: muddatni o'zgartirish</h3><form id="cdueF" data-d="${d.id}" style="display:grid;gap:10px">
        <label>Yangi muddat<input id="cd_due" type="date" value="${d.due || ''}"></label>
        <label>Izoh<input id="cd_note" value="${esc(d.note)}"></label>
        <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri">Saqlash</button></div></form>`);
    }
    if (b.dataset.cmsg) {
      const d = S.cdebts.find((x) => x.id === b.dataset.cmsg), txt = credMsg(d);
      try { await navigator.clipboard.writeText(txt); toast('Eslatma matni nusxalandi: Telegram yoki SMS ga joylang'); }
      catch { modal(`<h3>Eslatma matni</h3><textarea style="min-height:110px">${esc(txt)}</textarea><div class="row" style="justify-content:flex-end"><button type="button" data-close class="pri">Yopish</button></div>`); }
    }
    if (b.dataset.cdel) {
      const d = S.cdebts.find((x) => x.id === b.dataset.cdel);
      modal(`<h3>Nasiya o'chirilsinmi?</h3><p class="muted" style="margin:0">${esc(d.name)} · ${fmt(d.amount - d.paid)} so'm qoldiq. To'lovlar tarixi ham o'chadi.</p>
        <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri" data-cdelyes="${d.id}">Ha, o'chirish</button></div>`);
    }
    if (b.dataset.cdelyes) { await act(() => must(db.from('customer_debts').delete().eq('id', b.dataset.cdelyes)), "Nasiya o'chirildi"); closeModal(); }
    if (b.dataset.return) returnModal(b.dataset.return);
    if (b.dataset.receipt) { const sl = [...S.sales, ...Object.values(extraSales).flat()].find((x) => x.id === b.dataset.receipt); if (sl) receiptModal(sl); }
    if (b.dataset.deldebt) {
      const d = S.debts.find((x) => x.id === b.dataset.deldebt);
      modal(`<h3>Qarz o'chirilsinmi?</h3><p class="muted" style="margin:0">${esc(d.supplier)} · ${esc(d.name)}. To'lovlar tarixi ham o'chadi.</p>
        <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri" data-deldebtyes="${d.id}">Ha, o'chirish</button></div>`);
    }
    if (b.dataset.deldebtyes) { await act(() => must(db.from('supplier_debts').delete().eq('id', b.dataset.deldebtyes)), "Qarz o'chirildi"); closeModal(); }
    if (b.dataset.delexp) await act(() => must(db.from('expenses').delete().eq('id', b.dataset.delexp)), "Rasxod o'chirildi");
    if (b.dataset.skin) { S.skin = b.dataset.skin; try { localStorage.setItem('comtech_skin', S.skin); } catch {} applySkin(); render(); }
    if (b.dataset.view !== undefined) { viewUser = b.dataset.view || null; render(); window.scrollTo(0, 0); }
    if (b.dataset.active) await act(() => adminUsers({ action: 'set_active', user_id: b.dataset.u, active: b.dataset.active === '1' }), b.dataset.active === '1' ? 'Xodim yoqildi' : "Xodim o'chirildi");
    if (b.dataset.setpin) {
      const u = S.users.find((x) => x.id === b.dataset.setpin);
      modal(`<h3>${esc(u.name)}: tahrirlash</h3><form id="pinSetF" data-u="${u.id}" style="display:grid;gap:10px">
        <label>Ism<input id="ps_name" required value="${esc(u.name)}"></label>
        <label>Login<input id="ps_login" required maxlength="30" autocapitalize="none" value="${esc(u.login || '')}"></label>
        <label>Yangi parol (bo'sh qolsa, eskisi qoladi)<input id="ps_pin" maxlength="30" autocapitalize="none" placeholder="istalgan so'z yoki raqam"></label>
        <div class="row" style="justify-content:flex-end"><button type="button" data-close>Bekor qilish</button><button class="pri">Saqlash</button></div></form>`);
    }
    if (b.hasAttribute('data-close')) closeModal();
    if (b.dataset.add) { const p = S.products.find((p) => p.id === b.dataset.add); document.getElementById('scanIn').value = ''; addToCart(p); }
    if (b.dataset.q !== undefined) {
      const c = cart[+b.dataset.q]; const p = S.products.find((p) => p.id === c.id); const n = c.qty + +b.dataset.d;
      if (n > p.qty) return toast(`Omborda faqat ${p.qty} dona bor`);
      if (n < 1) cart.splice(+b.dataset.q, 1); else c.qty = n; render();
    }
    if (b.dataset.rm !== undefined) { cart.splice(+b.dataset.rm, 1); render(); }
    if (b.id === 'sellBtn') {
      b.disabled = true;
      const pm = document.getElementById('pay').value;
      if (pm === 'nasiya' && (!nas.phone.trim() || !nas.name.trim())) { b.disabled = false; return toast("Nasiya uchun mijozning telefoni va ismini yozing"); }
      const args = { p_items: cart.map((c) => ({ product_id: c.id, qty: c.qty })), p_pay: pm, p_date: saleDate && saleDate !== today() ? saleDate : null };
      if (pm === 'nasiya') Object.assign(args, { p_client: nas.phone, p_client_name: nas.name.trim(), p_prepaid: +nas.prepaid || 0, p_due: nas.due || null, p_note: nas.note });
      let res;
      try { res = await act(() => must(db.rpc('make_sale', args))); } catch { b.disabled = false; return; }
      cart = []; if (pm === 'nasiya') { nas = { phone: '', name: '', prepaid: '', due: '', note: '' }; payMode = 'naqd'; } render();
      const sale = S.sales.find((s) => s.id === res.id); if (sale) receiptModal(sale);
    }
    if (b.dataset.talon) showTalon(+b.dataset.talon);
    if (b.dataset.print) {
      const w = b.dataset.print;
      if (w === 'ticket') printHtml(document.querySelector('.modal .ticket').outerHTML, +S.printers.receiptW || 80);
      if (w === 'labels') { const [lw, lh] = dims(readSize('lb')); const n = Math.min(200, Math.max(1, +document.getElementById('lb_n').value || 1)); const one1 = document.querySelector('#lbSheet .label').outerHTML; printHtml(Array(n).fill(one1).join(''), lw, lh); }
      if (w === 'stickers') { const [sw, sh] = dims(readSize('sk')); const n = Math.min(100, Math.max(1, +document.getElementById('sk_n').value || 1)); const one1 = document.querySelector('#skSheet .stk').outerHTML; printHtml(Array(n).fill(one1).join(''), sw, sh); }
    }
    if (b.id === 'copyDb') {
      const txt = JSON.stringify(S);
      try { await navigator.clipboard.writeText(txt); toast('Baza nusxalandi'); } catch { toast('Nusxalab bo\'lmadi'); }
    }
  } catch {}
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

async function boot() {
  const cfg = getCfg();
  if (!cfg?.url || !cfg?.key) return showSetup();
  db = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
  await enter();
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
// Yangi versiya chiqsa o'zi yangilanadi (forma ochiq bo'lmasa), aks holda tugma chiqadi
(function autoUpdate(){
  const mine = document.querySelector('script[type=module][src]')?.getAttribute('src');
  if (!mine || location.protocol !== 'https:') return;
  let shown = false;
  async function check(){
    try {
      const h = await fetch('./index.html?v=' + Date.now(), { cache: 'no-store' }).then(r => r.text());
      if (h.includes('<script') && !h.includes(mine)) {
        const busy = document.querySelector('.modal, dialog[open]') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
        if (!busy) return location.reload();
        if (shown) return; shown = true;
        const b = document.createElement('button');
        b.textContent = '🔄 Yangi versiya — yangilash';
        b.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;padding:12px 18px;border-radius:12px;border:0;background:#2bb673;color:#fff;font-weight:700;box-shadow:0 6px 20px rgba(0,0,0,.3)';
        b.onclick = () => location.reload();
        document.body.appendChild(b);
      }
    } catch {}
  }
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();
boot();
