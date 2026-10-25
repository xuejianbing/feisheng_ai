// Source identity is a persistent client claim. Only the server-issued credential
// grants a namespace. Browser storage/copies are not hardware attestation.
import {safeGet,safeSet} from '../storage/storage.js?v=41a';
import {normalizeIngestReceipt,parseIngestHttpResponse} from './ingestReceipt.js?v=41a';
const ID_KEY='djsc_ingest_source_identity_v1',CREDENTIAL_KEY='djsc_ingest_source_credential_v1';
const fail=code=>{const e=new Error(code);e.code=code;e.kind='source-auth';e.permanent=true;return e;};
const string=v=>typeof v==='string'&&v.length>0&&v.length<=200;
function endpointOf(value){
 let url;try{url=new URL(value);}catch{throw fail('E_SOURCE_ENDPOINT');}
 if(url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw fail('E_SOURCE_ENDPOINT');
 return url.href;
}
export function createSourceIdentity({read=safeGet,write=safeSet,random=globalThis.crypto,fetch:network=(...args)=>globalThis.fetch(...args)}={}){
 const save=(key,value)=>{const raw=JSON.stringify(value);if(!write(key,raw)||read(key)!==raw)throw fail('E_SOURCE_STORAGE_WRITE');};
 function identity(){
  const raw=read(ID_KEY);
  if(raw){let value;try{value=JSON.parse(raw);}catch{throw fail('E_SOURCE_STORAGE_CORRUPT');}
   if(value?.schema!=='client-instance-v1'||!/^ci_[0-9a-f]{32}$/.test(value.instanceId))throw fail('E_SOURCE_STORAGE_CORRUPT');return value.instanceId;}
  if(!random?.getRandomValues)throw fail('E_SOURCE_RANDOM_UNAVAILABLE');
  const bytes=random.getRandomValues(new Uint8Array(16)),instanceId='ci_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  save(ID_KEY,{schema:'client-instance-v1',instanceId});return instanceId;
 }
 function credential(){const raw=read(CREDENTIAL_KEY);if(!raw)return null;try{const c=JSON.parse(raw);if(!c||typeof c!=='object'||Array.isArray(c)||c.schema!=='ingest-source-credential-v1')throw Error();return c;}catch{throw fail('E_SOURCE_CREDENTIAL_CORRUPT');}}
 function validate(value,endpoint){
  if(value?.schema!=='ingest-source-credential-v1'||![value.realmId,value.domain,value.principalId,value.credentialId].every(string)||value.clientInstanceId!==identity()||
   !/^sa1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/.test(value.token||'')||value.token.split('.')[1]!==value.credentialId||!Number.isFinite(value.expiresAt))throw fail('E_SOURCE_CREDENTIAL_BINDING');
  if(endpointOf(value.endpoint)!==endpointOf(endpoint))throw fail('E_SOURCE_ENDPOINT_BINDING');
  return value;
 }
 function install(value,endpoint){validate(value,endpoint);save(CREDENTIAL_KEY,{...value,endpoint:endpointOf(endpoint)});return status();}
 function status(){const c=credential();return {instanceId:identity(),credentialInstalled:!!c,credentialId:c?.credentialId||null,principalId:c?.principalId||null,realmId:c?.realmId||null,
  authorization:'not-verified-by-status',storage:'browser-local; copied credentials require operator revocation'};}
 function envelope(value,endpoint){endpointOf(endpoint);identity();const c=credential();if(!c)return value;validate(c,endpoint);
  return {...value,v:3,source:{schema:'ingest-source-v1',domain:c.domain,instanceId:c.clientInstanceId,principalId:c.principalId,realmId:c.realmId}};
 }
 function bound(value,endpoint){const c=credential();if(!c)throw fail('E_SOURCE_CREDENTIAL_MISSING');validate(c,endpoint);
  if(c.expiresAt*1000<=Date.now())throw fail('E_SOURCE_CREDENTIAL_EXPIRED');
  const s=value.source;if(value.v!==3||s?.schema!=='ingest-source-v1'||s.instanceId!==c.clientInstanceId||s.domain!==c.domain||s.principalId!==c.principalId||s.realmId!==c.realmId)throw fail('E_SOURCE_PENDING_BINDING');return c;
 }
 async function request(value,endpoint,signal){
  // Drain frozen pre-upgrade requests unchanged. Never retrofit a source onto old rows.
  if(!value.source)return {};
  const c=bound(value,endpoint),response=await network(endpointOf(endpoint),{method:'GET',signal,redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.ok){if(response.status===429)await parseIngestHttpResponse(response);const e=fail('E_SOURCE_CAPABILITY_HTTP');e.permanent=[400,401,403,404,426,501].includes(response.status);throw e;}
  let caps;try{caps=await response.json();}catch{throw fail('E_SOURCE_CAPABILITY_UNSUPPORTED');}
  const auth=caps?.sourceAuthentication;
  if(caps?.schema!=='ingest-capabilities-v1'||!Array.isArray(caps.protocolVersions)||!caps.protocolVersions.includes(3)||caps.sourceSchema!=='ingest-source-v1'||!Array.isArray(caps.receiptSchemas)||!caps.receiptSchemas.includes('ingest-receipt-v1')||
    auth?.schema!=='operator-bearer-v1'||auth.requiredForTrusted!==true||auth.enabled!==true)throw fail('E_SOURCE_CAPABILITY_UNSUPPORTED');
  if(auth.realmId!==c.realmId)throw fail('E_SOURCE_REALM_MISMATCH');
  const current=bound(value,endpoint);
  if(current.credentialId!==c.credentialId||current.token!==c.token)throw fail('E_SOURCE_CREDENTIAL_CHANGED');
  return {Authorization:'Bearer '+c.token};
 }
 function verifyReceipt(value,response,endpoint){
  if(!value.source)return;
  const c=bound(value,endpoint),r=response?.receipt,t=r?.sourceTrust;
  if(!normalizeIngestReceipt(response)||t?.status!=='authenticated'||t.eligibleSource!==true||t.realmId!==c.realmId||t.domain!==c.domain||t.principalId!==c.principalId||t.clientInstanceId!==c.clientInstanceId)throw fail('E_SOURCE_RECEIPT_UNCONFIRMED');
 }
 function forgetCredential(){if(!write(CREDENTIAL_KEY,'')||read(CREDENTIAL_KEY)!=='')throw fail('E_SOURCE_STORAGE_WRITE');}
 return {identity,status,install,envelope,request,verifyReceipt,forgetCredential};
}
export const sourceIdentity=createSourceIdentity();
