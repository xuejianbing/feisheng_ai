// Offline Node process only. No replacement of client model/optimizer functions.
const source='const s=globalThis.__NONAME_STUB;export const lib=s.lib,game=s.game,get=s.get,_status=s._status,ui=s.ui,ai=s.ai;';
const stub='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
export async function resolve(specifier,context,next){
 if(/(^|\/)noname\.js(\?|$)/.test(specifier))return {url:stub,format:'module',shortCircuit:true};
 return next(specifier,context);
}
