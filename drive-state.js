(function(root){
  'use strict';
  var clone=function(v){return JSON.parse(JSON.stringify(v));};
  function field(key){
    if(typeof key!=='string')throw Error('잘못된 기록 항목');
    var p=key.split('|'),lesson=root.COURSE.lessons.find(function(l){return l.id===p[0];});
    if(!lesson||!['memo','done','check','day'].includes(p[1]))throw Error('알 수 없는 수업 항목');
    if(p[1]==='memo'||p[1]==='done'){if(p.length!==2)throw Error('잘못된 항목');}
    else if(p[1]==='check'){
      if(p.length!==3||!lesson.checklist.some(function(c){return c.id===p[2];}))throw Error('알 수 없는 체크');
    }else if(p.length!==3||!lesson.daily||!/^\d{4}-\d{2}-\d{2}$/.test(p[2])||isNaN(Date.parse(p[2]))||new Date(p[2]).toISOString().slice(0,10)!==p[2])throw Error('잘못된 날짜');
    return p;
  }
  function value(state,key){
    var p=field(key),l=state.lessons[p[0]]||{};
    if(p[1]==='memo')return l.memo||'';
    if(p[1]==='done')return !!l.done;
    if(p[1]==='check')return !!(l.checks&&l.checks[p[2]]);
    return !!(l.days&&l.days.includes(p[2]));
  }
  function put(state,key,v){
    var p=field(key);if(typeof v!==(p[1]==='memo'?'string':'boolean'))throw Error('잘못된 값');
    var l=state.lessons[p[0]]||(state.lessons[p[0]]={checks:{},memo:'',done:false});
    if(p[1]==='memo'||p[1]==='done')l[p[1]]=v;
    else if(p[1]==='check')l.checks[p[2]]=v;
    else{l.days=(l.days||[]).filter(function(d){return d!==p[2];});if(v)l.days.push(p[2]);l.days.sort();}
  }
  function diff(a,b){
    var keys=new Set();[a,b].forEach(function(s){Object.keys(s.lessons).forEach(function(id){
      keys.add(id+'|memo');keys.add(id+'|done');
      Object.keys(s.lessons[id].checks||{}).forEach(function(c){keys.add(id+'|check|'+c);});
      (s.lessons[id].days||[]).forEach(function(d){keys.add(id+'|day|'+d);});
    });});
    return Array.from(keys).map(function(key){return{key:key,before:value(a,key),after:value(b,key)};}).filter(function(c){return c.before!==c.after;});
  }
  function model(ops){
    var all=new Map(),children=new Map(),degree=new Map(),groups=new Map(),removed=new Set();
    ops.forEach(function(o){
      var p=field(o.key);
      if(!/^[\w-]{1,100}$/.test(o.id)||!Array.isArray(o.parents)||o.parents.length>1000||!o.parents.every(function(id){return typeof id==='string'&&/^[\w-]{1,100}$/.test(id);})||typeof o.value!==(p[1]==='memo'?'string':'boolean'))throw Error('잘못된 동기화 기록');
      var clean={id:o.id,key:o.key,parents:Array.from(new Set(o.parents)).sort(),value:o.value};
      if(all.has(o.id)&&JSON.stringify(all.get(o.id))!==JSON.stringify(clean))throw Error('동일 기록 ID의 내용이 다릅니다');
      all.set(o.id,clean);
    });
    all.forEach(function(o){
      var count=0;
      o.parents.forEach(function(id){
        removed.add(id);if(!all.has(id))return;
        if(all.get(id).key!==o.key)throw Error('다른 항목을 참조한 기록');
        count++;if(!children.has(id))children.set(id,[]);children.get(id).push(o.id);
      });degree.set(o.id,count);
    });
    var queue=[];degree.forEach(function(n,id){if(!n)queue.push(id);});
    for(var i=0;i<queue.length;i++)(children.get(queue[i])||[]).forEach(function(id){degree.set(id,degree.get(id)-1);if(!degree.get(id))queue.push(id);});
    if(queue.length!==all.size)throw Error('순환 참조한 동기화 기록');
    all.forEach(function(o){if(!removed.has(o.id)){if(!groups.has(o.key))groups.set(o.key,[]);groups.get(o.key).push(o);}});
    var state={last:null,lessons:{}},heads={},conflicts=[];
    groups.forEach(function(list,key){
      list.sort(function(a,b){return a.id<b.id?-1:a.id>b.id?1:0;});heads[key]=list;
      put(state,key,list[list.length-1].value);
      if(new Set(list.map(function(o){return JSON.stringify(o.value);})).size>1)conflicts.push({key:key,choices:list});
    });
    return{state:state,heads:heads,conflicts:conflicts,ops:Array.from(all.values())};
  }
  root.StudyDriveState={clone:clone,value:value,put:put,diff:diff,model:model};
})(typeof window!=='undefined'?window:globalThis);
