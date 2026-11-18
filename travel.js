(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let registration=null,installPrompt=null,busy=false;
  function openTravel(){if(!$('travelDialog').open)$('travelDialog').showModal();refreshStatus();}
  $('travelOpen').onclick=openTravel;$('mobileTravel').onclick=openTravel;
  document.querySelectorAll('[data-jump]').forEach(button=>button.onclick=()=>{$(button.dataset.jump).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});});
  function workerMessage(type){return new Promise((resolve,reject)=>{
    const worker=registration?.active;
    if(!worker){reject(Error('离线资源正在准备，请稍后重试'));return;}
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('准备超时，请检查网络后重试'));},type==='CACHE_AUDIO'?180000:8000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data.ok?resolve(event.data):reject(Error(event.data.error||'操作未完成'));};
    worker.postMessage({type},[channel.port2]);
  });}
  async function refreshStatus(){
    if(busy)return;
    $('connectionStatus').textContent=navigator.onLine?'已联网 · 可提前准备离线学习':'当前离线';
    if(!registration){return;}
    try{const status=await workerMessage('OFFLINE_STATUS');
      $('cacheAudio').disabled=!navigator.onLine&&!status.audio;
      if(status.shell&&status.audio){$('offlineStatus').textContent='音频与页面已备齐，可以离线练习这首歌。';$('cacheAudio').textContent='离线资源已准备好 ✓';$('cacheAudio').disabled=true;$('connectionStatus').textContent=navigator.onLine?'离线资源已备齐 · 随时学一句':'当前离线 · 歌曲与讲解可用';}
      else if(status.shell){$('offlineStatus').textContent='歌词和讲解已保存；再准备音频，就能离线跟唱。';$('cacheAudio').textContent='准备离线音频 · 约 8 MB';}
      else{$('offlineStatus').textContent='页面资源尚未备齐，请保持联网并刷新后重试。';$('cacheAudio').disabled=true;}
    }catch(error){$('offlineStatus').textContent=error.message;$('cacheAudio').disabled=true;}
  }
  $('cacheAudio').onclick=async()=>{
    busy=true;$('cacheAudio').disabled=true;$('cacheAudio').textContent='正在准备，请稍等…';$('offlineStatus').textContent='正在将完整歌曲保存到这台设备。请保持网页打开。';
    try{await workerMessage('CACHE_AUDIO');busy=false;await refreshStatus();}
    catch(error){busy=false;$('offlineStatus').textContent=error.message;$('cacheAudio').textContent='重新准备离线音频';$('cacheAudio').disabled=false;}
  };
  window.addEventListener('online',refreshStatus);window.addEventListener('offline',refreshStatus);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('installApp').hidden=false;});
  $('installApp').onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installApp').hidden=true;};
  window.addEventListener('appinstalled',()=>{$('installApp').hidden=true;installPrompt=null;});
  if('serviceWorker' in navigator&&location.protocol!=='file:'){
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(reg=>{registration=reg;refreshStatus();}).catch(()=>{$('offlineStatus').textContent='当前浏览器未能启用离线功能。请用 Chrome、Edge 或 Safari 的普通窗口打开正式网址。';});
  }else{$('offlineStatus').textContent='请通过正式 HTTPS 网址打开，才能准备离线学习。本地文件仍可直接播放。';}
  refreshStatus();
})();
