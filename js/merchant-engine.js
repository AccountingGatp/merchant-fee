(function(global){
  'use strict';
  const P=global.MFParser;

  function inRange(d,from,to){
    if(!d)return false;
    const k=P.dateKey(d);
    return (!from||k>=from)&&(!to||k<=to);
  }

  function gatewayKind(name){
    const s=String(name||'').toLowerCase().replace(/[_-]/g,' ');
    if(s.includes('afterpay'))return 'afterpay';
    if(s.includes('paypal'))return 'paypal';
    if(s.includes('shopify'))return 'shopify';
    if(s.includes('shop cash'))return 'shop_cash';
    return 'other';
  }

  function buildOrderMaster(rows,from,to){
    const issues=[];
    const map=new Map();
    const summary={};
    for(const r of rows){
      const d=P.parseDate(r['Day']);
      if(!inRange(d,from,to))continue;
      const day=P.dateKey(d);
      const gateway=String(r['Payment gateway']||'').trim();
      const kind=gatewayKind(gateway);
      let order=String(r['Order name']||'').trim();
      // Do not invent a Shopify Order Name: synthetic TXN-* identifiers violate the SOP.
      if(!order && ['shopify','paypal','afterpay'].includes(kind)) {
        const txn=String(r['Transaction ID']||'').trim()||'unknown transaction';
        issues.push({severity:'REVIEW',category:'Missing Shopify Order Name',gateway:kind,date:day,reference:txn,detail:'Unidentified transaction excluded from order-level sheets; retained in the raw gateway summary. Obtain Shopify Order Name and reprocess for complete results.'});
      }
      if(!order){
        // Preserve source-level gateway totals, but NEVER invent an OrderID.
        const gross=P.cleanNumber(r['Gross payments']),refund=P.cleanNumber(r['Refunded payments']),net=P.cleanNumber(r['Net payments']);
        const a=summary[gateway]||(summary[gateway]={gateway,transactions:0,gross:0,refund:0,net:0});
        a.transactions++;a.gross+=gross;a.refund+=refund;a.net+=net;
        continue;
      }
      const gross=P.cleanNumber(r['Gross payments']);
      const refund=P.cleanNumber(r['Refunded payments']);
      const net=P.cleanNumber(r['Net payments']);
      const key=`${day}|${kind}|${order}`;
      const q=map.get(key)||{day,kind,gateway,order,gross:0,refund:0,net:0,sourceRows:0,transactionIds:[]};
      q.gross+=gross; q.refund+=refund; q.net+=net; q.sourceRows++;
      const sourceTxn=String(r['Transaction ID']||'').trim();if(sourceTxn&&!q.transactionIds.includes(sourceTxn))q.transactionIds.push(sourceTxn);
      map.set(key,q);

      const s=summary[gateway]||(summary[gateway]={gateway,transactions:0,gross:0,refund:0,net:0});
      s.transactions++; s.gross+=gross; s.refund+=refund; s.net+=net;
    }
    const orders=[...map.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.order.localeCompare(b.order));
    return {orders,summary:Object.values(summary),issues};
  }

  function salesCrossCheck(salesRows,orders,from,to,warnings){
    const seen=new Set();
    for(const r of salesRows||[]){
      const d=P.parseDate(r['Day']); if(!inRange(d,from,to))continue;
      const order=String(r['Order name']||'').trim();
      if(order)seen.add(`${P.dateKey(d)}|${order}`);
    }
    const missing=orders.filter(o=>!seen.has(`${o.day}|${o.order}`));
    if(missing.length){
      warnings.push(`${missing.length} Net Payments order(s) were not found in Total Sales by Order for the same date. Net Payments remains the source of truth per SOP.`);
    }
  }

  function dailyPool(rows,from,to,dateField,reader){
    const out={};
    for(const r of rows){
      const d=P.parseDate(r[dateField]); if(!inRange(d,from,to))continue;
      const day=P.dateKey(d), q=out[day]||(out[day]={});
      reader(r,q);
    }
    return out;
  }

  // Shopify fee amounts in the Payment Transactions export are denominated
  // in EACH ROW'S 'Currency', not necessarily AUD. Exclude other gateways and
  // transaction types; only transactions for Net Payments Shopify orders qualify.
  async function shopifyFeePool(rows,master,from,to,fx){
    const eligible=new Set(master.orders.filter(o=>o.kind==='shopify').map(o=>`${o.day}|${o.order}`));
    const pool={}, audit={excluded:{otherGateway:0,unmatched:0,transactionType:0,zeroFee:0},fx:[]};
    for(const r of rows){
      const d=P.parseDate(r['Transaction Date']);if(!inRange(d,from,to))continue;
      const day=P.dateKey(d),order=String(r['Order']||'').trim();
      const type=String(r['Type']||'').trim().toLowerCase().replace(/[_-]/g,' ');
      const method=String(r['Payment Method Name']||'').trim().toLowerCase().replace(/[_-]/g,' ');
      // Shop Cash credits and other balance events aren't Shopify Payments charges.
      if(type==='shop cash credit'||method==='shop cash'){audit.excluded.otherGateway++;continue;}
      if(type!=='charge'&&type!=='refund'){audit.excluded.transactionType++;continue;}
      if(!eligible.has(`${day}|${order}`)){audit.excluded.unmatched++;continue;}
      const fee=P.cleanNumber(r['Fee']), gst=P.cleanNumber(r['GST']);
      if(!fee&&!gst){audit.excluded.zeroFee++;continue;}
      const currency=String(r['Currency']||'').trim().toUpperCase();
      if(!/^[A-Z]{3}$/.test(currency))throw new Error(`Shopify transaction ${order} on ${day} has missing or invalid Currency; cannot convert Fee/GST to AUD.`);
      const info=await fx.getRate(day,currency);
      const q=pool[day]||(pool[day]={feeIncl:0,gst:0,feeEx:0,sourceRows:0,currencies:{}});
      q.feeIncl+=fee*info.rate;q.gst+=gst*info.rate;q.feeEx+=(fee-gst)*info.rate;
      q.sourceRows++;q.currencies[currency]=(q.currencies[currency]||0)+1;
      fx.recordUsage('Shopify',day,currency,info);
    }
    return {pool,audit};
  }

  function afterpayFeePool(rows,from,to){
    return dailyPool(rows,from,to,'Settlement Date',(r,q)=>{
      q.feeEx=(q.feeEx||0)+P.cleanNumber(r['Merchant Fee excl Tax']);
      q.gst=(q.gst||0)+P.cleanNumber(r['Merchant Fee Tax']);
      q.feeIncl=(q.feeIncl||0)+P.cleanNumber(r['Merchant Fee incl Tax']);
      q.sourceRows=(q.sourceRows||0)+1;
    });
  }

  // PayPal and Shopify use the SAME dated ECB reference series via
  // Frankfurter. The historical reference is reproducible and avoids mixing
  // unrelated provider rates, which previously changed the fee total.
  // No source values, dates, exchange rates or totals are hardcoded.

  // Banque de France's EUR reference crosses match the ECB daily EUR tables.
  // Pin Frankfurter to provider ECB (never use the blended multi-provider rate).
  // AUD per foreign unit = (EUR→AUD) / (EUR→foreign currency).
  // Most recent publication on/before the transaction date is used on weekends.
  const FX_BASE='https://api.frankfurter.dev/v2/providers/ecb/rates';
  function isoBack(day,offset){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-offset);return d.toISOString().slice(0,10);}
  function makeFX(allCurrencies,warnings){
    const needed=[...new Set([...allCurrencies,'AUD'].map(x=>String(x||'').toUpperCase()).filter(x=>/^[A-Z]{3}$/.test(x)&&x!=='EUR'))].sort();
    const requested=new Map(),used=new Map();
    async function dailyRates(day){
      if(requested.has(day))return requested.get(day);
      const task=(async()=>{
        const url=`${FX_BASE}?date=${encodeURIComponent(day)}&base=EUR&quotes=${encodeURIComponent(needed.join(','))}`;
        let resp;
        const controller=typeof AbortController!=='undefined'?new AbortController():null;
        const timer=controller?setTimeout(()=>controller.abort(),12000):null;
        try{resp=await fetch(url,{headers:{Accept:'application/json'},cache:'default',...(controller?{signal:controller.signal}:{})});}
        catch(e){throw new Error(`FX API network failure/timeout for ${day}: ${e.message||e}. Check internet connection and browser access to Frankfurter.`);}
        finally{if(timer)clearTimeout(timer);}
        if(!resp.ok){let note='';try{note=(await resp.text()).slice(0,160);}catch(_){}throw new Error(`FX API returned HTTP ${resp.status} for ${day}. ${note}`);}
        const records=await resp.json();
        if(!Array.isArray(records))throw new Error(`Unexpected FX API response on ${day}: ECB historical rates array required.`);
        const map={};
        for(const r of records){
          if(r.base!=='EUR'||!needed.includes(String(r.quote||'').toUpperCase()))continue;
          const rate=Number(r.rate), actual=String(r.date||'').slice(0,10);
          if(rate>0&&Number.isFinite(rate)&&/^\d{4}-\d{2}-\d{2}$/.test(actual)&&actual<=day){
            map[String(r.quote).toUpperCase()]={value:rate,date:actual};
          }
        }
        return map;
      })();requested.set(day,task);return task;
    }
    async function getRate(day,currency){
      const cur=String(currency||'').toUpperCase();
      if(cur==='AUD')return {rate:1,rateDate:day,source:'AUD'};
      if(cur!=='EUR'&&!needed.includes(cur))throw new Error(`FX currency ${cur} not in the current input currencies.`);
      for(let off=0;off<=10;off++){
        const candidate=isoBack(day,off);
        const rates=await dailyRates(candidate);
        if(rates.AUD&&(cur==='EUR'||rates[cur])&&(cur==='EUR'||rates.AUD.date===rates[cur].date)){
          const r=rates.AUD.value/(cur==='EUR'?1:rates[cur].value);
          if(Number.isFinite(r)&&r>0)return {rate:r,rateDate:rates.AUD.date,source:'ECB via Frankfurter'};
        }
      }
      throw new Error(`ECB/Frankfurter has no usable ${cur}→AUD cross rate on or before ${day}; processing stopped rather than substituting a guessed rate.`);
    }
    function recordUsage(gateway,day,currency,info){
      if(currency==='AUD')return;
      const key=`${gateway}|${day}|${currency}|${info.rateDate}`;
      if(!used.has(key))used.set(key,{gateway,day,currency,rateDate:info.rateDate,rate:info.rate,source:info.source});
    }
    function summary(){
      const entries=[...used.values()];
      const prior=entries.filter(x=>x.rateDate!==x.day);
      if(prior.length)warnings.push(`${prior.length} gateway/date/currency group(s) used the most recent prior ECB publication for a weekend/holiday. Actual rate dates are documented in FX_Audit.csv.`);
      return entries;
    }
    return {getRate,recordUsage,summary};
  }

  // Explicit payment-transaction allowlist. PayPal exports use different labels
  // depending on checkout integration. In particular, Express Checkout Payment
  // is a normal merchant sale and must NOT be excluded. Exclude reserve,
  // withdrawal and currency-conversion activity, even if they have a fee.
  function paypalFeeTransaction(row){
    const kind=String(row['Type']||'').trim().toLowerCase().replace(/\s+/g,' ');
    const status=String(row['Status']||'').trim().toLowerCase();
    if(status && !['completed','refunded','partially refunded'].includes(status))return false;
    return kind==='express checkout payment' ||
      kind==='pre-approved payment bill user payment' ||
      kind==='payment refund';
  }

  async function paypalSource(rows,from,to,warnings,fx){
    const txns=[],pool={},byCurrency={};
    const excludedFeeTypes=new Map();
    const relevant=rows.filter(r=>{
      const d=P.parseDate(r['Date']); if(!inRange(d,from,to))return false;
      const eligible=paypalFeeTransaction(r);
      if(!eligible && Math.abs(P.cleanNumber(r['Fee']))>0.0000001){
        const kind=String(r['Type']||'(blank)').trim();
        excludedFeeTypes.set(kind,(excludedFeeTypes.get(kind)||0)+1);
      }
      return eligible;
    });
    if(excludedFeeTypes.size){
      warnings.push('PayPal excluded non-sales transaction types carrying fees: '+
        [...excludedFeeTypes].map(([kind,count])=>`${kind} (${count})`).join(', ')+
        '. These are excluded from merchant sales fee allocation; review them separately if the business needs other PayPal charges.');
    }
    for(const r of relevant){
      const d=P.parseDate(r['Date']), day=P.dateKey(d), cur=String(r['Currency']||'AUD').toUpperCase();
      if(!/^[A-Z]{3}$/.test(cur))throw new Error(`PayPal transaction on ${day} has invalid Currency.`);
      const info=await fx.getRate(day,cur);
      const rate=info.rate,rateDate=info.rateDate,rateSource=info.source;
      fx.recordUsage('PayPal',day,cur,info);
      const originalGross=P.cleanNumber(r['Gross']);
      const sourceFee=P.cleanNumber(r['Fee']);
      const grossAUD=originalGross*rate;
      // PayPal source sales fees are negative and refund fee reversals are positive.
      // Merchant-fee reporting uses the opposite sign: sale fee positive, refund fee negative.
      const feeAUD=(-sourceFee)*rate;
      const type=originalGross<0?'Refund':'Sale';
      txns.push({day,currency:cur,originalGross,grossAUD,feeAUD,type,rate,rateDate,rateSource,transactionId:String(r['Transaction ID']||''),referenceTxnId:String(r['Reference Txn ID']||''),invoiceNumber:String(r['Invoice Number']||''),customNumber:String(r['Custom Number']||''),receiptId:String(r['Receipt ID']||'')});
      const q=pool[day]||(pool[day]={fee:0,gross:0,sourceRows:0}); q.fee+=feeAUD;q.gross+=grossAUD;q.sourceRows++;
      const key=`${day}|${cur}|${rateDate}|${rateSource}`;
      const audit=byCurrency[key]||(byCurrency[key]={day,currency:cur,rateDate,rate,rateSource,sourceRows:0,feeOriginal:0,feeAUD:0,grossOriginal:0,grossAUD:0});
      audit.sourceRows++;audit.feeOriginal+=-sourceFee;audit.feeAUD+=feeAUD;audit.grossOriginal+=originalGross;audit.grossAUD+=grossAUD;
    }
    return {txns,pool,fxFeeAudit:Object.values(byCurrency).sort((a,b)=>a.day.localeCompare(b.day)||a.currency.localeCompare(b.currency))};
  }

  // Largest-remainder apportionment in integer cents (Hamilton method).
  // It preserves the daily source total while assigning each cent to the
  // order with the largest fractional remainder. Tie-break on descending
  // order index so duplicate amounts are deterministic and reproducible.
  function allocateRounded(rows,target,weightField,outField,audit){
    if(!rows.length){
      if(Math.round(Number(target||0)*100)!==0)throw new Error(`Cannot allocate a nonzero fee pool (${target}) without eligible orders.`);
      return;
    }
    const denom=rows.reduce((sum,r)=>sum+Number(r[weightField]||0),0);
    const targetCents=Math.round(Number(target||0)*100);
    if(!Number.isFinite(denom)||Math.abs(denom)<1e-10){
      if(targetCents!==0)throw new Error(`Cannot allocate a nonzero fee pool (${target}) because the daily order allocation basis totals zero.`);
      rows.forEach(r=>r[outField]=0);
      return;
    }
    const exact=rows.map(r=>targetCents*(Number(r[weightField]||0)/denom));
    const cents=exact.map(v=>Math.floor(v));
    let remaining=targetCents-cents.reduce((sum,v)=>sum+v,0);
    if(remaining<0||remaining>rows.length)throw new Error(`Invalid fee apportionment remainder (${remaining})`);
    const ranks=rows.map((_,index)=>index).sort((a,b)=>
      (exact[b]-Math.floor(exact[b]))-(exact[a]-Math.floor(exact[a])) || b-a
    );
    for(let i=0;i<remaining;i++)cents[ranks[i]]++;
    rows.forEach((r,index)=>{
      r[outField]=cents[index]/100;
      if(audit){
        const independentlyRounded=Math.round(exact[index]);
        const centDelta=cents[index]-independentlyRounded;
        if(centDelta!==0)audit.push({gateway:audit.gateway,date:r.day,orderID:r.order,field:outField,ideal:exact[index]/100,independent:independentlyRounded/100,allocated:cents[index]/100,adjustment:centDelta/100});
      }
    });
  }

  function ordersByDay(master,kind,from,to){
    const out={};
    master.orders.forEach(o=>{if(o.kind!==kind||!inRange(P.parseDate(o.day),from,to))return;(out[o.day]||(out[o.day]=[])).push({...o});});
    Object.values(out).forEach(a=>a.sort((x,y)=>x.order.localeCompare(y.order)));
    return out;
  }

  function buildShopifyDetails(master,pool,from,to,roundingAudit){
    const byDay=ordersByDay(master,'shopify',from,to), out=[];
    // Do not quietly discard source fees for a day without a matching order.
    for(const [day,p] of Object.entries(pool)){
      if(!byDay[day]?.length && Math.round((p.feeIncl||0)*100)!==0)
        throw new Error(`Shopify fees on ${day} cannot be allocated: no eligible Shopify orders.`);
    }
    Object.keys(byDay).sort().forEach(day=>{
      const rows=byDay[day], p=pool[day]||{feeEx:0,gst:0,feeIncl:0};
      rows.forEach(r=>r.GrossAmountAUD=P.round2(r.net));
      const targetIncl=P.round2(p.feeIncl||0),targetGst=P.round2(p.gst||0);
      // Critical: allocate fee-INCLUSIVE first, then GST separately.
      // FeeExGST must be derived as (FeeInclGST - GSTOnFee) per order.
      // Independently allocating ex-GST causes different rounding cents.
      allocateRounded(rows,targetIncl,'net','FeeInclGST',Object.assign(roundingAudit,{gateway:'Shopify'}));
      allocateRounded(rows,targetGst,'net','GSTOnFee',Object.assign(roundingAudit,{gateway:'Shopify'}));
      rows.forEach(r=>{
        r.FeeExGST=P.round2(r.FeeInclGST-r.GSTOnFee);
        r.NetAmountAUD=P.round2(r.GrossAmountAUD-r.FeeInclGST);
        out.push({Date:day,OrderID:r.order,GrossAmountAUD:r.GrossAmountAUD,FeeExGST:r.FeeExGST,GSTOnFee:r.GSTOnFee,FeeInclGST:r.FeeInclGST,NetAmountAUD:r.NetAmountAUD});
      });
    });
    return out;
  }

  function buildAfterpayDetails(master,pool,from,to,roundingAudit){
    const byDay=ordersByDay(master,'afterpay',from,to), out=[];
    Object.keys(byDay).sort().forEach(day=>{
      const rows=byDay[day], p=pool[day]||{feeEx:0,gst:0,feeIncl:0};
      rows.forEach(r=>r.GrossAmountAUD=P.round2(r.net));
      const targetIncl=P.round2(p.feeIncl||0),targetGst=P.round2(p.gst||0),targetEx=P.round2(targetIncl-targetGst);
      allocateRounded(rows,targetEx,'net','MerchantFeeExclGST',Object.assign(roundingAudit,{gateway:'Afterpay'}));
      allocateRounded(rows,targetGst,'net','MerchantFeeGST',Object.assign(roundingAudit,{gateway:'Afterpay'}));
      rows.forEach(r=>{r.MerchantFeeInclGST=P.round2(r.MerchantFeeExclGST+r.MerchantFeeGST);r.NetAmountAUD=P.round2(r.GrossAmountAUD-r.MerchantFeeInclGST);out.push({Date:day,OrderID:r.order,GrossAmountAUD:r.GrossAmountAUD,MerchantFeeExclGST:r.MerchantFeeExclGST,MerchantFeeGST:r.MerchantFeeGST,MerchantFeeInclGST:r.MerchantFeeInclGST,NetAmountAUD:r.NetAmountAUD});});
    });
    return out;
  }

  // File-only PayPal metadata attribution. The five required reports do not
  // always expose a common Shopify OrderID <-> PayPal Transaction ID. We only
  // populate original-currency fields when an exact source identifier proves
  // the relationship. Date/amount/country proximity is intentionally never used.
  function matchPaypalMeta(orderRows,sourceTxns,master,warnings){
    const normOrder=x=>{const s=String(x||'').trim().replace(/^#/,'');return s?'#'+s:'';};
    const orderByTxn=new Map();
    for(const o of master.orders||[]){
      if(o.kind!=='paypal')continue;
      for(const id of o.transactionIds||[]){
        const key=String(id||'').trim();if(!key)continue;
        if(!orderByTxn.has(key))orderByTxn.set(key,new Set());orderByTxn.get(key).add(normOrder(o.order));
      }
    }
    const direct=new Map();
    const add=(order,tx)=>{if(!order||!tx)return;if(!direct.has(order))direct.set(order,[]);direct.get(order).push(tx);};
    for(const tx of sourceTxns){
      // 1) PayPal fields that literally contain a Shopify order number.
      for(const ref of [tx.invoiceNumber,tx.customNumber]){
        const str=String(ref||'').trim();
        if(/^#?\d{4,}$/.test(str))add(normOrder(str),tx);
      }
      // 2) Exact reference equality with Shopify Net Payments Transaction ID.
      // This is safe when a future export exposes the same gateway reference.
      for(const ref of [tx.transactionId,tx.referenceTxnId,tx.invoiceNumber,tx.customNumber,tx.receiptId]){
        const key=String(ref||'').trim();if(!key)continue;
        const owners=orderByTxn.get(key);if(!owners||owners.size!==1)continue;
        add([...owners][0],tx);
      }
    }
    let matched=0,unavailable=0,ambiguous=0;
    for(const row of orderRows){
      const candidates=[...new Set(direct.get(normOrder(row.OrderID))||[])];
      const currencies=[...new Set(candidates.map(t=>t.currency))];
      if(candidates.length&&currencies.length===1){
        row.OriginalCurrency=currencies[0];
        row.GrossOriginalCurrency=P.round2(candidates.reduce((sum,t)=>sum+Number(t.originalGross||0),0));
        const types=[...new Set(candidates.map(t=>t.type))];
        row.Type=types.length===1?types[0]:'Mixed Sale/Refund';matched++;
      }else{
        row.OriginalCurrency='';row.GrossOriginalCurrency='';
        row.Type=row.GrossAmountAUD<0?'Refund':'Sale';
        if(candidates.length)ambiguous++;else unavailable++;
      }
    }
    if(unavailable||ambiguous){
      warnings.push(`PayPal source attribution: ${matched} order(s) had an exact file-based transaction reference. ${unavailable} order(s) had no common transaction identifier in the supplied files${ambiguous?`, and ${ambiguous} were ambiguous`:''}. Their OriginalCurrency and GrossOriginalCurrency cells are intentionally blank; AUD gross, fee and net calculations remain source-reconciled.`);
    }
  }

  function buildPaypalDetails(master,paypal,from,to,warnings,roundingAudit){
    const byDay=ordersByDay(master,'paypal',from,to), out=[];
    Object.keys(byDay).sort().forEach(day=>{
      const rows=byDay[day], p=paypal.pool[day]||{fee:0};
      rows.forEach(r=>r.GrossAmountAUD=P.round2(r.net));
      allocateRounded(rows,p.fee,'net','FeeAmountAUD',Object.assign(roundingAudit,{gateway:'PayPal'}));
      rows.forEach(r=>{r.NetAmountAUD=P.round2(r.GrossAmountAUD-r.FeeAmountAUD);out.push({Date:day,OrderID:r.order,OriginalCurrency:'',GrossOriginalCurrency:'',GrossAmountAUD:r.GrossAmountAUD,FeeAmountAUD:r.FeeAmountAUD,NetAmountAUD:r.NetAmountAUD,Type:r.GrossAmountAUD<0?'Refund':'Sale'});});
    });
    matchPaypalMeta(out,paypal.txns,master,warnings);
    return out;
  }

  function summaryFromDetails(details){
    const spec={
      afterpay:['GrossAmountAUD','MerchantFeeExclGST','MerchantFeeGST','MerchantFeeInclGST','NetAmountAUD'],
      paypal:['GrossAmountAUD','FeeAmountAUD','NetAmountAUD'],
      shopify:['GrossAmountAUD','FeeExGST','GSTOnFee','FeeInclGST','NetAmountAUD']
    };
    const sections=[];
    for(const kind of ['afterpay','paypal','shopify']){
      const map={};
      for(const r of details[kind]){const q=map[r.Date]||(map[r.Date]={day:r.Date,count:0});q.count++;for(const f of spec[kind])q[f]=(q[f]||0)+Number(r[f]||0);}
      const rows=Object.values(map).sort((a,b)=>a.day.localeCompare(b.day)).map(q=>{
        if(kind==='paypal')return {day:q.day,count:q.count,gross:P.round2(q.GrossAmountAUD),fee:P.round2(q.FeeAmountAUD),net:P.round2(q.NetAmountAUD)};
        return {day:q.day,count:q.count,gross:P.round2(q.GrossAmountAUD),feeEx:P.round2(kind==='afterpay'?q.MerchantFeeExclGST:q.FeeExGST),gst:P.round2(kind==='afterpay'?q.MerchantFeeGST:q.GSTOnFee),feeIncl:P.round2(kind==='afterpay'?q.MerchantFeeInclGST:q.FeeInclGST),net:P.round2(q.NetAmountAUD)};
      });
      sections.push({kind,rows});
    }
    return sections;
  }

  function feeReconciliation(details,shopPool,afterPool,payPool){
    const out=[];
    function add(kind,day,allocated,source){out.push({kind,day,allocated:P.round2(allocated),source:P.round2(source),difference:P.round2(allocated-source),match:Math.abs(P.round2(allocated-source))<0.01});}
    const days=new Set([...Object.keys(shopPool),...Object.keys(afterPool),...Object.keys(payPool)]);
    [...days].sort().forEach(day=>{
      add('shopify',day,details.shopify.filter(r=>r.Date===day).reduce((s,r)=>s+r.FeeInclGST,0),shopPool[day]?.feeIncl||0);
      add('afterpay',day,details.afterpay.filter(r=>r.Date===day).reduce((s,r)=>s+r.MerchantFeeInclGST,0),afterPool[day]?.feeIncl||0);
      add('paypal',day,details.paypal.filter(r=>r.Date===day).reduce((s,r)=>s+r.FeeAmountAUD,0),payPool[day]?.fee||0);
    });
    return out;
  }

  function externalGatewayVerification(derivedRows,checkpointRows){
    if(!checkpointRows)return {verified:false,rows:[],warnings:[]};
    const source=new Map(),actual=new Map();
    for(const r of derivedRows){const k=gatewayKind(r.gateway);if(k==='other')continue;
      const q=source.get(k)||{transactions:0,gross:0,refund:0,net:0};
      q.transactions+=Number(r.transactions)||0;q.gross+=Number(r.gross)||0;q.refund+=Number(r.refund)||0;q.net+=Number(r.net)||0;source.set(k,q);
    }
    for(const r of checkpointRows){const k=gatewayKind(r['Payment gateway']);if(k==='other')continue;
      const q=actual.get(k)||{transactions:0,gross:0,refund:0,net:0};
      q.transactions+=P.cleanNumber(r['Transactions']);q.gross+=P.cleanNumber(r['Gross payments']);
      q.refund+=P.cleanNumber(r['Refunded payments']);q.net+=P.cleanNumber(r['Net payments']);actual.set(k,q);
    }
    const rows=[];
    for(const k of new Set([...source.keys(),...actual.keys()])){
      const a=source.get(k),b=actual.get(k);
      const differences=a&&b?{
        transactions:a.transactions-b.transactions,
        gross:P.round2(a.gross-b.gross),
        refund:P.round2(a.refund-b.refund),
        net:P.round2(a.net-b.net)
      }:null;
      rows.push({kind:k,expected:b,calculated:a,differences,match:!!differences&&Object.values(differences).every(x=>Math.abs(x)<0.001)});
    }
    return {verified:true,rows,warnings:[]};
  }
  function gatewaySummary(master){return master.summary.map(r=>({...r,transactions:r.transactions,gross:P.round2(r.gross),refund:P.round2(r.refund),net:P.round2(r.net)}));}
  function reconcileGross(details,summary){
    const sums={};summary.forEach(s=>{const k=gatewayKind(s.gateway);if(['shopify','paypal','afterpay'].includes(k))sums[k]=(sums[k]||0)+s.net;});
    return ['shopify','paypal','afterpay'].map(kind=>{const calc=details[kind].reduce((s,r)=>s+Number(r.GrossAmountAUD||0),0),check=sums[kind]||0,diff=P.round2(calc-check);return {kind,calculated:P.round2(calc),checkpoint:P.round2(check),difference:diff,match:Math.abs(diff)<0.01};});
  }

  async function process(files,range){
    const warnings=[];
    const master=buildOrderMaster(files.net.rows,range.from,range.to);
    const review=[...master.issues];
    if(master.issues.length)warnings.push(`${master.issues.length} source transaction(s) have no Shopify Order Name. Their amounts remain in the gateway summary, but no invented order rows were created. See Review Issues CSV.`);
    salesCrossCheck(files.sales.rows,master.orders,range.from,range.to,warnings);
    const currencies=new Set(['AUD']);
    const eligible=new Set(master.orders.filter(o=>o.kind==='shopify').map(o=>`${o.day}|${o.order}`));
    for(const r of files.transactions.rows){
      const d=P.parseDate(r['Transaction Date']);if(!inRange(d,range.from,range.to))continue;
      const typ=String(r['Type']||'').trim().toLowerCase();
      if((typ==='charge'||typ==='refund')&&eligible.has(`${P.dateKey(d)}|${String(r['Order']||'').trim()}`)){
        const c=String(r['Currency']||'').trim().toUpperCase();if(c)currencies.add(c);
      }
    }
    for(const r of files.paypal.rows){
      if(!inRange(P.parseDate(r['Date']),range.from,range.to))continue;
      if(!paypalFeeTransaction(r))continue;
      const c=String(r['Currency']||'').trim().toUpperCase();if(c)currencies.add(c);
    }
    const fx=makeFX(currencies,warnings);
    const shop=await shopifyFeePool(files.transactions.rows,master,range.from,range.to,fx);
    const shopPool=shop.pool;
    const afterPool=afterpayFeePool(files.afterpay.rows,range.from,range.to);
    const paypal=await paypalSource(files.paypal.rows,range.from,range.to,warnings,fx);
    const roundingAudit=[];
    const details={
      afterpay:buildAfterpayDetails(master,afterPool,range.from,range.to,roundingAudit),
      paypal:buildPaypalDetails(master,paypal,range.from,range.to,warnings,roundingAudit),
      shopify:buildShopifyDetails(master,shopPool,range.from,range.to,roundingAudit)
    };
    const fxAudit=fx.summary();
    const sections=summaryFromDetails(details);
    const summary=gatewaySummary(master);
    const feeRecon=feeReconciliation(details,shopPool,afterPool,paypal.pool);
    const badFee=feeRecon.filter(x=>!x.match);
    badFee.forEach(x=>review.push({severity:'REVIEW',category:'Daily Fee Reconciliation',gateway:x.kind,date:x.day,reference:'',detail:`Allocated ${x.allocated}; source ${x.source}; difference ${x.difference}. Investigate before posting to Xero.`}));
    const recon=reconcileGross(details,summary);
    recon.filter(x=>!x.match).forEach(x=>review.push({severity:'REVIEW',category:'Gross Reconciliation',gateway:x.kind,date:'',reference:'',detail:`Calculated ${x.calculated}, expected ${x.checkpoint}, variance ${x.difference}.` }));
    const external=externalGatewayVerification(summary,null);
    external.rows.filter(x=>!x.match).forEach(x=>review.push({severity:'REVIEW',category:'External Gateway Check',gateway:x.kind,date:'',reference:'',detail:`Independent checkpoint mismatch: ${JSON.stringify(x.differences||'missing gateway')}.` }));

    // Always allocate and reconcile against the FULL date-period before applying an
    // optional order-range filter. Otherwise a subset would wrongly absorb 100%
    // of the full daily gateway fee pool.
    let resultDetails=details,resultSections=sections,resultSummary=summary,resultRecon=recon;
    let isPartial=false;
    const fromOrder=String(range.orderFrom||'').trim(),toOrder=String(range.orderTo||'').trim();
    if(fromOrder||toOrder){
      const fromNum=fromOrder?Number(fromOrder.replace(/^#/,'')):0;
      const toNum=toOrder?Number(toOrder.replace(/^#/,'')):Number.MAX_SAFE_INTEGER;
      if(!Number.isSafeInteger(fromNum)||!Number.isSafeInteger(toNum)||fromNum<0||toNum<fromNum)
        throw new Error('Invalid order range. Use Shopify numeric order names, e.g. #10053 through #10342.');
      const keep=r=>{const m=String(r.OrderID||'').match(/^#?(\d+)$/);return !!m&&Number(m[1])>=fromNum&&Number(m[1])<=toNum;};
      resultDetails=Object.fromEntries(Object.entries(details).map(([kind,rows])=>[kind,rows.filter(keep)]));
      resultSections=summaryFromDetails(resultDetails);
      const within=o=>{const m=String(o.order||'').match(/^#?(\d+)$/);return !!m&&Number(m[1])>=fromNum&&Number(m[1])<=toNum;};
      const partial=new Map();
      master.orders.filter(within).forEach(o=>{
        const key=o.gateway,q=partial.get(key)||{gateway:key,transactions:0,gross:0,refund:0,net:0};
        q.transactions+=o.sourceRows;q.gross+=o.gross;q.refund+=o.refund;q.net+=o.net;partial.set(key,q);
      });
      resultSummary=[...partial.values()].map(q=>({...q,gross:P.round2(q.gross),refund:P.round2(q.refund),net:P.round2(q.net)}));
      resultRecon=reconcileGross(resultDetails,resultSummary);
      resultRecon.filter(x=>!x.match).forEach(x=>review.push({severity:'REVIEW',category:'Order Range Reconciliation',gateway:x.kind,date:'',reference:'',detail:`Subset variance ${x.difference}.`}));
      isPartial=true;
      warnings.push('Order-range mode: fee allocation and source/checkpoint checks were performed on the entire date period BEFORE selecting order IDs. Downloaded merchant and gateway files contain only the chosen subset. Subset fees intentionally do not equal the full gateway fee pool.');
    }
    if(review.length)warnings.push(`${review.filter(x=>x.severity==='REVIEW').length} review item(s) identified. Downloads remain available; REVIEW means not approved for journal posting.`);
    return {details:resultDetails,sections:resultSections,summary:resultSummary,reconciliation:resultRecon,externalReconciliation:external,feeReconciliation:feeRecon,fxAudit,paypalFxFeeAudit:paypal.fxFeeAudit,shopifyAudit:shop.audit,roundingAudit,partialOrderRange:isPartial,warnings,review};
  }

  async function testFX(day){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error('Select a valid date to test FX.');
    const warnings=[],fx=makeFX(['USD','GBP','AUD'],warnings);
    const [usd,gbp]=await Promise.all([fx.getRate(day,'USD'),fx.getRate(day,'GBP')]);
    return {requestedDate:day,usd,gbp,source:'ECB via Frankfurter'};
  }
  global.MFEngine={process,gatewayKind,testFX};
})(window);
