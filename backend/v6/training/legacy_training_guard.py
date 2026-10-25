"""Fail closed before legacy scripts read datasets, fit, or export policies.

Supplied scripts use action-imitation labels and 114/130 feature subsets, not the
134->128->64->6 reward actor contract. No environment bypass is provided.
An explicitly reviewed adapter/trainer must consume trusted_dataset exports and
bind its actual snapshot/validation proof; this batch does not implement fitting.
"""
def require_trusted_training_adapter():
    raise RuntimeError('E_LEGACY_TRAINING_BLOCKED: unverified legacy dataset/split/label contract; approved trusted-dataset trainer adapter required')
