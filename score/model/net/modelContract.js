/*
 * modelContract.js — model input/output contract validation.
 */
export const FORMAL_CONTRACT={featureDim:134,hiddenDims:[128,64],actionOutputs:6,criticOutputs:1,weightType:'int8',version:7};
export const LEGACY_CONTRACT={featureDim:130,hiddenDims:[128,64],actionOutputs:6,criticOutputs:1,weightType:'int8',version:6};
export const EXPERIMENTAL_DIMS=[142,150];

export function inferContractFromWeights(weights) {
  if (!weights) return {error:'null-weights'};
  if (weights.dims && Array.isArray(weights.dims)) {
    const dims=weights.dims;
    return {featureDim:weights.featureDim??dims[0],hiddenDims:dims.slice(1,-1),
      actionOutputs:dims[dims.length-1],criticOutputs:weights.hasCritic?1:0,
      version:weights.version??weights.VERSION??null};
  }
  if (weights.W && Array.isArray(weights.W)) {
    const layers=weights.W;
    const featureDim=weights.featureDim??(layers[0]&&layers[0].length)??0;
    const actionOutputs=layers[layers.length-1]&&layers[layers.length-1].length;
    return {featureDim,hiddenDims:layers.slice(0,-1).map(l=>l.length),actionOutputs,
      criticOutputs:weights.criticW?1:0,version:weights.version??null};
  }
  if (weights.featureDim && weights.outputDim) {
    return {featureDim:weights.featureDim,hiddenDims:weights.hiddenDims||[],
      actionOutputs:weights.outputDim,criticOutputs:weights.hasCritic?1:0,version:weights.version??null};
  }
  return {error:'unrecognized-weight-format'};
}
export function verifyModelContract(weights, expectedContract=FORMAL_CONTRACT) {
  const actual=inferContractFromWeights(weights);
  if (actual.error) return {ok:false,expected:expectedContract,actual,mismatches:[actual.error],reason:actual.error};
  const mismatches=[];
  if (actual.featureDim!==expectedContract.featureDim)
    mismatches.push('featureDim: expected='+expectedContract.featureDim+' actual='+actual.featureDim);
  if (actual.actionOutputs!==expectedContract.actionOutputs)
    mismatches.push('actionOutputs: expected='+expectedContract.actionOutputs+' actual='+actual.actionOutputs);
  if (expectedContract.criticOutputs>0 && actual.criticOutputs!==expectedContract.criticOutputs)
    mismatches.push('criticOutputs: expected='+expectedContract.criticOutputs+' actual='+actual.criticOutputs);
  // Check these only when source metadata actually exposes them.
  if (Array.isArray(actual.hiddenDims) && actual.hiddenDims.length>0 &&
      JSON.stringify(actual.hiddenDims)!==JSON.stringify(expectedContract.hiddenDims))
    mismatches.push('hiddenDims: expected='+JSON.stringify(expectedContract.hiddenDims)+' actual='+JSON.stringify(actual.hiddenDims));
  if (actual.version!=null && expectedContract.version!=null && actual.version!==expectedContract.version)
    mismatches.push('version: expected='+expectedContract.version+' actual='+actual.version);
  if (EXPERIMENTAL_DIMS.includes(actual.featureDim))
    mismatches.push('experimental-dim:'+actual.featureDim+'-not-formal-contract');
  return {ok:mismatches.length===0,expected:expectedContract,actual,mismatches,reason:mismatches.length?mismatches.join('; '):null};
}
export function isLegacy130Model(weights) {
  const actual=inferContractFromWeights(weights);
  return !actual.error && actual.featureDim===130 && actual.actionOutputs===6;
}
export function isExperimentalModel(weights) {
  const actual=inferContractFromWeights(weights);
  return !actual.error && EXPERIMENTAL_DIMS.includes(actual.featureDim);
}
export function contractSummary(weights) {
  const actual=inferContractFromWeights(weights);
  if (actual.error) return '无法识别权重格式';
  return '输入'+actual.featureDim+'维 → '+(actual.hiddenDims.length?actual.hiddenDims.join('→')+'→':'')+
    actual.actionOutputs+'动作'+(actual.criticOutputs?'+Critic':'')+(actual.version?' v'+actual.version:'');
}
