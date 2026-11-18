'use strict';
const RELEASE = '2026-11-18-2';
const BASE = self.registration.scope;
const PREFIX = 'uta-step:' + new URL(BASE).pathname + ':';
const SHELL = PREFIX + 'shell:' + RELEASE;
const MEDIA = PREFIX + 'media:1';
const url = path => new URL(path, BASE).href;
const SHELL_PATHS = ['./','index.html',`styles.css?v=${RELEASE}`,`app.js?v=${RELEASE}`,'travel.js','lessons.js','waveform.js','manifest.webmanifest','assets/icon-192.png','assets/icon-512.png'];
const AUDIO_URL = url('assets/song.mp3');

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    await cache.addAll(SHELL_PATHS.map(path=>new Request(url(path),{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await Promise.all((await caches.keys()).filter(key=>key.startsWith(PREFIX+'shell:')&&key!==SHELL).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

async function rangedResponse(request,cached){
  const range=request.headers.get('range');
  if(!range)return cached;
  const data=await cached.arrayBuffer(),length=data.byteLength;
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  const invalid=()=>new Response(null,{status:416,headers:{'Content-Range':`bytes */${length}`}});
  if(!match||(!match[1]&&!match[2]))return invalid();
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!suffix)return invalid();start=Math.max(0,length-suffix);end=length-1;}
  else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),length-1):length-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=length||start>end)return invalid();
  return new Response(data.slice(start,end+1),{status:206,headers:{'Content-Type':'audio/mpeg','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${length}`,'Accept-Ranges':'bytes'}});
}

self.addEventListener('fetch',event=>{
  const request=event.request,requestURL=new URL(request.url);
  if(request.method!=='GET'||requestURL.origin!==self.location.origin||!requestURL.href.startsWith(BASE))return;
  if(requestURL.href===AUDIO_URL){
    event.respondWith((async()=>{const cached=await(await caches.open(MEDIA)).match(AUDIO_URL);return cached?rangedResponse(request,cached):fetch(request);})());return;
  }
  if(request.mode==='navigate'){
    event.respondWith((async()=>{try{const response=await fetch(request);if(response.ok)return response;}catch{}return(await(await caches.open(SHELL)).match(url('index.html')))||Response.error();})());return;
  }
  event.respondWith((async()=>{const cache=await caches.open(SHELL);return(await cache.match(request))||fetch(request);})());
});

self.addEventListener('message',event=>{
  const reply=data=>event.ports[0]?.postMessage(data);
  if(event.data?.type==='OFFLINE_STATUS'){
    event.waitUntil((async()=>{const shell=await caches.open(SHELL),media=await caches.open(MEDIA);const resources=await Promise.all(SHELL_PATHS.map(path=>shell.match(url(path))));reply({ok:true,shell:resources.every(Boolean),audio:!!(await media.match(AUDIO_URL)),release:RELEASE});})().catch(()=>reply({ok:false,error:'无法读取缓存状态'})));
  }
  if(event.data?.type==='CACHE_AUDIO'){
    event.waitUntil((async()=>{
      const media=await caches.open(MEDIA);
      if(!(await media.match(AUDIO_URL))){const response=await fetch(new Request(AUDIO_URL,{cache:'reload'}));if(response.status!==200||!(response.headers.get('content-type')||'').startsWith('audio/'))throw Error('下载失败，请联网后重试');const blob=await response.blob();if(blob.size<1000)throw Error('音频下载不完整，请重试');await media.put(AUDIO_URL,new Response(blob,{status:200,headers:{'Content-Type':'audio/mpeg','Content-Length':String(blob.size),'Accept-Ranges':'bytes'}}));}
      reply({ok:true,audio:true});
    })().catch(error=>reply({ok:false,error:error.name==='QuotaExceededError'?'设备剩余存储不足，请释放空间后重试':(error.message||'下载未完成，请保持联网后重试')})));
  }
});
