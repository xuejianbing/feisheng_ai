/* 职责：通用出牌顺序、保留牌和盲狙的旧宿主规则。原技能名、回调定义和注册顺序保持不变。 */
import { lib, game, ui, get, ai, _status } from '../../shared/utils.js';
export function registerGlobalRules() {
	if (true) {
		/** 全局AI */
		lib.skill.aiyh_gjcx_qj = {
			mod: {
				aiOrder: (player, card, num) => {
					if (!player._aiyh_order_temp && num > 0 && get.itemtype(card) === 'card' && get.position(card) !== 'e') {
						if (get.type(card) === 'equip') {
							for (let i of get.subtypes(card)) {
								if (!player.hasEnabledSlot(i)) return num;
							}
							player._aiyh_order_temp = true;
							let sub = get.subtype(card),
								dis = player.needsToDiscard(),
								equipValue = get.equipValue(card, player);
							if (!player.isEmpty(sub) && !player.hasSkillTag('noe')) {
								let ec = player.getEquips(sub).reduce((val, carde) => {
									if (lib.filter.canBeReplaced(carde, player)) return Math.min(val, get.equipValue(carde, player));
								}, 20);
								if (equipValue - ec <= 1.2 * Math.max(0, 2 - dis)) {
									delete player._aiyh_order_temp;
									return 0;
								}
								if (card.name !== 'zhuge') num /= 5;
							}
						}
						delete player._aiyh_order_temp;
						if (get.name(card, player) !== 'sha') return Math.max(0.01, num - ((get.number(card) || 0) - 6) / 200);
					}
				},
				aiUseful: (player, card, num) => {
					if (num > 0 && get.itemtype(card) === 'card') {
						if (get.type(card) === 'equip')
							for (let i of get.subtypes(card)) {
								if (!player.hasEnabledSlot(i)) return 0;
							}
						num += ((get.number(card) || 0) - 6) / 100;
						if (get.name(card, player) === 'sha') {
							let nature = get.natureList(card);
							if (nature.includes('fire')) num += 0.08;
							if (nature.includes('thunder')) num += 0.05;
							if (nature.includes('ice')) num += 0.18;
							if (nature.includes('stab')) num += 0.25;
						}
						return Math.max(0.01, num);
					}
				},
				aiValue: (player, card, num) => {
					if (!player._aiyh_value_temp && num > 0 && get.itemtype(card) === 'card') {
						if (get.type(card) === 'equip')
							for (let i of get.subtypes(card)) {
								if (!player.hasEnabledSlot(i)) return 0.01 * num;
							}
						num += ((get.number(card) || 0) - 6) / 50;
						if (get.name(card, player) === 'sha') {
							let nature = get.natureList(card);
							if (nature.includes('fire')) num += 0.18;
							if (nature.includes('thunder')) num += 0.1;
							if (nature.includes('ice')) num += 0.36;
							if (nature.includes('stab')) num += 0.5;
						}
						return Math.max(0.01, num);
					}
				},
			},
			charlotte: true,
			superCharlotte: true,
		};
		// 防酒杀AI
		lib.skill._aiyh_reserved_shan = {
			silent: true,
			locked: true,
			unique: true,
			charlotte: true,
			superCharlotte: true,
			ai: {
				effect: {
					player: (card, player, target) => {
						if (typeof card !== 'object' || player.hp <= 1 || get.name(card, player) !== 'shan') return;
						const par = _status.event.getParent(2);
						if ((par && par.player.hasCard('jiu', 'hs')) && par.player.mayHaveSha(player, 'use')) {
							return 'zeroplayertarget';
						}
					},
				},
			},
		};
	}

	{
		// 盲狙AI
		lib.skill._noScopeSkill = {
			trigger: { player: 'phaseZhunbeiBegin' },
			filter(event, player) {
				return _status.aiyh_configs.noScope && player.phaseNumber === 1 && (player === game.zhu || player.identity === 'zhong');
			},
			silent: true,
			unique: true,
			charlotte: true,
			superCharlotte: true,
			mode: ['identity'],
			async content(event, trigger, player) {
				player.addTempSkill('aiMangju');
			},
		};
		lib.skill.aiMangju = {
			// 盲狙
			forced: true,
			unique: true,
			popup: false,
			silent: true,
			charlotte: true,
			superCharlotte: true,
			mode: ['identity'],
			ai: {
				effect: {
					player(card, player, target, current) {
						let name = get.name(card, player);
						if (get.tag(card, 'damage') && Math.abs(get.attitude(player, target)) < 0.5) {
							if (name === 'juedou') return [1, player.countCards('hs') / 400];
							if (name === 'huogong') return [1, player.countCards('h') / 200];
							if (name === 'sha' && !game.hasNature(card)) {
								if (
									(target.hasSkill('tengjia3') || target.hasSkill('rw_tengjia4')) &&
									!(player.getEquip('qinggang') || player.getEquip('zhuque'))
								)
									return 'zeroplayertarget';
							}
							if (
								name === 'sha' &&
								get.color(card) === 'black' &&
								(target.hasSkill('renwang_skill') || target.hasSkill('rw_renwang_skill'))
							) {
								if (!player.getEquip('qinggang')) return 'zeroplayertarget';
							}
							if (get.attitude(player, target) === 0) return [1, 0.005];
						}
						if (
							name === 'guohe' ||
							name === 'shunshou' ||
							name === 'lebu' ||
							name === 'bingliang' ||
							name === 'caomu' ||
							name === 'zhujinqiyuan' ||
							name === 'caochuanjiejian' ||
							name === 'toulianghuanzhu'
						) {
							if (get.attitude(player, target) === 0) return [1, 0.01];
						}
					},
				},
			},
		};
	}


}
