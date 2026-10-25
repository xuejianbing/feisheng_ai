"""Transport authorization and routing policy; no registration over HTTP."""
import ipaddress,os
from pathlib import Path
from source_auth import SourceAuthority,AuthError

UPLOAD_PATHS={'/','/ingest'}
def proxy_networks(value):
    try:return tuple(ipaddress.ip_network(x.strip(),strict=True) for x in value.split(',') if x.strip())
    except ValueError as e:raise RuntimeError('E_TRUSTED_PROXY_CONFIG') from e
def client_ip(peer,headers,networks=()):
    address=ipaddress.ip_address(peer)
    if not any(address in n for n in networks):return str(address)
    value=headers.get('CF-Connecting-IP') or headers.get('X-Forwarded-For')
    if not value:return str(address)
    try:return str(ipaddress.ip_address(value.strip()))
    except ValueError:raise AuthError('E_PROXY_ADDRESS',400)
def capabilities(authority):
    return dict(schema='ingest-capabilities-v1',service='wuming-ingest',merged_samples=None,protocolVersions=[2,3],sourceSchema='ingest-source-v1',receiptSchemas=['ingest-receipt-v1'],
                sourceAuthentication=dict(schema='operator-bearer-v1',requiredForTrusted=True,enabled=authority is not None,realmId=authority.realm if authority else None,registration='operator-only-offline'),
                legacyArchiveAllowed=True,unauthenticatedTrainingAllowed=False,qualifiedSamples=None)
