/* 职责：依据样本、准确率和调用时状态生成训练建议文本，不改变配置/权重。 */
import { bufferSize } from '../../model/train/trainExport.js';
import { getAccuracy } from '../../model/weights/weights.js';
import { cfg } from '../../foundation/config/util.js';
function _swallow(e) { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (_) {} }
/* ★ 动态推荐（训练完成弹窗 & 模型状态面板共用）
 * 依据样本量 + 准确率 + 校准信任动态给出学习率/残差/学习状态/AI 强度建议，
 * 防止过拟合、防数据污染，并强调让模型保持学习、不下放休闲档。 */
export async function buildTrainingRecommendation(accArg, nArg, _state) {
    const L = [];
    try {
        /* 优先使用调用方传入的训练结果，避免读到候选期前的旧模型（0.0%） */
        const N = (typeof nArg === 'number' && nArg > 0) ? nArg : (bufferSize() || 0);
        const accuracy = (typeof accArg === 'number' && accArg >= 0) ? accArg : (getAccuracy() || 0);
        let calibTrust = 0;
        try { calibTrust = (window.__DJSC.calibrator && window.__DJSC.calibrator.modelTrust()) || 0; } catch (e) { _swallow(e); }
        let lr = 0.005;
        try { lr = Number(cfg('learningRate', 0.005)) || 0.005; } catch (e) { lr = 0.005; }
        const ready = (window.__DJSC.weightsReady ? window.__DJSC.weightsReady() : true);

        /* ★ 异常检测：样本充足却准确率极低 → 本次训练异常，提示先查数据/重训，而非盲目继续 */
        const lowAcc = (N >= 200 && accuracy < 0.1);

        /* ① 学习率：样本量 × 准确率 双因子校正（防过拟合） */
        let lrRec;
        if (N === 0) lrRec = '0.001';
        else if (lowAcc) lrRec = '0.002';  /* 准确率异常时降学习率排查，不盲目提速 */
        else if (accuracy > 0.85) lrRec = '0.002';
        else if (N < 150) lrRec = '0.002';
        else if (N < 400) lrRec = '0.003';
        else if (N < 1000) lrRec = '0.004';
        else if (accuracy >= 0.65) lrRec = '0.004';
        else lrRec = '0.005';
        if (lowAcc) L.push('⚠ 本次训练准确率异常（' + (accuracy * 100).toFixed(0) + '%），可能数据/标签问题，建议检查后【重训】验证');
        L.push('学习率 → ' + lrRec + (Math.abs(lr - Number(lrRec)) > 0.0001 ? '（当前 ' + lr + '，已按样本' + N + '条 + 准确率' + (accuracy * 100).toFixed(0) + '% 校准）' : '（已匹配当前基线）'));

        /* ② 残差连接：深模型需样本支撑 */
        if (N >= 300) L.push('残差连接 → 建议【开】（样本充足，可更深学习）');
        else L.push('残差连接 → 建议【关】（样本仅 ' + N + ' 条，深网络易过拟合，攒够 300 条再开）');

        /* ③ 学习状态（保持学习，不躺平） */
        if (lowAcc) {
            L.push('学习状态 → 本次训练异常（0%），模型不可信，建议点【重训】再验证，先别依赖它做决策');
        } else if (!ready) {
            L.push('学习状态 → 模型未就绪，请【手动训练】进入学习');
        } else if (_state === 'training') {
            L.push('学习状态 → 训练中，跑完自动进入 A/B 对比');
        } else if (calibTrust < 0) {
            L.push('学习状态 → 校准信任偏低(' + (calibTrust * 100).toFixed(0) + '%)，建议【再训练】修正而非调休闲');
        } else if (N < 100) {
            L.push('学习状态 → 样本偏少(' + N + ')，再多打几局积累，模型持续进步');
        } else if (N >= 1000 && accuracy < 0.6) {
            L.push('学习状态 → 样本 ' + N + ' 条（含内置基线）但准确率仅 ' + (accuracy * 100).toFixed(0) + '%，多打真实对局持续学习，别停');
        } else {
            L.push('学习状态 → 模型在学习（样本 ' + N + '），可定期【手动训练】稳步提升');
        }

        /* ⑤ AI 强度：避免下放休闲档，异常时不盲目上线 */
        if (lowAcc) {
            L.push('AI 强度 → 暂用规则/旧模型兜底，本次训练异常未修复前不宜调强上线');
        } else if (calibTrust < -0.1) {
            L.push('AI 强度 → 中（校准信任下滑，先稳住并再训练，别急着降档）');
        } else if (accuracy >= 0.68 && accuracy <= 0.85) {
            L.push('AI 强度 → 强（模型真强且校准信任正常，保持全力发挥）');
        } else if (accuracy >= 0.85) {
            L.push('AI 强度 → 中（准确率异常偏高警惕过拟合，暂调中档验证泛化）');
        } else {
            L.push('AI 强度 → 中~强（保持模型有存在感，避免太休闲；打不赢再调强）');
        }
    } catch (e) {
        L.push('推荐生成失败：' + String(e));
    }
    return L.map(function (t, i) { return '  ' + (i + 1) + '. ' + t; }).join('\n');
}
