// Agent Tower host shim: gives the tower the same window.claude.use('mcp') surface it has on claude.ai,
// answered by Google's own APIs with Elisha's sign-in. No secrets live here; the token stays in this tab.
(function(){
'use strict';
const CFG=window.TOWER_CFG||{};
const SCOPES=['https://www.googleapis.com/auth/drive','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/calendar.readonly'].join(' ');
const AUTH={token:'',exp:0,client:null,waiters:[],onNeed:null};
try{const t=JSON.parse(sessionStorage.getItem('at.tok')||'null');if(t&&t.exp>Date.now()+60000){AUTH.token=t.tok;AUTH.exp=t.exp;}}catch(e){}

function gisReady(){return !!(window.google&&google.accounts&&google.accounts.oauth2);}
function client(){
  if(AUTH.client||!gisReady())return AUTH.client;
  AUTH.client=google.accounts.oauth2.initTokenClient({client_id:CFG.clientId,scope:SCOPES,hint:CFG.hint||'',callback:r=>{
    if(r&&r.access_token){AUTH.token=r.access_token;AUTH.exp=Date.now()+(Number(r.expires_in)||3600)*1000;
      try{sessionStorage.setItem('at.tok',JSON.stringify({tok:AUTH.token,exp:AUTH.exp}));}catch(e){}
      const w=AUTH.waiters.splice(0);w.forEach(f=>f.ok(AUTH.token));}
    else{const w=AUTH.waiters.splice(0);w.forEach(f=>f.no(new Error((r&&r.error)||'sign-in failed')));}
  },error_callback:e=>{const w=AUTH.waiters.splice(0);w.forEach(f=>f.no(new Error((e&&e.type)||'sign-in closed')));}});
  return AUTH.client;
}
// Must run inside a tap the first time (Google opens a small sign-in window).
function signIn(silent){return new Promise((ok,no)=>{const c=client();if(!c)return no(new Error('Google sign-in is still loading'));AUTH.waiters.push({ok,no});c.requestAccessToken({prompt:silent?'':'consent'});});}
function fresh(){return AUTH.token&&AUTH.exp>Date.now()+90000;}
async function token(){
  if(fresh())return AUTH.token;
  // Token ran out: ask the page to show a one-tap chip, and wait for it.
  return new Promise((ok,no)=>{AUTH.waiters.push({ok,no});if(AUTH.onNeed)AUTH.onNeed();});
}

class ToolError extends Error{constructor(code,msg){super(msg||code);this.code=code;}}
async function g(url,opt){
  opt=opt||{};let t=await token();
  for(let i=0;i<3;i++){
    const r=await fetch(url,Object.assign({},opt,{headers:Object.assign({Authorization:'Bearer '+t},opt.headers||{})}));
    if(r.status===401){AUTH.exp=0;t=await token();continue;}
    if(r.status===429||r.status>=500){await new Promise(z=>setTimeout(z,600*(i+1)));continue;}
    if(!r.ok){let m='';try{m=(await r.json()).error.message;}catch(e){}throw new ToolError(r.status===403?'not_granted':'error',m||('HTTP '+r.status));}
    return opt.raw?r:(r.status===204?{}:r.json());
  }
  throw new ToolError('error','Google did not answer');
}
const qs=o=>Object.entries(o).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
const DRV='https://www.googleapis.com/drive/v3/files',UP='https://www.googleapis.com/upload/drive/v3/files';
const FIELDS='id,name,mimeType,parents,createdTime,modifiedTime,size,webViewLink';
const outFile=f=>f&&({id:f.id,title:f.name,mimeType:f.mimeType,parentId:(f.parents||[])[0],createdTime:f.createdTime,modifiedTime:f.modifiedTime,fileSize:f.size,viewUrl:f.webViewLink});
// Connector query dialect to Drive v3: parentId = 'x' -> 'x' in parents, title -> name.
function driveQ(q){
  q=String(q||'');
  q=q.replace(/parentId\s*=\s*'([^']+)'/g,"'$1' in parents").replace(/\btitle\b(?=\s*(=|!=|contains))/g,'name');
  return q?'('+q+') and trashed = false':'trashed = false';
}
function b64(bytes){let s='';const n=0x8000;for(let i=0;i<bytes.length;i+=n)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+n));return btoa(s);}
function utf8b64(t){return b64(new TextEncoder().encode(t));}
const b64url=t=>utf8b64(t).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function unb64url(s){s=String(s||'').replace(/-/g,'+').replace(/_/g,'/');try{return new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));}catch(e){return '';}}

const DRIVE={
  async search_files(a){
    const p={q:driveQ(a.query),pageSize:Math.min(a.pageSize||50,1000),pageToken:a.pageToken,fields:'nextPageToken,files('+FIELDS+')',orderBy:a.orderBy,supportsAllDrives:true,includeItemsFromAllDrives:true};
    const r=await g(DRV+'?'+qs(p));return {files:(r.files||[]).map(outFile),nextPageToken:r.nextPageToken};
  },
  async get_file_metadata(a){return outFile(await g(DRV+'/'+a.fileId+'?'+qs({fields:FIELDS,supportsAllDrives:true})));},
  async download_file_content(a){
    const m=await g(DRV+'/'+a.fileId+'?'+qs({fields:FIELDS,supportsAllDrives:true}));
    const gdoc=/^application\/vnd\.google-apps\./.test(m.mimeType);
    const url=gdoc?DRV+'/'+a.fileId+'/export?'+qs({mimeType:a.exportMimeType||(/spreadsheet/.test(m.mimeType)?'text/csv':'text/plain')}):DRV+'/'+a.fileId+'?alt=media&supportsAllDrives=true';
    const r=await g(url,{raw:true});const buf=new Uint8Array(await r.arrayBuffer());
    return {content:b64(buf),id:m.id,mimeType:m.mimeType,title:m.name};
  },
  async read_file_content(a){const d=await DRIVE.download_file_content(a);return {content:new TextDecoder().decode(Uint8Array.from(atob(d.content),c=>c.charCodeAt(0))),id:d.id,title:d.title};},
  async create_file(a){
    const meta={name:a.title,parents:a.parentId?[a.parentId]:undefined,mimeType:a.mimeType};
    if(a.mimeType==='application/vnd.google-apps.folder'||a.textContent==null&&a.content==null){
      return outFile(await g(DRV+'?'+qs({fields:FIELDS,supportsAllDrives:true}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(meta)}));
    }
    const mime=a.contentMimeType||'text/plain';
    if(!a.disableConversionToGoogleType&&/^text\/(plain|markdown|html)$/.test(mime)&&!a.mimeType)meta.mimeType=undefined;
    const bd='tower'+Math.random().toString(36).slice(2);
    const body=a.textContent!=null?a.textContent:Uint8Array.from(atob(a.content),c=>c.charCodeAt(0));
    const blob=new Blob(['--'+bd+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+bd+'\r\nContent-Type: '+mime+(a.textContent!=null?'; charset=UTF-8':'')+'\r\n\r\n',body,'\r\n--'+bd+'--']);
    return outFile(await g(UP+'?'+qs({uploadType:'multipart',fields:FIELDS,supportsAllDrives:true}),{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+bd},body:blob}));
  },
  async update_file(a){
    const p={fields:FIELDS,supportsAllDrives:true};
    if(a.parentId){const cur=await g(DRV+'/'+a.fileId+'?fields=parents&supportsAllDrives=true');p.addParents=a.parentId;p.removeParents=(cur.parents||[]).filter(x=>x!==a.parentId).join(',');}
    const meta={};if(a.title)meta.name=a.title;
    return outFile(await g(DRV+'/'+a.fileId+'?'+qs(p),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(meta)}));
  },
  async list_recent_files(a){return DRIVE.search_files({query:'',pageSize:(a&&a.pageSize)||20,orderBy:'modifiedTime desc'});}
};

const GMAIL_API='https://gmail.googleapis.com/gmail/v1/users/me';
const hdr=(m,n)=>{const h=((m.payload||{}).headers||[]).find(x=>x.name.toLowerCase()===n.toLowerCase());return h?h.value:'';};
function bodyText(p){
  if(!p)return '';
  if(p.mimeType==='text/plain'&&p.body&&p.body.data)return unb64url(p.body.data);
  for(const c of p.parts||[]){const t=bodyText(c);if(t)return t;}
  if(p.mimeType==='text/html'&&p.body&&p.body.data){const d=document.createElement('div');d.innerHTML=unb64url(p.body.data).replace(/<(br|\/p|\/div)[^>]*>/gi,'\n');return d.textContent||'';}
  return '';
}
function outMsg(m,full){
  const o={id:m.id,threadId:m.threadId,date:new Date(Number(m.internalDate)).toISOString(),internalDate:m.internalDate,labelIds:m.labelIds||[],
    sender:hdr(m,'From'),subject:hdr(m,'Subject'),snippet:m.snippet||'',toRecipients:hdr(m,'To').split(',').map(s=>s.trim()).filter(Boolean),
    ccRecipients:hdr(m,'Cc').split(',').map(s=>s.trim()).filter(Boolean),sizeEstimate:m.sizeEstimate,
    viewUrl:'https://mail.google.com/mail/u/0/#all/'+m.id};
  if(full)o.plaintextBody=bodyText(m.payload);
  return o;
}
async function pool(items,n,fn){const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;try{out[k]=await fn(items[k]);}catch(e){out[k]=null;}}}));return out;}
const META='format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date';
const GMAIL={
  async search_threads(a){
    const r=await g(GMAIL_API+'/threads?'+qs({q:a.query,maxResults:Math.min(a.pageSize||20,100),pageToken:a.pageToken}));
    const ths=await pool(r.threads||[],8,t=>g(GMAIL_API+'/threads/'+t.id+'?'+META));
    return {threads:ths.filter(Boolean).map(t=>({id:t.id,messageCount:(t.messages||[]).length,messages:(t.messages||[]).slice(-1).map(m=>outMsg(m)),viewUrl:'https://mail.google.com/mail/u/0/#all/'+t.id})),
      nextPageToken:r.nextPageToken,resultCountEstimate:r.resultSizeEstimate};
  },
  async get_thread(a){
    const full=a.messageFormat!=='METADATA_ONLY';
    const t=await g(GMAIL_API+'/threads/'+a.threadId+'?'+(full?'format=full':META));
    return {id:t.id,messageCount:(t.messages||[]).length,messages:(t.messages||[]).map(m=>outMsg(m,full)),viewUrl:'https://mail.google.com/mail/u/0/#all/'+t.id};
  },
  async get_message(a){const m=await g(GMAIL_API+'/messages/'+a.messageId+'?format=full');return outMsg(m,true);},
  async reply(a){
    const m=await g(GMAIL_API+'/messages/'+a.messageId+'?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References');
    const to=hdr(m,'Reply-To')||hdr(m,'From');let subj=hdr(m,'Subject');if(!/^re:/i.test(subj))subj='Re: '+subj;
    const mid=hdr(m,'Message-ID'),refs=(hdr(m,'References')+' '+mid).trim();
    const enc=s=>/[^\x20-\x7e]/.test(s)?'=?UTF-8?B?'+utf8b64(s)+'?=':s;
    const head=['To: '+to,'Subject: '+enc(subj)];if(mid)head.push('In-Reply-To: '+mid);if(refs)head.push('References: '+refs);
    head.push('MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64');
    const raw=head.join('\r\n')+'\r\n\r\n'+utf8b64(String(a.body||'')).replace(/.{76}/g,'$&\r\n');
    const s=await g(GMAIL_API+'/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw:b64url(raw),threadId:m.threadId})});
    return {id:s.id,threadId:s.threadId,labelIds:s.labelIds};
  }
};

const CAL_API='https://www.googleapis.com/calendar/v3';
const CAL={
  async list_calendars(){const r=await g(CAL_API+'/users/me/calendarList?maxResults=250');return {calendars:(r.items||[]).map(c=>({id:c.id,summary:c.summaryOverride||c.summary,timeZone:c.timeZone,primary:!!c.primary}))};},
  async list_events(a){
    const r=await g(CAL_API+'/calendars/'+encodeURIComponent(a.calendarId||'primary')+'/events?'+qs({timeMin:a.startTime,timeMax:a.endTime,timeZone:a.timeZone,singleEvents:true,orderBy:a.orderBy||'startTime',maxResults:Math.min(a.pageSize||100,2500),pageToken:a.pageToken,q:a.query}));
    return {events:r.items||[],summary:r.summary,timeZone:r.timeZone,nextPageToken:r.nextPageToken};
  }
};

const SERVERS={'Google Drive':DRIVE,'Gmail':GMAIL,'Google Calendar':CAL};
const MCP={
  async callTool(server,tool,args){
    const s=SERVERS[server];
    if(!s)throw new ToolError('server_not_connected',server+' only works inside claude.ai');
    if(!s[tool])throw new ToolError('not_in_manifest',server+' '+tool+' is not available on this site');
    const payload=await s[tool](args||{});
    return {payload,cache:{storedAt:Date.now()}};
  },
  watchTool(server,tool,args,cb,opt){
    let stop=false,timer=0;const every=Math.max(30000,(opt&&opt.refetchInterval)||120000);
    const run=async()=>{if(stop)return;try{const r=await MCP.callTool(server,tool,args);if(!stop)cb({type:'data',result:r});}catch(e){if(!stop)cb({type:'error',error:{code:e.code||'error',message:e.message}});}
      if(!stop)timer=setTimeout(run,document.hidden?every*3:every);};
    run();return ()=>{stop=true;clearTimeout(timer);};
  }
};

// Google ID token (proves it is Elisha) for the live endpoint. Separate from the data access token above.
const ID={tok:'',exp:0,init:false,wait:[]};
function jwtExp(t){try{return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp*1000;}catch(e){return 0;}}
function idInit(){
  if(ID.init||!(window.google&&google.accounts&&google.accounts.id))return ID.init;
  google.accounts.id.initialize({client_id:CFG.clientId,auto_select:true,login_hint:CFG.hint||'',use_fedcm_for_prompt:true,cancel_on_tap_outside:false,
    callback:r=>{if(r&&r.credential){ID.tok=r.credential;ID.exp=jwtExp(r.credential);}const w=ID.wait.splice(0);w.forEach(f=>f(ID.tok));}});
  return ID.init=true;
}
function idToken(){
  if(ID.tok&&ID.exp>Date.now()+120000)return Promise.resolve(ID.tok);
  if(!idInit())return Promise.resolve('');
  return new Promise(ok=>{ID.wait.push(ok);google.accounts.id.prompt(n=>{if(n&&(n.isNotDisplayed&&n.isNotDisplayed()||n.isSkippedMoment&&n.isSkippedMoment())){const w=ID.wait.splice(0);w.forEach(f=>f(''));}});setTimeout(()=>{const w=ID.wait.splice(0);w.forEach(f=>f(ID.tok||''));},20000);});
}
window.HOST={
  auth:AUTH,signIn,token,fresh,mcp:MCP,idToken,
  // What the tower sees as window.claude inside its frame.
  claude:{hosted:true,use:async n=>n==='mcp'?MCP:null}
};
})();
