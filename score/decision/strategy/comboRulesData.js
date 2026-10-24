/* comboRulesData.js - 由 combo_rules.json 自动生成（P1_ComboRules_Build.py），勿手改 */
export const COMBO_RULES = {
  "version": "v2_hard_soft",
  "generated_at": "2026-10-22T18:43:19",
  "layers": {
    "hard_force": "模型推理之前评估；condition 全部为 true 且 action 合法时，强制执行 action，模型不再参与该决策（最高 priority 胜出）",
    "soft_boost": "仅通过 comboChain.js 的 chainBonus 给候选加分，不得强制覆盖模型输出；force_unsafe=true 的规则永久禁止进入 hard_force"
  },
  "evaluation_order": [
    "hard_force 规则（按 priority 降序）",
    "soft_boost 软加分（叠加到候选分）",
    "Worker/策略模型兜底"
  ],
  "hard_force_threshold": 0.6,
  "hard_force_ids": [
    "CR_jiu_sha",
    "CR_zhuge_burst"
  ],
  "soft_boost_ids": [
    "CR_guohe_sha_lowhp",
    "CR_tiesuo_huogong",
    "CR_shunshou_sha_lowhp",
    "CR_juedou_sha"
  ],
  "token_dictionary": {
    "<card>_used": "本回合自己出牌阶段已打出该卡（读取本回合动作序列）",
    "<card>_in_hand": "手牌中存在该卡（comboChain.js detectChains 的 handNames 判定）",
    "sha_count_ge_2": "手牌杀数量 >= 2（me.countCards(\"hs\",\"sha\")）",
    "enemy_hp_le_2": "存在 HP<=2 的敌方（对应训练特征 f20>0）",
    "enemy_linked": "存在被横置的敌方（playerState.isPlayerLinked）",
    "zhuge_equipped": "已装备诸葛连弩（me.getEquip(\"zhuge\")）"
  },
  "rules": [
    {
      "id": "CR_jiu_sha",
      "name": "酒→杀斩杀（酒已用且有杀，强制续杀）",
      "layer": "hard_force",
      "recommended_layer": "hard_force",
      "client_chain": "jiu_sha",
      "priority": 95,
      "condition": [
        "jiu_used",
        "sha_in_hand"
      ],
      "action": "card:sha",
      "confidence": 0.7937,
      "evidence": {
        "n": 28265,
        "hits": 22434,
        "empirical_p": 0.7937,
        "empirical_p_lowhp": 0.8258,
        "empirical_p_base": 0.7555,
        "client_chain_wins": "5/5=100%（jiu_sha 连招上报）",
        "note": "门控=用酒时f2(有杀)>0；自己出牌阶段用酒后下一张杀伤害+1，有杀必出"
      }
    },
    {
      "id": "CR_guohe_sha_lowhp",
      "name": "过河拆桥→杀（拆牌压残血，补刀）",
      "layer": "soft_boost",
      "recommended_layer": "soft_boost",
      "client_chain": "strip_sha",
      "client_bonus": 2.5,
      "priority": 80,
      "condition": [
        "guohe_used",
        "sha_in_hand",
        "enemy_hp_le_2"
      ],
      "action": "card:sha",
      "confidence": 0.3883,
      "evidence": {
        "n": 5254,
        "hits": 2040,
        "empirical_p": 0.3883,
        "empirical_p_base": 0.2929,
        "note": "门控概率 38.8% < 0.60，不做强制；走 comboChain.js strip_sha 软加分"
      }
    },
    {
      "id": "CR_tiesuo_huogong",
      "name": "铁索连环→火攻（横置后属性引爆）",
      "layer": "soft_boost",
      "recommended_layer": "soft_boost",
      "force_unsafe": true,
      "client_chain": "tiesuo_fire",
      "client_bonus": 3.5,
      "priority": 85,
      "condition": [
        "tiesuo_used",
        "huogong_in_hand",
        "enemy_linked"
      ],
      "action": "card:huogong",
      "confidence": 0.0446,
      "evidence": {
        "n": 40319,
        "hits": 1800,
        "empirical_p_unconditional": 0.0446,
        "gated_p": "不可测量（114维特征无火攻手牌/横置状态字段）",
        "client_chain": "tiesuo_fire 整周期触发 0 次，仅 bonus=3.5 软加分",
        "note": "门控后真实概率无法验证；永久禁止强制，只能软加分"
      }
    },
    {
      "id": "CR_shunshou_sha_lowhp",
      "name": "顺手牵羊→杀（顺牌后补刀）",
      "layer": "soft_boost",
      "recommended_layer": "soft_boost",
      "client_chain": "strip_sha",
      "client_bonus": 2.5,
      "priority": 78,
      "condition": [
        "shunshou_used",
        "sha_in_hand",
        "enemy_hp_le_2"
      ],
      "action": "card:sha",
      "confidence": 0.2697,
      "evidence": {
        "n": 4491,
        "hits": 1211,
        "empirical_p": 0.2697,
        "empirical_p_base": 0.2241,
        "note": "门控概率 27.1% < 0.60，不做强制；走 comboChain.js strip_sha 软加分"
      }
    },
    {
      "id": "CR_juedou_sha",
      "name": "决斗→杀（决斗后持杀压制）",
      "layer": "soft_boost",
      "recommended_layer": "soft_boost",
      "client_chain": "jue_lengtai",
      "client_bonus": 1.8,
      "priority": 70,
      "condition": [
        "juedou_used",
        "sha_in_hand"
      ],
      "action": "card:sha",
      "confidence": 0.3515,
      "evidence": {
        "n": 16768,
        "hits": 5894,
        "empirical_p": 0.3515,
        "empirical_p_base": 0.2915,
        "client_chain_wins": "2/2=100%（jue_lengtai 连招上报）",
        "note": "门控概率 35.3% < 0.60，不做强制；走 comboChain.js jue_lengtai 软加分"
      }
    },
    {
      "id": "CR_zhuge_burst",
      "name": "连弩+多杀（诸葛连弩已装备且杀≥2）",
      "layer": "hard_force",
      "recommended_layer": "hard_force",
      "client_chain": "zhuge_burst",
      "priority": 75,
      "condition": [
        "zhuge_equipped",
        "sha_count_ge_2"
      ],
      "action": "card:sha",
      "confidence": 0.9,
      "evidence": {
        "client_chain_wins": "8/9=89%（zhuge_burst 连招上报）",
        "note": "序列统计无法直接取装备状态，confidence 取自客户端连招胜率"
      }
    }
  ]
};
export const HARD_FORCE_RULES = COMBO_RULES.rules.filter(r => r.layer === 'hard_force');
export const SOFT_BOOST_RULES = COMBO_RULES.rules.filter(r => r.layer === 'soft_boost');
export default COMBO_RULES;
