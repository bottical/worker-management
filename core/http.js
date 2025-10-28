export async function fetchWithRetry(url, { timeoutMs=8000, retries=2 } = {}){
  for(let i=0;i<=retries;i++){
    try{
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }catch(e){
      if(i===retries) throw e;
      await new Promise(r=>setTimeout(r, 400*(i+1)));
    }
  }
}
