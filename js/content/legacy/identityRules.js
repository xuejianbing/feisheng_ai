/* 职责：身份局主公与内奸的旧宿主规则。原技能名、回调定义和注册顺序保持不变。 */
import { lib, game, ui, get, ai, _status } from '../../shared/utils.js';
export function registerIdentityRules() {
	if (true) {
		// 身份局AI
		lib.skill.gjcx_zhuAi = {
			trigger: { global: 'zhuUpdate' },
			silent: true,
			forced: true,
			unique: true,
			popup: false,
			charlotte: true,
			superCharlotte: true,
			async content(event, trigger, player) {
				const target = game.findPlayer((current) => {
					return current === game.zhu;
				});
				player.removeSkill('gjcx_zhuAi');
				target.addSkill('gjcx_zhuAi');
			},
			ai: {
				effect: {
					player(card, player, target) {
						if (
							typeof card !== 'object' ||
							player._aiyh_zhuAi_temp ||
							player.hasSkill('aiMangju') ||
							get.itemtype(target) !== 'player'
						)
							return;
						player._aiyh_zhuAi_temp = true;
						let att = get.attitude(player, target),
							name = get.name(card, player);
						delete player._aiyh_zhuAi_temp;
						if (Math.abs(att) < 1 && player.needsToDiscard()) {
							if (
								(get.tag(card, 'damage') &&
									name !== 'huogong' &&
									name !== 'juedou' &&
									(target.hp > 1 || player.hasSkillTag('jueqing', false, target))) ||
								name === 'lebu' ||
								name === 'bingliang' ||
								name === 'fudichouxin'
							) {
								return [1, 0.8];
							}
						}
					},
					target(card, player, target) {
						if (typeof card !== 'object' || target._zhuCx_temp || get.itemtype(player) !== 'player') return 1;
						target._zhuCx_temp = true;
						let eff = get.effect(target, card, player, target);
						delete target._zhuCx_temp;
						if (!eff) return;
						if (get.tag(card, 'damage')) return [1, -Math.min(3, 0.8 * target.getDamagedHp()) - 0.6];
						if (get.name(card) === 'lebu' || get.name(card) === 'bingliang') return [1, -0.8];
					},
				},
			},
		};
		lib.skill.gjcx_neiAi = {
			init() {
				game.countPlayer((current) => {
					current.storage.gjcx_neiAi = current.maxHp;
				});
			},
			trigger: {
				global: ['phaseUseBegin', 'changeHp', 'dieAfter', 'zhuUpdate', 'changeIdentity'],
			},
			silent: true,
			forced: true,
			forceDie: true,
			unique: true,
			popup: false,
			priority: -1,
			charlotte: true,
			superCharlotte: true,
			mode: ['identity'],
			filter(event, player) {
				return !player.hasSkill('gjcx_neiAi_nojump') && !player.hasSkill('gjcx_neiAi_suspend');
			},
			async content(event, trigger, player) {
				player.removeSkill('gjcx_neiJiang');
				player.removeSkill('gjcx_neiZhong');
				player.removeSkill('gjcx_neiFan');
				let end = false;
				if (player.identity !== 'nei' || game.players.length <= 2) {
					player.removeSkill('gjcx_neiAi');
					player.removeSkill('gjcx_neiAi_damage');
					player.removeSkill('gjcx_neiAi_expose');
					end = true;
				}
				if (
					trigger.name === 'die' &&
					!game.hasPlayer((current) => {
						return current.identity === 'fan';
					})
				) {
					player.removeSkill('gjcx_neiAi_damage');
					player.addSkill('gjcx_neiAi_nojump');
					end = true;
				}
				if (end) return;
				let zs = game.filterPlayer((current) => {
					return current.identity === 'zhu' || current.identity === 'zhong' || current.identity === 'mingzhong';
				});
				let fs = game.filterPlayer((current) => {
					return current.identity === 'fan';
				});
				let all = 0,
					mine = 0;
				for (let i of game.players) {
					let sym,
						base1 = 1,
						base2 = 0,
						temp = 0;
					if (i === player || zs.includes(i)) sym = 1;
					else if (fs.includes(i)) sym = -1;
					else continue;
					if (i.hp > 0) {
						if (typeof lib.aiyh.qz[i.name] === 'number') base1 = lib.aiyh.qz[i.name];
						if (lib.config.extension_无名AI_takeQz && game.purifySFConfig) {
							let sfc = get.purifySFConfig(lib.config[get.sfConfigName(i.identity)], lib.config.extension_无名AI_min)[
									i.name
								],
								sl = 0.5;
							if (sfc && typeof sfc.sl === 'number') sl = sfc.sl;
							if (sl < 0.4) base1 = 0.6 + sl;
							else if (sl < 0.8) base1 = 2 * sl + 0.2;
							else base1 = 3 * sl - 0.6;
						} else if (lib.config.extension_无名AI_qz && typeof lib.config.extension_无名AI_qz[i.name] === 'number')
							base1 = lib.config.extension_无名AI_qz[i.name];
						else if (false) {
							let rank = lib.rank;
							if (rank.bp.includes(i.name)) base1 = 1.4;
							else if (rank.am.includes(i.name)) base1 = 1.8;
							else if (rank.b.includes(i.name)) base1 = 1.2;
							else if (rank.a.includes(i.name)) base1 = 2.4;
							else if (rank.ap.includes(i.name)) base1 = 2.7;
							else if (rank.c.includes(i.name)) base1 = 0.8;
							else if (rank.s.includes(i.name)) base1 = 3.2;
							else if (rank.d.includes(i.name)) base1 = 0.6;
						}
						lib.aiyh.qz[i.name] = base1;
						if (i.name2 !== undefined) {
							if (typeof lib.aiyh.qz[i.name2] === 'number') base2 = lib.aiyh.qz[i.name2];
							if (lib.config.extension_无名AI_takeQz && game.purifySFConfig) {
								let sfc = get.purifySFConfig(lib.config[get.sfConfigName(i.identity)], lib.config.extension_无名AI_min)[
										i.name2
									],
									sl = 0.5;
								if (sfc && typeof sfc.sl === 'number') sl = sfc.sl;
								if (sl < 0.4) base2 = 0.6 + sl;
								else if (sl < 0.8) base2 = 2 * sl + 0.2;
								else base2 = 3 * sl - 0.6;
							} else if (lib.config.extension_无名AI_qz && typeof lib.config.extension_无名AI_qz[i.name2] === 'number')
								base2 = lib.config.extension_无名AI_qz[i.name2];
							else if (false) {
								let rank = lib.rank;
								if (rank.bp.includes(i.name2)) base2 = 1.4;
								else if (rank.am.includes(i.name2)) base2 = 1.8;
								else if (rank.b.includes(i.name2)) base2 = 1.2;
								else if (rank.a.includes(i.name2)) base2 = 2.4;
								else if (rank.ap.includes(i.name2)) base2 = 2.7;
								else if (rank.c.includes(i.name2)) base2 = 0.8;
								else if (rank.s.includes(i.name2)) base2 = 3.2;
								else if (rank.d.includes(i.name2)) base2 = 0.6;
							}
							lib.aiyh.qz[i.name2] = base2;
						}
						if (base2) base1 = (base1 + base2) / 2;
						if (i.isTurnedOver()) base1 -= 0.28;
						if (i.storage.gjcx_neiAi && i.storage.gjcx_neiAi !== i.maxHp) {
							if (i.maxHp > i.storage.gjcx_neiAi) {
								if (i.hp > i.storage.gjcx_neiAi)
									temp += ((1 + (i.maxHp - i.storage.gjcx_neiAi) / 10) * base1 * i.hp) / i.maxHp;
								else temp += (base1 * i.hp) / i.storage.gjcx_neiAi;
							} else temp += (base1 * i.hp) / Math.min(5, i.storage.gjcx_neiAi);
						} else temp += (base1 * i.hp) / i.maxHp;
					}
					temp += (i.countCards('hes') - i.countCards('j') * 1.6) / 10;
					if (player === i) mine = temp * Math.sqrt(base1);
					else all += sym * temp;
				}
				if (Math.abs(all) < mine && game.zhu.hp > 2 && zs.length > 1) player.addSkill('gjcx_neiJiang');
				else if (all > -0.06) {
					if (all > 0.36 * mine) player.addSkill('gjcx_neiFan');
					else if (fs.length - zs.length > 1) player.addSkill('gjcx_neiZhong');
					else player.addSkill('gjcx_neiJiang');
				} else player.addSkill('gjcx_neiZhong');
			},
			group: 'gjcx_neiAi_clear',
			subSkill: {
				clear: {
					trigger: {
						global: ['zhuUpdate', 'changeIdentity'],
					},
					silent: true,
					firstDo: true,
					charlotte: true,
					superCharlotte: true,
					async content() {
						lib.aiyh.qz = {};
					},
					sub: true,
				},
				damage: {
					mode: ['identity'],
					trigger: { player: 'useCard1' },
					filter(event, player) {
						return get.tag(event.card, 'damage');
					},
					direct: true,
					unique: true,
					lastDo: true,
					charlotte: true,
					superCharlotte: true,
					async content(event, trigger, player) {
						player.addTempSkill('gjcx_neiAi_suspend', { player: 'useCardAfter' });
					},
				},
				expose: {
					mode: ['identity'],
					trigger: { player: 'useCard1' },
					filter(event, player) {
						return !player.identityShown && typeof player.ai.shown === 'number' && player.ai.shown;
					},
					silent: true,
					forced: true,
					unique: true,
					popup: false,
					charlotte: true,
					superCharlotte: true,
					async content(event, trigger, player) {
						if (player.ai.shown >= 0.95 || get.attitude(game.zhu, player) < 0) player.removeSkill('gjcx_neiAi_expose');
						else if (trigger.card.name === 'tao') {
							for (let i of trigger.targets) {
								if (player === i) continue;
								if (get.attitude(game.zhu, i) > 0) player.ai.shown -= 0.5;
								else if (i.identity === 'fan') player.ai.shown = 0.99;
							}
						} else if (
							trigger.targets &&
							trigger.targets.length === 1 &&
							player !== trigger.targets[0] &&
							!player.hasSkill('gjcx_neiZhong') &&
							!player.hasSkill('gjcx_neiJiang') &&
							get.attitude(game.zhu, trigger.targets[0]) * get.effect(trigger.targets[0], trigger.card, player, game.zhu) <
								0
						) {
							player.removeSkill('gjcx_neiAi_expose');
							player.ai.shown = 0.99;
						} else if (!player.hasSkill('gjcx_neiFan')) player.ai.shown -= 0.03;
					},
				},
				suspend: {
					charlotte: true,
					superCharlotte: true,
				},
				nojump: {
					charlotte: true,
					superCharlotte: true,
				},
			},
		};
		lib.skill.gjcx_neiZhong = {
			silent: true,
			forced: true,
			unique: true,
			popup: false,
			charlotte: true,
			superCharlotte: true,
			mode: ['identity'],
			ai: {
				effect: {
					player(card, player, target) {
						if (typeof card !== 'object' || player._aiyh_neiZhong_temp || get.itemtype(target) !== 'player') return 1;
						player._aiyh_neiZhong_temp = true;
						let eff = get.effect(target, card, player, player),
							name = get.name(card, player);
						delete player._aiyh_neiZhong_temp;
						if (!eff) return;
						if ((get.tag(card, 'damage') && name !== 'huogong') || name === 'lebu' || name === 'bingliang') {
							if (target.identity === 'zhu') return [1, -3];
							if (target.ai.shown < 0.95 && get.attitude(game.zhu, target) <= 0) {
								if (player.needsToDiscard()) return [1, 0.5];
								return [0, 0];
							}
							if (target.identity !== 'fan') return [1, -2];
							return [1, 0.9];
						}
						if (name === 'tao') {
							if (
								target === player ||
								target === game.zhu ||
								(_status.event.dying && player.countCards('hs', 'tao') + _status.event.dying.hp <= 0)
							)
								return 1;
							if (target.identity !== 'fan' && game.zhu.hp > 1 && player.hp > 2) return [1, 0.8];
							return [1, -2];
						}
					},
				},
			},
		};
		lib.skill.gjcx_neiFan = {
			silent: true,
			forced: true,
			unique: true,
			popup: false,
			charlotte: true,
			superCharlotte: true,
			mode: ['identity'],
			ai: {
				effect: {
					player(card, player, target) {
						if (typeof card !== 'object' || player._aiyh_neiFan_temp || get.itemtype(target) !== 'player') return;
						player._aiyh_neiFan_temp = true;
						let eff = get.effect(target, card, player, player),
							name = get.name(card, player);
						delete player._aiyh_neiFan_temp;
						if (!eff) return;
						if ((get.tag(card, 'damage') && name !== 'huogong') || name === 'lebu' || name === 'bingliang') {
							if (
								target.identity === 'zhu' &&
								(target.hp < 2 ||
									game.hasPlayer((current) => {
										return current.identity === 'zhong' || current.identity === 'mingzhong';
									}))
							)
								return [1, -3];
							if (target.identity === 'fan') return [1, -2];
							if (target.ai.shown < 0.95) {
								if (player.needsToDiscard()) return [1, 0.5];
								return [0, 0];
							}
							return [1, 0.9];
						}
						if (name === 'tao') {
							if (
								target === player ||
								target === game.zhu ||
								(_status.event.dying && player.countCards('hs', 'tao') + _status.event.dying.hp <= 0)
							)
								return;
							if (target.identity === 'fan' && game.zhu.hp > 1 && player.hp > 2) return [1, 1.6];
							return [1, -2];
						}
					},
				},
			},
		};
		lib.skill.gjcx_neiJiang = {
			silent: true,
			forced: true,
			unique: true,
			popup: false,
			charlotte: true,
			superCharlotte: true,
			mode: ['identity'],
			ai: {
				effect: {
					player(card, player, target) {
						if (typeof card !== 'object' || get.itemtype(target) !== 'player') return;
						let name = get.name(card);
						if ((get.tag(card, 'damage') && name !== 'huogong') || name === 'lebu' || name === 'bingliang') {
							if (target.identity === 'zhu') return [1, -3];
							if (!player.needsToDiscard()) return [0, 0];
							return [1, -0.5];
						}
						if (name === 'tao') {
							if (target === player && game.zhu.hp > 2) return [1, 0.9];
							if (target === player || target === game.zhu) return;
							return [1, -2];
						}
						if (name === 'jiu' && player.hp > 0) return [0, 0];
					},
				},
			},
		};



	}

}
