"""Independent Python forward for the existing client float32-v1 snapshot.
This is not an optimizer or a conversion of legacy LightGBM/130-dim models.
"""
import math,struct
PARAMETER_LENGTHS=dict(W1=134*128,B1=128,W2=128*64,B2=64,W3=64*6,B3=6,W4=64,B4=1,W_proj1=134*128,W_proj2=128*64)
def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]
def check_snapshot(snapshot):
 try:
  if snapshot['parameterFormat']!='float32-v1' or snapshot['META']['version']!=7 or type(snapshot['META']['ready'])!=bool or type(snapshot['adamT'])!=int or snapshot['adamT']<0:raise ValueError()
  for k in ['trained','accuracy']:
   if not math.isfinite(snapshot['META'][k]) or snapshot['META'][k]<0:raise ValueError()
  expected={prefix+k for k in PARAMETER_LENGTHS for prefix in ('','m','v')}|{'META','parameterFormat','adamT'}
  if set(snapshot)!=expected:raise ValueError()
  for key,n in PARAMETER_LENGTHS.items():
   for prefix in ('','m','v'):
    values=snapshot[prefix+key]
    if not isinstance(values,list) or len(values)!=n:raise ValueError()
    for v in values:
     if type(v) not in (float,int) or not math.isfinite(v) or f32(v)!=v or prefix=='v' and v<0:raise ValueError()
     if not prefix and not (-32768<=v<=32767 if key.startswith('B') else -128<=v<=127):raise ValueError()
 except (KeyError,TypeError,ValueError,OverflowError):raise ValueError('E_MODEL_SHAPE') from None
 return snapshot
def predict(snapshot,features,use_residual=False):
 if len(features)!=134 or any(type(v) not in (int,float) or not math.isfinite(v) for v in features):raise ValueError('E_INPUT_SHAPE')
 def layer(x,w,b,projection,width):
  out=[];n=len(x)
  for j in range(width):
   value=sum(w[j*n+i]*x[i] for i in range(n))
   if use_residual:value+=sum(projection[j*n+i]*x[i] for i in range(n))
   value=f32((value+b[j]*128)/128)
   out.append(f32(.5*value*(1+math.tanh(math.sqrt(2/math.pi)*(value+.044715*value*value*value)))))
  mean=sum(out)/width;variance=sum((v-mean)**2 for v in out)/width
  return [f32((v-mean)/math.sqrt(variance+1e-8)) for v in out]
 h1=layer(features,snapshot['W1'],snapshot['B1'],snapshot['W_proj1'],128)
 h2=layer(h1,snapshot['W2'],snapshot['B2'],snapshot['W_proj2'],64)
 logits=[f32((sum(snapshot['W3'][k*64+j]*h2[j] for j in range(64))+snapshot['B3'][k]*128)/128) for k in range(6)]
 value=math.tanh((sum(snapshot['W4'][j]*h2[j] for j in range(64))+snapshot['B4'][0]*128)/128)
 if not all(math.isfinite(v) for v in logits+[value]):raise ValueError('E_INFERENCE')
 return dict(logits=logits,value=value)
