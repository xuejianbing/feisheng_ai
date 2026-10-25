"""Finite canonical JSON and fsynced, explicit-path offline output only."""
import hashlib,json,os,pathlib,tempfile
def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')
def content_hash(value):return hashlib.sha256(encoded(value)).hexdigest()
def file_hash(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def read(path):
 def invalid(value):raise ValueError('E_NONFINITE_JSON')
 return json.loads(pathlib.Path(path).read_text(encoding='utf-8'),parse_constant=invalid)
def write_new(path,value):
 path=pathlib.Path(path);body=encoded(value)
 with path.open('xb') as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
def write_status(path,value):
 path=pathlib.Path(path);fd,name=tempfile.mkstemp(prefix='status-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as stream:stream.write(encoded(value));stream.flush();os.fsync(stream.fileno())
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
