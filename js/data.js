// ── Default client data & DOCX generation ───────────────────
var FACILITY_NAME = 'ShiftPoint';
// ── Data ───────────────────────────────────────────────────────
let CLIENTS=[];
let REPORTS=[],nextClientId=100,nextReportId=1;
// ── Extended module data (Staff, Chores, Passes) ──────────────
var STAFF = [];
var PASSES = [];
var MASTER_CHORES = [];
var PASS_NOTICE = '';
var STAFF_CATEGORIES = ['Director','Case Manager','Monitor','Other'];
let currentReportId=null,shiftStatuses={},shiftComments={},shiftLastUA={},shiftLastRoomSearch={};
const logEntries=[],issues=[],medNotes=[],saveTimer_ref={t:null};

const STATUS_OPTS=[
  {v:'building',l:'In Building',c:'s-building'},
  {v:'work',l:'Work',c:'s-work'},
  {v:'pass',l:'Weekend Pass',c:'s-pass'},
  {v:'out',l:'Out / Other',c:'s-out'},
  {v:'bhc',l:'BHC — Billie Holiday Center',c:'s-bhc'},
  {v:'efc',l:'EFC — Eleanora Fagan Center',c:'s-efc'},
  {v:'hospital',l:'Hospital',c:'s-hospital'},
  // 'vacant' intentionally excluded — set automatically on discharge only
];
const stCls=v=>(STATUS_OPTS.find(o=>o.v===v)||{c:''}).c;

// ── Filename ───────────────────────────────────────────────────
function docxFilename(){
  const sv=document.getElementById('meta-shift').value||'Shift';
  const dv=document.getElementById('meta-date').value;
  let dp='';
  if(dv){const[y,m,d]=dv.split('-');dp=' '+parseInt(m)+'.'+parseInt(d)+'.'+y.slice(2);}
  const fn=(window.FACILITY_NAME||FACILITY_NAME||'Shift').replace(/[^a-zA-Z0-9 _-]/g,'').trim();
  return fn+' — '+sv+' Report'+dp+'.docx';
}

// ── DOCX generation ────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// DOCX GENERATION — Professional themed Open XML
// ══════════════════════════════════════════════════════
function xe(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── Low-level helpers ─────────────────────────────────
function rpr(opts={}){
  const{font='Calibri',sz=20,bold,col,italic}=opts;
  let r=`<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`;
  r+=`<w:sz w:val="${sz*2}"/><w:szCs w:val="${sz*2}"/>`;
  if(bold)   r+='<w:b/><w:bCs/>';
  if(italic) r+='<w:i/><w:iCs/>';
  if(col)    r+=`<w:color w:val="${col}"/>`;
  return `<w:rPr>${r}</w:rPr>`;
}
function run(text,opts={}){
  return `<w:r>${rpr(opts)}<w:t xml:space="preserve">${xe(text)}</w:t></w:r>`;
}
function para(runs,pOpts={}){
  const{align,shade,sb=0,sa=80,il=0,ir=0,border_bottom,numPr}=pOpts;
  let pp='';
  if(shade)pp+=`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`;
  if(align)pp+=`<w:jc w:val="${align}"/>`;
  if(sb||sa)pp+=`<w:spacing w:before="${sb}" w:after="${sa}"/>`;
  if(il||ir)pp+=`<w:ind w:left="${il}" w:right="${ir}"/>`;
  if(border_bottom)pp+=`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${border_bottom}"/></w:pBdr>`;
  if(numPr)pp+=`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numPr}"/></w:numPr>`;
  const r=Array.isArray(runs)?runs.join(''):runs;
  return `<w:p>${pp?`<w:pPr>${pp}</w:pPr>`:''}${r}</w:p>`;
}
function emptyPara(sa=120){return para('',{sa});}

// ── Section header ────────────────────────────────────
function sectionHdr(text){
  // Full-width dark green bar with white text + gold left accent
  return para(
    run('\u2003'+text,{font:'Calibri',sz:11,bold:true,col:'FFFFFF'}),
    {shade:'1A3327',sb:280,sa:0}
  );
}
function subHdr(text){
  return para(
    run(text,{font:'Calibri',sz:10,bold:true,col:'1A3327'}),
    {border_bottom:'D4A017',sb:160,sa:40}
  );
}

// ── Table helpers ─────────────────────────────────────
function borders(c='D4E6DA'){
  return `<w:top w:val="single" w:sz="4" w:color="${c}"/>`
    +`<w:left w:val="single" w:sz="4" w:color="${c}"/>`
    +`<w:bottom w:val="single" w:sz="4" w:color="${c}"/>`
    +`<w:right w:val="single" w:sz="4" w:color="${c}"/>`
    +`<w:insideH w:val="single" w:sz="4" w:color="${c}"/>`
    +`<w:insideV w:val="single" w:sz="4" w:color="${c}"/>`;
}
function tcell(text,w,opts={}){
  const{bold=false,sz=10,col='111111',shade=null,align='left',italic=false}=opts;
  let tp=`<w:tcW w:w="${w}" w:type="dxa"/>`;
  tp+=`<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar>`;
  if(shade)tp+=`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`;
  const pA=align==='center'?'center':align==='right'?'right':'left';
  return `<w:tc><w:tcPr>${tp}</w:tcPr>${para(run(text,{font:'Calibri',sz,bold,col,italic}),{align:pA,sa:0,sb:0})}</w:tc>`;
}
function thcell(text,w,opts={}){
  return tcell(text,w,{bold:true,sz:9,col:'FFFFFF',shade:'1A3327',align:'center',...opts});
}
function trow(cells,opts={}){
  const hdr=opts.header?'<w:trPr><w:tblHeader/></w:trPr>':'';
  return `<w:tr>${hdr}${cells}</w:tr>`;
}
function table(cols,rows,opts={}){
  const{c='D4E6DA'}=opts;
  const total=cols.reduce((a,b)=>a+b,0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${borders(c)}</w:tblBorders><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

// ══════════════════════════════════════════════════════
async function generateDocx(){
  const dv=document.getElementById('meta-date').value;
  const sv=document.getElementById('meta-shift').value;
  const mv=document.getElementById('meta-mod').value;
  const shiftFull={'Day Shift':'Day Shift (7:00 a.m. \u2013 3:30 p.m.)','Swing Shift':'Swing Shift (3:00 p.m. \u2013 11:30 p.m.)','Graveyard Shift':'Graveyard Shift (11:00 p.m. \u2013 7:30 a.m.)'}[sv]||sv;
  const dateStr=dv?new Date(dv+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'—';
  const stShd={building:'D8F3DC',work:'DBEAFE',pass:'FEF9C3',bhc:'EDE9FE',efc:'FCE7F3',hospital:'FEE2E2',out:'FFF7ED',vacant:'F1F5F9'};
  const stLbl={building:'In Building',work:'Work',pass:'Weekend Pass',bhc:'BHC',efc:'EFC',hospital:'Hospital',out:'Out / Other',vacant:'Vacant'};
  const cnt={building:0,work:0,pass:0,bhc:0,efc:0,hospital:0,out:0};
  CLIENTS.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT').forEach(c=>{const st=shiftStatuses[c.id]||'building';if(cnt.hasOwnProperty(st))cnt[st]++;});
  const tot=Object.values(cnt).reduce((a,b)=>a+b,0);
  const CW=9360;
  let body='';

  // ── LETTERHEAD ──────────────────────────────────────
  // Gold top bar
  body+=para(run('',{sz:4}),{shade:'D4A017',sb:0,sa:0});
  // Dark green org banner
  body+=para([
    run('POSITIVE DIRECTIONS EQUALS CHANGE  \u00b7  WESTSIDE COMMUNITY SERVICES',{font:'Calibri',sz:8,col:'A8D5B5',bold:true}),
  ],{shade:'163825',sb:0,sa:0,align:'center'});
  // Deep green main title
  body+=para(run(window.FACILITY_NAME||FACILITY_NAME,{font:'Calibri',sz:24,bold:true,col:'FFFFFF'}),{shade:'1A3327',sb:0,sa:0,align:'center'});
  body+=para(run(shiftFull,{font:'Calibri',sz:13,col:'D4E6DA'}),{shade:'2D6A4F',sb:0,sa:0,align:'center'});
  // Gold bottom bar
  body+=para(run('',{sz:4}),{shade:'D4A017',sb:0,sa:200});

  // ── REPORT INFO TABLE ─────────────────────────────
  const iCols=[2800,CW-2800];
  const infoRows=[
    ['Date',dateStr],
    ['Shift',shiftFull],
    ['Monitors on Duty (MOD)',mv||'—'],
  ].map(([l,v])=>trow(
    tcell(l,iCols[0],{bold:true,sz:9,col:'5C6B5E',shade:'F4FAF6'})+
    tcell(v,iCols[1],{sz:10,col:'1A3327'})
  ));
  body+=table(iCols,infoRows,{c:'D4E6DA'});
  body+=emptyPara(140);

  // ── CENSUS ───────────────────────────────────────
  body+=sectionHdr('CENSUS');
  const cKeys=['building','work','pass','bhc','efc','hospital','out','TOTAL'];
  const cLabels={building:'In Building',work:'At Work',pass:'Weekend Pass',bhc:'BHC',efc:'EFC',hospital:'Hospital',out:'Out/Other',TOTAL:'TOTAL'};
  const cW2=Math.floor(CW/8);
  const censusBg={building:'D8F3DC',work:'DBEAFE',pass:'FEF9C3',bhc:'EDE9FE',efc:'FCE7F3',hospital:'FEE2E2',out:'FFF7ED',TOTAL:'D4A017'};
  const censusFg={building:'14532D',work:'1D4ED8',pass:'854D0E',bhc:'5B21B6',efc:'9D174D',hospital:'991B1B',out:'7C2D12',TOTAL:'FFFFFF'};
  const censusHeaderRow=trow(cKeys.map(k=>thcell(cLabels[k],cW2)).join(''),{header:true});
  const censusValRow=trow(cKeys.map(k=>{
    const val=k==='TOTAL'?String(tot):String(cnt[k]);
    return tcell(val,cW2,{bold:true,sz:16,col:censusFg[k]||'1A3327',shade:censusBg[k]||'F8FAFC',align:'center'});
  }).join(''));
  body+=table(Array(8).fill(cW2),[censusHeaderRow,censusValRow],{c:'D4E6DA'});
  body+=emptyPara(140);

  // ── SHIFT ACTIVITY LOG ───────────────────────────
  body+=sectionHdr('SHIFT ACTIVITY LOG');
  if(!logEntries.length){
    body+=para(run('No entries recorded.',{sz:10,col:'94A3B8',italic:true}),{sa:40,il:160});
  } else {
    const logCols=[1000,CW-1000];
    const logRows=logEntries.map((e,i)=>trow(
      tcell(e.time,logCols[0],{bold:true,sz:10,col:'2D6A4F',shade:i%2===0?'FFFFFF':'F4FAF6'})+
      tcell(e.text,logCols[1],{sz:10,col:'111111',shade:i%2===0?'FFFFFF':'F4FAF6'})
    ));
    body+=table(logCols,logRows,{c:'D4E6DA'});
  }
  body+=emptyPara(140);

  // ── ISSUES & CONCERNS ────────────────────────────
  body+=sectionHdr('ISSUES & CONCERNS');
  if(!issues.length){
    body+=para(run('None.',{sz:10,col:'94A3B8',italic:true}),{sa:40,il:160});
  } else {
    issues.forEach((v,i)=>{
      body+=para([
        run('\u25cf  ',{sz:10,col:'D4A017',bold:true}),
        run(v,{sz:10,col:'111111'}),
      ],{sa:60,il:200,shade:i%2===0?'FFFFFF':'FFFBF0'});
    });
  }
  body+=emptyPara(140);

  // ── MEDICAL NOTES ────────────────────────────────
  if(medNotes.length){
    body+=sectionHdr('MEDICAL NOTES');
    medNotes.forEach((n,i)=>{
      body+=para([
        run('\u25cf  ',{sz:10,col:'D4A017',bold:true}),
        run(n,{sz:10,col:'111111'}),
      ],{sa:60,il:200,shade:i%2===0?'FFFBF0':'FFFFFF'});
    });
    body+=emptyPara(140);
  }

  // ── RESIDENT ROSTER ──────────────────────────────
  body+=sectionHdr('RESIDENT ROSTER');
  const rC=[640,2000,1500,1600,3620];
  const rosterHeaderRow=trow(
    [thcell('Rm #',rC[0]),thcell('Name',rC[1]),thcell('Case Manager',rC[2]),thcell('Status',rC[3]),thcell('Comments',rC[4])].join(''),
    {header:true}
  );
  const rosterRows=CLIENTS.filter(c=>c.is_active).map((c,i)=>{
    const rs=i%2===0?'FFFFFF':'F4FAF6';
    if(c.is_special){
      return trow([
        tcell(c.room,rC[0],{sz:8,col:'94A3B8',shade:'F1F5F9',align:'center'}),
        tcell(c.name,rC[1],{sz:9,col:'94A3B8',shade:'F1F5F9',italic:true}),
        tcell('',rC[2],{shade:'F1F5F9'}),tcell('',rC[3],{shade:'F1F5F9'}),tcell('',rC[4],{shade:'F1F5F9'}),
      ].join(''));
    }
    const st=shiftStatuses[c.id]||(c.name==='VACANT'?'vacant':'building');
    return trow([
      tcell(c.room,rC[0],{sz:9,col:'5C6B5E',shade:rs,align:'center',bold:true}),
      tcell(c.name,rC[1],{sz:10,col:'1A3327',shade:rs,bold:true}),
      tcell(c.case_manager||'',rC[2],{sz:9,col:'5C6B5E',shade:rs}),
      tcell(stLbl[st]||st,rC[3],{sz:9,col:'1A3327',shade:stShd[st]||rs,align:'center',bold:true}),
      tcell(shiftComments[c.id]||'',rC[4],{sz:9,col:'444444',shade:rs}),
    ].join(''));
  });
  body+=table(rC,[rosterHeaderRow,...rosterRows],{c:'D4E6DA'});
  body+=emptyPara(80);

  // ── FOOTER LINE ──────────────────────────────────
  body+=para(run('Positive Directions Equals Change  \u00b7  Westside Community Services  \u00b7  '+(window.FACILITY_NAME||FACILITY_NAME),{sz:8,col:'5C6B5E',italic:true}),{align:'center',border_bottom:'D4A017',sb:0,sa:0});

  // ── ASSEMBLE XML ─────────────────────────────────
  const docXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    +`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    +`<w:body>${body}`
    +`<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr>`
    +`</w:body></w:document>`;

  const ctXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relsXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const wRelsXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const zip=new JSZip();
  zip.file('[Content_Types].xml',ctXml);
  zip.file('_rels/.rels',relsXml);
  zip.file('word/document.xml',docXml);
  zip.file('word/_rels/document.xml.rels',wRelsXml);
  return await zip.generateAsync({type:'uint8array'});
}

// ── Default log entries per shift ─────────────────────────────
