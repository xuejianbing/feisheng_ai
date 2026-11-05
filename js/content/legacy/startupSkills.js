/* 职责：开局技能与友方伤害抑制的宿主注册。原技能名、回调定义和注册顺序保持不变。 */
import { lib, game, ui, get, ai, _status } from '../../shared/utils.js';
export function registerStartupSkills() {
	lib.skill._aiyh_firstKs = {
		available(mode) {
			if (_status.connectMode && !game.me) {
				return;
			}
			const configs = ['neiKey', 'findZhong'];
			let obj = { noScope: true };
			for (let name of configs) {
				obj[name] = lib.config[`extension_无名AI_${name}`];
			}
			game.broadcastAll((obj) => {
				lib.skill._aiyh_firstKs.toLoad(obj);
			}, obj);
		},
		toLoad(configs) {
			if (!_status.postReconnect.aiyh_configs) {
				_status.postReconnect.aiyh_configs = [lib.skill._aiyh_firstKs.toLoad, { ...configs }];
			}
			if (!_status.aiyh_configs) {
				_status.aiyh_configs = {};
			}
			for (let name in configs) {
				_status.postReconnect.aiyh_configs[1][name] = configs[name];
				_status.aiyh_configs[name] = configs[name];
			}
		},
		trigger: { global: 'gameStart' },
		silent: true,
		unique: true,
		firstDo: true,
		charlotte: true,
		superCharlotte: true,
		async content(event, trigger, player) {
			if (!_status.aiyh_firstDo) {
				_status.aiyh_firstDo = true;
				const updateSkillThreaten = (skillId, value) => {
					if (!value) {
						return;
					}
					// 更新技能威胁度
					if (!lib.skill[skillId]) {
						lib.skill[skillId] = { ai: { threaten: value } };
					} else if (!lib.skill[skillId].ai) {
						lib.skill[skillId].ai = { threaten: value };
					} else {
						lib.skill[skillId].ai.threaten = value;
					}
				};
				// 配置技能威胁度
				for (const skillId in lib.config.extension_无名AI_cf) {
					updateSkillThreaten(skillId, lib.config.extension_无名AI_cf[skillId]);
				}
				// 自动补充技能威胁度
				const processMode = 'off';
				if (processMode === 'pj' || processMode === 'pz') {
					const list = _status.connectMode ? get.charactersOL() : get.gainableCharacters();
					for (const charId of list) {
						const charInfo = lib.character[charId];
						if (!charInfo || charInfo.length < 4) {
							continue;
						}

						// 设置稀有度权重
						let allValue;
						if (processMode === 'pj') {
							// 根据评级补充
							const { rank } = lib;
							if (rank.bp.includes(charId)) {
								allValue = 1.4;
							} else if (rank.am.includes(charId)) {
								allValue = 1.8;
							} else if (rank.b.includes(charId)) {
								allValue = 1.2;
							} else if (rank.a.includes(charId)) {
								allValue = 2.4;
							} else if (rank.bm.includes(charId)) {
								// 跳过该角色
								continue;
							} else if (rank.ap.includes(charId)) {
								allValue = 2.7;
							} else if (rank.c.includes(charId)) {
								allValue = 0.8;
							} else if (rank.s.includes(charId)) {
								allValue = 3.2;
							} else if (rank.d.includes(charId)) {
								allValue = 0.6;
							} else {
								continue;
							}
						} else {
							// 根据品质补充
							const rarity = game.getRarity(charId);
							if (rarity === 'rare') {
								allValue = 1.2;
							} else if (rarity === 'epic') {
								allValue = 1.8;
							} else if (rarity === 'legend') {
								allValue = 2.4;
							} else if (rarity === 'junk') {
								allValue = 0.8;
							} else {
								continue;
							}
						}

						// 处理角色技能
						const skills = charInfo[3].filter((skillId) => !(lib.skill[skillId] && lib.skill[skillId].juexingji));

						if (skills.length > 0) {
							const baseThreat = Math.pow(allValue, 1 / skills.length);
							for (const skillId of skills) {
								const skill = lib.skill[skillId];
								// 仅在威胁度未定义时设置
								if (!(skill && skill.ai && skill.ai.threaten)) {
									const finalThreat = (skill && skill.ai && skill.ai.maixie_defend) ? 0.8 * baseThreat : baseThreat;
									updateSkillThreaten(skillId, finalThreat);
								}
							}
						}
					}
				}
			}
			player.addSkill('aiyh_gjcx_qj');

			// 身份局专属AI
			if (get.mode() === 'identity' && !['zhong', 'purple'].includes(_status.mode)) {
				if (player.identity === 'nei') {
					player.addSkill(['gjcx_neiAi', 'gjcx_neiAi_expose', 'gjcx_neiAi_damage']);
				}
				if (player === game.zhu) {
					player.addSkill('gjcx_zhuAi');
				}
			}
		},
		ai: {
			effect: {
				target(card, player, target) {
					if (get.itemtype(target) !== 'player') {
						return;
					}
					let base1 = 1;
					if (typeof lib.aiyh.qz[target.name] === 'number') {
						base1 = lib.aiyh.qz[target.name];
					/* 首局 arenaReady 前 qz 配置可能尚未创建，读取前必须判空。 */
					} else if (lib.config.extension_无名AI_qz && typeof lib.config.extension_无名AI_qz[target.name] === 'number') {
						base1 = lib.config.extension_无名AI_qz[target.name];
					}
					if (target.name2 === undefined) {
						return base1;
					}
					if (typeof lib.aiyh.qz[target.name2] === 'number') {
						return base1 + lib.aiyh.qz[target.name2];
					}
					if (lib.config.extension_无名AI_qz && typeof lib.config.extension_无名AI_qz[target.name2] === 'number') {
						return base1 + lib.config.extension_无名AI_qz[target.name2];
					}
					return base1;
				},
			},
		},
	};

	// AI不砍队友
	lib.skill._aiyh_holdFire = {
		silent: true,
		unique: true,
		charlotte: true,
		superCharlotte: true,
		ai: {
			effect: {
				player(card, player, target) {
					/* 配置未初始化（旧存档）：走安全默认值，不抑制 */
					const holdFireCfg = lib.config.extension_无名AI_holdFire;
					if (holdFireCfg === undefined) return;
					if (
						holdFireCfg === 'off' ||
						player._holdFire_temp ||
						get.itemtype(target) !== 'player' ||
						player === game.me
					) {
						return;
					}
					if (
						get.tag(card, 'damage') &&
						card.name !== 'huogong' &&
						(!lib.config.extension_无名AI_ntAoe || (get.info(card) && get.info(card).selectTarget !== -1)) &&
						get.attitude(player, target) > 0
					) {
						let num = 0;
						if (holdFireCfg === 'ph') num = player.hp;
						else {
							num = parseInt(holdFireCfg, 10);
							/* 非法值（如用户手改）：退化为阈值 1 */
							if (!Number.isFinite(num) || num < 0) num = 1;
						}
						if (target.hp > num) {
							return;
						}
						player._holdFire_temp = true;
						let eff = get.effect(target, card, player, player);
						delete player._holdFire_temp;
						/* 从使用者视角看，对友方出伤害牌 → eff < 0；此时应抑制 */
						if (eff < 0) {
							return [1, 0, 1, -1 - eff];
						}
					}
				},
			},
		},
	};

}
