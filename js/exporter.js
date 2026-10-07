(function(global){
  'use strict';
  const P=global.MFParser;
  const moneyFields=new Set(['GrossAmountAUD','MerchantFeeExclGST','MerchantFeeGST','MerchantFeeInclGST','FeeAmountAUD','FeeExGST','GSTOnFee','FeeInclGST','NetAmountAUD','GrossOriginalCurrency']);

  function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function colName(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
  function cell(ref,val,style){
    if(val===null||val===undefined||val==='')return `<c r="${ref}"${style?` s="${style}"`:''}/>`;
    if(typeof val==='number'&&Number.isFinite(val))return `<c r="${ref}"${style?` s="${style}"`:''}><v>${val}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style?` s="${style}"`:''}><is><t>${esc(val)}</t></is></c>`;
  }
  function csvValue(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"';}
  function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);}

  function detailMatrices(details){
    const afterHeaders=['Date','OrderID','GrossAmountAUD','MerchantFeeExclGST','MerchantFeeGST','MerchantFeeInclGST','NetAmountAUD'];
    const payHeaders=['Date','OrderID','OriginalCurrency','GrossOriginalCurrency','GrossAmountAUD','FeeAmountAUD','NetAmountAUD','Type'];
    const shopHeaders=['Date','OrderID','GrossAmountAUD','FeeExGST','GSTOnFee','FeeInclGST','NetAmountAUD'];
    const build=(headers,rows)=>{
      const out=[headers];
      rows.forEach(r=>out.push(headers.map(h=>(moneyFields.has(h)&&r[h]!==''&&r[h]!=null)?P.round2(r[h]):r[h])));
      const total=new Array(headers.length).fill('');
      total[headers.indexOf('OrderID')>=0?headers.indexOf('OrderID'):0]='TOTAL';
      headers.forEach((h,i)=>{if(moneyFields.has(h)){const vals=rows.map(r=>Number(r[h])).filter(Number.isFinite);if(vals.length)total[i]=P.round2(vals.reduce((s,v)=>s+v,0));}});
      out.push(total); return out;
    };
    return {
      Afterpay:build(afterHeaders,details.afterpay||[]),
      Paypal:build(payHeaders,details.paypal||[]),
      Shopify:build(shopHeaders,details.shopify||[])
    };
  }

  function mainMatrix(sections){
    const map=Object.fromEntries(sections.map(s=>[s.kind,s.rows]));
    const out=[];
    function blanks(n=1){for(let i=0;i<n;i++)out.push([]);}
    function block(title,kind,headers,rowBuilder){
      out.push([title]);out.push(headers);
      const rows=map[kind]||[];
      const totals=new Array(headers.length).fill(0);
      rows.forEach(r=>{const a=rowBuilder(r);out.push(a);for(let i=1;i<a.length;i++)totals[i]+=Number(a[i]||0);});
      out.push(['Grand Total',...totals.slice(1).map(P.round2)]);blanks(3);
    }
    block('Afterpay','afterpay',['Row Labels','Count of OrderID','Sum of GrossAmountAUD','Sum of MerchantFeeExclGST','Sum of MerchantFeeGST','Sum of MerchantFeeInclGST','Sum of NetAmountAUD'],r=>[r.day,r.count,r.gross,r.feeEx,r.gst,r.feeIncl,r.net]);
    block('Paypal','paypal',['Row Labels','Count of OrderID','Sum of GrossAmountAUD','Sum of FeeAmountAUD','Sum of NetAmountAUD'],r=>[r.day,r.count,r.gross,r.fee,r.net]);
    block('Shopify','shopify',['Row Labels','Count of OrderID','Sum of GrossAmountAUD','Sum of FeeExGST','Sum of GSTOnFee','Sum of FeeInclGST','Sum of NetAmountAUD'],r=>[r.day,r.count,r.gross,r.feeEx,r.gst,r.feeIncl,r.net]);
    while(out.length&&!out[out.length-1].length)out.pop();return out;
  }

  function sheetXml(matrix){
    const rows=[];
    matrix.forEach((r,ri)=>{
      const cells=[];
      r.forEach((v,ci)=>{
        const ref=colName(ci+1)+(ri+1);
        const first=String(r[0]??'');
        let style=0;
        if(ri===0||first==='Afterpay'||first==='Paypal'||first==='Shopify'||first==='Grand Total'||first==='Date'||first==='Row Labels')style=2;
        if(typeof v==='number'&&ci>=2)style=1;
        cells.push(cell(ref,v,style));
      });
      rows.push(`<row r="${ri+1}">${cells.join('')}</row>`);
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="10" width="23" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
  }

  async function makeWorkbook(sheets){
    const zip=new JSZip(),names=Object.keys(sheets);
    const overrides=names.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`);
    zip.folder('_rels').file('.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    const sheetTags=names.map((n,i)=>`<sheet name="${esc(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
    zip.folder('xl').file('workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`);
    const rels=names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${names.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    zip.folder('xl').folder('_rels').file('workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
    zip.folder('xl').file('styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00;[Red]-0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>');
    const wsf=zip.folder('xl').folder('worksheets');names.forEach((n,i)=>wsf.file(`sheet${i+1}.xml`,sheetXml(sheets[n])));
    return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  function gatewayCSV(summary){
    const lines=[['Payment gateway','Transactions','Gross payments','Refunded payments','Net payments']];
    summary.forEach(r=>lines.push([r.gateway,r.transactions,P.round2(r.gross),P.round2(r.refund),P.round2(r.net)]));
    return lines.map(r=>r.map(csvValue).join(',')).join('\r\n');
  }

  const MJ_CONFIG={
    afterpayFee:{code:'202',name:'Fees AfterPay'}, afterpayClearing:{code:'253',name:'Afterpay Clearing Account'},
    paypalFee:{code:'206',name:'Fees Paypal'}, paypalClearing:{code:'252',name:'PayPal Clearing Account'},
    shopifyFee:{code:'216',name:'Fees Shopify'}, shopifyClearing:{code:'251',name:'Shopify Clearing Account'},
    rounding:{code:'860',name:'Rounding'}, taxGstOnIncome:'GST on Income', taxBasExcluded:'BAS Excluded'
  };
  const MJ_HEADERS=['*Narration','*Date','Description','*AccountCode','*TaxRate','*Amount','TrackingName1','TrackingOption1','TrackingName2','TrackingOption2'];

  function manualJournalMatrix(sections,from,to){
    const C=MJ_CONFIG, byKind=Object.fromEntries(sections.map(s=>[s.kind,s.rows])),byDay={};
    ['afterpay','paypal','shopify'].forEach(kind=>(byKind[kind]||[]).forEach(r=>{(byDay[r.day]=byDay[r.day]||{})[kind]=r;}));
    const days=Object.keys(byDay).filter(d=>(!from||d>=from)&&(!to||d<=to)).sort(),out=[MJ_HEADERS];
    days.forEach(day=>{
      const ap=byDay[day].afterpay,pp=byDay[day].paypal,sp=byDay[day].shopify;
      const apEx=P.round2(ap?.feeEx||0),apIncl=P.round2(ap?.feeIncl||0),ppFee=P.round2(pp?.fee||0),spEx=P.round2(sp?.feeEx||0),spIncl=P.round2(sp?.feeIncl||0);
      if(!apEx&&!ppFee&&!spEx)return;
      const [y,m,d]=day.split('-'),dateStr=`${d}/${m}/${y}`,narration=`Fees on Sales as on ${d}.${m}.${y}`;
      const line=(acc,tax,amount)=>[narration,dateStr,narration,acc.code,tax,P.round2(amount),'','','',''];
      // Xero single Amount convention used here: debit = plain positive number (no '+' sign), credit = negative number.
      if(apEx)out.push(line(C.afterpayFee,C.taxGstOnIncome,apEx));
      if(apIncl)out.push(line(C.afterpayClearing,C.taxBasExcluded,-apIncl));
      if(ppFee){out.push(line(C.paypalFee,C.taxBasExcluded,ppFee));out.push(line(C.paypalClearing,C.taxBasExcluded,-ppFee));}
      if(spEx)out.push(line(C.shopifyFee,C.taxGstOnIncome,spEx));
      if(spIncl)out.push(line(C.shopifyClearing,C.taxBasExcluded,-spIncl));
      const debitInclXero=P.round2(apEx*1.1)+ppFee+P.round2(spEx*1.1),creditRaw=apIncl+ppFee+spIncl;
      const rounding=P.round2(creditRaw-debitInclXero);
      if(Math.abs(rounding)>=0.005)out.push(line(C.rounding,C.taxBasExcluded,rounding));
    });
    return out;
  }
  function manualJournalCSV(sections,from,to){return manualJournalMatrix(sections,from,to).map(r=>r.map(csvValue).join(',')).join('\r\n');}

  async function downloadMerchant(result,from,to){
    const details=detailMatrices(result.details),sheets={Main:mainMatrix(result.sections),Afterpay:details.Afterpay,Paypal:details.Paypal,Shopify:details.Shopify};
    const blob=await makeWorkbook(sheets);download(blob,`Merchant fee${from&&to?` - ${from} - ${to}`:''}.xlsx`);
  }
  function downloadGateway(summary,from,to){download(new Blob([gatewayCSV(summary)],{type:'text/csv;charset=utf-8'}),`Payments by gateway summary${from&&to?` - ${from} - ${to}`:''}.csv`);}
  function downloadManualJournal(sections,from,to){download(new Blob([manualJournalCSV(sections,from,to)],{type:'text/csv;charset=utf-8'}),`Manual Journal - Merchant Fees${from&&to?` - ${from} - ${to}`:''}.csv`);}

  function fxAuditCSV(entries){
    const lines=[['Gateway','Transaction date','Currency','FX rate date','Currency to AUD rate','Provider']];
    (entries||[]).slice().sort((a,b)=>a.day.localeCompare(b.day)||a.gateway.localeCompare(b.gateway)||a.currency.localeCompare(b.currency)).forEach(a=>lines.push([a.gateway,a.day,a.currency,a.rateDate,a.rate,a.source]));
    return lines.map(r=>r.map(csvValue).join(',')).join('\r\n');
  }
  function reviewCSV(items){const rows=[['Severity','Category','Gateway','Date','Reference','Details']];(items||[]).forEach(i=>rows.push([i.severity,i.category,i.gateway,i.date,i.reference,i.detail]));return rows.map(r=>r.map(csvValue).join(',')).join('\r\n');}
  function downloadReview(items,from,to){download(new Blob([reviewCSV(items)],{type:'text/csv;charset=utf-8'}),`Merchant Fee Review${from&&to?` - ${from} - ${to}`:''}.csv`);}
  function paypalFxFeeCSV(items){
    // Currency-group displays must add up to the SAME rounded daily fee pool
    // as the engine (round the daily source once, then allocate presentation cents).
    const grouped={};
    (items||[]).forEach((x,i)=>{(grouped[x.day]||(grouped[x.day]=[])).push({...x,_index:i});});
    const centsByIndex=new Map();
    Object.keys(grouped).forEach(day=>{
      const entries=grouped[day];
      const exact=entries.map(x=>Number(x.feeAUD)*100);
      const floor=exact.map(x=>Math.floor(x));
      let remaining=Math.round(exact.reduce((a,b)=>a+b,0))-floor.reduce((a,b)=>a+b,0);
      const order=entries.map((x,i)=>i).sort((a,b)=>(exact[b]-floor[b])-(exact[a]-floor[a])||a-b);
      for(let i=0;i<remaining;i++)floor[order[i%order.length]]++;
      entries.forEach((x,i)=>centsByIndex.set(x._index,floor[i]));
    });
    const rows=[['Date','Currency','Rate Date','AUD Per Currency','FX Provider','Source Transactions','Fee Original Currency','Fee AUD','Fee AUD Unrounded','Gross Original Currency','Gross AUD']];
    (items||[]).forEach((r,i)=>rows.push([r.day,r.currency,r.rateDate,r.rate,r.rateSource,r.sourceRows,P.round2(r.feeOriginal),(centsByIndex.get(i)||0)/100,Number(r.feeAUD).toFixed(6),P.round2(r.grossOriginal),P.round2(r.grossAUD)]));
    return rows.map(r=>r.map(csvValue).join(',')).join('\r\n');
  }
  function downloadPaypalFxFee(items,from,to){download(new Blob([paypalFxFeeCSV(items)],{type:'text/csv;charset=utf-8'}),`PayPal FX Fee Audit${from&&to?` - ${from} - ${to}`:''}.csv`);}
  function downloadFxAudit(entries,from,to){download(new Blob([fxAuditCSV(entries)],{type:'text/csv;charset=utf-8'}),`FX Audit${from&&to?` - ${from} - ${to}`:''}.csv`);}
  function roundingAuditCSV(entries){
    const lines=[['Gateway','Date','OrderID','Field','Unrounded Allocation','Independent 2dp Round','Final Allocated Amount','Rounding Adjustment']];
    (entries||[]).forEach(r=>lines.push([r.gateway,r.date,r.orderID,r.field,r.ideal,r.independent,r.allocated,r.adjustment]));
    return lines.map(r=>r.map(csvValue).join(',')).join('\r\n');
  }
  function downloadRoundingAudit(entries,from,to){download(new Blob([roundingAuditCSV(entries)],{type:'text/csv;charset=utf-8'}),`Rounding Audit${from&&to?` - ${from} - ${to}`:''}.csv`);}
  global.MFExporter={paypalFxFeeCSV,downloadPaypalFxFee,reviewCSV,downloadReview,roundingAuditCSV,downloadRoundingAudit,downloadMerchant,downloadGateway,downloadManualJournal,mainMatrix,detailMatrices,gatewayCSV,manualJournalCSV,manualJournalMatrix,MJ_CONFIG,makeWorkbook,fxAuditCSV,downloadFxAudit};
})(window);
