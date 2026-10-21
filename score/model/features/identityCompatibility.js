import {identityMode} from '../../perception/observer/identityFacts.js?v=41a';

/* 临时隔离：142 维的形状相同不代表新旧身份特征语义兼容。
 * 新 schema/dataEpoch/模型发布契约到位前，身份场不推理、不输出新训练样本。 */
export function identityModelCompatibility(mode = identityMode()) {
    const paused = mode === 'identity';
    return {allowed:!paused,sampleAllowed:!paused,status:paused?'paused':'legacy',
        reason:paused?'identity-feature-schema-migration':null,
        featureSchema:paused?'identity-visible-hard-v1':'legacy-142',
        compatibility:paused?'incompatible':mode==='doudizhu'?'legacy-public-role':'legacy-unreviewed'};
}
