import {buildDoudizhuDiagnostics} from '../../perception/journal/doudizhuDiagnostics.js?v=41a';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const key=a=>JSON.stringify([a?.type==='equip'?'card':a?.type,a?.id,!!a?.recast,(Array.isArray(a?.target)?a.target:a?.target?[a.target]:[]).map(String).sort()]);
const same=(a,b)=>key(a)===key(b);
const statuses={active:'专项模型已参与',disabled:'专项模型未开启','not-run':'未经过专项模型','no-active-model':'暂无启用版本','rule-not-covered':'规则不匹配，沿用公共引擎','insufficient-candidates':'候选不足，沿用公共引擎',fallback:'模型异常，沿用公共引擎','storage-error':'模型读取失败','storage-loading':'模型尚在读取'};
export function classicEffectsData(match){
 if(match?.meta?.modeContext?.mode!=='doudizhu')return null;
 const diagnostic=buildDoudizhuDiagnostics(match),actions={sha:0,trick:0,tiesuo:0,recast:0,skill:0,respond:0,other:0};
 for(const e of match.events||[]){if(e.kind!=='action'||e.matchId&&e.matchId!==match.matchId)continue;const d=e.data||{};
 if(d.type==='skill')actions.skill++;else if(d.type==='recast')actions.recast++;else if(d.type==='respond')actions.respond++;
 else if(d.type==='useCard'){const cards=Array.isArray(d.card)?d.card:[d.card];for(const card of cards){if(card==='sha')actions.sha++;else if(card==='tiesuo')actions.tiesuo++;else if(['shunshou','guohe','wuzhong','juedou','nanman','wanjian','wugu','taoyuan','huogong','jiedao','lebu','bingliang'].includes(card))actions.trick++;else actions.other++;}}}
 let participated=0,changed=0,executed=0;const rewards={positive:0,zero:0,negative:0,unconfirmed:0};
 for(const row of diagnostic.rows){const stages=(row.commit?.decisionStages||row.suggestion?.decisionStages)?.stages||[];
 const stage=stages.find(s=>s.stage==='classicModel');if(stage?.evidence?.participatesInSelection)participated++;
 if(stage?.changed){changed++;if(row.status==='committed'&&row.actual&&same(stage.after,row.selected)&&same(row.selected,row.actual))executed++;}
 if(row.status!=='committed')continue;const reward=row.outcome?.reward;
 if(row.rewardStatus!=='observed'||!Number.isFinite(reward))rewards.unconfirmed++;else rewards[reward>0?'positive':reward<0?'negative':'zero']++;}
 return {schema:'classic-effects-v1',matchId:match.matchId,context:match.meta.modeContext,runtime:match.classicEffects?.runtime||null,samples:match.classicEffects?.samples??null,update:match.classicEffects?.update||{status:'unknown'},actions,model:{participated,changed,executed},rewards,diagnostic,note:'模型参与不等于改变出牌；即时收益不代表动作优劣；离线误差不代表胜率或实力提升。'};
}
function updateText(update){if(update.status==='running')return '结算后正在检查与学习…';if(update.status==='disabled')return '自动学习未开启，本局继续采集数据。';if(update.status==='failed')return '本次未更新：'+(update.result?.err||'处理失败，保留原版本');if(update.status==='skipped')return '本次跳过更新：'+(update.result?.reason||'样本未变化或当前不满足更新条件');if(update.status==='updated')return '版本已更新：'+(update.result?.id||'见开发者诊断')+'，下一局生效；实战提升待核对。';return '暂无结算后更新记录。';}
export function classicEffectsHtml(match){const d=classicEffectsData(match);if(!d)return '';
 return `<h3 class="djsc-report-heading">斗地主 · 飞雀V2 本局效果</h3><div data-classic-effects><div style="display:flex;gap:12px;flex-wrap:wrap"><button type="button" data-effect-view="player" aria-pressed="true">玩家简报</button><button type="button" data-effect-view="developer" aria-pressed="false">开发者诊断</button></div><div data-effect-player><p>本局模型：${esc(d.runtime?.participated>0?'飞雀V2 · 专项 '+(d.runtime.modelId||d.context.specialistVersion||'版本未记录'):'飞雀V2 · 公共引擎（专项参与见下方）')}；专项状态：${esc(statuses[d.runtime?.lastStatus]||'本局未参与或已回退，详见诊断')}。</p><p>专项参与 ${d.model.participated} 条决策；改变阶段建议 ${d.model.changed} 次；改变后匹配最终选择并执行 ${d.model.executed} 次。</p><p>全场实际操作：杀 ${d.actions.sha} 次，常见锦囊 ${d.actions.trick} 次，铁索使用 ${d.actions.tiesuo} 次，重铸 ${d.actions.recast} 次，技能 ${d.actions.skill} 次，响应 ${d.actions.respond} 次，其他牌 ${d.actions.other} 次。</p><p>已执行决策即时收益：正 ${d.rewards.positive}，零 ${d.rewards.zero}，负 ${d.rewards.negative}，待确认 ${d.rewards.unconfirmed}。${d.samples===null?'本局合格样本未记录。':'结算时本局合格样本 '+d.samples+' 条（包括符合条件的玩家示范）。'}</p><p>${esc(updateText(d.update))}</p><p>${esc(d.note)}</p>${d.diagnostic.recordingComplete?'':'<p>记录已达到上限，以上仅统计保留部分。</p>'}</div><div data-effect-developer hidden><button type="button" data-effect-copy>复制诊断内容</button><span data-effect-copy-status role="status"></span><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto">${esc(JSON.stringify(d,null,2))}</pre></div></div>`;
}
export function bindClassicEffects(root,getMatch){const box=root.querySelector('[data-classic-effects]');if(!box)return;
 box.querySelectorAll('[data-effect-view]').forEach(button=>{button.onclick=()=>{const dev=button.dataset.effectView==='developer';box.querySelector('[data-effect-player]').hidden=dev;box.querySelector('[data-effect-developer]').hidden=!dev;box.querySelectorAll('[data-effect-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));};});
 box.querySelector('[data-effect-copy]').onclick=async()=>{const text=JSON.stringify(classicEffectsData(getMatch()),null,2),status=box.querySelector('[data-effect-copy-status]');try{await navigator.clipboard.writeText(text);status.textContent=' 已复制完整诊断';}catch(_){const input=document.createElement('textarea');input.value=text;box.append(input);input.select();try{status.textContent=document.execCommand('copy')?' 已复制完整诊断':' 请选中诊断内容手动复制';}finally{input.remove();}}};
}
