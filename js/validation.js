(function(global){
  'use strict';
  const P=global.MFParser;
  const TYPES={
    net:{label:'Shopify — Net Payments by Order',required:[['day'],['order name'],['payment gateway'],['gross payments'],['refunded payments'],['net payments']]},
    sales:{label:'Shopify — Total Sales by Order',required:[['day'],['order name'],['gross sales'],['total sales']]},
    transactions:{label:'Shopify — Payment Transactions',required:[['transaction date'],['type'],['order'],['amount'],['fee'],['net'],['gst']]},
    paypal:{label:'PayPal — Activity Report',required:[['date'],['type'],['currency'],['gross'],['fee'],['net'],['transaction id']]},
    afterpay:{label:'Afterpay — Settlement Report',required:[['settlement date'],['order amount'],['merchant fee excl tax'],['merchant fee tax'],['merchant fee incl tax'],['net settlement amount'],['type']]}
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
      'net payments':['net payment']
    };
    for(const group of TYPES[type].required){
      const canonical=group[0];
      const direct=normalizedHeaders.find(h=>h.n===canonical);
      const alt=normalizedHeaders.find(h=>(aliases[canonical]||[]).includes(h.n));
      result[canonical]=(direct||alt||{}).raw||'';
    }
    return result;
  }
  function applyMapping(parsed,type,mapping){
    const used=new Set();
    for(const field of TYPES[type].required.map(x=>x[0])){
      const source=mapping[field];
      if(!source||!parsed.headers.includes(source))throw new Error(`Select a source column for ${field}`);
      if(used.has(source))throw new Error(`Column ${source} cannot be mapped to multiple required fields`);
      used.add(source);
    }
    const originalSet=new Set(parsed.headers);
    // Do not overwrite a canonical column before all source values have been read.
    const rows=parsed.rows.map(row=>{
      const result={...row};
      for(const [dest,src] of Object.entries(mapping))if(src && originalSet.has(src))result[dest]=row[src]??'';
      return result;
    });
    const headers=[...new Set([...parsed.headers,...Object.keys(mapping)])];
    return {headers,rows};
  }
  global.MFValidation={TYPES,validateAs,detect,propose,applyMapping};
})(window);
