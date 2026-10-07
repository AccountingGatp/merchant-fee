(function(global){
  'use strict';
  const P=global.MFParser;
  // required: canonical (lower-case) names used for validation and the mapping dialog.
  // optional: extra columns used when present (never block upload).
  // keys: canonical name -> the exact header the calculation engine reads. Mapping
  //       writes BOTH, so a renamed source column is really used by the engine.
  const TYPES={
    net:{label:'Shopify — Net Payments by Order',required:[['day'],['order name'],['payment gateway'],['gross payments'],['refunded payments'],['net payments']],optional:['transaction id','billing country'],
      keys:{'day':'Day','order name':'Order name','payment gateway':'Payment gateway','gross payments':'Gross payments','refunded payments':'Refunded payments','net payments':'Net payments','transaction id':'Transaction ID','billing country':'Billing country'}},
    sales:{label:'Shopify — Total Sales by Order',required:[['day'],['order name'],['gross sales'],['total sales']],optional:[],
      keys:{'day':'Day','order name':'Order name','gross sales':'Gross sales','total sales':'Total sales'}},
    transactions:{label:'Shopify — Payment Transactions',required:[['transaction date'],['type'],['order'],['amount'],['fee'],['net'],['gst']],optional:['currency','payment method name','presentment currency','presentment amount'],
      keys:{'transaction date':'Transaction Date','type':'Type','order':'Order','amount':'Amount','fee':'Fee','net':'Net','gst':'GST','currency':'Currency','payment method name':'Payment Method Name','presentment currency':'Presentment Currency','presentment amount':'Presentment Amount'}},
    paypal:{label:'PayPal — Activity Report',required:[['date'],['type'],['currency'],['gross'],['fee'],['net'],['transaction id']],optional:['status','reference txn id','invoice number','custom number','receipt id','country'],
      keys:{'date':'Date','type':'Type','currency':'Currency','gross':'Gross','fee':'Fee','net':'Net','transaction id':'Transaction ID','status':'Status','reference txn id':'Reference Txn ID','invoice number':'Invoice Number','custom number':'Custom Number','receipt id':'Receipt ID','country':'Country'}},
    afterpay:{label:'Afterpay — Settlement Report',required:[['settlement date'],['order amount'],['merchant fee excl tax'],['merchant fee tax'],['merchant fee incl tax'],['net settlement amount'],['type']],optional:[],
      keys:{'settlement date':'Settlement Date','order amount':'Order Amount','merchant fee excl tax':'Merchant Fee excl Tax','merchant fee tax':'Merchant Fee Tax','merchant fee incl tax':'Merchant Fee incl Tax','net settlement amount':'Net Settlement Amount','type':'Type'}}
  };
  function normalized(headers){return new Set(headers.map(P.normalizeHeader));}
  function validateAs(parsed,type){
    const set=normalized(parsed.headers), spec=TYPES[type];
    const missing=spec.required.filter(group=>!group.some(x=>set.has(x))).map(x=>x[0]);
    return {ok:missing.length===0,missing};
  }
  function detect(parsed){
    for(const key of Object.keys(TYPES)){if(validateAs(parsed,key).ok)return key;} return null;
  }
  // A user can map actual CSV headers to these canonical fields; calculations
  // always consume canonical field names after applying the mapping.
  function propose(parsed,type){
    const result={};
    const normalizedHeaders=parsed.headers.map(h=>({raw:h,n:P.normalizeHeader(h)}));
    const aliases={
      'order name':['order id','order number','shopify order','shopify order name'],
      'payment gateway':['gateway','payment method'],
      'day':['report date','order date'],
      'transaction date':['created at','processed at'],
      'settlement date':['date settled'],
      'merchant fee excl tax':['merchant fee excl gst','fee ex gst'],
      'merchant fee tax':['merchant fee gst','gst on merchant fee'],
      'merchant fee incl tax':['merchant fee incl gst','fee incl gst'],
      'transaction id':['txn id','transaction identifier'],
      'refunded payments':['refund payments'],
      'gross payments':['gross payment'],
      'net payments':['net payment'],
      'reference txn id':['reference transaction id','reference txn','reference transaction'],
      'invoice number':['invoice id','invoice no','invoice'],
      'custom number':['custom id','custom'],
      'receipt id':['receipt number'],
      'payment method name':['payment method']
    };
    for(const canonical of [...TYPES[type].required.map(g=>g[0]),...(TYPES[type].optional||[])]){
      const direct=normalizedHeaders.find(h=>h.n===canonical);
      const alt=normalizedHeaders.find(h=>(aliases[canonical]||[]).includes(h.n));
      result[canonical]=(direct||alt||{}).raw||'';
    }
    return result;
  }
  function applyMapping(parsed,type,mapping){
    const spec=TYPES[type],used=new Set();
    for(const field of spec.required.map(x=>x[0])){
      const source=mapping[field];
      if(!source||!parsed.headers.includes(source))throw new Error(`Select a source column for ${field}`);
      if(used.has(source))throw new Error(`Column ${source} cannot be mapped to multiple required fields`);
      used.add(source);
    }
    const originalSet=new Set(parsed.headers);
    // Read from the untouched source row so one mapping cannot overwrite another's source.
    const rows=parsed.rows.map(row=>{
      const result={...row};
      for(const [dest,src] of Object.entries(mapping)){
        if(!src||!originalSet.has(src))continue;
        const value=row[src]??'';
        result[dest]=value;
        if(spec.keys[dest])result[spec.keys[dest]]=value;
      }
      return result;
    });
    const headers=[...new Set([...parsed.headers,...Object.keys(mapping).filter(k=>mapping[k]),...Object.keys(mapping).filter(k=>mapping[k]&&spec.keys[k]).map(k=>spec.keys[k])])];
    return {headers,rows};
  }
  global.MFValidation={TYPES,validateAs,detect,propose,applyMapping};
})(window);
