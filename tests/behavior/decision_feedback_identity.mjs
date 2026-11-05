/* 使用合成样本验证事务身份隔离，不加载或覆盖用户历史训练数据。 */
import { eq, loadScore, finish } from './_harness.mjs';

const training = await loadScore('model/train/trainExport.js');
training.trainClearBuffer();
const player = { name: 'actor-a', name1: 'actor-a' };
const action = { type: 'card', id: 'sha', _conf: 0.5 };
const features = new Array(130).fill(2);
training.trainRecordSample(player, action, {}, 8, features, { decisionId: 'decision-1' });
training.trainRecordSample(player, action, {}, 8, features, { decisionId: 'decision-2' });
const rows = training.getSamples();
eq(rows.length, 2, '同特征不同真实决策保持独立样本');
const feedback = { decisionId: 'decision-2', type: 'card', id: 'sha', player: 'actor-a', campNet: 12, gain: 6, sign: 1 };
eq(training.trainFeedbackSample(feedback), 1, '反馈只匹配指定决策事务');
eq(rows.filter(x => x.fbAsync).length, 1, '另一个同动作样本不被串写');
eq(rows.find(x => x.m.decisionId === 'decision-1').fbAsync, undefined, '未匹配事务保持未回填');
eq(training.trainFeedbackSample(feedback), 0, '重复反馈不得重复回填');
eq(training.trainFeedbackSample({ ...feedback, decisionId: undefined }), 0, '无事务身份的旧反馈不做模糊回填');
training.trainClearBuffer();
finish('Decision feedback identity');
