/* Recognize the responder's own current trick-response window without inheriting outer actions. */
export function trickResponseContext(player,event,names){
 try{
  const seen=new Set();let choice=null,e=event;
  while(e&&!seen.has(e)&&seen.size<24){
   seen.add(e);if(e.finished)return null;
   if(names.includes(e.name)){
    if(!choice)return null;
    return {root:e,event:choice};
   }
   if(e.name==='chooseToRespond'||e.name==='chooseToUse'){
    if(choice||e.player!==player)return null;
    choice=e;
   }else if(['useCard','useSkill','respond','damage','dying'].includes(e.name))return null;
   e=e.parent||e.getParent?.();
  }
 }catch(_){}
 return null;
}
