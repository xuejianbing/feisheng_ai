export const MODE_SPECIALTIES=Object.freeze([
 {id:'doudizhu-classic',name:'常规斗地主',submodes:['normal','kaihei','huanle'],status:'candidate-validation',description:'公共 AI＋常规规则；独立候选训练与旁路验证'},
 {id:'doudizhu-special',name:'特殊斗地主',submodes:['binglin','online'],status:'planned',description:'兵临／智斗尚未接入专项训练，继续已有公共 AI'},
 {id:'versus-2v2',name:'双人对决',submodes:['two','2v2'],status:'context-validation',description:'已接入公开队伍、规则、座次、留牌、群体牌风险、斩杀机会及设置；实战待验证，未启用专项选将、模型或训练'},
 ...[['identity','身份'],['guozhan','国战'],['versus','对决'],['single','单挑'],['boss','挑战'],['chess','战棋'],['tafang','塔防'],['stone','炉石'],['brawl','乱斗']].map(([id,name])=>({id,name,status:'planned',description:'尚未接入专项训练'}))
]);
