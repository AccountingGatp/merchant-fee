(function(global){
  'use strict';

  function parseCSV(text){
    text = String(text || '').replace(/^\uFEFF/, '');
    const rows=[]; let row=[], cell='', quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"' && text[i+1]==='"'){cell+='"'; i++;}
        else if(ch==='"'){quoted=false;}
        else cell+=ch;
      }else{
        if(ch==='"') quoted=true;
        else if(ch===','){row.push(cell); cell='';}
        else if(ch==='\n'){row.push(cell.replace(/\r$/,'')); rows.push(row); row=[]; cell='';}
        else cell+=ch;
      }
    }
    if(cell.length || row.length){row.push(cell.replace(/\r$/,'')); rows.push(row);}
    while(rows.length && rows[rows.length-1].every(v=>String(v).trim()==='')) rows.pop();
    if(!rows.length) return {headers:[],rows:[]};
    const headers=rows[0].map(h=>String(h).trim());
    const data=rows.slice(1).filter(r=>r.some(v=>String(v).trim()!=='' )).map(r=>{
      const obj={}; headers.forEach((h,idx)=>obj[h]=r[idx] ?? ''); return obj;
    });
    return {headers,rows:data};
  }

  function normalizeHeader(s){
    return String(s||'').trim().toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
  }
  function normText(s){return String(s??'').trim().toLowerCase();}
  function cleanNumber(v){
    if(typeof v==='number') return Number.isFinite(v)?v:0;
    let s=String(v??'').trim(); if(!s) return 0;
    let neg=false; if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}
    s=s.replace(/[$£€¥₹,%\s]/g,'').replace(/,/g,'');
    const n=Number(s); return Number.isFinite(n)?(neg?-n:n):0;
  }
  function round2(n){const x=Number(n)||0;return Math.round((x+(x>=0?Number.EPSILON:-Number.EPSILON))*100)/100;}
  function parseDate(v){
    if(v instanceof Date && !isNaN(v)) return v;
    const s=String(v??'').trim(); if(!s) return null;
    let m;
    if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
    if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(Date.UTC(+m[3],+m[2]-1,+m[1])); // SOP reports use day-first
    if((m=s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/))){
      const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const y=+m[3]<100?2000+(+m[3]):+m[3]; const mo=months[m[2].toLowerCase()];
      if(mo!==undefined) return new Date(Date.UTC(y,mo,+m[1]));
    }
    const d=new Date(s); return isNaN(d)?null:new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  }
  function dateKey(d){return d?`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`:'';}
  function formatDate(d){if(!d)return ''; return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;}
  function minMaxDates(rows,field){
    const ds=rows.map(r=>parseDate(r[field])).filter(Boolean).sort((a,b)=>a-b); return ds.length?{min:ds[0],max:ds[ds.length-1]}:{min:null,max:null};
  }
  function readFile(file){
    return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onerror=()=>reject(fr.error);fr.onload=()=>resolve(String(fr.result||''));fr.readAsText(file);});
  }
  global.MFParser={parseCSV,normalizeHeader,normText,cleanNumber,round2,parseDate,dateKey,formatDate,minMaxDates,readFile};
})(window);
