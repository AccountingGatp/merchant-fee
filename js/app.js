(function(){
  'use strict';
  const P=window.MFParser,V=window.MFValidation,E=window.MFEngine,X=window.MFExporter;
  const slots=['net','sales','transactions','paypal','afterpay']; const state={files:{},result:null,range:{from:'',to:''},mappingType:null};
  const grid=document.getElementById('uploadGrid'),countEl=document.getElementById('uploadCount'),statusEl=document.getElementById('statusText'),bar=document.getElementById('progressBar'),processBtn=document.getElementById('processBtn');
  function humanSize(n){if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;return `${(n/1048576).toFixed(1)} MB`;}
  function renderCards(){
    grid.innerHTML='';slots.forEach(type=>{const info=state.files[type];const card=document.createElement('div');card.className='upload-card'+(info?.valid?' ready':info?' invalid':'');card.dataset.type=type;
      card.innerHTML=`<div class="card-title"><span class="badge-dot">${info?.valid?'✓':info?'!':'+'}</span><div><h3>${V.TYPES[type].label}</h3></div></div><div class="file-state">${info?`<div class="${info.valid?'success':'danger'}">${info.valid?'Uploaded Successfully':'Invalid file'}</div><div class="file-name">${escapeHtml(info.file.name)}</div><div class="file-meta">${humanSize(info.file.size)}${info.valid?'':` · Missing: ${escapeHtml(info.missing.join(', '))}`}</div><div class="upload-actions"><button class="text-button small map-columns" data-type="${type}">Map columns</button><button class="text-button small replace" data-type="${type}">Replace</button><button class="text-button small danger remove" data-type="${type}">Remove</button></div>`:`<div class="file-meta">Drag and drop the ${V.TYPES[type].label} report here, or choose a file.</div><div class="upload-actions"><button class="button secondary small choose" data-type="${type}">Choose file</button></div>`}<input class="file-input" data-input="${type}" type="file" accept=".csv,text/csv" /></div>`;grid.appendChild(card);});
    grid.querySelectorAll('.choose,.replace').forEach(b=>b.onclick=()=>grid.querySelector(`[data-input="${b.dataset.type}"]`).click());grid.querySelectorAll('.map-columns').forEach(b=>b.onclick=()=>openMapping(b.dataset.type));grid.querySelectorAll('.remove').forEach(b=>b.onclick=()=>{delete state.files[b.dataset.type];state.result=null;document.getElementById('resultsPanel').classList.add('hidden');renderCards();updateStatus();});grid.querySelectorAll('.file-input').forEach(inp=>inp.onchange=e=>handleFile(inp.dataset.input,e.target.files[0]));
    bindDragAndDrop();
  }
  function bindDragAndDrop(){
    grid.querySelectorAll('.upload-card').forEach(card=>{
      const type=card.dataset.type;
      ['dragenter','dragover'].forEach(evt=>card.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();card.classList.add('drag-over');}));
      ['dragleave','dragend'].forEach(evt=>card.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();if(!card.contains(e.relatedTarget))card.classList.remove('drag-over');}));
      card.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();card.classList.remove('drag-over');const file=e.dataTransfer?.files?.[0];if(file)handleFile(type,file);});
    });
  }
  async function handleFile(type,file){if(!file)return;let needsMapping=false;
    state.result=null;document.getElementById('resultsPanel').classList.add('hidden');
    try{const text=await P.readFile(file),parsed=P.parseCSV(text),mapping=V.propose(parsed,type);
      state.files[type]={file,original:parsed,parsed:null,rows:[],valid:false,missing:[],mapping};
      try{
        const mapped=V.applyMapping(parsed,type,mapping);
        const check=V.validateAs(mapped,type);state.files[type].parsed=mapped;state.files[type].rows=mapped.rows;state.files[type].valid=check.ok;state.files[type].missing=check.missing;
      }catch(ex){state.files[type].missing=[ex.message];}
      if(!state.files[type].valid){state.files[type].missing.push('Use Map columns to select the correct headers.');needsMapping=true;}}catch(err){state.files[type]={file,valid:false,missing:[err.message||'could not read file']};}renderCards();updateStatus();
    // Everything recognised automatically? Do nothing more. Otherwise ask, with dropdowns, only for what is missing.
    if(needsMapping&&state.files[type]?.original)openMapping(type,true);}
  const fx={ready:false,running:false,kick:false};
  const canProcess=()=>slots.every(x=>state.files[x]?.valid)&&fx.ready&&!state.busy;
  function updateStatus(){const ready=slots.filter(x=>state.files[x]?.valid).length;countEl.textContent=`${ready} / 5 files ready`;bar.style.width=`${ready/5*100}%`;processBtn.disabled=!canProcess();
    if(ready===5)statusEl.textContent=fx.ready?'All source reports are validated and ready.':'Reports validated — waiting for the exchange-rate service before processing.';
    else statusEl.textContent=`${5-ready} required report${5-ready===1?'':'s'} remaining.`;}
  function inferRange(){const rows=state.files.net.rows;const mm=P.minMaxDates(rows,'Day');return {from:document.getElementById('fromDate').value||P.dateKey(mm.min),to:document.getElementById('toDate').value||P.dateKey(mm.max)};}
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n||0));
  async function process(){state.busy=true;processBtn.disabled=true;processBtn.textContent='Processing…';try{const range=inferRange();if(range.from&&range.to&&range.from>range.to)throw new Error('From date cannot be after To date.');range.orderFrom=document.getElementById('orderFrom').value.trim();range.orderTo=document.getElementById('orderTo').value.trim();state.range=range;const files=Object.fromEntries(slots.map(s=>[s,state.files[s]]));
      state.result=await E.process(files,range);renderResults();}catch(err){alert(`Unable to calculate reliable amounts: ${err.message||String(err)}. This is a processing failure (e.g. unavailable FX), not a review-only variance; the application does not fabricate fee values.`);}finally{state.busy=false;processBtn.textContent='Process Merchant Fees';updateStatus();}}
  function renderResults(){const r=state.result,panel=document.getElementById('resultsPanel');panel.classList.remove('hidden');document.getElementById('rangeLabel').textContent=`${state.range.from} to ${state.range.to}`;
    const totalFees=r.sections.reduce((s,sec)=>s+sec.rows.reduce((x,q)=>x+(sec.kind==='paypal'?q.fee:q.feeIncl),0),0);document.getElementById('metrics').innerHTML=`<div class="metric"><span>Source files</span><strong>5</strong></div><div class="metric"><span>Gateways checked</span><strong>3</strong></div><div class="metric"><span>Total merchant fees</span><strong>${money(totalFees)}</strong></div><div class="metric"><span>Reconciliation</span><strong>${(r.reconciliation.every(x=>x.match)&&r.feeReconciliation.every(x=>x.match)&&!(r.review||[]).some(x=>x.severity==='REVIEW'))?'MATCH':'REVIEW'}</strong></div>`;
    document.getElementById('reviewCount').textContent=`${(r.review||[]).filter(x=>x.severity==='REVIEW').length} action item(s), ${(r.review||[]).filter(x=>x.severity!=='REVIEW').length} informational note(s) · downloads enabled`;document.getElementById('reviewRows').innerHTML=(r.review||[]).map(x=>`<tr><td>${escapeHtml(x.category)}</td><td>${escapeHtml(x.gateway||'')}</td><td>${escapeHtml(x.date||'')}</td><td>${escapeHtml(x.reference||'')}</td><td>${escapeHtml(x.detail)}</td></tr>`).join('')||'<tr><td colspan="5">No review issues identified.</td></tr>';const names={shopify:'Shopify Payments',paypal:'PayPal',afterpay:'Afterpay'};document.getElementById('reconRows').innerHTML=r.reconciliation.map(x=>`<tr><td>${names[x.kind]}</td><td>${money(x.calculated)}</td><td>${money(x.checkpoint)}</td><td>${money(x.difference)}</td><td><span class="status-pill ${x.match?'match':'not-match'}">${x.match?'MATCH':'NOT MATCH'}</span></td></tr>`).join('');
    const w=document.getElementById('warnings');if(r.warnings.length){w.classList.remove('hidden');w.innerHTML=`<strong>Processing notes</strong><ul>${[...new Set(r.warnings)].map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`;}else{w.classList.add('hidden');w.innerHTML='';}panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
  // Exchange-rate service: checked automatically on load and retried (with a visible
  // countdown) until it answers. Processing stays disabled until it does.
  const fxBox=document.getElementById('fxStatus'),fxText=document.getElementById('fxStatusText'),fxRetry=document.getElementById('fxRetryBtn');
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function setFx(mode,text,detail){fxBox.className=`fx-status full-row is-${mode}`;fxText.textContent=text;fxText.title=detail||text;fxRetry.hidden=mode!=='retry';}
  function fxCheckDay(){
    const sel=document.getElementById('fromDate').value;if(sel)return sel;
    try{if(state.files.net?.valid)return inferRange().from||new Date().toISOString().slice(0,10);}catch(_){}
    return new Date().toISOString().slice(0,10);
  }
  async function startFxCheck(){
    if(fx.running)return;fx.running=true;fx.ready=false;updateStatus();
    let attempt=0;
    while(!fx.ready){
      attempt++;setFx('loading',attempt>1?`Contacting the ECB exchange-rate service… (attempt ${attempt})`:'Connecting to the ECB exchange-rate service…');
      try{
        const r=await E.testFX(fxCheckDay());
        fx.ready=true;
        setFx('ok',`Exchange rates ready · ECB via Frankfurter · USD→AUD ${r.usd.rate.toFixed(4)} · GBP→AUD ${r.gbp.rate.toFixed(4)} (${r.usd.rateDate})`);
      }catch(e){
        const secs=Math.min(30,2**Math.min(attempt+1,5));fx.kick=false;
        for(let left=secs;left>0&&!fx.kick;left--){setFx('retry',`Exchange-rate service not reachable — retrying in ${left}s (attempt ${attempt}). Processing is paused until it responds.`,String(e.message||e));await wait(1000);}
      }
    }
    fx.running=false;updateStatus();
  }
  fxRetry.onclick=()=>{fx.kick=true;};
  window.addEventListener('online',()=>{fx.kick=true;});
  // Changing the range invalidates earlier results (they were calculated for another range).
  ['fromDate','toDate','orderFrom','orderTo'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{state.result=null;document.getElementById('resultsPanel').classList.add('hidden');}));
  document.getElementById('processBtn').onclick=process;document.getElementById('clearAll').onclick=()=>{state.files={};state.result=null;document.getElementById('fromDate').value='';document.getElementById('toDate').value='';document.getElementById('orderFrom').value='';document.getElementById('orderTo').value='';document.getElementById('resultsPanel').classList.add('hidden');renderCards();updateStatus();};
  document.getElementById('downloadMerchant').onclick=()=>state.result&&X.downloadMerchant(state.result,state.range.from,state.range.to);document.getElementById('downloadGateway').onclick=()=>state.result&&X.downloadGateway(state.result.summary,state.range.from,state.range.to);document.getElementById('downloadJournal').onclick=()=>state.result&&X.downloadManualJournal(state.result.sections,state.range.from,state.range.to);
  document.getElementById('downloadRoundingAudit').onclick=()=>state.result&&X.downloadRoundingAudit(state.result.roundingAudit,state.range.from,state.range.to);
  document.getElementById('downloadPaypalFxFee').onclick=()=>state.result&&X.downloadPaypalFxFee(state.result.paypalFxFeeAudit,state.range.from,state.range.to);
  document.getElementById('downloadPaypalLink').onclick=()=>state.result&&X.downloadPaypalLink(state.result.paypalLinkAudit,state.range.from,state.range.to);
  document.getElementById('downloadReview').onclick=()=>state.result&&X.downloadReview(state.result.review,state.range.from,state.range.to);
  document.getElementById('downloadFxAudit').onclick=()=>state.result&&X.downloadFxAudit(state.result.fxAudit,state.range.from,state.range.to);
  const dlg=document.getElementById('sopDialog');document.getElementById('openSop').onclick=()=>dlg.showModal();document.getElementById('closeSop').onclick=()=>dlg.close();dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close();});
  ['dragover','drop'].forEach(evt=>window.addEventListener(evt,e=>{if(!e.target.closest('.upload-card'))e.preventDefault();}));

  const mapDlg=document.getElementById('mappingDialog');
  const closeMap=()=>{mapDlg.close();state.mappingType=null;};
  document.getElementById('closeMapping').onclick=closeMap;
  document.getElementById('cancelMapping').onclick=closeMap;
  function openMapping(type,onlyMissing){
    const info=state.files[type];if(!info?.original)return;
    state.mappingType=type;
    document.getElementById('mappingTitle').textContent=`Map columns — ${V.TYPES[type].label}`;
    document.getElementById('mappingStatus').textContent='';
    const holder=document.getElementById('mappingRows');holder.replaceChildren();
    let fields=[...V.TYPES[type].required.map(g=>[g[0],true]),...(V.TYPES[type].optional||[]).map(f=>[f,false])];
    if(onlyMissing)fields=fields.filter(([f,req])=>req&&!(info.mapping&&info.mapping[f]));
    document.getElementById('mappingIntro').textContent=onlyMissing?'These required columns could not be recognised automatically. Choose the matching column from each list; everything else was detected.':'Match the actual CSV headers to the fields used in calculations. Column examples update when you choose a source.';
    for(const [canonical,isRequired] of fields){
      const box=document.createElement('div');box.className='mapping-field';
      const label=document.createElement('label');label.textContent=isRequired?canonical:`${canonical} (optional)`;label.htmlFor=`map-${canonical.replace(/\s/g,'-')}`;
      const sel=document.createElement('select');sel.id=label.htmlFor;sel.dataset.canonical=canonical;
      const blank=new Option(isRequired?'— Select source column —':'— Not available —','');sel.add(blank);
      for(const head of info.original.headers)sel.add(new Option(head,head));
      sel.value=info.mapping?.[canonical]||'';
      const example=document.createElement('small');
      const updateSample=()=>{const src=sel.value;const values=info.original.rows.slice(0,3).map(r=>r[src]).filter(x=>x!==undefined && x!=='');example.textContent=src?`Sample: ${values.join('  |  ')||'(blank in first three rows)'}`:isRequired?'Required field — select a column':'Optional — used when available (e.g. to link PayPal currency to orders)';};
      sel.onchange=updateSample;updateSample();box.append(label,sel,example);holder.appendChild(box);
    }
    mapDlg.showModal();
  }
  document.getElementById('applyMapping').onclick=()=>{
    const type=state.mappingType,info=state.files[type];if(!info)return;
    const mapping={...(info.mapping||{}),...Object.fromEntries([...document.querySelectorAll('#mappingRows select')].map(s=>[s.dataset.canonical,s.value]))};
    try{
      const mapped=V.applyMapping(info.original,type,mapping),check=V.validateAs(mapped,type);
      if(!check.ok)throw new Error(`Missing mapped columns: ${check.missing.join(', ')}`);
      info.mapping=mapping;info.parsed=mapped;info.rows=mapped.rows;info.valid=true;info.missing=[];
      state.result=null;document.getElementById('resultsPanel').classList.add('hidden');
      closeMap();renderCards();updateStatus();
    }catch(e){document.getElementById('mappingStatus').textContent=e.message;}
  };
  renderCards();updateStatus();startFxCheck();
})();
