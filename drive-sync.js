(function(){
  'use strict';
  var C=window.StudyDriveState,hooks,panel,client;
  var user=null,access='',expires=0,epoch=0,attempt=0,work=null,writeTimer,pollTimer;
  var ops=[],queue=[],draft={},seen=new Set(),status='',persistenceError=false,blocked=false;
  var empty=function(){return{last:null,lessons:{}};};
  var uuid=function(){return crypto.randomUUID();};
  var key=function(){return 'chageun-drive-replica-v1:'+user.sub;};
  function store(){
    if(!user)return true;
    try{localStorage.setItem(key(),JSON.stringify({ops:ops,queue:queue,draft:draft,seen:Array.from(seen)}));persistenceError=false;return true;}
    catch(e){persistenceError=true;return false;}
  }
  function all(){return ops.concat(queue.flatMap(function(b){return b.ops;}));}
  function current(){return C.model(all());}
  function view(){
    var m=current(),s=C.clone(m.state);
    Object.keys(draft).forEach(function(k){C.put(s,k,draft[k].value);});
    hooks.apply(s);return m;
  }
  function node(tag,text,parent){var e=document.createElement(tag);if(text)e.textContent=text;if(parent)parent.appendChild(e);return e;}
  function button(text,fn,parent){var b=node('button',text,parent);b.type='button';b.addEventListener('click',fn);return b;}
  function render(){
    if(!panel)return;
    var open=panel.children[0]&&panel.children[0].open,m=current();panel.replaceChildren();
    var details=node('details','',panel);details.open=!!open||!!m.conflicts.length;
    var connected=user&&access&&Date.now()<expires;
    node('summary','Google Drive 동기화 · '+(user?user.email+' · '+(connected?'연결됨':'재연결 필요'):'연결 전'),details);
    node('p',status+(persistenceError?' 전송 대기 기록 저장에 실패했습니다. JSON 백업을 받아 주세요.':''),details).setAttribute('role','status');
    var row=node('div','',details);row.className='btn-row';
    if(client)button(connected?'구글 계정 변경':'구글 계정으로 연결',function(){client.requestAccessToken({prompt:'select_account'});},row);
    if(user){
      button('지금 동기화',function(){run();},row);
      button('연결 해제',disconnect,row);
      button('로그인 전 기록 가져오기',importGuest,row);
      node('p','로그인 전 기록은 별도로 보관됩니다. 처음 연결한 기기의 기존 기록을 계정에 합치려면 가져오기를 눌러 주세요.',details);
    }
    m.conflicts.forEach(function(conflict){
      var lesson=window.COURSE.lessons.find(function(l){return l.id===conflict.key.split('|')[0];});
      var section=node('section','',details);node('h3',lesson.title+' · 기록 충돌',section);
      node('p','두 기기에서 같은 항목이 다르게 바뀌었습니다. 남길 내용을 선택하세요.',section);
      conflict.choices.forEach(function(choice){
        node('p',choice.value===''?'(빈 메모)':typeof choice.value==='boolean'?(choice.value?'적용함':'취소함'):String(choice.value),section);
        button('이 내용 사용',function(){
          draft[conflict.key]={value:choice.value,base:C.value(m.state,conflict.key),parents:conflict.choices.map(function(o){return o.id;})};
          freeze();view();render();schedule();
        },section);
      });
    });
  }
  function freeze(){
    var changes=Object.keys(draft).map(function(k){return{id:uuid(),key:k,value:draft[k].value,parents:draft[k].parents};});
    if(changes.length){queue.push({id:uuid(),ops:changes});draft={};store();}
  }
  function schedule(){
    clearTimeout(writeTimer);status='수정 내용은 이 기기에 보관했고 자동 전송을 기다립니다.';render();
    writeTimer=setTimeout(run,1800);
  }
  function changed(before,after){
    if(!user||blocked)return;
    var m=current();
    C.diff(before,after).forEach(function(c){
      if(!draft[c.key])draft[c.key]={base:C.value(m.state,c.key),parents:(m.heads[c.key]||[]).map(function(o){return o.id;}),value:c.after};
      else draft[c.key].value=c.after;
      if(draft[c.key].value===draft[c.key].base)delete draft[c.key];
    });
    store();schedule();
  }
  async function api(url,options,session){
    if(session.epoch!==epoch)throw Error('session-changed');
    var response=await fetch(url,Object.assign({},options,{headers:Object.assign({},options&&options.headers,{Authorization:'Bearer '+session.access})}));
    if(response.status===401){if(session.epoch===epoch){access='';expires=0;}throw Error('로그인 권한이 만료됐습니다. 구글 계정으로 다시 연결해 주세요.');}
    if(!response.ok)throw Error('Google Drive 요청에 실패했습니다 ('+response.status+'). 잠시 후 다시 시도해 주세요.');
    var text=await response.text();if(text.length>2000000)throw Error('동기화 파일 크기가 너무 큽니다.');
    return text?JSON.parse(text):{};
  }
  async function pull(session){
    var token='',pages=new Set(),newIds=[],received=[];
    do{
      if(pages.has(token))throw Error('Drive 목록을 확인하지 못했습니다.');pages.add(token);
      var params=new URLSearchParams({spaces:'appDataFolder',q:"trashed = false and name contains 'obsidian-study-ops-'",pageSize:'1000',fields:'nextPageToken,files(id,name,size)'});
      if(token)params.set('pageToken',token);
      var result=await api('https://www.googleapis.com/drive/v3/files?'+params,{},session);
      for(var file of result.files||[]){
        if(seen.has(file.id)||!/^obsidian-study-ops-[\w-]+\.json$/.test(file.name))continue;
        if(Number(file.size)>2000000)throw Error('Drive의 동기화 파일을 확인해 주세요.');
        var data=await api('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media',{},session);
        if(data.app!=='chageun-obsidian-sync'||data.version!==1||!Array.isArray(data.ops))throw Error('Drive 기록의 형식이 맞지 않습니다. 덮어쓰지 않았습니다.');
        received.push.apply(received,data.ops);newIds.push(file.id);
      }
      token=result.nextPageToken||'';
    }while(token);
    if(session.epoch!==epoch)throw Error('session-changed');
    var merged=C.model(ops.concat(received)).ops;
    ops=merged;newIds.forEach(function(id){seen.add(id);});store();
  }
  async function upload(batch,session){
    var boundary='obsidian_'+uuid();
    var meta={name:'obsidian-study-ops-'+batch.id+'.json',parents:['appDataFolder']};
    var data={app:'chageun-obsidian-sync',version:1,ops:batch.ops};
    var body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+
      '\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(data)+'\r\n--'+boundary+'--';
    if(new Blob([body]).size>1900000)throw Error('기록이 커서 전송하지 못했습니다. JSON 백업으로 보관해 주세요.');
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{
      method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:body
    },session);
  }
  async function run(){
    if(work)return work;
    if(!user||blocked)return;
    if(!access||Date.now()>=expires){status='구글 연결 권한이 만료됐습니다. 다시 연결하면 자동 동기화가 이어집니다.';render();return;}
    if(!navigator.onLine){status='인터넷 연결을 기다립니다. 수정 기록은 이 기기에 보관합니다.';render();return;}
    var session={access:access,epoch:epoch};freeze();
    if(!store()){render();return;}
    status='Google Drive와 동기화 중입니다.';render();
    work=(async function(){
      try{
        await pull(session);
        current();
        var acknowledged=new Set(ops.map(function(o){return o.id;}));
        queue=queue.filter(function(b){return !b.ops.every(function(o){return acknowledged.has(o.id);});});store();
        while(queue.length){
          var batch=queue[0];
          // Files are append-only; repeated uploads after a lost response are deduplicated by operation ID.
          var result=await upload(batch,session);
          if(session.epoch!==epoch)return;
          if(!result.id)throw Error('전송 결과를 확인하지 못했습니다.');
          ops=C.model(ops.concat(batch.ops)).ops;seen.add(result.id);queue.shift();store();
        }
        await pull(session);
        if(session.epoch!==epoch)return;
        var m=view();status=m.conflicts.length?'같은 항목이 다르게 바뀌었습니다. 아래에서 내용을 선택해 주세요.':'동기화 완료 · 연결 중에는 약 20초마다 다른 기기 기록을 확인합니다.';
        render();
      }catch(e){if(session.epoch===epoch){status=e.message;render();}}
      finally{if(session.epoch===epoch){work=null;if(Object.keys(draft).length)schedule();}}
    })();return work;
  }
  function disconnect(){
    epoch++;attempt++;clearTimeout(writeTimer);clearInterval(pollTimer);
    access='';expires=0;user=null;ops=[];queue=[];draft={};seen=new Set();work=null;blocked=false;
    hooks.switchAccount(null);status='이 브라우저에 저장합니다. 연결하면 Google Drive로 기록을 공유할 수 있습니다.';render();
  }
  function importGuest(){
    if(!user||blocked)return;
    try{
      var raw=localStorage.getItem('chageun-obsidian-v1');
      if(!raw){status='가져올 로그인 전 기록이 없습니다.';render();return;}
      var guest=hooks.parse(raw),m=current();
      C.diff(empty(),guest).filter(function(c){return !!c.after;}).forEach(function(c){
        if(C.value(m.state,c.key)===c.after)return;
        // No parents: an existing different cloud memo must be reviewed, never silently replaced.
        draft[c.key]={base:c.before,value:c.after,parents:[]};
      });freeze();view();render();schedule();
    }catch(e){status='기존 기록을 읽지 못했습니다. JSON 백업을 확인해 주세요.';render();}
  }
  async function onToken(response){
    var mine=++attempt;
    if(response.error||!response.access_token){status='구글 연결을 완료하지 못했습니다.';render();return;}
    if(!String(response.scope||'').split(' ').includes('https://www.googleapis.com/auth/drive.appdata')){status='이 앱의 전용 저장 공간 권한을 허용해야 동기화할 수 있습니다.';render();return;}
    try{
      var infoResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+response.access_token}});
      if(!infoResponse.ok)throw Error('구글 계정을 확인하지 못했습니다.');
      var info=await infoResponse.json();if(typeof info.sub!=='string'||!info.sub||!info.email||info.email_verified!==true)throw Error('계정 정보가 없습니다.');
      if(!Number.isFinite(Number(response.expires_in))||Number(response.expires_in)<=0)throw Error('연결 권한의 유효 시간을 확인하지 못했습니다.');
      if(mine!==attempt)return;
      epoch++;clearTimeout(writeTimer);clearInterval(pollTimer);work=null;
      user=info;access=response.access_token;expires=Date.now()+Math.max(0,Number(response.expires_in)-30)*1000;blocked=true;
      hooks.switchAccount(info.sub);
      ops=[];queue=[];draft={};seen=new Set();
      var saved=JSON.parse(localStorage.getItem(key())||'{"ops":[],"queue":[],"draft":{},"seen":[]}');
      if(!Array.isArray(saved.ops)||!Array.isArray(saved.queue)||!Array.isArray(saved.seen)||!saved.draft||typeof saved.draft!=='object'||Array.isArray(saved.draft))throw Error('이 기기의 대기 기록 형식을 확인하지 못했습니다. JSON 백업을 먼저 보관해 주세요.');
      C.model(saved.ops.concat(saved.queue.flatMap(function(b){if(!/^[\w-]{1,100}$/.test(b.id)||!Array.isArray(b.ops))throw Error('잘못된 대기 기록');return b.ops;})));
      var check=empty();Object.keys(saved.draft).forEach(function(k){C.put(check,k,saved.draft[k].value);if(!Array.isArray(saved.draft[k].parents))throw Error('잘못된 대기 기록');});
      hooks.parse(JSON.stringify(check));
      ops=saved.ops;queue=saved.queue;draft=saved.draft;seen=new Set(saved.seen);blocked=false;view();render();
      pollTimer=setInterval(function(){if(document.visibilityState!=='hidden')run();},20000);
      await run();
    }catch(e){if(mine===attempt){status=e.message;render();}}
  }
  function start(options){
    hooks=options;panel=document.getElementById('drive-panel');
    status='같은 구글 계정으로 연결하면 Google Drive를 통해 기록을 공유합니다. 새로고침하거나 권한이 만료되면 다시 연결하세요. 기록은 보관됩니다.';render();
    if(location.protocol==='file:'){status='Google Drive 연결은 배포된 웹 주소에서 사용하세요.';render();return;}
    var config=window.GOOGLE_DRIVE_CONFIG;
    if(!config||!config.clientId){status='구글 로그인 연결 설정이 아직 완료되지 않았습니다.';render();return;}
    var script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
    script.onload=function(){
      client=google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:'openid email https://www.googleapis.com/auth/drive.appdata',callback:onToken,
        error_callback:function(){status='로그인 창이 닫혔거나 차단됐습니다. 팝업을 허용한 뒤 다시 연결해 주세요.';render();}});render();
    };
    script.onerror=function(){status='구글 로그인 기능을 불러오지 못했습니다. 브라우저 저장은 계속 사용할 수 있습니다.';render();};
    document.head.appendChild(script);
    window.addEventListener('online',run);
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')run();});
  }
  window.StudyDrive={start:start,changed:changed};
})();
