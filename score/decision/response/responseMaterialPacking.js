/* Feasibility over already validated, static one/two-card response options.
 * A material is a vertex, a two-material response is an edge. Maximum matching
 * handles shared materials and odd cycles without depending on option order.
 */
function hasPairMatching(graph,required){
 const n=graph.length,match=Array(n).fill(-1);
 let parent,base,used,blossom,queue;
 function commonBase(a,b){
  const path=Array(n).fill(false);
  for(;;){a=base[a];path[a]=true;if(match[a]===-1)break;a=parent[match[a]];}
  for(;;){b=base[b];if(path[b])return b;b=parent[match[b]];}
 }
 function markPath(v,b,child){
  while(base[v]!==b){
   blossom[base[v]]=blossom[base[match[v]]]=true;
   parent[v]=child;child=match[v];v=parent[match[v]];
  }
 }
 function augment(root){
  parent=Array(n).fill(-1);base=Array.from({length:n},(_,i)=>i);
  used=Array(n).fill(false);queue=[root];used[root]=true;
  for(let head=0;head<queue.length;head++){
   const v=queue[head];
   for(const neighbor of graph[v]){
    let u=neighbor;
    if(base[v]===base[u]||match[v]===u)continue;
    if(u===root||match[u]!==-1&&parent[match[u]]!==-1){
     const b=commonBase(v,u);blossom=Array(n).fill(false);
     markPath(v,b,u);markPath(u,b,v);
     for(let i=0;i<n;i++)if(blossom[base[i]]){
      base[i]=b;if(!used[i]){used[i]=true;queue.push(i);}
     }
    }else if(parent[u]===-1){
     parent[u]=v;
     if(match[u]===-1){
      while(u!==-1){const p=parent[u],next=p===-1?-1:match[p];match[u]=p;if(p!==-1)match[p]=u;u=next;}
      return true;
     }
     u=match[u];used[u]=true;queue.push(u);
    }
   }
  }
  return false;
 }
 let count=0;
 for(let v=0;v<n;v++)if(match[v]===-1&&augment(v)&&++count>=required)return true;
 return false;
}

export function hasDisjointResponseMaterials(options,required){
 if(!Number.isSafeInteger(required)||required<1)return false;
 const singles=new Set(),pairs=[];
 for(const option of options||[]){
  const cards=option?.cards;
  if(!Array.isArray(cards)||!cards.length||cards.length>2||cards.some(c=>!c||typeof c!=='object'))continue;
  if(cards.length===1)singles.add(cards[0]);
  else if(cards[0]!==cards[1])pairs.push(cards);
 }
 // Taking a single-card response cannot lower capacity: replace any pair using
 // it with that single, freeing the pair's other card. Duplicate skills count once.
 const remaining=required-singles.size;
 if(remaining<=0)return true;
 const index=new Map(),graph=[];
 const vertex=card=>{if(!index.has(card)){index.set(card,index.size);graph.push(new Set());}return index.get(card);};
 for(const [a,b] of pairs){
  if(singles.has(a)||singles.has(b))continue;
  const x=vertex(a),y=vertex(b);graph[x].add(y);graph[y].add(x);
 }
 if(Math.floor(graph.length/2)<remaining)return false;
 return hasPairMatching(graph,remaining);
}
