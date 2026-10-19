"""Shared, Blender-independent guards for the stable-orbit NORMAL audit.

Translations do not intentionally rotate normals. Extending the bridge's ends
also retains its bevel cross-section. Blender's material join nevertheless
re-evaluates corner normals from float32 coordinates: the accepted source has
~1.2 mm bevel edges, while ~20 m batch-local coordinates have a ~1.9 micrometre
ULP. That conditioning can amplify coordinate rounding to ~1e-3 radians; it is
not the ~1e-7 rounding of a stored unit normal itself.

Keep the pre-existing 0.00175 component contract, tightened to the unit-vector
chord for 0.1 degrees, AND enforce the actual angle. This is a policy ceiling,
not a fit to measured maxima or permission to alter geometry. Only explicitly
approved transformed source corners get this allowance; all others are exact.
"""
import math

FLOAT32_EPSILON = 2.0 ** -23
# Three float32 components plus normalization/sqrt rounding, not a shading budget.
NORMAL_UNIT_LENGTH_TOLERANCE = 4 * FLOAT32_EPSILON
NORMAL_ANGLE_TOLERANCE_DEGREES = 0.1
NORMAL_COMPONENT_TOLERANCE = 2 * math.sin(math.radians(NORMAL_ANGLE_TOLERANCE_DEGREES) / 2)


def validate_exported_normals(normals, context):
    """Reject malformed raw accessor data BEFORE any normalization can hide it."""
    maximum = 0.0
    for index, normal in enumerate(normals):
        assert len(normal) == 3 and all(math.isfinite(float(v)) for v in normal), (
            'Non-finite or malformed exported NORMAL', context, index)
        error = abs(math.hypot(*normal) - 1.0)
        assert error <= NORMAL_UNIT_LENGTH_TOLERANCE, (
            'Non-unit exported NORMAL', context, index, error, NORMAL_UNIT_LENGTH_TOLERANCE)
        maximum = max(maximum, error)
    return maximum


def assert_normal_preserved(normal, candidates, transformed, raw_normal, raw_candidates,
                            context, allow_transformed=True):
    """Enforce one actual corner match, not independent minima of its metrics.

The caller supplies position/UV-equivalent baseline candidates, normalized in
the same world frame. Raw values retain strict unrelated-accessor equality.
Returns (candidate index, component error, angle in degrees).
"""
    assert len(candidates) and len(candidates) == len(transformed) == len(raw_candidates)
    assert all(math.isfinite(float(v)) for v in normal), ('Non-finite world NORMAL', context)
    comparisons = []
    for index, candidate in enumerate(candidates):
        assert all(math.isfinite(float(v)) for v in candidate), ('Non-finite baseline NORMAL', context)
        component = max(abs(float(a) - float(b)) for a, b in zip(normal, candidate))
        # atan2 stays stable for exact/tiny angles, unlike acos near a dot of one.
        cross = (normal[1]*candidate[2] - normal[2]*candidate[1],
                 normal[2]*candidate[0] - normal[0]*candidate[2],
                 normal[0]*candidate[1] - normal[1]*candidate[0])
        angle = math.degrees(math.atan2(math.hypot(*cross), sum(a*b for a, b in zip(normal, candidate))))
        exact = all(a == b for a, b in zip(raw_normal, raw_candidates[index])) and component == 0
        permitted = exact or (allow_transformed and transformed[index]
            and component <= NORMAL_COMPONENT_TOLERANCE and angle <= NORMAL_ANGLE_TOLERANCE_DEGREES)
        comparisons.append((not permitted, component, angle, index))
    failed, component, angle, index = min(comparisons)
    assert not failed, ('Exported shading NORMAL changed beyond approved precision', context,
        'component', component, 'angle_degrees', angle,
        'transformed', bool(allow_transformed and transformed[index]))
    return index, component, angle
