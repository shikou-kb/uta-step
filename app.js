(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const lines = window.UTA_LESSONS;
  if (!Array.isArray(lines) || !lines.length) { $('jpLine').textContent = '歌词资料未能加载，请刷新页面。'; return; }
  const KEY = 'uta-step-v1';
  const SONG = '2752729049';
  const SECTIONS = ['01 · 清晨的小事', '02 · 消失的兴趣', '03 · 为什么只有我', '04 · 想相信明天', '05 · 人群之中', '06 · 梦的片段', '07 · 再一次相信', '08 · 于是今天又活了下来'];
  const SECTION_CODES = ['VERSE 01', 'VERSE 02', 'PRE-CHORUS', 'CHORUS 01', 'VERSE 03', 'BRIDGE', 'CHORUS 02', 'OUTRO'];
  const defaults = {version:1,song:SONG,selected:0,mastered:[],prefs:{kana:true,kanaScript:'katakana',romaji:true,zh:true,speed:0.75,mode:'single',gap:'auto',volume:0.8,follow:true},timings:{},offset:0};
  const clone = x => JSON.parse(JSON.stringify(x));
  function cleanState(raw) {
    const value = clone(defaults);
    if (!raw || raw.song !== SONG || raw.version !== 1) return value;
    value.selected = Math.max(0,Math.min(lines.length-1,Number.isInteger(raw.selected)?raw.selected:0));
    value.mastered = [...new Set((Array.isArray(raw.mastered)?raw.mastered:[]).filter(i=>Number.isInteger(i)&&i>=0&&i<lines.length))];
    const p=raw.prefs||{};
    for(const k of ['kana','romaji','zh','follow']) if(typeof p[k]==='boolean')value.prefs[k]=p[k];
    if(['katakana','hiragana'].includes(p.kanaScript))value.prefs.kanaScript=p.kanaScript;
    if([0.6,0.75,0.9,1,1.1].includes(p.speed))value.prefs.speed=p.speed;
    if(['single','loop','shadow','song'].includes(p.mode))value.prefs.mode=p.mode;
    if(['auto','2','4','6'].includes(String(p.gap)))value.prefs.gap=String(p.gap);
    if(Number.isFinite(p.volume))value.prefs.volume=Math.min(1,Math.max(0,p.volume));
    if(Number.isFinite(raw.offset)&&Math.abs(raw.offset)<=10)value.offset=raw.offset;
    if(raw.timings&&typeof raw.timings==='object')for(const [k,v] of Object.entries(raw.timings)){
      const i=Number(k);
      if(Number.isInteger(i)&&i>=0&&i<lines.length&&v&&validRange(v.start,v.end))value.timings[i]={start:v.start,end:v.end};
    }
    let previous=-1;
    for(let i=0;i<lines.length;i++){
      const segment=value.timings[i]||lines[i];
      if(segment.start<=previous){value.timings={};break;}
      previous=segment.start;
    }
    if(lines.some((line,i)=>{const segment=value.timings[i]||line;return segment.start+value.offset<0||segment.end+value.offset>339.31;}))value.offset=0;
    return value;
  }
  let state=clone(defaults),storageOK=true;
  try {const raw=localStorage.getItem(KEY);if(raw)state=cleanState(JSON.parse(raw));} catch {storageOK=false;}
  const audio=$('audio');
  const builtInAudio=audio.src;
  let running=false,phase='idle',runId=0,gapTimer=0,gapTick=0,gapUntil=0,cycles=0,toastTimer=0,localURL=null,lastWaveTime=-1;
  let cueTime=bounds().start, pendingStart=null, muted=false;
  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{if(storageOK)toast('浏览器暂时无法保存。可从学习记录导出备份。');storageOK=false;}}
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3600);}
  function time(t,decimal=false){t=Math.max(0,Number(t)||0);const m=Math.floor(t/60),s=t%60;return String(m).padStart(2,'0')+':'+(decimal?s.toFixed(2).padStart(5,'0'):String(Math.floor(s)).padStart(2,'0'));}
  function validRange(start,end){return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start+0.15&&end<=339.32;}
  function bounds(i=state.selected){const v=state.timings[i]||lines[i];return {start:Math.max(0,v.start+state.offset),end:Math.min(Number.isFinite(audio.duration)?audio.duration:339.31,v.end+state.offset)};}
  function indexAt(t){let found=0;for(let i=0;i<lines.length;i++){if(bounds(i).start<=t)found=i;else break;}return found;}
  function playhead(){return cueTime??audio.currentTime;}
  function cueSelected(){cueTime=bounds().start;tick();}
  function setSpeed(speed){audio.defaultPlaybackRate=speed;audio.playbackRate=speed;}
  function syncPrefs(){
    for(const k of ['romaji','zh']){$(k+'Toggle').setAttribute('aria-pressed',String(state.prefs[k]));$(k+'Line').hidden=!state.prefs[k];}
    $('kanaDisplay').value=state.prefs.kana?state.prefs.kanaScript:'off';
    $('kanaLine').hidden=!state.prefs.kana;
    $('speedSelect').value=String(state.prefs.speed);setSpeed(state.prefs.speed);audio.preservesPitch=true;
    $('modeSelect').value=state.prefs.mode;$('gapSelect').value=state.prefs.gap;$('gapSelect').disabled=state.prefs.mode!=='shadow';
    $('volumeSlider').value=state.prefs.volume;audio.volume=state.prefs.volume;
    $('followBtn').setAttribute('aria-pressed',String(state.prefs.follow));$('followBtn').textContent=state.prefs.follow?'跟随 ✓':'跟随';
    $('offsetInput').value=state.offset;
    const hints={single:'先听清一句，再按播放重听。无需从头找进度。',loop:'这一句会持续循环。点暂停或选择其他句即可停止。',shadow:'原唱一句后留出练习时间，再重复这一句。没有录音或自动评分。',song:'从选中的句子开始，按原曲顺序继续播放。'};
    $('modeHint').textContent=hints[state.prefs.mode];
  }
  const particleSounds=new Map([['は','ワ'],['へ','エ'],['を','オ']]);
  function katakana(kana){
    return kana.replace(/\S+/g,word=>particleSounds.get(word)??word.replace(/[ぁ-ゖゝゞ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60)));
  }
  function reading(kana){
    if(state.prefs.kanaScript==='katakana')return katakana(kana);
    return kana.replace(/[ァ-ヶヽヾ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
  }
  function renderList(){
    const query=$('searchInput').value.trim().toLowerCase(),sec=$('sectionSelect').value;
    const fragment=document.createDocumentFragment();let lastSection=-1,count=0;
    lines.forEach((line,i)=>{
      if(sec!=='all'&&Number(sec)!==line.section)return;
      if(query&&![line.jp,line.zh,line.kana,katakana(line.kana),line.romaji].some(x=>x.toLowerCase().includes(query)))return;
      if(lastSection!==line.section){const label=document.createElement('div');label.className='section-marker';label.textContent=SECTIONS[line.section]||'逐句练习';fragment.append(label);lastSection=line.section;}
      const button=document.createElement('button');button.type='button';button.dataset.index=i;button.className='lyric-row';button.setAttribute('role','listitem');button.setAttribute('aria-label',`播放第 ${i+1} 句：${line.jp}`);
      const n=document.createElement('span');n.className='lyric-num';n.textContent=state.mastered.includes(i)?'✓':String(i+1).padStart(2,'0');
      const words=document.createElement('span'),jp=document.createElement('span'),zh=document.createElement('span');jp.className='lyric-jp';jp.lang='ja';jp.textContent=line.jp;zh.className='lyric-zh';zh.textContent=line.zh;zh.hidden=!state.prefs.zh;words.append(jp,zh);
      const stamp=document.createElement('span');stamp.className='lyric-time';stamp.textContent=time(bounds(i).start);
      button.append(n,words,stamp);fragment.append(button);count++;
    });
    if(!count){const empty=document.createElement('p');empty.className='no-results';empty.textContent='没有找到这一句。试试中文或缩短关键词。';fragment.append(empty);}
    $('lyricList').replaceChildren(fragment);markActive(false);
  }
  function markActive(scroll){
    document.querySelectorAll('.lyric-row').forEach(row=>{const i=Number(row.dataset.index),active=i===state.selected;row.classList.toggle('active',active);row.classList.toggle('learned',state.mastered.includes(i));if(active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});
    const active=$('lyricList').querySelector('.active');
    if(scroll&&active&&state.prefs.follow){const list=$('lyricList'),top=active.offsetTop-list.offsetTop;if(top<list.scrollTop+35||top+active.clientHeight>list.scrollTop+list.clientHeight-15)list.scrollTo({top:top-list.clientHeight/2+active.clientHeight/2,behavior:'auto'});}
  }
  function renderProgress(){const count=state.mastered.length;$('headerCount').textContent=count;$('learnedCount').textContent=count;$('progressDenom').textContent=`/ ${lines.length} 句`;$('progressFill').style.width=`${count/lines.length*100}%`;$('lineTotal').textContent=`${lines.length} 句练习`;}
  function renderReadings(line=lines[state.selected]){
    $('kanaLine').textContent=reading(line.kana);
    const fragment=document.createDocumentFragment();
    for(const token of line.tokens){
      const wrap=document.createElement('div');wrap.className='token';
      const jp=document.createElement('div');jp.className='token-jp';jp.lang='ja';jp.append(document.createTextNode(token.text));
      const kana=document.createElement('span');kana.className='token-kana';kana.textContent=reading(token.kana);jp.append(kana);
      const meaning=document.createElement('span');meaning.className='token-meaning';meaning.textContent=token.meaning;
      wrap.append(jp,meaning);fragment.append(wrap);
    }
    $('tokenList').replaceChildren(fragment);
  }
  function renderCurrent(scroll=false){
    const line=lines[state.selected],b=bounds();
    $('jpLine').textContent=line.jp;$('romajiLine').textContent=line.romaji;$('zhLine').textContent=line.zh;
    renderReadings(line);
    $('lineTime').textContent=`${time(b.start)} — ${time(b.end)}`;$('lineCounter').textContent=String(state.selected+1).padStart(2,'0');$('sectionLabel').textContent=SECTION_CODES[line.section]||'PRACTICE';$('nowPlaying').textContent=line.jp;
    $('masterBtn').setAttribute('aria-pressed',String(state.mastered.includes(state.selected)));$('masterBtn').lastChild.textContent=state.mastered.includes(state.selected)?' 已掌握，再复习':' 这句我会了';
    $('prevBtn').disabled=state.selected===0;$('dockPrev').disabled=state.selected===0;$('nextBtn').disabled=state.selected===lines.length-1;$('dockNext').disabled=state.selected===lines.length-1;
    $('grammarTitle').textContent=line.grammar.title;$('grammarBody').textContent=line.grammar.body;$('exampleJp').textContent=line.grammar.example;$('exampleZh').textContent=line.grammar.exampleZh;$('pronunciation').textContent=line.pronunciation;
    $('cautionBox').hidden=!line.caution;$('cautionText').textContent=line.caution||'';
    const raw=state.timings[state.selected]||line;$('startInput').value=raw.start.toFixed(3);$('endInput').value=raw.end.toFixed(3);$('timingError').textContent='';
    markActive(scroll);updateTransport();
  }
  function cancelGap(){clearTimeout(gapTimer);clearInterval(gapTick);gapTimer=0;gapTick=0;}
  function stop(){
    runId++;running=false;cancelGap();
    pendingStart?.abort();pendingStart=null;
    audio.pause();audio.muted=muted;
    phase='idle';updateTransport();
  }
  function updateTransport(){
    $('playBtn').firstElementChild.textContent=running?'Ⅱ':'▶';$('playBtn').setAttribute('aria-label',running?'暂停播放':'播放当前句');
    if(pendingStart){
      $('lineState').textContent=phase==='buffering'?'正在下载音频以定位本句…':'正在定位本句…';
      $('repeatCount').textContent='定位后开始播放';
      return;
    }
    if(phase==='gap'){$('lineState').textContent=`轮到你唱 · ${Math.max(1,Math.ceil((gapUntil-Date.now())/1000))} 秒`;$('repeatCount').textContent=`第 ${cycles} 遍 · 跟唱时间`;}else if(running){const b=bounds();const inGap=state.prefs.mode==='song'&&(audio.currentTime<b.start-0.1||audio.currentTime>b.end);$('lineState').textContent=inGap?'间奏 · 稍作休息':'正在听原唱';$('repeatCount').textContent=cycles?`已听 ${cycles} 遍`:'跟着旋律，慢慢来';}else{$('lineState').textContent=phase==='done'?'听完了，试着唱一遍':'准备好，先听一遍';$('repeatCount').textContent=cycles?`已听 ${cycles} 遍`:'先听，再开口';}
  }
  function playAt(target,signal){
    return new Promise((resolve,reject)=>{
      let started=false;
      const timer=setTimeout(()=>finish(reject,Error('定位超时')),8000);
      function finish(callback,value){
        clearTimeout(timer);
        signal.removeEventListener('abort',cancel);
        audio.removeEventListener('seeked',checkPosition);
        audio.removeEventListener('error',mediaError);
        callback(value);
      }
      function cancel(){finish(reject,signal.reason);}
      function mediaError(){finish(reject,Error('音频读取失败'));}
      function checkPosition(){
        if(!started||audio.seeking)return;
        if(Math.abs(audio.currentTime-target)>0.3){finish(reject,Error('音频没有到达所选位置'));return;}
        finish(resolve);
      }
      signal.addEventListener('abort',cancel,{once:true});
      audio.addEventListener('seeked',checkPosition);
      audio.addEventListener('error',mediaError);
      if(signal.aborted){cancel();return;}
      try{
        audio.currentTime=target;
        audio.play().then(()=>{started=true;checkPosition();},error=>finish(reject,error));
      }catch(error){finish(reject,error);}
    });
  }
  async function startAudio(t){
    runId++;cancelGap();
    const attempt=new AbortController();
    pendingStart=attempt;
    const target=Math.max(0,t);
    cueTime=target;phase='locating';running=true;
    // A browser can clamp a seek while the media is loading. Keep it silent until the position is confirmed.
    audio.muted=true;updateTransport();tick();
    try{
      try{await playAt(target,attempt.signal);}
      catch(error){
        if(attempt.signal.aborted||error?.name==='NotAllowedError'||audio.src!==builtInAudio||!/^https?:/.test(builtInAudio))throw error;
        audio.pause();phase='buffering';updateTransport();
        const response=await fetch(builtInAudio,{signal:attempt.signal});
        if(response.status!==200)throw Error('音频下载失败');
        const song=await response.blob();
        if(!song.size||!song.type.startsWith('audio/'))throw Error('音频下载不完整');
        if(attempt.signal.aborted)return;
        localURL=URL.createObjectURL(song);
        audio.src=localURL;
        await playAt(target,attempt.signal);
      }
      if(attempt.signal.aborted)return;
      pendingStart=null;cueTime=null;phase='listening';audio.muted=muted;updateTransport();tick();
    }catch(error){
      if(attempt.signal.aborted)return;
      stop();
      toast(error?.name==='NotAllowedError'?'请点播放键继续这一句。':'这句音频暂时未能定位。可重试，或在页面底部更换本地音频。');
    }
  }
  function playLine(i=state.selected){stop();state.selected=Math.max(0,Math.min(lines.length-1,i));cycles=0;renderCurrent(true);save();startAudio(bounds().start);}
  function togglePlay(){if(running){stop();return;}const b=bounds();let t=playhead();if(state.prefs.mode!=='song'&&(t<b.start||t>=b.end-0.06))t=b.start;if(phase==='done')t=b.start;startAudio(t);}
  function finishSegment(){
    if(!running||phase!=='listening'||state.prefs.mode==='song')return;
    const b=bounds();audio.pause();audio.currentTime=b.end;cycles++;
    if(state.prefs.mode==='single'){running=false;phase='done';updateTransport();return;}
    if(state.prefs.mode==='loop'){startAudio(b.start);return;}
    phase='gap';const seconds=state.prefs.gap==='auto'?Math.max(1,(b.end-b.start)/state.prefs.speed):Number(state.prefs.gap);gapUntil=Date.now()+seconds*1000;updateTransport();
    const token=++runId;gapTick=setInterval(updateTransport,200);gapTimer=setTimeout(()=>{if(token!==runId||!running)return;cancelGap();startAudio(bounds().start);},seconds*1000);
  }
  function tick(){
    const t=playhead();
    if(running&&phase==='listening'){
      if(state.prefs.mode==='song'){const i=indexAt(t);if(i!==state.selected){state.selected=i;renderCurrent(true);save();}updateTransport();}
      else if(t>=bounds().end-0.025)finishSegment();
    }
    $('currentTime').textContent=time(t);$('seekBar').value=t;$('seekBar').setAttribute('aria-valuetext',`${time(t)}，总长 ${time(audio.duration||339.31)}`);
    const b=bounds();$('phraseTrack').firstElementChild.style.width=`${Math.max(0,Math.min(100,(t-b.start)/(b.end-b.start)*100))}%`;
    if(Math.abs(t-lastWaveTime)>0.12){drawWave();lastWaveTime=t;}
  }
  function frame(){tick();requestAnimationFrame(frame);}
  function drawWave(){
    const canvas=$('waveform'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const ctx=canvas.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,width,height);
    const values=window.UTA_WAVEFORM||Array(200).fill(.35),step=width/values.length,progress=playhead()/(audio.duration||339.31);
    for(let i=0;i<values.length;i++){const h=Math.max(2*dpr,values[i]*height*.78);ctx.fillStyle=i/values.length<=progress?'#768964':'#d6dccb';ctx.fillRect(i*step,(height-h)/2,Math.max(dpr,step*.55),h);}
    ctx.fillStyle='#c84f35';ctx.fillRect(progress*width,1,1.4*dpr,height-2);
  }
  function navigate(delta){const i=state.selected+delta;if(i<0||i>=lines.length)return;playLine(i);}
  $('lyricList').addEventListener('click',event=>{const row=event.target.closest('[data-index]');if(row){playLine(Number(row.dataset.index));if(window.matchMedia('(max-width:680px)').matches)$('practice').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});}});
  $('searchInput').addEventListener('input',renderList);$('sectionSelect').addEventListener('change',renderList);
  SECTIONS.forEach((name,i)=>{const option=document.createElement('option');option.value=i;option.textContent=name;$('sectionSelect').append(option);});
  $('followBtn').onclick=()=>{state.prefs.follow=!state.prefs.follow;syncPrefs();save();};
  for(const k of ['romaji','zh'])$(k+'Toggle').onclick=()=>{state.prefs[k]=!state.prefs[k];syncPrefs();if(k==='zh')renderList();save();};
  $('kanaDisplay').onchange=()=>{
    const style=$('kanaDisplay').value;
    state.prefs.kana=style!=='off';
    if(state.prefs.kana)state.prefs.kanaScript=style;
    $('kanaLine').hidden=!state.prefs.kana;
    renderReadings();save();
  };
  $('prevBtn').onclick=()=>navigate(-1);$('dockPrev').onclick=()=>navigate(-1);$('nextBtn').onclick=()=>navigate(1);$('dockNext').onclick=()=>navigate(1);
  $('replayBtn').onclick=()=>playLine();$('playBtn').onclick=togglePlay;
  $('masterBtn').onclick=()=>{const i=state.selected;if(state.mastered.includes(i))state.mastered=state.mastered.filter(x=>x!==i);else{state.mastered.push(i);toast('记下了。这一句，又近了一点。');}save();renderProgress();renderList();renderCurrent();};
  $('modeSelect').onchange=()=>{const wasRunning=running;stop();state.prefs.mode=$('modeSelect').value;cycles=0;syncPrefs();save();if(wasRunning)startAudio(bounds().start);};
  $('gapSelect').onchange=()=>{state.prefs.gap=$('gapSelect').value;save();if(phase==='gap'){stop();startAudio(bounds().start);}};
  $('speedSelect').onchange=()=>{state.prefs.speed=Number($('speedSelect').value);setSpeed(state.prefs.speed);save();};
  function setMuted(value){
    muted=value;audio.muted=muted||Boolean(pendingStart);
    $('muteBtn').setAttribute('aria-pressed',String(muted));$('muteBtn').setAttribute('aria-label',muted?'取消静音':'静音');$('muteBtn').textContent=muted?'×':'♪';
  }
  $('volumeSlider').oninput=()=>{audio.volume=Number($('volumeSlider').value);state.prefs.volume=audio.volume;setMuted(false);save();};
  $('muteBtn').onclick=()=>setMuted(!muted);
  $('seekBar').addEventListener('input',()=>{
    const wasRunning=running;stop();const t=Number($('seekBar').value);cueTime=t;state.selected=indexAt(t);cycles=0;renderCurrent(true);save();
    if(wasRunning){const b=bounds();startAudio(state.prefs.mode==='song'?t:Math.min(Math.max(t,b.start),b.end-0.1));}else tick();
  });
  audio.addEventListener('loadedmetadata',()=>{$('seekBar').max=audio.duration;$('durationTime').textContent=time(audio.duration);drawWave();});
  audio.addEventListener('timeupdate',tick);
  audio.addEventListener('ended',()=>{if(!running||phase!=='listening')return;if(state.prefs.mode==='song'){running=false;phase='done';updateTransport();}else finishSegment();});
  audio.addEventListener('error',()=>{if(!pendingStart){stop();toast('音频加载失败。可点页面底部「更换本地音频」选择你的文件。');}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
  window.addEventListener('resize',drawWave);

  function openDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
  for(const id of ['guideOpen','quickGuide','readingHelp','soundGuide'])$(id).onclick=()=>openDialog('guideDialog');
  $('aboutOpen').onclick=()=>openDialog('aboutDialog');
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
  function tab(which){const sound=which==='sound';$('wordsTab').setAttribute('aria-selected',String(!sound));$('soundTab').setAttribute('aria-selected',String(sound));$('wordsTab').tabIndex=sound?-1:0;$('soundTab').tabIndex=sound?0:-1;$('wordsPane').hidden=sound;$('soundPane').hidden=!sound;}
  $('wordsTab').onclick=()=>tab('words');$('soundTab').onclick=()=>tab('sound');
  for(const id of ['wordsTab','soundTab'])$(id).addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const sound=id==='wordsTab';tab(sound?'sound':'words');$(sound?'soundTab':'wordsTab').focus();}});
  $('notebookOpen').onclick=()=>{
    const list=$('notebookList');list.replaceChildren();
    if(!state.mastered.length){const p=document.createElement('p');p.className='no-results';p.textContent='还没有标记。先学会第一句，就从今天开始。';list.append(p);}
    [...state.mastered].sort((a,b)=>a-b).forEach(i=>{const button=document.createElement('button');button.className='notebook-row';const text=document.createElement('span');text.textContent=`${String(i+1).padStart(2,'0')}　${lines[i].jp}`;const stamp=document.createElement('small');stamp.textContent='去复习 →';button.append(text,stamp);button.onclick=()=>{$('notebookDialog').close();playLine(i);};list.append(button);});
    openDialog('notebookDialog');
  };
  function download(name,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('exportBtn').onclick=()=>download('歌で一歩-学习备份.json',JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2));
  $('backupImport').onclick=()=>$('backupFile').click();
  $('backupFile').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>1000000)throw Error('文件过大');const raw=JSON.parse(await file.text());if(raw.song!==SONG||raw.version!==1)throw Error('不是这首歌的学习备份');stop();const imported=cleanState(raw);state={...imported,mastered:[...new Set([...state.mastered,...imported.mastered])]};save();syncPrefs();renderProgress();renderList();renderCurrent();cueSelected();$('notebookDialog').close();toast('已导入备份，并合并已掌握的句子。');}catch(e){toast('无法导入：'+e.message);}event.target.value='';};
  $('captureStart').onclick=()=>$('startInput').value=Math.max(0,playhead()-state.offset).toFixed(3);
  $('captureEnd').onclick=()=>$('endInput').value=Math.max(0,playhead()-state.offset).toFixed(3);
  $('saveTiming').onclick=()=>{
    const start=Number($('startInput').value),end=Number($('endInput').value),i=state.selected;
    if(!$('startInput').value||!$('endInput').value||!validRange(start,end)){$('timingError').textContent='请填写有效时间：结束须比开始晚至少 0.15 秒，且不超过 339.31 秒。';return;}
    if((i>0&&start<=((state.timings[i-1]||lines[i-1]).start))||(i<lines.length-1&&start>=((state.timings[i+1]||lines[i+1]).start))){$('timingError').textContent='本句开始时间应位于前后两句的开始时间之间。';return;}
    if(start+state.offset<0||end+state.offset>(audio.duration||339.31)){$('timingError').textContent='加上整曲偏移后，本句超出了音频范围。请调整时间或偏移。';return;}
    stop();state.timings[i]={start,end};save();renderList();renderCurrent();cueSelected();toast('本句时间已保存。点「听这一句」试听。');
  };
  $('offsetInput').onchange=()=>{const value=Number($('offsetInput').value);if(!Number.isFinite(value)||Math.abs(value)>10){$('offsetInput').value=state.offset;toast('整曲偏移请在 -10 到 10 秒之间。');return;}if(lines.some((line,i)=>{const segment=state.timings[i]||line;return segment.start+value<0||segment.end+value>(audio.duration||339.31);})){ $('offsetInput').value=state.offset;toast('这个偏移会把句子移出音频范围，请减小偏移。');return;}stop();state.offset=value;save();renderList();renderCurrent();cueSelected();toast('整曲时间偏移已保存。');};
  $('resetTiming').onclick=()=>{stop();delete state.timings[state.selected];save();renderList();renderCurrent();cueSelected();toast('本句已恢复平台时间；整曲偏移仍按你的设置。');};
  $('importOpen').onclick=()=>$('audioFile').click();
  $('audioFile').onchange=event=>{const file=event.target.files[0];if(!file)return;stop();if(localURL)URL.revokeObjectURL(localURL);localURL=URL.createObjectURL(file);audio.src=localURL;cueSelected();toast('已载入本地音频。请使用同一首歌、同一版本，刷新后恢复内置音频。');event.target.value='';};
  document.addEventListener('keydown',event=>{
    const target=event.target;if(target.closest('input,select,textarea,button,dialog')||target.isContentEditable)return;
    if(event.code==='Space'){event.preventDefault();togglePlay();}else if(event.key==='ArrowLeft'){event.preventDefault();navigate(-1);}else if(event.key==='ArrowRight'){event.preventDefault();navigate(1);}
  });
  window.addEventListener('pagehide',()=>{stop();save();});
  syncPrefs();renderProgress();renderList();renderCurrent();tab('words');drawWave();requestAnimationFrame(frame);
  if(!storageOK)toast('浏览器存储不可用，本次仍可练习；离开前请导出学习备份。');
})();
