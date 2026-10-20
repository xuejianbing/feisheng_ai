import {safeGet,safeSet} from '../../foundation/storage/storage.js?v=41a';
import {modeModelsReady} from '../../model/weights/modeModelStore.js?v=41a';
import {game,lib,get} from '../../foundation/adapt/host.js?v=41a';
import {cfg} from '../../foundation/config/util.js?v=41a';
import {classicTrainingStatus,trainClassicCandidate,validateClassicCandidate,exportClassicData,activateClassicCandidate,rollbackClassicModel,restoreClassicModels} from '../../model/train/modeTraining.js?v=41a';
import {classicMatchSummary} from '../../model/train/modeStats.js?v=41a';
import {DOUDIZHU_NAMES,modeSessionActive} from '../../foundation/runtime/modeContext.js?v=41a';
import {styleUtilityPanel} from '../panel/panelTheme.js?v=41a';
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
async function copyDiagnostic(text){
 try{await navigator.clipboard.writeText(text);return true;}catch{}
 const focus=document.activeElement,input=node('textarea',text);
 input.readOnly=true;input.style.cssText='position:fixed;left:-10000px;top:0;';document.body.append(input);
 try{input.select();return document.execCommand('copy')===true;}catch{return false;}
 finally{input.remove();if(focus?.isConnected)focus.focus?.({preventScroll:true});}
}
function installStyles(){
 if(document.getElementById('djsc-mode-training-style'))return;
 const style=node('style');style.id='djsc-mode-training-style';
 style.textContent=`
 #djsc-mode-training {box-shadow:0 22px 70px #0007,inset 0 1px 0 #ffffff12;-webkit-backdrop-filter:blur(14px)}
 #djsc-mode-training>.djsc-popup-title {border-bottom:1px solid #aaccdd33;letter-spacing:2px}
 #djsc-mode-training .djsc-mode-content,#djsc-mode-training .djsc-mode-content * {box-sizing:border-box}
 #djsc-mode-training .djsc-mode-content div,#djsc-mode-training .djsc-mode-content section,#djsc-mode-training .djsc-mode-content p,#djsc-mode-training .djsc-mode-content h3 {position:static!important;width:auto;height:auto;float:none}
 #djsc-mode-training .djsc-mode-content {position:static!important;width:100%;font:inherit}
 #djsc-mode-training .djsc-mode-toolbar {display:flex!important;align-items:center;gap:12px;flex-wrap:wrap;margin:8px 0 18px}
 #djsc-mode-training .djsc-mode-toolbar label {color:#f3e8ae}
 #djsc-mode-training select {position:static;max-width:100%;padding:9px 14px;border:1px solid #c4d7df66;border-radius:12px;background:#ffffff18;color:#f3e8ae;font:inherit;cursor:pointer}
 #djsc-mode-training select option {background:#343235;color:#eee}
 #djsc-mode-training .djsc-mode-note {margin:10px 0 16px;color:#bdcbd7;font-size:15px;line-height:1.65}
 #djsc-mode-training .djsc-mode-grid {display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
 #djsc-mode-training .djsc-mode-stat,#djsc-mode-training .djsc-mode-card {background:rgba(175,172,172,.20);border:1px solid #ffffff40;border-radius:16px;padding:16px}
 #djsc-mode-training .djsc-mode-stat {text-align:center}
 #djsc-mode-training .djsc-mode-stat span {display:block;color:#9ad8ff;font-size:16px}
 #djsc-mode-training .djsc-mode-stat strong {display:block;color:#f3e8ae;font-size:30px;line-height:1.5;font-variant-numeric:tabular-nums}
 #djsc-mode-training .djsc-mode-card {margin:16px 0}
 #djsc-mode-training h3 {margin:0 0 12px;color:#f3e8ae;font-size:21px}
 #djsc-mode-training .djsc-mode-switches {display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
 #djsc-mode-training .djsc-mode-switch {display:flex!important;align-items:flex-start;gap:10px;cursor:pointer}
 #djsc-mode-training .djsc-mode-switch input {position:static!important;flex:0 0 auto;width:18px;height:18px;margin:7px 0 0;accent-color:#dac78c}
 #djsc-mode-training .djsc-mode-switch span {color:#f3e8ae}
 #djsc-mode-training .djsc-mode-switch small {display:block;margin-top:4px;color:#bdcbd7;font-size:14px;line-height:1.5}
 #djsc-mode-training .djsc-mode-table-wrap {overflow-x:auto}
 #djsc-mode-training table {position:static;width:100%;border-collapse:collapse;font:inherit;font-size:16px}
 #djsc-mode-training th,#djsc-mode-training td {position:static;padding:10px 12px;text-align:left;white-space:nowrap;border-bottom:1px solid #ffffff1c}
 #djsc-mode-training th {color:#9ad8ff;background:#ffffff09;font-weight:normal}
 #djsc-mode-training tbody tr:last-child td {border-bottom:0}
 #djsc-mode-training .djsc-mode-state {display:flex!important;gap:10px;flex-wrap:wrap;align-items:center;color:#e7edf2}
 #djsc-mode-training .djsc-mode-badge {display:inline-block;background:#ffffff15;border:1px solid #ffffff30;border-radius:20px;padding:3px 12px;color:#f3e8ae;font-size:15px}
 #djsc-mode-training .djsc-mode-actions {display:flex!important;gap:10px;flex-wrap:wrap;margin-top:16px}
 #djsc-mode-training .djsc-mode-actions button {position:static!important;width:auto;height:auto;padding:10px 16px;margin:0;border:1px solid #ffffff50;border-radius:12px;background:rgba(175,172,172,.22);color:#f3e8ae;font:inherit;cursor:pointer;box-shadow:inset 0 1px 0 #ffffff10}
 #djsc-mode-training .djsc-mode-actions button:hover {background:rgba(175,172,172,.34)}
 #djsc-mode-training .djsc-mode-actions button:disabled {opacity:.5;cursor:wait}
 #djsc-mode-training .djsc-mode-result {border-left:3px solid #7fe3a0}
 #djsc-mode-training .djsc-mode-result[data-failed=true] {border-left-color:#ffad91}
 #djsc-mode-training details.djsc-mode-card>summary {display:list-item;list-style-position:inside;font-size:23px;color:#f3e8ae;line-height:1.6;cursor:pointer}
 #djsc-mode-training details {position:static;margin-top:10px;color:#bdcbd7}
 #djsc-mode-training summary {cursor:pointer;color:#9ad8ff}
 #djsc-mode-training pre {position:static;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace;color:#d7e2eb}
 @media(max-width:640px) {#djsc-mode-training .djsc-mode-grid {grid-template-columns:repeat(2,minmax(0,1fr))}#djsc-mode-training .djsc-mode-switches {grid-template-columns:1fr}#djsc-mode-training .djsc-mode-actions button {flex:1 1 40%}}
 `;
 document.head.append(style);
}
export function openModeTrainingPanel(){
 document.getElementById('djsc-mode-training')?.remove();installStyles();
 const panel=node('section');panel.id='djsc-mode-training';
 const heading=node('header','无名AI · 斗地主专项训练（飞雀V2）','djsc-popup-title');
 const close=node('button');close.type='button';close.onclick=()=>panel.remove();
 const content=node('div',undefined,'djsc-mode-content');
 panel.append(heading,close,content);document.body.append(panel);styleUtilityPanel(panel,close);
 let category='doudizhu-classic',lastResult=null;
 function card(title){
  const section=node('details',undefined,'djsc-mode-card'),heading=node('summary',title),key='djsc_mode_fold_'+title;
  const stored=safeGet(key);section.open=stored===null||stored===undefined?['专项设置','候选模型与训练'].includes(title):stored==='true';
  section.append(heading);section.addEventListener('toggle',()=>{if(section.isConnected)safeSet(key,String(section.open));});return section;
 }

 function checkbox(key,label,description){
  const row=node('label',undefined,'djsc-mode-switch'),input=node('input'),text=node('span',label);
  input.type='checkbox';input.checked=cfg(key,!['classicModelEnabled','classicAutoUpdate'].includes(key))===true;
  input.onchange=()=>{lib.config['extension_无名AI_'+key]=input.checked;game.saveExtensionConfig?.('无名AI',key,input.checked);render();};
  text.append(node('small',description));row.append(input,text);return row;
 }
 function renderResult(){
  if(!lastResult)return;
  const {label,result}=lastResult,section=card(label+'结果');section.classList.add('djsc-mode-result');section.dataset.failed=String(!result.ok||(result.quality||result.report?.quality)?.ok===false);
  section.append(node('p',result.ok?(result.note||'操作完成'):(result.err||'操作失败'),'djsc-mode-note'));
  if(result.statistics){const s=result.statistics;section.append(node('p','有效样本 '+s.data.accepted+' 条 · 来源 '+s.data.sessions+' 局','djsc-mode-note'));section.append(node('p','已启用版本：'+(s.active?.id||'暂无')+' · 本局锁定版本：'+(s.context.specialistVersion||'暂无'),'djsc-mode-note'));section.append(node('p',s.context.sessionId?'本局专项开关：'+(s.context.specialistEnabled?'开启':'关闭')+' · 参与比较 '+s.runtime.participated+' 次 · 改变模型阶段首选 '+s.runtime.changed+' 次 · 状态 '+s.runtime.lastStatus:'当前页面尚无对局运行统计；完成新对局后再刷新。','djsc-mode-note'));}
  const evaluation=result.report?.candidate||result.result;
  if(result.report)section.append(node('p','训练 '+result.report.training+' 条 · 整局留出 '+result.report.validation+' 条','djsc-mode-note'));
  if(evaluation)section.append(node('p','标签准确率 '+(evaluation.accuracy*100).toFixed(1)+'% · 价值均方误差 '+Number(evaluation.valueMSE).toFixed(4),'djsc-mode-note'));
  const quality=result.quality||result.report?.quality,baseline=result.baseline||result.report?.baseline;
  if(baseline)section.append(node('p','公共基线：标签准确率 '+(baseline.accuracy*100).toFixed(1)+'% · 价值均方误差 '+Number(baseline.valueMSE).toFixed(4),'djsc-mode-note'));
  if(quality){section.append(node('p',quality.ok?'离线质量检查通过；尚需启用后核对实际出牌。':'离线质量检查未通过：'+quality.regressions.join('；'),'djsc-mode-note'));}
  if(result.file)section.append(node('p','文件：'+result.file,'djsc-mode-note'));
  const diagnostic=JSON.stringify(result,null,2),actions=node('div',undefined,'djsc-mode-actions'),copy=node('button','复制诊断内容'),feedback=node('p','','djsc-mode-note');
  copy.type='button';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  copy.onclick=async()=>{copy.disabled=true;const copied=await copyDiagnostic(diagnostic);feedback.textContent=copied?'已复制完整诊断内容，可直接粘贴反馈。':'复制失败，请展开诊断详情手动选择复制。';copy.disabled=false;};
  actions.append(copy);section.append(actions,feedback);
  const detail=node('details');detail.append(node('summary','查看诊断详情'),node('pre',diagnostic));section.append(detail);content.append(section);
 }
 function render(){
  content.replaceChildren();
  const toolbar=node('div',undefined,'djsc-mode-toolbar'),label=node('label','专项分类'),select=node('select');select.id='djsc-mode-category';label.htmlFor=select.id;
  for(const [value,text] of [['doudizhu-classic','常规斗地主：休闲／开黑／欢乐'],['doudizhu-special','特殊斗地主：兵临／智斗']]){const option=node('option',text);option.value=value;select.append(option);}
  select.value=category;select.onchange=()=>{category=select.value;render();};toolbar.append(label,select);content.append(toolbar);
  if(category==='doudizhu-special'){const section=card('特殊斗地主');section.append(node('p','兵临城下与智斗三国尚未接入专项训练。现有公共 AI 继续使用。','djsc-mode-note'));content.append(section,node('p','分类选择用于查看专项设置，实际游戏模式请在游戏原生菜单中选择。','djsc-mode-note'));return;}
  const s=classicTrainingStatus(),c=s.context;
  const config=card('专项设置');
  config.append(node('p','当前对局：'+(c.mode==='doudizhu'?(DOUDIZHU_NAMES[c.submode]||'未知子模式'):c.mode)+' · '+(modeSessionActive()?'本局设置已锁定，修改于下一局生效':'可修改下一局设置'),'djsc-mode-note'));
  const switches=node('div',undefined,'djsc-mode-switches');switches.append(checkbox('classicDoudizhu','启用常规斗地主专项规则','沿用公共 AI，加入地主／农民专项偏好。'),checkbox('classicDoudizhuCollect','采集常规斗地主专项数据','仅收录实际执行、收益已确认且标签有效的样本。'));switches.append(checkbox('playerDemonstrations','采集玩家手动出牌示范','记录手动用牌、重铸及顺序；合格动作参与专项训练。'));switches.append(checkbox('classicModelEnabled','专项模型参与实际选择','使用已启用的试用版本，影响幅度封顶，修改下一局生效。'),checkbox('classicAutoUpdate','局间自动学习与更新','结算后对比公共基线与当前试用版，地主、农民分组通过才更新。'));config.append(switches);content.append(config);
  const grid=node('div',undefined,'djsc-mode-grid');for(const [label,value] of [['有效事务',s.data.accepted],['来源局数',s.data.sessions],['重复事务',s.data.duplicates],['冲突事务',s.data.conflicts]]){const stat=node('div',undefined,'djsc-mode-stat');stat.append(node('span',label),node('strong',String(value)));grid.append(stat);}content.append(grid);
  const stats=card('玩法与角色统计'),wrap=node('div',undefined,'djsc-mode-table-wrap'),table=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');
  for(const label of ['玩法／角色','有效事务','来源局数','战绩'])header.append(node('th',label));head.append(header);table.append(head,body);
  const results=classicMatchSummary();for(const subtype of ['normal','kaihei','huanle'])for(const role of ['landlord','farmer']){const k=subtype+'/'+role,d=s.data.breakdown[k]||{},r=results.groups[k]||{},row=node('tr');for(const value of [DOUDIZHU_NAMES[subtype]+' · '+(role==='landlord'?'地主':'农民'),d.samples||0,d.sessions||0,(r.wins||0)+'胜 / '+(r.losses||0)+'负 / '+(r.unknown||0)+'未知'])row.append(node('td',String(value)));body.append(row);}
  wrap.append(table);stats.append(wrap,node('p','战绩最多保留最近 500 局，仅记录本机玩家的真实结算视角。','djsc-mode-note'));content.append(stats);
  const rejected=Object.entries(s.data.rejected).map(([reason,count])=>reason+'：'+count).join('；');
  content.append(node('p','样本排除原因：'+(rejected||'暂无'),'djsc-mode-note'));
  const demos=s.demonstrations,demoCard=card('玩家示范与操作顺序');
  demoCard.append(node('p','手动动作 '+demos.total+' 条 · 有效 '+demos.observed+' 条 · 待结果 '+demos.pending+' 条 · 未通过 '+demos.unresolved+' 条','djsc-mode-note'));
  demoCard.append(node('p','多步片段 '+demos.sequences+' 段 · 连续且各步收益已核对 '+demos.verifiedSequences+' 段。托管、响应及触发动作不冒充手动示范。','djsc-mode-note'));
  for(const row of demos.recent){const names=row.steps.map(a=>(a.recast?'重铸':'使用')+'【'+(get.translation?.(a.id)||a.id)+(a.nature?' · '+(get.translation?.(a.nature)||a.nature):'')+'】');demoCard.append(node('p',names.join(' → ')+'｜'+(row.verified?'各步收益已核对':row.continuous?'有步骤收益待核对':'片段不完整，不判定连招'),'djsc-mode-note'));}
  demoCard.append(node('p','确认收益的单步样本进入现有专项训练。操作顺序单独保留，不把整段胜利当作每一步正确；复杂连招的因果收益仍需核对。','djsc-mode-note'));content.append(demoCard);
  const training=card('候选模型与训练'),state=node('div',undefined,'djsc-mode-state');state.append(node('span',s.progress.phase+(s.progress.epoch?'（'+s.progress.epoch+'/'+s.progress.epochs+' 轮）':''),'djsc-mode-badge'),node('span',s.candidate?s.candidate.id+' · '+s.candidate.state:'暂无专项候选'));training.append(state);
  if(s.candidate?.report?.quality?.ok===false)training.append(node('p','候选未通过原因：'+s.candidate.report.quality.regressions.join('；'),'djsc-mode-note'));
  if(s.progress.reason)training.append(node('p','上次训练失败原因：'+s.progress.reason,'djsc-mode-note'));
  training.append(node('p','模型保存位置：'+(s.storage.ready?(s.storage.backend==='unavailable'?'恢复失败（原数据保留）':s.storage.backend):'正在恢复')+(s.storage.error?'；存储提示：'+s.storage.error:''),'djsc-mode-note'));
  if(s.storage.invalidKeys?.length)training.append(node('p','模型记录格式无效：'+s.storage.invalidKeys.join('、')+'；原数据保留，请复制诊断核对。','djsc-mode-note'));
  training.append(node('p','当前存储来源：'+(s.storage.origin||'本地宿主')+'；不同地址或端口的浏览器数据相互隔离。','djsc-mode-note'));
  training.append(node('p',s.active?'专项试用版本：'+s.active.id+' · 上一版：'+(s.active.previousId||'暂无'):'暂无已启用版本；先训练并验证，再点击启用试用版本。','djsc-mode-note'));
  training.append(node('p',modeSessionActive()?(c.specialistEnabled&&c.specialistVersion?'本局已开启专项收益预测；规则匹配时参与实际比较，影响封顶±0.5。':'本局使用公共引擎；专项开关修改下一局生效。'):'开启专项模型后，匹配规则的试用版本将在下一局参与实际选择；无匹配版本自动沿用公共引擎。','djsc-mode-note'));
  if(c.sessionId){
   const statusNames={'storage-loading':'模型仍在恢复','storage-error':'模型恢复失败，沿用公共引擎','not-run':'尚未运行',active:'已参与候选比较',disabled:'本局专项模型未开启','no-active-model':'没有已启用版本','rule-not-covered':'本局规则不匹配','version-not-pinned':'版本未锁定','unknown-role':'角色尚未确认','insufficient-candidates':'可比较候选不足','no-candidates':'没有合法候选',fallback:'预测异常，沿用公共引擎'};
   training.append(node('p','本局专项参与比较 '+s.runtime.participated+' 次 · 改变模型阶段首选 '+s.runtime.changed+' 次；最近状态：'+(statusNames[s.runtime.lastStatus]||s.runtime.lastStatus)+(s.runtime.modelId?' · '+s.runtime.modelId:'')+'。刷新统计可更新；后续规划仍可能调整，最终执行以决策记录为准。','djsc-mode-note'));
  }
  const buttons=node('div',undefined,'djsc-mode-actions');
  for(const [label,action] of [['训练候选模型',trainClassicCandidate],['验证候选模型',validateClassicCandidate],['启用试用版本',activateClassicCandidate],['回滚上一版本',rollbackClassicModel],['导出专项数据',exportClassicData],['重新恢复模型',restoreClassicModels],['刷新统计',async()=>({ok:true,note:'统计已刷新；已附模型状态、局内统计与下一局设置，可复制完整内容反馈。',statistics:classicTrainingStatus(),nextGameSettings:Object.fromEntries(['classicDoudizhu','classicDoudizhuCollect','playerDemonstrations','classicModelEnabled','classicAutoUpdate'].map(key=>[key,cfg(key,!['classicModelEnabled','classicAutoUpdate'].includes(key))===true]))})]]){
   const button=node('button',label);button.type='button';button.disabled=s.busy&&label!=='刷新统计';
   button.onclick=async()=>{button.disabled=true;let result;try{const task=action();render();result=await task;}catch(e){result={ok:false,err:String(e.message||e)};}lastResult={label,result};safeSet('djsc_mode_fold_'+label+'结果','true');render();};buttons.append(button);
  }
  training.append(buttons,node('p','训练门槛：300 条有效事务、10 局，按整局留出验证。每个适用角色分组至少 10 条；新候选对比公共基线和当前试用版，分组指标不退步才可启用。标签准确率和价值误差不代表胜率；未执行建议、未知收益及模式未知的旧数据不参与专项训练。','djsc-mode-note'));content.append(training);renderResult();
 }
 render();
 modeModelsReady.then(()=>{if(panel.isConnected)render();});
}
if(typeof window!=='undefined'){window.__DJSC=window.__DJSC||{};window.__DJSC.openModeTrainingPanel=openModeTrainingPanel;}

// 玩家只读概览：训练、验证、回滚保留在开发者训练中心。
export async function openModeLearningProgress(){
 await modeModelsReady;
 document.getElementById('djsc-mode-training')?.remove();installStyles();
 const panel=node('section');panel.id='djsc-mode-training';
 const close=node('button');close.type='button';close.onclick=()=>panel.remove();
 const content=node('div',undefined,'djsc-mode-content');
 panel.append(node('header','无名AI · 斗地主学习进度（飞雀V2）','djsc-popup-title'),close,content);
 document.body.append(panel);styleUtilityPanel(panel,close);
 const s=classicTrainingStatus(),enabled=cfg('classicModelEnabled',false),active=enabled&&s.active;
 const state=s.storage.backend==='unavailable'?'存储恢复失败':s.busy?'正在学习':s.candidate?(s.candidate.report?.quality?.ok?'候选通过检查，待启用':'候选待检查'):active?'已启用专项版本':'正在收集数据';
 const grid=node('div',undefined,'djsc-mode-grid');
 for(const [label,value]of [['下一局模型',active?'专项版本':'公共引擎'],['有效记录局数',s.data.sessions],['学习状态',state],['最近启用时间',s.active?.activatedAt?new Date(s.active.activatedAt).toLocaleString():'暂无']]){
  const card=node('div',undefined,'djsc-mode-stat'),strong=node('strong',String(value));strong.style.cssText='font-size:20px;overflow-wrap:anywhere';card.append(node('span',label),strong);grid.append(card);
 }
 content.append(grid);
 if(s.active)content.append(node('p','已启用版本：'+s.active.id,'djsc-mode-note'));
 if(s.context.sessionId)content.append(node('p','本局已锁定：'+(s.context.specialistEnabled&&s.context.specialistVersion?s.context.specialistVersion:'公共引擎')+'；参与比较 '+s.runtime.participated+' 次。','djsc-mode-note'));
 content.append(node('p','专项版本需匹配本局规则才参与选择。设置修改于下一局生效；学习通过检查也不等于实战胜率提高。','djsc-mode-note'),node('p','手动训练、验证与回滚请到开发者选项 → 斗地主训练管理。','djsc-mode-note'));
}
