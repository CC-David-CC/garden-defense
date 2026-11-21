import * as Phaser from 'phaser';
import {SynthAudio} from '../audio/synth.ts';
import {
 ENEMIES,
 GardenDefenseSession,
 SAVE_APP_ID,
 TOWERS,
 WAVE_COUNT,
 decodeSave,
 encodeSave,
 pathForMap,
 sessionFromSave,
 sitesForMap,
 type TowerRole,
} from '../model/garden.ts';

interface FileRecord{data:Uint8Array;version:string;status?:string}
interface FileContext{
 owner:string;
 valid():boolean;
 path(value:string):string;
 name(value:string):string;
 files:{
  read(path:string):Promise<FileRecord>;
  write(path:string,data:Uint8Array,version:string|null):Promise<{version:string;status?:string}>;
  stat?(path:string):Promise<{version:string;status?:string;bytes:number}>;
  subscribe?(callback:()=>void):()=>void;
  sync():Promise<unknown>;
 };
}

export interface Host{
 signal:AbortSignal;
 w?:{
  title?:string;
  ownerSub?:string;
  launchContext?:{version:1;storage:'mirror';path:string;owner:string};
  gardenDefense?:{dirty:boolean};
 };
 ui:{
  make(tag:string,className?:string,text?:string):HTMLElement;
  textButton(label:string,action:()=>void):HTMLButtonElement;
  appInput(label:string,value?:string):HTMLInputElement;
  confirm(message:string,options?:{title?:string;confirmLabel?:string;cancelLabel?:string;danger?:boolean;signal?:AbortSignal}):Promise<boolean>;
 };
 storage:{
  signedInSubject():string;
  mirrorFileContext():Promise<FileContext>;
  pickFile(options:{extensions:string[];signal?:AbortSignal}):Promise<string|null>;
  pickFolder(options:{signal?:AbortSignal}):Promise<string|null>;
 };
}

export interface ViewHandle{element:HTMLElement;dispose():void}

const VIEW_WIDTH=600,VIEW_HEIGHT=360,CELL=60;

export async function startView(host:Host,signal:AbortSignal):Promise<ViewHandle>{
 const {make,textButton,appInput}=host.ui;
 const owner=host.w?.launchContext?.owner||host.storage.signedInSubject();
 const windowState=host.w?.gardenDefense??{dirty:false};
 if(host.w){host.w.gardenDefense=windowState;host.w.ownerSub=owner}
 let session=new GardenDefenseSession(`garden-${crypto.randomUUID()}`,0);
 let disposed=false,busy=false,paused=true,dirty=false,revision=0,selectedSite=0,lastWave=0;
 let savedPath:string|null=null,savedVersion:string|null=null,unwatch=()=>{},watchSerial=0,watchCheck=0;
 let game:Phaser.Game|null=null,graphics:Phaser.GameObjects.Graphics|null=null;
 let stageResizeObserver:ResizeObserver|null=null;
 let observedWindow:HTMLElement|null=null,windowObserver:MutationObserver|null=null;
 const audio=new SynthAudio();
 const element=make('section','garden-view'),toolbar=make('div','garden-toolbar'),layout=make('div','garden-layout');
 const stageWrap=make('div','garden-stage-wrap'),side=make('div','garden-side'),summary=make('div','garden-summary');
 const siteLabel=make('div','garden-site-label'),advisor=make('div','garden-advisor'),controls=make('div','garden-controls');
 const warning=make('div','garden-warning'),status=make('div','garden-status app-status');
 warning.hidden=true;warning.setAttribute('role','status');status.setAttribute('role','status');
 advisor.innerHTML='<strong>Garden advisor</strong><span>Final Rive artwork is pending; the defense rules are live.</span>';

 const map=document.createElement('select');map.setAttribute('aria-label','Garden map');
 map.append(new Option('Coral path','0'),new Option('Meadow path','1'),new Option('Moon gate','2'));
 const pause=textButton('Resume',()=>togglePause());
 const waveButton=textButton('Start wave',()=>startWave());
 const speedButton=textButton('Speed 1×',()=>setSpeed());
 const openButton=textButton('Open from My files',()=>void open());
 const saveButton=textButton('Save to My files',()=>void save());
 toolbar.append(map,pause,waveButton,speedButton,openButton,saveButton);

 const build=(role:TowerRole)=>textButton(`Build ${role}`,()=>{
  if(busy||!valid())return;
  if(session.buildTower(selectedSite,role)){
   mark();
   if(!sound.checked)audio.setMuted(true);else{audio.unlock();audio.tone(520,70,'triangle')}
   session.openBuildMenu(selectedSite);
   say(`${role} tower built at site ${selectedSite+1}.`);
  }else say('That site is occupied or the tower costs more than the available coins.');
  refresh();
 });
 const upgrade=textButton('Upgrade tower',()=>{
  if(busy||!valid())return;
  if(session.upgradeTower(selectedSite)){mark();audio.tone(640,60,'triangle');say(`Tower at site ${selectedSite+1} upgraded.`)}
  else say('Select a tower that is not at level 3 and has enough coins to upgrade.');
  refresh();
 });
 const sell=textButton('Sell tower',()=>{
  if(busy||!valid())return;
  if(!session.towers.some(tower=>tower.site===selectedSite)){say('There is no tower at the selected site.');return}
  session.sellTower(selectedSite);mark();audio.tone(180,90,'sawtooth');say(`Tower at site ${selectedSite+1} sold.`);refresh();
 });
 const previous=textButton('◀ Previous site',()=>selectSite((selectedSite+7)%8));
 const next=textButton('Next site ▶',()=>selectSite((selectedSite+1)%8));
 controls.append(build('rapid'),build('splash'),build('slow'),upgrade,sell,previous,next);

 const settings=document.createElement('details'),settingsSummary=make('summary','','Settings');
 const contrastLabel=make('label','','Contrast '),contrast=document.createElement('select');
 contrast.setAttribute('aria-label','Garden contrast');contrast.append(new Option('Standard','standard'),new Option('High contrast','high'));
 const sound=document.createElement('input');sound.type='checkbox';sound.setAttribute('aria-label','Sound effects');
 const soundLabel=make('label','','Sound effects ');soundLabel.prepend(sound);
 const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';volume.value='25';volume.disabled=true;volume.setAttribute('aria-label','Sound volume');
 const volumeLabel=make('label','','Volume ');volumeLabel.append(volume);
 const reduced=document.createElement('input');reduced.type='checkbox';reduced.setAttribute('aria-label','Reduce motion');
 const reducedLabel=make('label','','Reduce motion ');reducedLabel.prepend(reduced);
 settings.append(settingsSummary,contrastLabel,contrast,soundLabel,volumeLabel,reducedLabel);
 contrastLabel.prepend(contrast);
 const help=document.createElement('details');help.className='garden-help';
 help.append(make('summary','','How to play'),make('p','','Choose a garden map, select a site, and build rapid, splash or slow towers. Start each wave only after you are ready; pause while planning. Defend all ten waves. Larger circles show tower range while choosing a build.'));
 const saveDetails=document.createElement('details'),saveFields=make('div','garden-save-fields');
 saveDetails.className='garden-save';
 const path=appInput('Garden save path',host.w?.launchContext?.path||'/Garden Defense.game.json');
 const folder=textButton('Choose folder',()=>void chooseFolder());
 saveFields.append(path,folder);saveDetails.append(make('summary','','Save location'),saveFields);
 side.append(advisor,summary,help,settings,saveDetails,warning,status);
 layout.append(stageWrap,side);
 element.append(toolbar,layout,controls);

 const valid=()=>!disposed&&!signal.aborted&&element.isConnected&&owner===host.storage.signedInSubject();
 const say=(message:string)=>{if(valid())status.textContent=message};
 const setDirty=(value:boolean)=>{dirty=value;windowState.dirty=value};
 const mark=()=>{setDirty(true);revision++};
 const selectSite=(index:number)=>{if(busy||!valid())return;selectedSite=index;session.openBuildMenu(index);siteLabel.textContent=`Selected site ${index+1} · range preview on`;refresh()};

 function togglePause(){
  if(busy||!valid())return;
  paused=!paused;
  if(!paused&&sound.checked)audio.unlock();
  say(paused?'Garden paused. Build or upgrade towers while paused.':'Garden running.');
  refresh();
 }
 function startWave(){
  if(busy||!valid())return;
  if(paused){paused=false;if(sound.checked)audio.unlock()}
  const before=session.wave;
  session.startWave();
  if(session.wave===before)say(`Wave ${session.wave}/${WAVE_COUNT} is already active or the campaign is complete.`);
  else{mark();audio.tone(420,100,'triangle');say(`Wave ${session.wave} started.`)}
  refresh();
 }
 function setSpeed(){
  if(busy||!valid())return;
  session.setSpeed(session.speed===1?2:1);mark();
  say(`Simulation speed set to ${session.speed}×.`);refresh();
 }
 async function pickMap():Promise<void>{
  const mapId=Number(map.value),prior=session,atRevision=revision,before=encodeSave(session);
  if(busy||!valid()){map.value=String(session.mapId);return}
  if(mapId===session.mapId)return;
  busy=true;map.disabled=true;paused=true;refresh();
  try{
   if(dirty&&!await host.ui.confirm('Switch gardens and discard unsaved progress?',{title:'Unsaved garden',confirmLabel:'Switch garden',cancelLabel:'Keep garden',danger:true,signal})){
    map.value=String(session.mapId);say('Current garden kept and paused.');return;
   }
   if(!valid())return;
   if(session!==prior||revision!==atRevision||encodeSave(session)!==before){map.value=String(session.mapId);say('The garden changed while confirming. Try again.');return}
   clearWatch();savedPath=null;savedVersion=null;session=new GardenDefenseSession(`garden-${crypto.randomUUID()}`,mapId);
   paused=true;selectedSite=0;lastWave=0;setDirty(false);revision++;path.value='/Garden Defense.game.json';if(host.w)delete host.w.launchContext;
   say(`Garden map ${mapId+1} ready. Press Resume and start a wave.`);refresh();
  }catch(error){map.value=String(session.mapId);say('Could not switch garden: '+(error instanceof Error?error.message:'unknown error'))}
  finally{busy=false;map.disabled=false}
 }

 function refresh(){
  if(!valid())return;
  pause.textContent=paused?'Resume':'Pause';pause.setAttribute('aria-label',pause.textContent);
  speedButton.textContent=`Speed ${session.speed}×`;speedButton.setAttribute('aria-label',speedButton.textContent);
  waveButton.textContent=session.waveActive?'Wave active':session.wave>=WAVE_COUNT?'Campaign complete':'Start wave';
  waveButton.setAttribute('aria-label',waveButton.textContent);
  siteLabel.textContent=`Selected site ${selectedSite+1}`;
  summary.textContent=`Map ${session.mapId+1} · Wave ${session.wave}/${WAVE_COUNT} · ${session.waveActive?'active':'paused for planning'} · ${session.coins} coins · ${session.health}/20 health · ${session.towers.length}/8 towers`;
  if(session.lost)say('The garden was overrun. Choose another map to retry.');
  else if(session.won)say('All ten waves cleared. The garden is safe.');
 }
 function draw(){
  if(!graphics)return;
  const canvas=graphics;
  canvas.clear();
  canvas.fillStyle(contrast.value==='high'?0x152a1b:0x24402a,1);canvas.fillRect(0,0,VIEW_WIDTH,VIEW_HEIGHT);
  const pathPoints=pathForMap(session.mapId);
  canvas.lineStyle(18,0x5c4932,1);canvas.beginPath();pathPoints.forEach((point,index)=>index?canvas.lineTo(point.x*CELL,point.y*CELL):canvas.moveTo(point.x*CELL,point.y*CELL));canvas.strokePath();
  canvas.lineStyle(11,0xa88454,1);canvas.beginPath();pathPoints.forEach((point,index)=>index?canvas.lineTo(point.x*CELL,point.y*CELL):canvas.moveTo(point.x*CELL,point.y*CELL));canvas.strokePath();
  const sites=sitesForMap(session.mapId);
  sites.forEach((site,index)=>{
   canvas.fillStyle(index===selectedSite?0xe8d54c:0x6d5638,1);canvas.fillRect(site.x*CELL-12,site.y*CELL-12,24,24);
   if(index===selectedSite){canvas.lineStyle(2,0xe9f6df,.75);canvas.strokeCircle(site.x*CELL,site.y*CELL,TOWERS.rapid.range*CELL)}
  });
  for(const tower of session.towers){
   const site=sites[tower.site],color=tower.role==='rapid'?0x49c8e8:tower.role==='splash'?0xe85c5c:0x5cbf62;
   canvas.fillStyle(color,1);canvas.fillRect(site.x*CELL-15,site.y*CELL-15,30,30);
   canvas.lineStyle(2,contrast.value==='high'?0xffffff:0x17301d,1);canvas.strokeRect(site.x*CELL-15,site.y*CELL-15,30,30);
  }
  for(const enemy of session.enemies){
   const color=enemy.kind==='beetle'?0x7d5b48:enemy.kind==='moth'?0xc7b772:0xcf805d;
   canvas.fillStyle(color,1);canvas.fillCircle(enemy.x*CELL,enemy.y*CELL,enemy.kind==='beetle'?12:8);
   if(enemy.slowMs>0){canvas.lineStyle(2,0x8ad8ff,1);canvas.strokeCircle(enemy.x*CELL,enemy.y*CELL,14)}
  }
  for(const projectile of session.projectiles){canvas.fillStyle(projectile.splash?0xffb35c:0xdff6ff,1);canvas.fillCircle(projectile.x*CELL,projectile.y*CELL,4)}
  const end=pathPoints[pathPoints.length-1];canvas.fillStyle(0xf0d46b,1);canvas.fillRect(end.x*CELL-18,end.y*CELL-18,36,36);
 }
 function update(_time:number,delta:number){
  if(disposed)return;
  watchWindow();
  if(!paused){
   const beforeWave=session.wave,sessionLines=session.waveActive;
   session.advance(Math.min(100,Math.max(0,delta)));
   if(session.wave!==beforeWave||session.waveActive!==sessionLines||session.lost||session.won){
    mark();
    if(!session.waveActive&&!session.lost&&!session.won){paused=true;say(`Wave ${session.wave} cleared. Build or upgrade, then start the next wave.`)}
    if(session.lost||session.won)paused=true;
   }
  }
  draw();refresh();
 }

 const createGameWhenConnected=(attempt=0)=>{
  if(disposed)return;
  if(!element.isConnected&&attempt<60){setTimeout(()=>createGameWhenConnected(attempt+1),16);return}
  if(!valid())return;
  try{
   game=new Phaser.Game({type:Phaser.CANVAS,audio:{noAudio:true},parent:stageWrap,width:VIEW_WIDTH,height:VIEW_HEIGHT,backgroundColor:'#24402a',scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},scene:{create(){graphics=this.add.graphics();this.scale.getParentBounds();this.scale.refresh()},update}});
   if(typeof ResizeObserver!=='undefined'){stageResizeObserver=new ResizeObserver(()=>{game?.scale.getParentBounds();game?.scale.refresh()});stageResizeObserver.observe(stageWrap);}
   watchWindow();
   refresh();
  }catch(error){say('Could not start the garden view: '+(error instanceof Error?error.message:'unknown error'))}
 };
 queueMicrotask(()=>createGameWhenConnected());

 const boardClick=(event:PointerEvent)=>{
  if(!game)return;
  const rect=game.canvas.getBoundingClientRect();
  const x=(event.clientX-rect.left)/rect.width*9,y=(event.clientY-rect.top)/rect.height*6;
  let best=0,distance=Infinity;
  sitesForMap(session.mapId).forEach((site,index)=>{const d=Math.hypot(site.x-x,site.y-y);if(d<distance){best=index;distance=d}});
  if(distance<.8)selectSite(best);
 };
 stageWrap.addEventListener('pointerdown',boardClick);
 map.addEventListener('change',()=>void pickMap());
 sound.addEventListener('change',()=>{volume.disabled=!sound.checked;audio.setMuted(!sound.checked);if(sound.checked)audio.unlock()});
 volume.addEventListener('input',()=>audio.setVolume(Number(volume.value)/100));
 const suspend=()=>{if(!paused){paused=true;say('Garden paused when its window lost attention. Press Resume when ready.');refresh()}};
 const visibility=()=>{if(document.hidden)suspend()};
 const watchWindow=()=>{
  const target=element.closest<HTMLElement>('.window');
  if(target!==observedWindow){
   windowObserver?.disconnect();observedWindow=target;windowObserver=new MutationObserver(()=>{
    if(observedWindow&&(observedWindow.hidden||!observedWindow.classList.contains('focused')||observedWindow.classList.contains('rolled')))suspend();
   });
   if(target)windowObserver.observe(target,{attributes:true,attributeFilter:['class','hidden']});
  }
  if(target&&(target.hidden||!target.classList.contains('focused')||target.classList.contains('rolled')))suspend();
 };
 window.addEventListener('blur',suspend);document.addEventListener('visibilitychange',visibility);

 function clearWatch(){watchSerial++;watchCheck++;unwatch();unwatch=()=>{}}
 function watch(context:FileContext,target:string,version:string){
  clearWatch();const serial=watchSerial;
  const check=async()=>{const id=++watchCheck;if(!valid()||!context.valid()||savedPath!==target||savedVersion!==version)return;let text='';try{const current=context.files.stat?await context.files.stat(target):await context.files.read(target);text=current.status==='conflict'?'This save has conflicting copies. Resolve them in Files.':current.version!==version?'The saved garden changed. Your current game is unchanged; save a copy or reopen it.':''}catch{text='The saved garden is unavailable. Your current game is unchanged.'}if(valid()&&context.valid()&&serial===watchSerial&&id===watchCheck){warning.textContent=text;warning.hidden=!text}};
  unwatch=context.files.subscribe?.(check)||(()=>{});queueMicrotask(check);
 }
 async function chooseFolder(){try{const folderPath=await host.storage.pickFolder({signal});if(folderPath===null||!valid())return;const context=await host.storage.mirrorFileContext();if(!valid()||!context.valid())return;path.value=context.path((folderPath==='/'?'':folderPath)+'/'+context.name(path.value.split('/').pop()||'Garden Defense.game.json'))}catch(error){say('Could not choose folder: '+(error instanceof Error?error.message:'unknown error'))}}
 async function save(){
  if(busy||!valid())return;busy=true;const wasDirty=dirty;setDirty(true);paused=true;refresh();const captured=revision,text=encodeSave(session),requested=path.value;let committed=false;
  try{const context=await host.storage.mirrorFileContext(),target=context.path(requested);if(!target.toLowerCase().endsWith('.game.json'))throw Error('Use a .game.json file name.');let expected:string|null=null;try{const old=context.files.stat?await context.files.stat(target):await context.files.read(target);if(old.status==='conflict')throw Error('Resolve the conflict in Files first.');if(target===savedPath&&savedVersion){if(old.version!==savedVersion)throw Error('The saved garden changed. Save a copy or reopen it.')}else if(!await host.ui.confirm('Replace '+target+'?',{title:'Replace saved garden',confirmLabel:'Replace',cancelLabel:'Cancel',danger:true,signal})){say('Save cancelled.');return}expected=old.version}catch(error){if(!(error instanceof Error)||error.message!=='File not found.')throw error;if(target===savedPath&&savedVersion)throw Error('The saved garden was removed. Save a copy or reopen it.')}if(!valid()||!context.valid())return;const result=await context.files.write(target,new TextEncoder().encode(text),expected);if(!valid()||!context.valid())return;savedPath=target;savedVersion=result.version;if(path.value===requested)path.value=target;const newer=revision!==captured||encodeSave(session)!==text;setDirty(newer);committed=true;if(host.w){host.w.launchContext=Object.freeze({version:1,storage:'mirror',path:target,owner});host.w.title=target.split('/').pop()+' — Garden Defense'}watch(context,target,result.version);say(result.status==='conflict'?'Checkpoint saved with conflicting copies. Resolve them in Files.':newer?'Saved an earlier checkpoint; newer garden changes are unsaved.':'Garden checkpoint saved to My files; syncing with the server.')}catch(error){say('Could not save garden: '+(error instanceof Error?error.message:'unknown error'))}finally{if(!committed&&valid()&&revision===captured)setDirty(wasDirty);busy=false}
 }
 async function open(selected?:string){
  if(busy||!valid())return;busy=true;paused=true;refresh();const before=revision,beforeSave=encodeSave(session);const unchanged=()=>revision===before&&encodeSave(session)===beforeSave;
  try{if(dirty&&!await host.ui.confirm('Open a saved garden and discard current progress?',{title:'Unsaved garden',confirmLabel:'Discard progress',cancelLabel:'Keep garden',danger:true,signal})){say('Garden remains paused.');return}if(!valid())return;if(!unchanged())throw Error('The garden changed while confirming; try again.');const choice=selected||await host.storage.pickFile({extensions:['.json'],signal});if(!choice||!valid())return;const context=await host.storage.mirrorFileContext(),target=context.path(choice),file=await context.files.read(target);if(!valid()||!context.valid())return;if(file.status==='conflict')throw Error('Resolve the conflict in Files first.');if(file.data.byteLength>8*1024*1024)throw Error('Save file is too large.');const payload=decodeSave(new TextDecoder('utf-8',{fatal:true}).decode(file.data)).payload;const replacement=sessionFromSave({payload});if(!valid()||!context.valid())return;if(!unchanged())throw Error('The garden changed while opening; try again.');session=replacement;paused=true;selectedSite=0;map.value=String(session.mapId);savedPath=target;savedVersion=file.version;path.value=target;setDirty(false);warning.hidden=true;if(host.w){host.w.launchContext=Object.freeze({version:1,storage:'mirror',path:target,owner});host.w.title=target.split('/').pop()+' — Garden Defense'}watch(context,target,file.version);say('Garden loaded and paused. Press Resume to play.');refresh()}catch(error){say('Could not open garden: '+(error instanceof Error?error.message:'unknown error'))}finally{busy=false}
 }

 refresh();draw();watchWindow();
 if(host.w?.launchContext?.storage==='mirror'&&host.w.launchContext.owner===owner){
  const initialPath=host.w.launchContext.path;path.value=initialPath;
  const openWhenConnected=(attempt=0)=>{if(disposed||signal.aborted)return;if(!element.isConnected&&attempt<60)setTimeout(()=>openWhenConnected(attempt+1),16);else if(valid())void open(initialPath)};
  queueMicrotask(()=>openWhenConnected());
 }else say('Select a site, build towers, then start a wave.');
 return{
  element,
  dispose(){
   if(disposed)return;disposed=true;busy=true;watchSerial++;watchCheck++;unwatch();windowObserver?.disconnect();windowObserver=null;
   stageWrap.removeEventListener('pointerdown',boardClick);window.removeEventListener('blur',suspend);document.removeEventListener('visibilitychange',visibility);
   stageResizeObserver?.disconnect();stageResizeObserver=null;
   audio.dispose();game?.destroy(true);game=null;graphics=null;element.replaceChildren();
  },
 };
}
